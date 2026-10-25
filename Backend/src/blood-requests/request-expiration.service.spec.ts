jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: {
    EVERY_MINUTE: '* * * * *',
  },
}));

import { BloodRequestStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestExpirationService } from './request-expiration.service';

describe('RequestExpirationService', () => {
  const tx = {
    bloodRequest: {
      updateMany: jest.fn(),
    },
    requestStatusHistory: {
      create: jest.fn(),
    },
  };

  const prismaMock = {
    bloodRequest: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: RequestExpirationService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx),
    );

    tx.bloodRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.requestStatusHistory.create.mockResolvedValue({});
    prismaMock.bloodRequest.findMany.mockResolvedValue([]);

    service = new RequestExpirationService(prismaMock as unknown as PrismaService);
  });

  it('expires an eligible request and records its status history', async () => {
    prismaMock.bloodRequest.findMany.mockResolvedValue([
      {
        id: 'request-1',
        status: BloodRequestStatus.OPEN,
      },
    ]);

    await service.expireRequests();

    expect(tx.bloodRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'request-1',
          status: BloodRequestStatus.OPEN,
        }),
        data: {
          status: BloodRequestStatus.EXPIRED,
          closedAt: expect.any(Date),
        },
      }),
    );

    expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1',
        changedBy: null,
        oldStatus: BloodRequestStatus.OPEN,
        newStatus: BloodRequestStatus.EXPIRED,
        reason: 'Request expiration time reached',
      },
    });
  });

  it('does not record history if another operation already changed the request', async () => {
    prismaMock.bloodRequest.findMany.mockResolvedValue([
      {
        id: 'request-2',
        status: BloodRequestStatus.OPEN,
      },
    ]);

    tx.bloodRequest.updateMany.mockResolvedValue({ count: 0 });

    await service.expireRequests();

    expect(tx.requestStatusHistory.create).not.toHaveBeenCalled();
  });

  it('continues processing other requests when one expiration fails', async () => {
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      prismaMock.bloodRequest.findMany.mockResolvedValue([
        {
          id: 'request-3',
          status: BloodRequestStatus.OPEN,
        },
        {
          id: 'request-4',
          status: BloodRequestStatus.IN_PROGRESS,
        },
      ]);

      tx.bloodRequest.updateMany
        .mockRejectedValueOnce(new Error('Simulated database error'))
        .mockResolvedValueOnce({ count: 1 });

      await expect(service.expireRequests()).resolves.toBeUndefined();

      expect(tx.bloodRequest.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.requestStatusHistory.create).toHaveBeenCalledTimes(1);
      expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
        data: {
          requestId: 'request-4',
          changedBy: null,
          oldStatus: BloodRequestStatus.IN_PROGRESS,
          newStatus: BloodRequestStatus.EXPIRED,
          reason: 'Request expiration time reached',
        },
      });

      expect(loggerErrorSpy).toHaveBeenCalled();
    } finally {
      loggerErrorSpy.mockRestore();
    }
  });
});
