import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { VerificationService } from './verification.service';
import { VerificationDecision } from './verification.dto';

type MockMethod = jest.Mock;

interface VerificationPrismaMock {
  donorProfile: {
    findUnique: MockMethod;
    update: MockMethod;
    updateMany: MockMethod;
  };
  userRole: {
    findFirst: MockMethod;
  };
  verificationRecord: {
    create: MockMethod;
    findMany: MockMethod;
    findFirst: MockMethod;
    update: MockMethod;
    updateMany: MockMethod;
    findUniqueOrThrow: MockMethod;
  };
  auditLog: {
    create: MockMethod;
  };
  $transaction: MockMethod;
}

describe('VerificationService', () => {
  let service: VerificationService;
  let prisma: VerificationPrismaMock;
  let tx: Omit<VerificationPrismaMock, '$transaction'>;

  const reviewerId = '11111111-1111-4111-8111-111111111111';
  const donorId = '22222222-2222-4222-8222-222222222222';
  const recordId = '33333333-3333-4333-8333-333333333333';

  const pendingRecord = {
    id: recordId,
    donorId,
    status: VerificationStatus.PENDING,
    reason: 'Ready for review',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    tx = {
      donorProfile: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      userRole: {
        findFirst: jest.fn(),
      },
      verificationRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    prisma = {
      ...tx,
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
      donorProfile: {
        ...tx.donorProfile,
        findUnique: jest.fn(),
      },
    };

    service = new VerificationService(
      prisma as unknown as ConstructorParameters<typeof VerificationService>[0],
    );
  });

  describe('getQueue', () => {
    it('rejects a user who is not an authorized reviewer', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(service.getQueue(reviewerId)).rejects.toThrow(ForbiddenException);

      expect(prisma.verificationRecord.findMany).not.toHaveBeenCalled();
    });

    it('returns a page and cursor when more records exist', async () => {
      prisma.userRole.findFirst.mockResolvedValue({ userId: reviewerId });

      const records = [
        { ...pendingRecord, id: recordId },
        { ...pendingRecord, id: '44444444-4444-4444-8444-444444444444' },
        { ...pendingRecord, id: '55555555-5555-4555-8555-555555555555' },
      ];

      prisma.verificationRecord.findMany.mockResolvedValue(records);

      const result = await service.getQueue(reviewerId, 2);

      expect(prisma.verificationRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3,
          where: { status: VerificationStatus.PENDING },
        }),
      );
      expect(result.items).toHaveLength(2);
      expect(records).toHaveLength(3);
      const secondRecord = records[1];
      expect(secondRecord).toBeDefined();
      expect(result.nextCursor).toBe(secondRecord!.id);
    });

    it('returns a null cursor when there are no more records', async () => {
      prisma.userRole.findFirst.mockResolvedValue({ userId: reviewerId });
      prisma.verificationRecord.findMany.mockResolvedValue([pendingRecord]);

      const result = await service.getQueue(reviewerId, 20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('getMyStatus', () => {
    it('returns the profile status and latest review', async () => {
      const latestReview = {
        id: recordId,
        status: VerificationStatus.VERIFIED,
        reason: 'Approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.donorProfile.findUnique.mockResolvedValue({
        verificationStatus: VerificationStatus.VERIFIED,
        verificationRecords: [latestReview],
      });

      await expect(service.getMyStatus(donorId)).resolves.toEqual({
        status: VerificationStatus.VERIFIED,
        latestReview,
      });
    });

    it('throws when the donor profile does not exist', async () => {
      prisma.donorProfile.findUnique.mockResolvedValue(null);

      await expect(service.getMyStatus(donorId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('review', () => {
    const dto = {
      status: VerificationDecision.VERIFIED,
      reason: 'Donor details checked and approved',
    };

    function authorizeReviewer() {
      prisma.userRole.findFirst.mockResolvedValue({ userId: reviewerId });
    }

    it('rejects unauthorized reviewers', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(service.review(reviewerId, donorId, dto)).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws when the donor profile does not exist', async () => {
      authorizeReviewer();
      tx.donorProfile.findUnique.mockResolvedValue(null);

      await expect(service.review(reviewerId, donorId, dto)).rejects.toThrow(NotFoundException);
    });

    it('rejects a donor whose verification is not pending', async () => {
      authorizeReviewer();
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.REJECTED,
      });

      await expect(service.review(reviewerId, donorId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws when no pending verification record exists', async () => {
      authorizeReviewer();
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.PENDING,
      });
      tx.verificationRecord.findFirst.mockResolvedValue(null);

      await expect(service.review(reviewerId, donorId, dto)).rejects.toThrow(NotFoundException);
    });

    it('updates the record, profile, and audit log on success', async () => {
      authorizeReviewer();

      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.PENDING,
      });
      tx.verificationRecord.findFirst.mockResolvedValue(pendingRecord);
      tx.verificationRecord.updateMany.mockResolvedValue({ count: 1 });
      tx.donorProfile.updateMany.mockResolvedValue({ count: 1 });

      const updatedRecord = {
        ...pendingRecord,
        status: VerificationStatus.VERIFIED,
        reviewerId,
        reason: dto.reason,
      };

      tx.verificationRecord.findUniqueOrThrow.mockResolvedValue(updatedRecord);
      tx.auditLog.create.mockResolvedValue({});

      const result = await service.review(reviewerId, donorId, dto);

      expect(tx.verificationRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: recordId,
          status: VerificationStatus.PENDING,
        },
        data: {
          status: dto.status,
          reviewerId,
          reason: dto.reason,
        },
      });

      expect(tx.donorProfile.updateMany).toHaveBeenCalledWith({
        where: {
          userId: donorId,
          verificationStatus: VerificationStatus.PENDING,
        },
        data: { verificationStatus: dto.status },
      });

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: reviewerId,
          action: 'DONOR_VERIFICATION_REVIEWED',
          targetId: recordId,
        }),
      });

      expect(result.verification).toEqual(updatedRecord);
    });

    it('rejects a record already changed by another reviewer', async () => {
      authorizeReviewer();

      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.PENDING,
      });
      tx.verificationRecord.findFirst.mockResolvedValue(pendingRecord);
      tx.verificationRecord.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.review(reviewerId, donorId, dto)).rejects.toThrow(BadRequestException);

      expect(tx.donorProfile.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('rolls back when the donor profile is no longer pending', async () => {
      authorizeReviewer();

      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.PENDING,
      });
      tx.verificationRecord.findFirst.mockResolvedValue(pendingRecord);
      tx.verificationRecord.updateMany.mockResolvedValue({ count: 1 });
      tx.donorProfile.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.review(reviewerId, donorId, dto)).rejects.toThrow(BadRequestException);

      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });
  describe('submit', () => {
    const dto = {
      note: 'My donor profile is complete and ready for review.',
    };

    function configureActiveDonor() {
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.NOT_SUBMITTED,
        user: { status: 'ACTIVE' },
      });
      tx.userRole.findFirst.mockResolvedValue({ userId: donorId });
    }

    it('throws when the donor profile does not exist', async () => {
      tx.donorProfile.findUnique.mockResolvedValue(null);

      await expect(service.submit(donorId, dto)).rejects.toThrow(NotFoundException);
    });

    it('rejects an inactive account', async () => {
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.NOT_SUBMITTED,
        user: { status: 'SUSPENDED' },
      });

      await expect(service.submit(donorId, dto)).rejects.toThrow(BadRequestException);

      expect(tx.userRole.findFirst).not.toHaveBeenCalled();
    });

    it('requires the donor role', async () => {
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.NOT_SUBMITTED,
        user: { status: 'ACTIVE' },
      });
      tx.userRole.findFirst.mockResolvedValue(null);

      await expect(service.submit(donorId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate pending submissions', async () => {
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.PENDING,
        user: { status: 'ACTIVE' },
      });
      tx.userRole.findFirst.mockResolvedValue({ userId: donorId });

      await expect(service.submit(donorId, dto)).rejects.toThrow(BadRequestException);

      expect(tx.verificationRecord.create).not.toHaveBeenCalled();
    });

    it('rejects resubmission of a verified donor', async () => {
      tx.donorProfile.findUnique.mockResolvedValue({
        userId: donorId,
        verificationStatus: VerificationStatus.VERIFIED,
        user: { status: 'ACTIVE' },
      });
      tx.userRole.findFirst.mockResolvedValue({ userId: donorId });

      await expect(service.submit(donorId, dto)).rejects.toThrow(BadRequestException);

      expect(tx.verificationRecord.create).not.toHaveBeenCalled();
    });

    it('creates a pending record and audit log for an eligible submission', async () => {
      configureActiveDonor();

      const createdRecord = {
        ...pendingRecord,
        reason: dto.note,
      };

      tx.verificationRecord.create.mockResolvedValue(createdRecord);
      tx.donorProfile.update.mockResolvedValue({});
      tx.auditLog.create.mockResolvedValue({});

      const result = await service.submit(donorId, dto);

      expect(tx.verificationRecord.create).toHaveBeenCalledWith({
        data: {
          donorId,
          status: VerificationStatus.PENDING,
          reason: dto.note,
        },
      });

      expect(tx.donorProfile.update).toHaveBeenCalledWith({
        where: { userId: donorId },
        data: { verificationStatus: VerificationStatus.PENDING },
      });

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: donorId,
          action: 'DONOR_VERIFICATION_SUBMITTED',
          targetId: recordId,
          metadata: {
            donorId,
            note: dto.note,
          },
        }),
      });

      expect(result).toEqual({
        message: 'Verification submitted for review.',
        verification: createdRecord,
      });
    });
  });
});
