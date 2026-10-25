jest.mock('../auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class MockJwtAuthGuard {},
}));

import { ForbiddenException } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import {
  ReviewVerificationDto,
  SubmitVerificationDto,
  VerificationDecision,
  VerificationQueueQueryDto,
} from './verification.dto';

describe('VerificationController', () => {
  let controller: VerificationController;
  let verificationService: {
    submit: jest.Mock;
    getMyStatus: jest.Mock;
    getQueue: jest.Mock;
    review: jest.Mock;
  };

  const userId = '11111111-1111-4111-8111-111111111111';
  const donorId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    verificationService = {
      submit: jest.fn(),
      getMyStatus: jest.fn(),
      getQueue: jest.fn(),
      review: jest.fn(),
    };

    controller = new VerificationController(verificationService as unknown as VerificationService);
  });

  describe('submit', () => {
    it('passes the authenticated user ID and DTO to the service', async () => {
      const dto: SubmitVerificationDto = {
        note: 'My donor profile is complete and ready for review.',
      };
      const expected = {
        message: 'Verification submitted for review.',
        verification: { id: 'verification-record-1' },
      };

      verificationService.submit.mockResolvedValue(expected);

      const result = await controller.submit({ user: { sub: userId } } as never, dto);

      expect(verificationService.submit).toHaveBeenCalledTimes(1);
      expect(verificationService.submit).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(expected);
    });

    it('propagates service authorization errors', async () => {
      verificationService.submit.mockRejectedValue(
        new ForbiddenException('A donor role is required.'),
      );

      await expect(
        controller.submit({ user: { sub: userId } } as never, { note: 'Ready for review.' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMyStatus', () => {
    it('passes the authenticated user ID to the service', async () => {
      const expected = {
        verificationStatus: 'VERIFIED',
        latestReview: { status: 'VERIFIED' },
      };

      verificationService.getMyStatus.mockResolvedValue(expected);

      const result = await controller.getMyStatus({ user: { sub: userId } } as never);

      expect(verificationService.getMyStatus).toHaveBeenCalledTimes(1);
      expect(verificationService.getMyStatus).toHaveBeenCalledWith(userId);
      expect(result).toEqual(expected);
    });
  });

  describe('getQueue', () => {
    it('passes the authenticated user ID, limit, and cursor to the service', async () => {
      const query: VerificationQueueQueryDto = {
        limit: 10,
        cursor: '33333333-3333-4333-8333-333333333333',
      };
      const expected = {
        items: [{ donorId }],
        nextCursor: null,
      };

      verificationService.getQueue.mockResolvedValue(expected);

      const result = await controller.getQueue({ user: { sub: userId } } as never, query);

      expect(verificationService.getQueue).toHaveBeenCalledTimes(1);
      expect(verificationService.getQueue).toHaveBeenCalledWith(userId, query.limit, query.cursor);
      expect(result).toEqual(expected);
    });

    it('forwards undefined pagination values when omitted', async () => {
      verificationService.getQueue.mockResolvedValue({
        items: [],
        nextCursor: null,
      });

      await controller.getQueue(
        { user: { sub: userId } } as never,
        {} as VerificationQueueQueryDto,
      );

      expect(verificationService.getQueue).toHaveBeenCalledWith(userId, undefined, undefined);
    });
  });

  describe('review', () => {
    it('passes the reviewer ID, donor ID, and review DTO to the service', async () => {
      const dto: ReviewVerificationDto = {
        status: VerificationDecision.VERIFIED,
        reason: 'Donor details reviewed.',
      };
      const expected = {
        message: 'Verification reviewed successfully.',
        verification: { donorId, status: VerificationDecision.VERIFIED },
      };

      verificationService.review.mockResolvedValue(expected);

      const result = await controller.review({ user: { sub: userId } } as never, donorId, dto);

      expect(verificationService.review).toHaveBeenCalledTimes(1);
      expect(verificationService.review).toHaveBeenCalledWith(userId, donorId, dto);
      expect(result).toEqual(expected);
    });

    it('propagates service authorization errors', async () => {
      verificationService.review.mockRejectedValue(
        new ForbiddenException(
          'Only active moderators and platform administrators can review verification.',
        ),
      );

      await expect(
        controller.review({ user: { sub: userId } } as never, donorId, {
          status: VerificationDecision.REJECTED,
          reason: 'Insufficient documentation.',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
