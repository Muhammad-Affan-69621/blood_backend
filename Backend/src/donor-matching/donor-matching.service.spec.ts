import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  BloodGroup,
  BloodRequestStatus,
  UserRoleType,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DonorMatchingService } from './donor-matching.service';

describe('DonorMatchingService', () => {
  const recipientId = '11111111-1111-4111-8111-111111111111';
  const requestId = '22222222-2222-4222-8222-222222222222';
  const requestLocationId = '33333333-3333-4333-8333-333333333333';

  const recipient = {
    user: { status: UserStatus.ACTIVE },
  };

  const request = {
    id: requestId,
    bloodGroup: BloodGroup.A_POSITIVE,
    city: 'Quetta',
    unitsNeeded: 2,
    hospitalName: 'City Hospital',
    urgency: 'HIGH',
    status: BloodRequestStatus.OPEN,
    locationId: requestLocationId,
  };

  const makeDonor = (userId: string, overrides: Record<string, unknown> = {}) => ({
    userId,
    bloodGroup: BloodGroup.O_NEGATIVE,
    city: 'Quetta',
    isAvailable: true,
    verificationStatus: VerificationStatus.VERIFIED,
    dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
    weightKg: { toNumber: () => 65 },
    lastDonationDate: null,
    locationId: '44444444-4444-4444-8444-444444444444',
    user: {
      status: UserStatus.ACTIVE,
      roles: [{ role: UserRoleType.DONOR }],
    },
    ...overrides,
  });

  let prisma: {
    userRole: { findFirst: jest.Mock };
    bloodRequest: { findFirst: jest.Mock };
    donorProfile: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: DonorMatchingService;

  beforeEach(() => {
    prisma = {
      userRole: {
        findFirst: jest.fn().mockResolvedValue(recipient),
      },
      bloodRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
      },
      donorProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    service = new DonorMatchingService(prisma as unknown as PrismaService);
  });

  it('forbids users without the recipient role', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(service.findMatches(recipientId, requestId, 10)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.bloodRequest.findFirst).not.toHaveBeenCalled();
  });

  it('forbids inactive recipient accounts', async () => {
    prisma.userRole.findFirst.mockResolvedValue({
      user: { status: UserStatus.SUSPENDED },
    });

    await expect(service.findMatches(recipientId, requestId, 10)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.bloodRequest.findFirst).not.toHaveBeenCalled();
  });

  it('rejects requests that are missing, closed, expired, or not owned', async () => {
    prisma.bloodRequest.findFirst.mockResolvedValue(null);

    await expect(service.findMatches(recipientId, requestId, 10)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(prisma.donorProfile.findMany).not.toHaveBeenCalled();
  });

  it.each([0, -1, 201, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid radius %s',
    async (radius) => {
      await expect(service.findMatches(recipientId, requestId, radius)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.donorProfile.findMany).not.toHaveBeenCalled();
    },
  );

  it('uses compatible blood groups when querying available verified donors', async () => {
    await service.findMatches(recipientId, requestId, 10);

    expect(prisma.donorProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bloodGroup: {
            in: [
              BloodGroup.O_NEGATIVE,
              BloodGroup.O_POSITIVE,
              BloodGroup.A_NEGATIVE,
              BloodGroup.A_POSITIVE,
            ],
          },
          isAvailable: true,
          verificationStatus: VerificationStatus.VERIFIED,
          user: {
            is: {
              status: UserStatus.ACTIVE,
              roles: {
                some: { role: UserRoleType.DONOR },
              },
            },
          },
        }),

      }),
    );
  });

  it.each([
    [BloodGroup.O_NEGATIVE, [BloodGroup.O_NEGATIVE]],
    [BloodGroup.O_POSITIVE, [BloodGroup.O_NEGATIVE, BloodGroup.O_POSITIVE]],
    [BloodGroup.A_NEGATIVE, [BloodGroup.O_NEGATIVE, BloodGroup.A_NEGATIVE]],
    [
      BloodGroup.A_POSITIVE,
      [BloodGroup.O_NEGATIVE, BloodGroup.O_POSITIVE, BloodGroup.A_NEGATIVE, BloodGroup.A_POSITIVE],
    ],
    [BloodGroup.B_NEGATIVE, [BloodGroup.O_NEGATIVE, BloodGroup.B_NEGATIVE]],
    [
      BloodGroup.B_POSITIVE,
      [BloodGroup.O_NEGATIVE, BloodGroup.O_POSITIVE, BloodGroup.B_NEGATIVE, BloodGroup.B_POSITIVE],
    ],
    [
      BloodGroup.AB_NEGATIVE,
      [BloodGroup.O_NEGATIVE, BloodGroup.A_NEGATIVE, BloodGroup.B_NEGATIVE, BloodGroup.AB_NEGATIVE],
    ],
    [BloodGroup.AB_POSITIVE, Object.values(BloodGroup)],
  ])('covers all eight recipient blood groups: %s', async (bloodGroup, compatibleGroups) => {
    prisma.bloodRequest.findFirst.mockResolvedValue({
      ...request,
      bloodGroup,
    });

    await service.findMatches(recipientId, requestId, 10);

    expect(prisma.donorProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bloodGroup: { in: compatibleGroups },
        }),
      }),
    );
  });

  it('excludes donors with invalid birth dates or insufficient weight', async () => {
    prisma.bloodRequest.findFirst.mockResolvedValue({
      ...request,
      locationId: null,
    });

    prisma.donorProfile.findMany.mockResolvedValue([
      makeDonor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        dateOfBirth: new Date('invalid'),
      }),
      makeDonor('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        weightKg: { toNumber: () => 45 },
      }),
    ]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toHaveLength(0);
    expect(result.totalMatches).toBe(0);
  });

  it('includes an exact-radius match and excludes a donor outside the radius', async () => {
    const exactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const outsideId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    prisma.donorProfile.findMany.mockResolvedValue([makeDonor(exactId), makeDonor(outsideId)]);

    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          userId: exactId,
          distanceMeters: 10000,
          withinRadius: true,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches.map((match) => match.userId)).toEqual([exactId]);
    expect(result.matches[0]).toMatchObject({
      distanceKm: 10,
      locationMatch: 'WITHIN_RADIUS',
    });
  });
  it('returns request metadata and an empty match list when no donors qualify', async () => {
    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result).toMatchObject({
      request: {
        id: requestId,
        bloodGroup: BloodGroup.A_POSITIVE,
        city: 'Quetta',
        unitsNeeded: 2,
        hospitalName: 'City Hospital',
        status: BloodRequestStatus.OPEN,
      },
      radiusKm: 10,
      totalMatches: 0,
      spatialMatches: 0,
      cityFallbackMatches: 0,
      matches: [],
    });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('sorts spatial matches by distance and puts them before city fallbacks', async () => {
    const nearestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const fartherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const fallbackId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    prisma.donorProfile.findMany.mockResolvedValue([
      makeDonor(fartherId),
      makeDonor(fallbackId),
      makeDonor(nearestId),
    ]);

    prisma.$queryRaw.mockResolvedValue([
      {
        userId: fartherId,
        distanceMeters: 8200,
        withinRadius: true,
      },
      {
        userId: nearestId,
        distanceMeters: 2300,
        withinRadius: true,
      },
      {
        userId: fallbackId,
        distanceMeters: null,
        withinRadius: false,
      },
    ]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toEqual([
      expect.objectContaining({
        userId: nearestId,
        distanceKm: 2.3,
        locationMatch: 'WITHIN_RADIUS',
      }),
      expect.objectContaining({
        userId: fartherId,
        distanceKm: 8.2,
        locationMatch: 'WITHIN_RADIUS',
      }),
      expect.objectContaining({
        userId: fallbackId,
        distanceKm: null,
        locationMatch: 'CITY_FALLBACK',
      }),
    ]);

    expect(result).toMatchObject({
      totalMatches: 3,
      spatialMatches: 2,
      cityFallbackMatches: 1,
    });
  });

  it('uses city fallback for a same-city donor without a location ID', async () => {
    const donorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    prisma.donorProfile.findMany.mockResolvedValue([makeDonor(donorId, { locationId: null })]);

    prisma.$queryRaw.mockResolvedValue([
      {
        userId: donorId,
        distanceMeters: null,
        withinRadius: false,
      },
    ]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toEqual([
      expect.objectContaining({
        userId: donorId,
        sameCity: true,
        distanceKm: null,
        locationMatch: 'CITY_FALLBACK',
      }),
    ]);
    expect(result.cityFallbackMatches).toBe(1);
  });

  it('does not use city fallback for a different-city donor without a usable distance', async () => {
    const donorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    prisma.donorProfile.findMany.mockResolvedValue([
      makeDonor(donorId, {
        city: 'Karachi',
        locationId: null,
      }),
    ]);

    prisma.$queryRaw.mockResolvedValue([
      {
        userId: donorId,
        distanceMeters: null,
        withinRadius: false,
      },
    ]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toEqual([]);
    expect(result.cityFallbackMatches).toBe(0);
  });
  it('does not use city fallback for a donor with a known distance outside the radius', async () => {
    const donorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    prisma.donorProfile.findMany.mockResolvedValue([
      makeDonor(donorId, { city: request.city }),
    ]);

    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.cityFallbackMatches).toBe(0);
  });

  it('does not use city fallback when a spatial-only query omits an out-of-radius donor', async () => {
    const donorId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    prisma.donorProfile.findMany.mockResolvedValue([
      makeDonor(donorId, { city: request.city }),
    ]);

    // Spatial query omits the out-of-radius donor; it has no missing coordinates.
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.cityFallbackMatches).toBe(0);
  });
  it('does not run the spatial query when the request has no location', async () => {
    prisma.bloodRequest.findFirst.mockResolvedValue({
      ...request,
      locationId: null,
    });

    prisma.donorProfile.findMany.mockResolvedValue([
      makeDonor('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    ]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      locationMatch: 'CITY_FALLBACK',
      distanceKm: null,
    });
  });

  it('caps results at 100, prioritizes spatial matches, and exposes only safe match fields', async () => {
    const spatialDonors = Array.from({ length: 90 }, (_, index) => {
      const userId = `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
      return makeDonor(userId);
    });

    const fallbackDonors = Array.from({ length: 20 }, (_, index) => {
      const userId = `00000000-0000-4000-8000-${(index + 91).toString(16).padStart(12, '0')}`;
      return makeDonor(userId);
    });

    prisma.donorProfile.findMany.mockResolvedValue([...spatialDonors, ...fallbackDonors]);

    prisma.$queryRaw.mockResolvedValue([
      ...spatialDonors.map((donor, index) => ({
        userId: donor.userId,
        distanceMeters: (index + 1) * 100,
        withinRadius: true,
      })),
      ...fallbackDonors.map((donor) => ({
        userId: donor.userId,
        distanceMeters: null,
        withinRadius: false,
      })),
    ]);

    const result = await service.findMatches(recipientId, requestId, 10);

    expect(result.matches).toHaveLength(100);
    expect(result.totalMatches).toBe(100);
    expect(result.spatialMatches).toBe(90);
    expect(result.cityFallbackMatches).toBe(20);

    expect(
      result.matches.slice(0, 90).every((match) => match.locationMatch === 'WITHIN_RADIUS'),
    ).toBe(true);

    expect(result.matches.slice(90).every((match) => match.locationMatch === 'CITY_FALLBACK')).toBe(
      true,
    );

    expect(result.matches[0]!.userId).toBe(spatialDonors[0]!.userId);
    expect(result.matches[89]!.userId).toBe(spatialDonors[89]!.userId);
    expect(result.matches[90]!.userId).toBe(fallbackDonors[0]!.userId);
    expect(result.matches[99]!.userId).toBe(fallbackDonors[9]!.userId);

    for (const match of result.matches) {
      expect(Object.keys(match).sort()).toEqual([
        'bloodGroup',
        'city',
        'distanceKm',
        'locationMatch',
        'sameCity',
        'userId',
      ]);
    }
  });
});
