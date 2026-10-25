import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AbuseReportStatus,
  BloodRequestStatus,
  UserRoleType,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DonorEligibilityService } from '../donor-matching/donor-eligibility.service';

@Injectable()
export class AdminService {
  private readonly eligibility = new DonorEligibilityService();

  constructor(private readonly prisma: PrismaService) {}

  async getStats(userId: string) {
    const adminRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: UserRoleType.PLATFORM_ADMIN,
        user: { is: { status: UserStatus.ACTIVE } },
      },
      select: { id: true },
    });

    if (!adminRole) {
      throw new ForbiddenException(
        'Only active platform administrators can access dashboard statistics.',
      );
    }

    const [
      totalUsers,
      totalDonorProfiles,
      availableDonorProfiles,
      verifiedDonorProfiles,
      activeDonorCandidates,
      requestGroups,
      verificationGroups,
      reportGroups,
      pendingVerificationRecords,
      openAbuseReports,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.donorProfile.count(),
      this.prisma.donorProfile.count({
        where: { isAvailable: true },
      }),
      this.prisma.donorProfile.count({
        where: { verificationStatus: VerificationStatus.VERIFIED },
      }),
      this.prisma.donorProfile.findMany({
        where: {
          isAvailable: true,
          verificationStatus: VerificationStatus.VERIFIED,
          user: {
            is: {
              status: UserStatus.ACTIVE,
              roles: { some: { role: UserRoleType.DONOR } },
            },
          },
        },
        select: {
          isAvailable: true,
          verificationStatus: true,
          dateOfBirth: true,
          weightKg: true,
          lastDonationDate: true,
          user: {
            select: {
              status: true,
              roles: { select: { role: true } },
            },
          },
        },
      }),
      this.prisma.bloodRequest.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.verificationRecord.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.abuseReport.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.verificationRecord.count({
        where: { status: VerificationStatus.PENDING },
      }),
      this.prisma.abuseReport.count({
        where: {
          status: {
            in: [AbuseReportStatus.OPEN, AbuseReportStatus.UNDER_REVIEW],
          },
        },
      }),
    ]);

    const now = new Date();

    const eligibleAvailableDonors = activeDonorCandidates.filter((donor) => {
      const result = this.eligibility.evaluate(
        {
          userStatus: donor.user.status,
          roles: donor.user.roles.map((role) => role.role),
          isAvailable: donor.isAvailable,
          verificationStatus: donor.verificationStatus,
          dateOfBirth: donor.dateOfBirth,
          weightKg: donor.weightKg.toNumber(),
          lastDonationDate: donor.lastDonationDate,
        },
        now,
      );

      return result.eligible;
    }).length;

    const countsByStatus = <T extends string>(
      statuses: readonly T[],
      groups: Array<{ status: T; _count: { _all: number } }>,
    ): Record<T, number> =>
      Object.fromEntries(
        statuses.map((status) => [
          status,
          groups.find((group) => group.status === status)?._count._all ?? 0,
        ]),
      ) as Record<T, number>;

    return {
      generatedAt: now.toISOString(),
      users: {
        total: totalUsers,
      },
      donors: {
        totalProfiles: totalDonorProfiles,
        availableProfiles: availableDonorProfiles,
        verifiedProfiles: verifiedDonorProfiles,
        eligibleAndAvailable: eligibleAvailableDonors,
      },
      bloodRequests: countsByStatus(Object.values(BloodRequestStatus), requestGroups),
      verifications: {
        recordsByStatus: countsByStatus(Object.values(VerificationStatus), verificationGroups),
        pendingRecords: pendingVerificationRecords,
      },
      abuseReports: {
        reportsByStatus: countsByStatus(Object.values(AbuseReportStatus), reportGroups),
        unresolvedReports: openAbuseReports,
      },
    };
  }
}
