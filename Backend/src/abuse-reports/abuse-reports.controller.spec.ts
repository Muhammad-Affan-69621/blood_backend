jest.mock('../auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class MockJwtAuthGuard {},
}));

import { ForbiddenException } from '@nestjs/common';
import { AbuseReportStatus, AbuseTargetType } from '@prisma/client';
import { AbuseReportsController } from './abuse-reports.controller';
import { AbuseReportsService } from './abuse-reports.service';
import { CreateAbuseReportDto, ReviewAbuseReportDto } from './abuse-reports.dto';

describe('AbuseReportsController', () => {
  let controller: AbuseReportsController;
  let service: {
    create: jest.Mock;
    listMine: jest.Mock;
    listQueue: jest.Mock;
    review: jest.Mock;
  };

  const userId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  const reportId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    service = {
      create: jest.fn(),
      listMine: jest.fn(),
      listQueue: jest.fn(),
      review: jest.fn(),
    };

    controller = new AbuseReportsController(service as unknown as AbuseReportsService);
  });

  describe('create', () => {
    it('passes the reporter ID, target ID, and DTO to the service', async () => {
      const dto: CreateAbuseReportDto = {
        targetType: AbuseTargetType.USER,
        category: 'spam',
        description: 'Suspicious activity',
      };
      const expected = { id: reportId, status: AbuseReportStatus.OPEN };
      service.create.mockResolvedValue(expected);

      const result = await controller.create({ user: { sub: userId } } as never, targetId, dto);

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.create).toHaveBeenCalledWith(userId, targetId, dto);
      expect(result).toEqual(expected);
    });

    it('propagates service errors', async () => {
      service.create.mockRejectedValue(new ForbiddenException('Reporting is not permitted.'));

      await expect(
        controller.create({ user: { sub: userId } } as never, targetId, {
          targetType: AbuseTargetType.USER,
          category: 'spam',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listMine', () => {
    it('lists reports for the authenticated user', async () => {
      const expected = [{ id: reportId, status: AbuseReportStatus.OPEN }];
      service.listMine.mockResolvedValue(expected);

      const result = await controller.listMine({ user: { sub: userId } } as never);

      expect(service.listMine).toHaveBeenCalledWith(userId);
      expect(result).toEqual(expected);
    });
  });

  describe('listQueue', () => {
    it('passes the reviewer ID and requested status to the service', async () => {
      const expected = [{ id: reportId, status: AbuseReportStatus.UNDER_REVIEW }];
      service.listQueue.mockResolvedValue(expected);

      const result = await controller.listQueue(
        { user: { sub: userId } } as never,
        AbuseReportStatus.UNDER_REVIEW,
      );

      expect(service.listQueue).toHaveBeenCalledWith(userId, AbuseReportStatus.UNDER_REVIEW);
      expect(result).toEqual(expected);
    });

    it('passes an undefined status when no filter is supplied', async () => {
      service.listQueue.mockResolvedValue([]);

      await controller.listQueue({ user: { sub: userId } } as never);

      expect(service.listQueue).toHaveBeenCalledWith(userId, undefined);
    });
  });

  describe('review', () => {
    it('passes reviewer ID, report ID, and review DTO to the service', async () => {
      const dto: ReviewAbuseReportDto = {
        status: AbuseReportStatus.RESOLVED,
        resolution: 'Reviewed and resolved',
      };
      const expected = { id: reportId, status: AbuseReportStatus.RESOLVED };
      service.review.mockResolvedValue(expected);

      const result = await controller.review({ user: { sub: userId } } as never, reportId, dto);

      expect(service.review).toHaveBeenCalledTimes(1);
      expect(service.review).toHaveBeenCalledWith(userId, reportId, dto);
      expect(result).toEqual(expected);
    });

    it('propagates reviewer authorization errors', async () => {
      service.review.mockRejectedValue(
        new ForbiddenException('Only moderators can review reports.'),
      );

      await expect(
        controller.review({ user: { sub: userId } } as never, reportId, {
          status: AbuseReportStatus.DISMISSED,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
