import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  BloodRequestStatus,
  ConsentScope,
  DonorResponseStatus,
  RecipientResponseDecision,
  SharingMode,
  UserStatus,
} from '@prisma/client';
import { ConsentsService } from './consents.service';

describe('ConsentsService', () => {
  let service: ConsentsService;

  let prisma: {
    userRole: { findFirst: jest.Mock };
    donorProfile: { findUnique: jest.Mock; update: jest.Mock };
    contactPreference: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    contactConsent: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    bloodRequest: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    donorResponse: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      userRole: {
        findFirst: jest.fn().mockResolvedValue({ userId: 'donor-1' }),
      },
      donorProfile: {
        update: jest.fn().mockResolvedValue({
          userId: 'donor-1',
          urgentNotificationsEnabled: true,
        }),
        findUnique: jest.fn().mockResolvedValue({
          userId: 'donor-1',
          user: {
            email: 'donor@example.test',
            status: UserStatus.ACTIVE,
          },
        }),
      },
      contactPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'donor-1',
          sharingMode: SharingMode.NEVER,
        }),
      },
      contactConsent: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'consent-1',
          donorId: 'donor-1',
          scope: ConsentScope.EMAIL,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'consent-1',
          donorId: 'donor-1',
          revokedAt: new Date(),
        }),
      },
      bloodRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'request-1',
          status: BloodRequestStatus.OPEN,
          expiresAt: null,
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 'request-1' }),
      },
      donorResponse: {
        findFirst: jest.fn().mockResolvedValue({ id: 'response-1' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
    };

    service = new ConsentsService(
      prisma as unknown as ConstructorParameters<typeof ConsentsService>[0],
    );
  });

  describe('findMine', () => {
    it('returns the donor preference and consent records', async () => {
      const preference = {
        userId: 'donor-1',
        sharingMode: SharingMode.NEVER,
      };
      const consents = [{ id: 'consent-1' }];

      prisma.contactPreference.findUnique.mockResolvedValue(preference);
      prisma.contactConsent.findMany.mockResolvedValue(consents);

      await expect(service.findMine('donor-1')).resolves.toEqual({
        preference,
        consents,
      });

      expect(prisma.contactConsent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { donorId: 'donor-1' },
        }),
      );
    });

    it('rejects a user without the donor role', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(service.findMine('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a donor without a donor profile', async () => {
      prisma.donorProfile.findUnique.mockResolvedValue(null);

      await expect(service.findMine('donor-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('grant', () => {
    it('grants consent without a request-specific ID', async () => {
      const result = await service.grant('donor-1', {
        scope: ConsentScope.EMAIL,
      });

      expect(result.message).toBe('Consent granted successfully.');
      expect(prisma.contactConsent.create).toHaveBeenCalledWith({
        data: {
          donorId: 'donor-1',
          requestId: null,
          grantedBy: 'donor-1',
          scope: ConsentScope.EMAIL,
        },
      });
    });

    it('rejects duplicate active consent for the same scope and request', async () => {
      prisma.contactConsent.findFirst.mockResolvedValue({
        id: 'existing-consent',
      });

      await expect(
        service.grant('donor-1', {
          scope: ConsentScope.EMAIL,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.contactConsent.create).not.toHaveBeenCalled();
    });

    it('rejects a nonexistent blood request', async () => {
      prisma.bloodRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.grant('donor-1', {
          scope: ConsentScope.EMAIL,
          requestId: 'missing-request',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects consent for a closed blood request', async () => {
      prisma.bloodRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        status: BloodRequestStatus.FULFILLED,
        expiresAt: null,
      });

      await expect(
        service.grant('donor-1', {
          scope: ConsentScope.EMAIL,
          requestId: 'request-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires a willing donor response for request-specific consent', async () => {
      prisma.donorResponse.findFirst.mockResolvedValue(null);

      await expect(
        service.grant('donor-1', {
          scope: ConsentScope.EMAIL,
          requestId: 'request-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('checks that the donor response is willing', async () => {
      await service.grant('donor-1', {
        scope: ConsentScope.EMAIL,
        requestId: 'request-1',
      });

      expect(prisma.donorResponse.findFirst).toHaveBeenCalledWith({
        where: {
          requestId: 'request-1',
          donorId: 'donor-1',
          status: DonorResponseStatus.WILLING,
        },
        select: { id: true },
      });
    });
  });

  describe('revoke', () => {
    it('revokes the donor’s own active consent', async () => {
      prisma.contactConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        revokedAt: null,
      });

      const result = await service.revoke('donor-1', 'consent-1');

      expect(result.message).toBe('Consent revoked successfully.');
      expect(prisma.contactConsent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'consent-1',
          donorId: 'donor-1',
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
        }),
      });

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );
    });

    it('does not revoke a consent belonging to another donor', async () => {
      prisma.contactConsent.findFirst.mockResolvedValue(null);

      await expect(service.revoke('donor-1', 'someone-elses-consent')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.contactConsent.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a consent that has already been revoked', async () => {
      prisma.contactConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        revokedAt: new Date(),
      });

      await expect(service.revoke('donor-1', 'consent-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(prisma.contactConsent.updateMany).not.toHaveBeenCalled();
    });

    it('handles a concurrent revocation safely', async () => {
      prisma.contactConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        revokedAt: null,
      });
      prisma.contactConsent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke('donor-1', 'consent-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('updateUrgentNotificationsPreference', () => {
    it('enables urgent notifications for an active donor', async () => {
      await expect(
        service.updateUrgentNotificationsPreference('donor-1', { enabled: true }),
      ).resolves.toEqual({
        message: 'Urgent-notification preference updated successfully.',
        preference: {
          userId: 'donor-1',
          urgentNotificationsEnabled: true,
        },
      });

      expect(prisma.donorProfile.update).toHaveBeenCalledWith({
        where: { userId: 'donor-1' },
        data: { urgentNotificationsEnabled: true },
        select: { userId: true, urgentNotificationsEnabled: true },
      });
      expect(prisma.contactPreference.upsert).not.toHaveBeenCalled();
    });

    it('allows a donor to opt out', async () => {
      prisma.donorProfile.update.mockResolvedValue({
        userId: 'donor-1',
        urgentNotificationsEnabled: false,
      });

      await service.updateUrgentNotificationsPreference('donor-1', { enabled: false });

      expect(prisma.donorProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { urgentNotificationsEnabled: false },
        }),
      );
    });

    it('rejects a user without an active donor role', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.updateUrgentNotificationsPreference('donor-1', { enabled: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.donorProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('updatePreference', () => {
    it('updates the donor contact-sharing preference', async () => {
      const preference = {
        userId: 'donor-1',
        sharingMode: SharingMode.NEVER,
      };
      prisma.contactPreference.upsert.mockResolvedValue(preference);

      const result = await service.updatePreference('donor-1', {
        sharingMode: SharingMode.NEVER,
        consentVersion: '1.0',
      });

      expect(result.preference).toEqual(preference);
      expect(prisma.contactPreference.upsert).toHaveBeenCalledWith({
        where: { userId: 'donor-1' },
        create: {
          userId: 'donor-1',
          sharingMode: SharingMode.NEVER,
          consentVersion: '1.0',
        },
        update: {
          sharingMode: SharingMode.NEVER,
          consentVersion: '1.0',
        },
      });
    });
  });

  describe('getAuthorizedContact', () => {
    beforeEach(() => {
      prisma.userRole.findFirst.mockResolvedValue({
        userId: 'recipient-1',
      });
      prisma.bloodRequest.findFirst.mockResolvedValue({
        id: 'request-1',
      });
      prisma.donorResponse.findFirst.mockResolvedValue({
        id: 'response-1',
      });
      prisma.donorProfile.findUnique.mockResolvedValue({
        userId: 'donor-1',
        user: {
          email: 'donor@example.test',
          status: UserStatus.ACTIVE,
        },
      });
      prisma.contactPreference.findUnique.mockResolvedValue({
        sharingMode: SharingMode.WITH_CONSENT,
      });
      prisma.contactConsent.findMany.mockResolvedValue([
        {
          id: 'consent-1',
          requestId: 'request-1',
          scope: ConsentScope.EMAIL,
          grantedAt: new Date(),
        },
      ]);
    });

    it('discloses email to an authorized recipient with active consent', async () => {
      const result = await service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1');

      expect(result).toEqual({
        donorId: 'donor-1',
        requestId: 'request-1',
        email: 'donor@example.test',
        consentScope: ConsentScope.EMAIL,
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'recipient-1',
          action: 'DONOR_CONTACT_DETAILS_DISCLOSED',
          targetType: 'DonorProfile',
          targetId: 'donor-1',
          metadata: {
            requestId: 'request-1',
            consentScope: ConsentScope.EMAIL,
          },
        },
      });

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );

      // The audit event must not contain the disclosed email address.
      const auditCall = prisma.auditLog.create.mock.calls[0][0];
      expect(JSON.stringify(auditCall)).not.toContain('donor@example.test');
    });

    it('does not disclose contact details when the audit write fails', async () => {
      prisma.auditLog.create.mockRejectedValue(
        new Error('Audit service unavailable'),
      );

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toThrow('Audit service unavailable');
    });

    it('requires an active recipient role', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('requires the recipient to own an eligible request', async () => {
      prisma.bloodRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires an accepted willing donor response', async () => {
      prisma.donorResponse.findFirst.mockResolvedValue(null);

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.donorResponse.findFirst).toHaveBeenCalledWith({
        where: {
          requestId: 'request-1',
          donorId: 'donor-1',
          status: DonorResponseStatus.WILLING,
          recipientDecision: RecipientResponseDecision.ACCEPTED,
        },
        select: { id: true },
      });
    });

    it('rejects a donor whose account is not active', async () => {
      prisma.donorProfile.findUnique.mockResolvedValue({
        userId: 'donor-1',
        user: {
          email: 'donor@example.test',
          status: 'SUSPENDED' as UserStatus,
        },
      });

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not disclose contact details when sharing is disabled', async () => {
      prisma.contactPreference.findUnique.mockResolvedValue({
        sharingMode: SharingMode.NEVER,
      });

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects disclosure when no active consent exists', async () => {
      prisma.contactConsent.findMany.mockResolvedValue([]);

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires request-specific consent in AUTHORIZED_REQUESTS mode', async () => {
      prisma.contactPreference.findUnique.mockResolvedValue({
        sharingMode: SharingMode.AUTHORIZED_REQUESTS,
      });
      prisma.contactConsent.findMany.mockResolvedValue([
        {
          id: 'global-consent',
          requestId: null,
          scope: ConsentScope.EMAIL,
          grantedAt: new Date(),
        },
      ]);

      await expect(
        service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows global consent in WITH_CONSENT mode', async () => {
      prisma.contactPreference.findUnique.mockResolvedValue({
        sharingMode: SharingMode.WITH_CONSENT,
      });
      prisma.contactConsent.findMany.mockResolvedValue([
        {
          id: 'global-consent',
          requestId: null,
          scope: ConsentScope.CONTACT_DETAILS,
          grantedAt: new Date(),
        },
      ]);

      const result = await service.getAuthorizedContact('recipient-1', 'request-1', 'donor-1');

      expect(result.consentScope).toBe(ConsentScope.CONTACT_DETAILS);
    });
  });
});


