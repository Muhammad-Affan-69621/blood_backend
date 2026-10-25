import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewVerificationDto, SubmitVerificationDto } from './verification.dto';

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertReviewer(userId: string): Promise<void> {
    const reviewer = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: { in: ['MODERATOR', 'PLATFORM_ADMIN'] },
        user: {
          status: 'ACTIVE',
        },
      },
      select: { userId: true },
    });

    if (!reviewer) {
      throw new ForbiddenException(
        'Only active moderators and platform administrators can review verification.',
      );
    }
  }

  async submit(userId: string, dto: SubmitVerificationDto) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.donorProfile.findUnique({
        where: { userId },
        include: { user: { select: { status: true } } },
      });

      if (!profile) {
        throw new NotFoundException('Donor profile not found.');
      }

      if (profile.user.status !== 'ACTIVE') {
        throw new BadRequestException('Your account must be active to submit verification.');
      }

      const hasDonorRole = await tx.userRole.findFirst({
        where: { userId, role: 'DONOR' },
        select: { userId: true },
      });

      if (!hasDonorRole) {
        throw new ForbiddenException('A donor role is required.');
      }

      if (profile.verificationStatus === VerificationStatus.PENDING) {
        throw new BadRequestException('Your verification is already awaiting review.');
      }

      if (profile.verificationStatus === VerificationStatus.VERIFIED) {
        throw new BadRequestException('Your donor profile is already verified.');
      }

      const record = await tx.verificationRecord.create({
        data: {
          donorId: userId,
          status: VerificationStatus.PENDING,
          reason: dto.note?.trim() || null,
        },
      });

      await tx.donorProfile.update({
        where: { userId },
        data: { verificationStatus: VerificationStatus.PENDING },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DONOR_VERIFICATION_SUBMITTED',
          targetType: 'VerificationRecord',
          targetId: record.id,
          metadata: {
            donorId: userId,
            submissionType: 'DONOR_PROFILE',
          },
        },
      });

      return {
        message: 'Verification submitted for review.',
        verification: record,
      };
    });
  }

  async getMyStatus(userId: string) {
    const profile = await this.prisma.donorProfile.findUnique({
      where: { userId },
      select: {
        verificationStatus: true,
        verificationRecords: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Donor profile not found.');
    }

    return {
      status: profile.verificationStatus,
      latestReview: profile.verificationRecords[0] ?? null,
    };
  }

  async getQueue(userId: string, limit = 20, cursor?: string) {
    await this.assertReviewer(userId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const records = await this.prisma.verificationRecord.findMany({
      where: { status: VerificationStatus.PENDING },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: safeLimit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        donorId: true,
        status: true,
        reason: true,
        createdAt: true,
        donor: {
          select: {
            bloodGroup: true,
            dateOfBirth: true,
            weightKg: true,
            city: true,
            lastDonationDate: true,
            isAvailable: true,
            urgentNotificationsEnabled: true,
            verificationStatus: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                email: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const hasMore = records.length > safeLimit;
    const items = hasMore ? records.slice(0, safeLimit) : records;

    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async review(reviewerId: string, donorId: string, dto: ReviewVerificationDto) {
    await this.assertReviewer(reviewerId);

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.donorProfile.findUnique({
        where: { userId: donorId },
        select: {
          userId: true,
          verificationStatus: true,
        },
      });

      if (!profile) {
        throw new NotFoundException('Donor profile not found.');
      }

      if (profile.verificationStatus !== VerificationStatus.PENDING) {
        throw new BadRequestException('This donor does not have a pending verification.');
      }

      const pendingRecord = await tx.verificationRecord.findFirst({
        where: {
          donorId,
          status: VerificationStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!pendingRecord) {
        throw new NotFoundException('Pending verification record not found.');
      }

      // Only one reviewer can change this record from PENDING.
      const recordUpdate = await tx.verificationRecord.updateMany({
        where: {
          id: pendingRecord.id,
          status: VerificationStatus.PENDING,
        },
        data: {
          status: dto.status,
          reviewerId,
          reason: dto.reason.trim(),
        },
      });

      if (recordUpdate.count !== 1) {
        throw new BadRequestException(
          'This verification has already been reviewed. Refresh the queue and try again.',
        );
      }

      // Keep the donor profile transition conditional as well.
      const profileUpdate = await tx.donorProfile.updateMany({
        where: {
          userId: donorId,
          verificationStatus: VerificationStatus.PENDING,
        },
        data: {
          verificationStatus: dto.status,
        },
      });

      if (profileUpdate.count !== 1) {
        throw new BadRequestException(
          'The donor verification status changed during review. Please refresh and try again.',
        );
      }

      // Approving a donor verification also activates the donor's account.
      // The donor eligibility service and dashboard APIs require ACTIVE users,
      // so updating only donorProfile.verificationStatus leaves approved donors
      // unable to enable availability or load authenticated dashboard data.
      if (dto.status === VerificationStatus.VERIFIED) {
        await tx.user.updateMany({
          where: {
            id: donorId,
            status: { in: [UserStatus.PENDING, UserStatus.ACTIVE] },
          },
          data: { status: UserStatus.ACTIVE },
        });
      }

      const updatedRecord = await tx.verificationRecord.findUniqueOrThrow({
        where: { id: pendingRecord.id },
      });

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: 'DONOR_VERIFICATION_REVIEWED',
          targetType: 'VerificationRecord',
          targetId: updatedRecord.id,
          metadata: {
            donorId,
            previousStatus: VerificationStatus.PENDING,
            newStatus: dto.status,
            reason: dto.reason.trim(),
          },
        },
      });

      return {
        message: 'Verification decision saved.',
        verification: updatedRecord,
        ...(dto.status === VerificationStatus.VERIFIED ? { accountStatus: UserStatus.ACTIVE } : {}),
      };
    });
  }
}
