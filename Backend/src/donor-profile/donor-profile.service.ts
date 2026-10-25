import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRoleType, UserStatus, VerificationStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SearchDonorsDto, UpsertDonorProfileDto } from './donor-profile.dto';
import { DonorEligibilityService } from '../donor-matching/donor-eligibility.service';

@Injectable()
export class DonorProfileService {
  private readonly eligibility = new DonorEligibilityService();

  constructor(private readonly prisma: PrismaService) {}

  private async ensureDonorRole(userId: string): Promise<void> {
    const donorRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: 'DONOR',
      },
      select: { userId: true },
    });

    if (!donorRole) {
      throw new ForbiddenException('Only users with the DONOR role can manage a donor profile.');
    }
  }

  async getMyProfile(userId: string) {
    await this.ensureDonorRole(userId);

    const profile = await this.prisma.donorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Donor profile not found. Create your profile first.');
    }

    return { profile };
  }

  async updateMyAvailability(userId: string, isAvailable: boolean) {
    await this.ensureDonorRole(userId);

    const existing = await this.prisma.donorProfile.findUnique({
      where: { userId },
      select: {
        userId: true,
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
    });

    if (!existing) {
      throw new NotFoundException('Donor profile not found. Create your profile first.');
    }

    if (isAvailable) {
      const result = this.eligibility.evaluate({
        userStatus: existing.user.status,
        roles: existing.user.roles.map((role) => role.role),
        isAvailable: true,
        verificationStatus: existing.verificationStatus,
        dateOfBirth: existing.dateOfBirth,
        weightKg: existing.weightKg.toNumber(),
        lastDonationDate: existing.lastDonationDate,
      });

      if (!result.eligible) {
        throw new BadRequestException({
          message: 'You are not currently eligible to become an available donor.',
          reason: result.reason,
        });
      }
    }

    const profile = await this.prisma.donorProfile.update({
      where: { userId },
      data: { isAvailable },
    });

    return {
      message: 'Donor availability updated successfully.',
      profile,
    };
  }

  async searchDonors(userId: string, query: SearchDonorsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = {
      userId: { not: userId },
      isAvailable: true,
      verificationStatus: VerificationStatus.VERIFIED,
      ...(query.bloodGroup && { bloodGroup: query.bloodGroup }),
      ...(query.city && {
        city: { contains: query.city.trim(), mode: 'insensitive' as const },
      }),
      user: {
        is: {
          status: UserStatus.ACTIVE,
          roles: { some: { role: UserRoleType.DONOR } },
        },
      },
    };

    // Fetch current eligibility inputs from the database and evaluate them
    // before calculating totals or applying pagination.
    const candidates = await this.prisma.donorProfile.findMany({
      where,
      select: {
        userId: true,
        bloodGroup: true,
        city: true,
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
      orderBy: [{ city: 'asc' }, { bloodGroup: 'asc' }, { userId: 'asc' }],
    });

    const eligibleDonors = candidates.filter(
      (donor) =>
        this.eligibility.evaluate({
          userStatus: donor.user.status,
          roles: donor.user.roles.map((role) => role.role),
          isAvailable: donor.isAvailable,
          verificationStatus: donor.verificationStatus,
          dateOfBirth: donor.dateOfBirth,
          weightKg: donor.weightKg.toNumber(),
          lastDonationDate: donor.lastDonationDate,
        }).eligible,
    );

    const total = eligibleDonors.length;
    const donors = eligibleDonors
      .slice((page - 1) * limit, page * limit)
      .map(({ userId, bloodGroup, city, isAvailable }) => ({
        userId,
        bloodGroup,
        city,
        isAvailable,
      }));

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      donors,
    };
  }

  async getPublicDonorById(donorId: string) {
    const donor = await this.prisma.donorProfile.findFirst({
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

    if (!donor) {
      throw new NotFoundException('Donor not found.');
    }

    return { donor };
  }
  async upsertMyProfile(userId: string, dto: UpsertDonorProfileDto) {
    await this.ensureDonorRole(userId);

    const lastDonationDate =
      dto.lastDonationDate === undefined
        ? undefined
        : dto.lastDonationDate === null
          ? null
          : new Date(dto.lastDonationDate);

    const result = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.donorProfile.upsert({
        where: { userId },
        create: {
          userId,
          bloodGroup: dto.bloodGroup,
          dateOfBirth: new Date(dto.dateOfBirth),
          weightKg: dto.weightKg,
          city: dto.city,
          lastDonationDate: lastDonationDate ?? null,
          isAvailable: dto.isAvailable ?? false,
        },
        update: {
          bloodGroup: dto.bloodGroup,
          dateOfBirth: new Date(dto.dateOfBirth),
          weightKg: dto.weightKg,
          city: dto.city,
          ...(lastDonationDate !== undefined && { lastDonationDate }),
          ...(dto.isAvailable !== undefined && { isAvailable: dto.isAvailable }),
        },
      });

      // Saving a complete donor profile automatically creates a verification
      // request. Do not create duplicate requests while one is pending or after
      // the donor has already been verified.
      const complete = Boolean(profile.bloodGroup && profile.dateOfBirth && profile.weightKg && profile.city?.trim());
      let verificationSubmitted = false;
      if (complete && profile.verificationStatus !== VerificationStatus.PENDING &&
          profile.verificationStatus !== VerificationStatus.VERIFIED) {
        const existingPending = await tx.verificationRecord.findFirst({
          where: { donorId: userId, status: VerificationStatus.PENDING },
          select: { id: true },
        });
        if (!existingPending) {
          await tx.verificationRecord.create({
            data: {
              donorId: userId,
              status: VerificationStatus.PENDING,
              reason: 'Donor profile completed and submitted for verification.',
            },
          });
          await tx.donorProfile.update({
            where: { userId },
            data: { verificationStatus: VerificationStatus.PENDING },
          });
          profile.verificationStatus = VerificationStatus.PENDING;
          verificationSubmitted = true;
          await tx.auditLog.create({
            data: {
              actorId: userId,
              action: 'DONOR_VERIFICATION_SUBMITTED',
              targetType: 'DonorProfile',
              targetId: userId,
              metadata: { donorId: userId, source: 'PROFILE_COMPLETION' },
            },
          });
        }
      }
      return { profile, verificationSubmitted };
    });

    return {
      message: result.verificationSubmitted
        ? 'Donor profile saved and verification request submitted for review.'
        : 'Donor profile saved successfully.',
      profile: result.profile,
    };
  }
}
