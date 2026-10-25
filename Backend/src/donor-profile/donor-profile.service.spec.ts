import { NotFoundException } from '@nestjs/common';
import {
  BloodGroup,
  UserRoleType,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DonorProfileService } from './donor-profile.service';

describe('DonorProfileService.getPublicDonorById', () => {
  const donorId = '11111111-1111-4111-8111-111111111111';

  let service: DonorProfileService;
  let prisma: {
    userRole: { findFirst: jest.Mock };
    donorProfile: { findFirst: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      userRole: { findFirst: jest.fn() },
      donorProfile: {
        findFirst: jest.fn().mockResolvedValue({
          userId: donorId,
          bloodGroup: BloodGroup.O_POSITIVE,
          city: 'Quetta',
          isAvailable: true,
        }),
      },
    };

    service = new DonorProfileService(
      prisma as unknown as PrismaService,
    );
  });

  it('returns only explicitly selected public donor fields', async () => {
    const result = await service.getPublicDonorById(donorId);

    expect(result).toEqual({
      donor: {
        userId: donorId,
        bloodGroup: BloodGroup.O_POSITIVE,
        city: 'Quetta',
        isAvailable: true,
      },
    });

    expect(prisma.donorProfile.findFirst).toHaveBeenCalledWith({
      where: {
        userId: donorId,
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
      },
      select: {
        userId: true,
        bloodGroup: true,
        city: true,
        isAvailable: true,
      },
    });

    const selectedFields =
      prisma.donorProfile.findFirst.mock.calls[0][0].select;

    expect(Object.keys(selectedFields).sort()).toEqual(
      ['bloodGroup', 'city', 'isAvailable', 'userId'].sort(),
    );
  });

  it('returns not found when no eligible donor is found', async () => {
    prisma.donorProfile.findFirst.mockResolvedValue(null);

    await expect(
      service.getPublicDonorById(donorId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DonorProfileService eligibility recalculation', () => {
  const currentUserId = '99999999-9999-4999-8999-999999999999';

  const makeCandidate = (
    userId: string,
    overrides: Record<string, any> = {},
  ) => ({
    userId,
    bloodGroup: BloodGroup.O_POSITIVE,
    city: 'Quetta',
    isAvailable: true,
    verificationStatus: VerificationStatus.VERIFIED,
    dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
    weightKg: { toNumber: () => 65 },
    lastDonationDate: null as Date | null,
    user: {
      status: UserStatus.ACTIVE,
      roles: [{ role: UserRoleType.DONOR }],
    },
    ...overrides,
  });

  let service: DonorProfileService;
  let prisma: {
    userRole: { findFirst: jest.Mock };
    donorProfile: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      userRole: {
        findFirst: jest.fn().mockResolvedValue({ userId: currentUserId }),
      },
      donorProfile: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({
          userId: currentUserId,
          isAvailable: true,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new DonorProfileService(prisma as unknown as PrismaService);
  });

  it('rejects enabling availability during the donation waiting period', async () => {
    prisma.donorProfile.findUnique.mockResolvedValue(
      makeCandidate(currentUserId, {
        lastDonationDate: new Date(),
      }),
    );

    await expect(
      service.updateMyAvailability(currentUserId, true),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reason: 'DONATION_WAITING_PERIOD',
      }),
    });

    expect(prisma.donorProfile.update).not.toHaveBeenCalled();
  });

  it('allows missing donation history when other eligibility checks pass', async () => {
    prisma.donorProfile.findUnique.mockResolvedValue(
      makeCandidate(currentUserId, { lastDonationDate: null }),
    );

    await service.updateMyAvailability(currentUserId, true);

    expect(prisma.donorProfile.update).toHaveBeenCalledWith({
      where: { userId: currentUserId },
      data: { isAvailable: true },
    });
  });

  it('filters recently donating and underweight donors from search results', async () => {
    const eligible = makeCandidate(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const recentDonation = makeCandidate(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      { lastDonationDate: new Date() },
    );
    const underweight = makeCandidate(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      { weightKg: { toNumber: () => 45 } },
    );

    prisma.donorProfile.findMany.mockResolvedValue([
      eligible,
      recentDonation,
      underweight,
    ]);

    const result = await service.searchDonors(currentUserId, {
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
    expect(result.donors).toEqual([
      {
        userId: eligible.userId,
        bloodGroup: BloodGroup.O_POSITIVE,
        city: 'Quetta',
        isAvailable: true,
      },
    ]);
  });

  it('paginates after eligibility filtering', async () => {
    const eligibleOne = makeCandidate(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const recentDonation = makeCandidate(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      { lastDonationDate: new Date() },
    );
    const eligibleTwo = makeCandidate(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );

    prisma.donorProfile.findMany.mockResolvedValue([
      eligibleOne,
      recentDonation,
      eligibleTwo,
    ]);

    const result = await service.searchDonors(currentUserId, {
      page: 1,
      limit: 1,
    });

    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(2);
    expect(result.donors).toHaveLength(1);
    expect(result.donors[0]!.userId).toBe(eligibleOne.userId);
  });
});
