import { ForbiddenException } from '@nestjs/common';
import {
  AbuseReportStatus,
  BloodRequestStatus,
  UserRoleType,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;

  const prisma = {
    userRole: {
      findFirst: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
    donorProfile: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    bloodRequest: {
      groupBy: jest.fn(),
    },
    verificationRecord: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    abuseReport: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new AdminService(prisma as unknown as PrismaService);

    prisma.userRole.findFirst.mockResolvedValue({ id: 'admin-role-id' });
    prisma.user.count.mockResolvedValue(20);
    prisma.donorProfile.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(5);
    prisma.donorProfile.findMany.mockResolvedValue([]);
    prisma.bloodRequest.groupBy.mockResolvedValue([
      { status: BloodRequestStatus.OPEN, _count: { _all: 4 } },
      { status: BloodRequestStatus.FULFILLED, _count: { _all: 2 } },
    ]);
    prisma.verificationRecord.groupBy.mockResolvedValue([
      { status: VerificationStatus.PENDING, _count: { _all: 3 } },
      { status: VerificationStatus.VERIFIED, _count: { _all: 7 } },
    ]);
    prisma.abuseReport.groupBy.mockResolvedValue([
      { status: AbuseReportStatus.OPEN, _count: { _all: 2 } },
      { status: AbuseReportStatus.RESOLVED, _count: { _all: 1 } },
    ]);
    prisma.verificationRecord.count.mockResolvedValue(3);
    prisma.abuseReport.count.mockResolvedValue(2);
  });

  it('rejects users without an active platform-admin role', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(service.getStats('ordinary-user-id')).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('checks the platform-admin role and active user status in the database', async () => {
    await service.getStats('admin-user-id');

    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'admin-user-id',
        role: UserRoleType.PLATFORM_ADMIN,
        user: { is: { status: UserStatus.ACTIVE } },
      },
      select: { id: true },
    });
  });

  it('returns aggregate dashboard counts with zero values for missing statuses', async () => {
    const result = await service.getStats('admin-user-id');

    expect(result.users.total).toBe(20);

    expect(result.donors).toEqual({
      totalProfiles: 10,
      availableProfiles: 6,
      verifiedProfiles: 5,
      eligibleAndAvailable: 0,
    });

    expect(result.bloodRequests).toEqual({
      OPEN: 4,
      IN_PROGRESS: 0,
      FULFILLED: 2,
      CANCELLED: 0,
      EXPIRED: 0,
    });

    expect(result.verifications.recordsByStatus).toEqual({
      NOT_SUBMITTED: 0,
      PENDING: 3,
      VERIFIED: 7,
      REJECTED: 0,
      SUSPENDED: 0,
    });
    expect(result.verifications.pendingRecords).toBe(3);

    expect(result.abuseReports.reportsByStatus).toEqual({
      OPEN: 2,
      UNDER_REVIEW: 0,
      RESOLVED: 1,
      DISMISSED: 0,
    });
    expect(result.abuseReports.unresolvedReports).toBe(2);

    expect(result.generatedAt).toEqual(expect.any(String));
  });

  it('counts eligible donors using the existing eligibility rules', async () => {
    prisma.donorProfile.findMany.mockResolvedValue([
      {
        isAvailable: true,
        verificationStatus: VerificationStatus.VERIFIED,
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
        weightKg: { toNumber: () => 65 },
        lastDonationDate: null,
        user: {
          status: UserStatus.ACTIVE,
          roles: [{ role: UserRoleType.DONOR }],
        },
      },
    ]);

    const result = await service.getStats('admin-user-id');

    expect(result.donors.eligibleAndAvailable).toBe(1);
  });
});
