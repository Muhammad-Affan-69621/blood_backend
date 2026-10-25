import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BloodGroup,
  BloodRequestStatus,
  DonorResponseStatus,
  RecipientResponseDecision,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DonorResponsesService } from './donor-responses.service';

describe('DonorResponsesService', () => {
  let service: DonorResponsesService;

  let prisma: {
    userRole: {
      findFirst: jest.Mock;
    };
    donorProfile: {
      findUnique: jest.Mock;
    };
    bloodRequest: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    donorResponse: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
    requestStatusHistory: {
      create: jest.Mock;
    };
    notification: {
      create: jest.Mock;
      createMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const donorId = '11111111-1111-4111-8111-111111111111';
  const recipientId = '22222222-2222-4222-8222-222222222222';
  const requestId = '33333333-3333-4333-8333-333333333333';
  const responseId = '44444444-4444-4444-8444-444444444444';

  const eligibleDonorProfile = {
    bloodGroup: BloodGroup.O_NEGATIVE,
    isAvailable: true,
    verificationStatus: VerificationStatus.VERIFIED,
    dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
    weightKg: 65,
    lastDonationDate: null,
  };

  const openRequest = {
    id: requestId,
    requesterId: recipientId,
    bloodGroup: BloodGroup.A_POSITIVE,
    status: BloodRequestStatus.OPEN,
    expiresAt: null,
  };

  const pendingResponse = {
    id: responseId,
    requestId,
    donorId,
    status: DonorResponseStatus.WILLING,
    recipientDecision: RecipientResponseDecision.PENDING,
  };

  beforeEach(() => {
    prisma = {
      userRole: {
        findFirst: jest.fn().mockResolvedValue({
          user: { status: UserStatus.ACTIVE },
        }),
      },

      donorProfile: {
        findUnique: jest.fn().mockResolvedValue(eligibleDonorProfile),
      },

      bloodRequest: {
        findUnique: jest.fn().mockResolvedValue(openRequest),
        findFirst: jest.fn().mockResolvedValue(openRequest),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },

      donorResponse: {
        create: jest.fn().mockResolvedValue({
          id: 'response-id',
          status: DonorResponseStatus.WILLING,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(pendingResponse),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...pendingResponse,
          message: null,
          recipientDecision: RecipientResponseDecision.ACCEPTED,
          recipientDecisionAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },

      requestStatusHistory: {
        create: jest.fn().mockResolvedValue({
          id: 'history-id',
        }),
      },

      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notification-id' }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },

      $transaction: jest.fn(async (operation: unknown): Promise<unknown> => {
        if (typeof operation === 'function') {
          return (operation as (tx: typeof prisma) => Promise<unknown>)(prisma);
        }

        if (Array.isArray(operation)) {
          return Promise.all(operation);
        }

        throw new Error('Unsupported Prisma transaction mock input');
      }),
    };

    service = new DonorResponsesService(prisma as unknown as PrismaService);
  });

  it('creates a compatible response for an active verified donor', async () => {
    const result = await service.create(donorId, requestId, {
      status: DonorResponseStatus.WILLING,
      message: ' I can help ',
    });

    expect(prisma.donorResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          donorId,
          requestId,
          message: 'I can help',
        }),
      }),
    );

    expect(result.response.id).toBe('response-id');
  });

  it('rejects users without donor role', async () => {
    prisma.userRole.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects inactive accounts', async () => {
    prisma.userRole.findFirst.mockResolvedValueOnce({
      user: { status: UserStatus.SUSPENDED },
    });

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects closed requests', async () => {
    prisma.bloodRequest.findUnique.mockResolvedValueOnce({
      ...openRequest,
      status: BloodRequestStatus.CANCELLED,
    });

    prisma.bloodRequest.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.donorResponse.create).not.toHaveBeenCalled();
  });

  it('rejects own requests', async () => {
    prisma.bloodRequest.findUnique.mockResolvedValueOnce({
      ...openRequest,
      requesterId: donorId,
    });

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects incompatible blood groups', async () => {
    prisma.donorProfile.findUnique.mockResolvedValueOnce({
      ...eligibleDonorProfile,
      bloodGroup: BloodGroup.B_POSITIVE,
    });

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unavailable donors', async () => {
    prisma.donorProfile.findUnique.mockResolvedValueOnce({
      ...eligibleDonorProfile,
      isAvailable: false,
    });

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps unique constraint errors to a conflict', async () => {
    const { Prisma } = await import('@prisma/client');

    prisma.donorResponse.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create(donorId, requestId, {
        status: DonorResponseStatus.WILLING,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose another recipient request responses', async () => {
    prisma.bloodRequest.findFirst.mockResolvedValueOnce(null);

    await expect(service.findForRecipient(recipientId, requestId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(prisma.donorResponse.findMany).not.toHaveBeenCalled();
  });

  it('lists open compatible requests with pagination and excludes existing responses', async () => {
    prisma.bloodRequest.count.mockResolvedValueOnce(1);
    prisma.bloodRequest.findMany.mockResolvedValueOnce([{ id: requestId }]);

    const result = await service.findOpenRequestsForDonor(donorId, {
      page: 2,
      limit: 10,
    });

    expect(prisma.bloodRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({
          status: BloodRequestStatus.OPEN,
          donorResponses: { none: { donorId } },
        }),
      }),
    );

    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('filters open donor requests by city and uses stable ordering', async () => {
    await service.findOpenRequestsForDonor(donorId, {
      city: 'quetta',
      page: 1,
      limit: 20,
    });

    expect(prisma.bloodRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          city: { equals: 'quetta', mode: 'insensitive' },
        }),
        orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('does not apply a city filter when city is omitted', async () => {
    await service.findOpenRequestsForDonor(donorId, {
      page: 1,
      limit: 20,
    });

    const args = prisma.bloodRequest.findMany.mock.calls[0][0];
    expect(args.where.city).toBeUndefined();
  });
  it('lists only the current donor responses', async () => {
    await service.findMine(donorId);

    expect(prisma.donorResponse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { donorId },
      }),
    );
  });

  it('accepts a willing donor response and records request status history', async () => {
    const result = await service.decideForRecipient(
      recipientId,
      requestId,
      responseId,
      RecipientResponseDecision.ACCEPTED,
    );

    expect(prisma.bloodRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: requestId,
          requesterId: recipientId,
          status: BloodRequestStatus.OPEN,
        }),
        data: { status: BloodRequestStatus.IN_PROGRESS },
      }),
    );

    expect(prisma.requestStatusHistory.create).toHaveBeenCalledWith({
      data: {
        requestId,
        changedBy: recipientId,
        oldStatus: BloodRequestStatus.OPEN,
        newStatus: BloodRequestStatus.IN_PROGRESS,
        reason: 'A donor response was accepted.',
      },
    });

    expect(prisma.donorResponse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: responseId,
          requestId,
        }),
        data: expect.objectContaining({
          recipientDecision: RecipientResponseDecision.ACCEPTED,
        }),
      }),
    );

    expect(result.response.id).toBe(responseId);
  });

  it('rejects a willing donor response without closing the request', async () => {
    const result = await service.decideForRecipient(
      recipientId,
      requestId,
      responseId,
      RecipientResponseDecision.REJECTED,
    );

    expect(prisma.bloodRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.requestStatusHistory.create).not.toHaveBeenCalled();

    expect(prisma.donorResponse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: responseId,
          requestId,
        }),
        data: expect.objectContaining({
          recipientDecision: RecipientResponseDecision.REJECTED,
        }),
      }),
    );

    expect(result.response.id).toBe(responseId);
  });

  it('rejects a recipient decision for a request they do not own', async () => {
    prisma.bloodRequest.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.decideForRecipient(
        recipientId,
        requestId,
        responseId,
        RecipientResponseDecision.ACCEPTED,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects decisions for a response that has already been decided', async () => {
    prisma.donorResponse.findFirst.mockResolvedValueOnce({
      ...pendingResponse,
      recipientDecision: RecipientResponseDecision.REJECTED,
    });

    await expect(
      service.decideForRecipient(
        recipientId,
        requestId,
        responseId,
        RecipientResponseDecision.ACCEPTED,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a request that has already been claimed', async () => {
    prisma.bloodRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.decideForRecipient(
        recipientId,
        requestId,
        responseId,
        RecipientResponseDecision.ACCEPTED,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.requestStatusHistory.create).not.toHaveBeenCalled();
  });
});
