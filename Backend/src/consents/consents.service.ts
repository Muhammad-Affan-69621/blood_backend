import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BloodRequestStatus,
  ConsentScope,
  DonorResponseStatus,
  RecipientResponseDecision,
  SharingMode,
  UserRoleType,
  UserStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { UpdateContactPreferenceDto } from './dto/update-contact-preference.dto';
import { UpdateUrgentNotificationsDto } from './dto/update-urgent-notifications.dto';

@Injectable()
export class ConsentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureDonor(userId: string): Promise<void> {
    const role = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: UserRoleType.DONOR,
        user: { status: UserStatus.ACTIVE },
      },
      select: { userId: true },
    });

    if (!role) {
      throw new ForbiddenException(
        'Only active users with the DONOR role can manage contact consent.',
      );
    }

    const profile = await this.prisma.donorProfile.findUnique({
      where: { userId },
      select: { userId: true },
    });

    if (!profile) {
      throw new NotFoundException('Donor profile not found. Create your profile first.');
    }
  }

  async findMine(userId: string) {
    await this.ensureDonor(userId);

    const [preference, consents] = await Promise.all([
      this.prisma.contactPreference.findUnique({ where: { userId } }),
      this.prisma.contactConsent.findMany({
        where: { donorId: userId },
        orderBy: { grantedAt: 'desc' },
      }),
    ]);

    return { preference, consents };
  }

  async grant(userId: string, dto: GrantConsentDto) {
    await this.ensureDonor(userId);

    if (dto.requestId) {
      const request = await this.prisma.bloodRequest.findUnique({
        where: { id: dto.requestId },
        select: { id: true, status: true, expiresAt: true },
      });

      if (!request) {
        throw new NotFoundException('Blood request not found.');
      }

      if (
        request.status !== BloodRequestStatus.OPEN ||
        (request.expiresAt !== null && request.expiresAt.getTime() <= Date.now())
      ) {
        throw new ConflictException(
          'Consent can only be granted for an open, non-expired blood request.',
        );
      }

      const response = await this.prisma.donorResponse.findFirst({
        where: {
          requestId: dto.requestId,
          donorId: userId,
          status: DonorResponseStatus.WILLING,
        },
        select: { id: true },
      });

      if (!response) {
        throw new ForbiddenException(
          'You must submit a willing donor response before granting consent for this request.',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contactConsent.findFirst({
        where: {
          donorId: userId,
          requestId: dto.requestId ?? null,
          scope: dto.scope,
          revokedAt: null,
        },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('Active consent already exists for this scope and request.');
      }

      const consent = await tx.contactConsent.create({
        data: {
          donorId: userId,
          requestId: dto.requestId ?? null,
          grantedBy: userId,
          scope: dto.scope,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DONOR_CONTACT_CONSENT_GRANTED',
          targetType: 'ContactConsent',
          targetId: consent.id,
          metadata: {
            scope: dto.scope,
            requestId: dto.requestId ?? null,
          },
        },
      });

      return { message: 'Consent granted successfully.', consent };
    });
  }

  async revoke(userId: string, consentId: string) {
    await this.ensureDonor(userId);

    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.contactConsent.findFirst({
        where: { id: consentId, donorId: userId },
        select: { id: true, revokedAt: true },
      });

      if (!consent) {
        throw new NotFoundException('Consent record not found.');
      }

      if (consent.revokedAt) {
        throw new ConflictException('This consent has already been revoked.');
      }

      const result = await tx.contactConsent.updateMany({
        where: {
          id: consentId,
          donorId: userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      if (result.count !== 1) {
        throw new ConflictException('This consent has already been revoked.');
      }

      const revoked = await tx.contactConsent.findUniqueOrThrow({
        where: { id: consentId },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DONOR_CONTACT_CONSENT_REVOKED',
          targetType: 'ContactConsent',
          targetId: consentId,
          metadata: {
            requestId: revoked.requestId,
            scope: revoked.scope,
          },
        },
      });

      return { message: 'Consent revoked successfully.', consent: revoked };
    }, { isolationLevel: 'Serializable' });
  }

  /**
   * Discloses donor email only to the active recipient who owns the request,
   * after accepting the donor's response and while the applicable consent is active.
   */
  async getAuthorizedContact(recipientId: string, requestId: string, donorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const recipientRole = await tx.userRole.findFirst({
          where: {
            userId: recipientId,
            role: UserRoleType.RECIPIENT,
            user: { status: UserStatus.ACTIVE },
          },
          select: { userId: true },
        });

        if (!recipientRole) {
          throw new ForbiddenException(
            'Only active recipients can access donor contact details.',
          );
        }

        const request = await tx.bloodRequest.findFirst({
          where: {
            id: requestId,
            requesterId: recipientId,
            status: {
              in: [BloodRequestStatus.IN_PROGRESS, BloodRequestStatus.FULFILLED],
            },
          },
          select: { id: true },
        });

        if (!request) {
          throw new NotFoundException('Authorized blood request not found.');
        }

        const acceptedResponse = await tx.donorResponse.findFirst({
          where: {
            requestId,
            donorId,
            status: DonorResponseStatus.WILLING,
            recipientDecision: RecipientResponseDecision.ACCEPTED,
          },
          select: { id: true },
        });

        if (!acceptedResponse) {
          throw new ForbiddenException(
            'Donor contact details are available only after the recipient accepts that donor response.',
          );
        }

        const donor = await tx.donorProfile.findUnique({
          where: { userId: donorId },
          select: {
            userId: true,
            user: { select: { email: true, status: true } },
          },
        });

        if (!donor || donor.user.status !== UserStatus.ACTIVE) {
          throw new NotFoundException('Active donor not found.');
        }

        const preference = await tx.contactPreference.findUnique({
          where: { userId: donorId },
          select: { sharingMode: true },
        });

        const sharingMode = preference?.sharingMode ?? SharingMode.WITH_CONSENT;

        if (sharingMode === SharingMode.NEVER) {
          throw new ForbiddenException('This donor has disabled contact sharing.');
        }

        const activeConsents = await tx.contactConsent.findMany({
          where: {
            donorId,
            scope: { in: [ConsentScope.EMAIL, ConsentScope.CONTACT_DETAILS] },
            revokedAt: null,
            OR: [{ requestId }, { requestId: null }],
          },
          select: { id: true, requestId: true, scope: true, grantedAt: true },
          orderBy: { grantedAt: 'desc' },
        });

        const activeConsent =
          sharingMode === SharingMode.AUTHORIZED_REQUESTS
            ? activeConsents.find((consent) => consent.requestId === requestId)
            : activeConsents[0];

        if (!activeConsent) {
          throw new ForbiddenException(
            'No active consent authorizes disclosure of this donor email.',
          );
        }

        // The audit entry and disclosure authorization commit atomically.
        await tx.auditLog.create({
          data: {
            actorId: recipientId,
            action: 'DONOR_CONTACT_DETAILS_DISCLOSED',
            targetType: 'DonorProfile',
            targetId: donorId,
            metadata: {
              requestId,
              consentScope: activeConsent.scope,
            },
          },
        });

        return {
          donorId,
          requestId,
          email: donor.user.email,
          consentScope: activeConsent.scope,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async updateUrgentNotificationsPreference(
    userId: string,
    dto: UpdateUrgentNotificationsDto,
  ) {
    await this.ensureDonor(userId);

    return this.prisma.$transaction(async (tx) => {
      const preference = await tx.donorProfile.update({
        where: { userId },
        data: { urgentNotificationsEnabled: dto.enabled },
        select: { userId: true, urgentNotificationsEnabled: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DONOR_URGENT_NOTIFICATIONS_PREFERENCE_UPDATED',
          targetType: 'DonorProfile',
          targetId: userId,
          metadata: {
            urgentNotificationsEnabled: preference.urgentNotificationsEnabled,
          },
        },
      });

      return {
        message: 'Urgent-notification preference updated successfully.',
        preference,
      };
    });
  }

  async updatePreference(userId: string, dto: UpdateContactPreferenceDto) {
    await this.ensureDonor(userId);

    return this.prisma.$transaction(async (tx) => {
      const preference = await tx.contactPreference.upsert({
        where: { userId },
        create: {
          userId,
          sharingMode: dto.sharingMode,
          consentVersion: dto.consentVersion,
        },
        update: {
          sharingMode: dto.sharingMode,
          consentVersion: dto.consentVersion,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DONOR_CONTACT_SHARING_PREFERENCE_UPDATED',
          targetType: 'ContactPreference',
          targetId: userId,
          metadata: {
            sharingMode: preference.sharingMode,
            consentVersion: preference.consentVersion,
          },
        },
      });

      return {
        message: 'Contact-sharing preference updated successfully.',
        preference,
      };
    });
  }
}


