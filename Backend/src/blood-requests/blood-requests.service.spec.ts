import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BloodGroup, BloodRequestStatus, RequestUrgency, UserRoleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BloodRequestsService } from './blood-requests.service';
import { UpdateBloodRequestDto } from './dto/update-blood-request.dto';

const pushDeliveryMock = { sendToUser: jest.fn().mockResolvedValue(undefined) };

describe('BloodRequestsService.update', () => {
  const now = new Date();
  const openRequest = {
    id: 'request-1',
    requesterId: 'recipient-1',
    bloodGroup: BloodGroup.O_POSITIVE,
    unitsNeeded: 2,
    hospitalName: 'City Hospital',
    city: 'Quetta',
    locationId: null,
    urgency: RequestUrgency.NORMAL,
    contactReference: null,
    status: BloodRequestStatus.OPEN,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };

  const tx = {
    bloodRequest: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };

  const prismaMock = {
    userRole: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: BloodRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.userRole.findFirst.mockResolvedValue({
      userId: 'recipient-1',
    });

    tx.bloodRequest.findFirst.mockResolvedValue({ ...openRequest });
    tx.bloodRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.bloodRequest.findUniqueOrThrow.mockResolvedValue({
      ...openRequest,
      hospitalName: 'Updated Hospital',
    });

    prismaMock.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    service = new BloodRequestsService(prismaMock as unknown as PrismaService, pushDeliveryMock as any);
  });

  it('updates an owned open request', async () => {
    const dto: UpdateBloodRequestDto = {
      hospitalName: 'Updated Hospital',
      unitsNeeded: 3,
    };

    const result = await service.update('recipient-1', 'request-1', dto);

    expect(prismaMock.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'recipient-1',
        role: UserRoleType.RECIPIENT,
      },
      select: { userId: true },
    });

    expect(tx.bloodRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'request-1',
          requesterId: 'recipient-1',
          status: BloodRequestStatus.OPEN,
        }),
        data: {
          hospitalName: 'Updated Hospital',
          unitsNeeded: 3,
        },
      }),
    );

    expect(result.hospitalName).toBe('Updated Hospital');
  });

  it('rejects a request not owned by the recipient', async () => {
    tx.bloodRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.update('recipient-1', 'other-request', {
        hospitalName: 'Updated Hospital',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.bloodRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects requests that are no longer open', async () => {
    tx.bloodRequest.findFirst.mockResolvedValue({
      ...openRequest,
      status: BloodRequestStatus.CANCELLED,
    });

    await expect(
      service.update('recipient-1', 'request-1', {
        hospitalName: 'Updated Hospital',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.bloodRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an already expired request', async () => {
    tx.bloodRequest.findFirst.mockResolvedValue({
      ...openRequest,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      service.update('recipient-1', 'request-1', {
        hospitalName: 'Updated Hospital',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.bloodRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expiration date in the past', async () => {
    await expect(
      service.update('recipient-1', 'request-1', {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.bloodRequest.findFirst).not.toHaveBeenCalled();
  });

  it('does not select locationId in the update response', async () => {
    await service.update('recipient-1', 'request-1', {
      hospitalName: 'Updated Hospital',
    });
    const args = tx.bloodRequest.findUniqueOrThrow.mock.calls[0][0];
    expect(args.select).not.toHaveProperty('locationId');
  });
  it('rejects if the request changes before the conditional update', async () => {
    tx.bloodRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update('recipient-1', 'request-1', {
        hospitalName: 'Updated Hospital',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.bloodRequest.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('BloodRequestsService.findOne authorization', () => {
  const ownedRequest = {
    id: 'request-1',
    requesterId: 'recipient-1',
    bloodGroup: BloodGroup.O_POSITIVE,
    unitsNeeded: 2,
    hospitalName: 'City Hospital',
    city: 'Quetta',
    locationId: null,
    urgency: RequestUrgency.NORMAL,
    contactReference: null,
    status: BloodRequestStatus.OPEN,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    closedAt: null,
  };

  const prismaMock = {
    userRole: {
      findFirst: jest.fn(),
    },
    bloodRequest: {
      findFirst: jest.fn(),
    },
  };

  let service: BloodRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.userRole.findFirst.mockResolvedValue({ userId: 'recipient-1' });
    prismaMock.bloodRequest.findFirst.mockResolvedValue(ownedRequest);
    service = new BloodRequestsService(prismaMock as unknown as PrismaService, pushDeliveryMock as any);
  });

  it('allows a recipient to view their own request', async () => {
    const result = await service.findOne('recipient-1', 'request-1');

    expect(prismaMock.bloodRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'request-1',
          requesterId: 'recipient-1',
        },
      }),
    );
    expect(result).toEqual(ownedRequest);
  });

  it('does not select locationId in the findOne response', async () => {
    await service.findOne('recipient-1', 'request-1');
    const args = prismaMock.bloodRequest.findFirst.mock.calls[0][0];
    expect(args.select).not.toHaveProperty('locationId');
  });
  it('does not allow a recipient to view another recipient request', async () => {
    prismaMock.bloodRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('recipient-1', 'other-recipient-request'),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.bloodRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'other-recipient-request',
          requesterId: 'recipient-1',
        },
      }),
    );
  });

  it('rejects users without the RECIPIENT role', async () => {
    prismaMock.userRole.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('donor-1', 'request-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(prismaMock.bloodRequest.findFirst).not.toHaveBeenCalled();
  });
});
describe('BloodRequestsService.findMine', () => {
  const prismaMock = {
    userRole: {
      findFirst: jest.fn(),
    },
    bloodRequest: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: BloodRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.userRole.findFirst.mockResolvedValue({
      userId: 'recipient-1',
    });
    prismaMock.bloodRequest.findMany.mockResolvedValue([{ id: 'request-1', city: 'Quetta' }]);
    prismaMock.bloodRequest.count.mockResolvedValue(23);
    prismaMock.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );

    service = new BloodRequestsService(prismaMock as unknown as PrismaService, pushDeliveryMock as any);
  });

  it('filters by recipient, status, blood group and city with stable paginated ordering', async () => {
    const result = await service.findMine('recipient-1', {
      status: BloodRequestStatus.OPEN,
      bloodGroup: BloodGroup.O_POSITIVE,
      city: 'Quetta',
      page: 2,
      limit: 5,
    });

    expect(prismaMock.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'recipient-1',
        role: UserRoleType.RECIPIENT,
      },
      select: { userId: true },
    });

    expect(prismaMock.bloodRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          requesterId: 'recipient-1',
          status: BloodRequestStatus.OPEN,
          bloodGroup: BloodGroup.O_POSITIVE,
          city: { equals: 'Quetta', mode: 'insensitive' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 5,
        take: 5,
      }),
    );

    expect(prismaMock.bloodRequest.count).toHaveBeenCalledWith({
      where: {
        requesterId: 'recipient-1',
        status: BloodRequestStatus.OPEN,
        bloodGroup: BloodGroup.O_POSITIVE,
        city: { equals: 'Quetta', mode: 'insensitive' },
      },
    });

    expect(result).toEqual({
      items: [{ id: 'request-1', city: 'Quetta' }],
      pagination: {
        page: 2,
        limit: 5,
        total: 23,
        totalPages: 5,
      },
    });
  });

  it('does not select locationId in the findMine response', async () => {
    await service.findMine('recipient-1', { page: 1, limit: 20 });
    const args = prismaMock.bloodRequest.findMany.mock.calls[0][0];
    expect(args.select).not.toHaveProperty('locationId');
  });
  it('defaults pagination and omits optional filters when they are not supplied', async () => {
    await service.findMine('recipient-1', { page: 1, limit: 20 });

    expect(prismaMock.bloodRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requesterId: 'recipient-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(prismaMock.bloodRequest.count).toHaveBeenCalledWith({
      where: { requesterId: 'recipient-1' },
    });
  });
});

describe('BloodRequestsService.updateStatus', () => {
  const now = new Date();
  const openRequest = {
    id: 'request-1',
    requesterId: 'recipient-1',
    bloodGroup: BloodGroup.O_POSITIVE,
    unitsNeeded: 2,
    hospitalName: 'City Hospital',
    city: 'Quetta',
    locationId: null,
    urgency: RequestUrgency.NORMAL,
    contactReference: null,
    status: BloodRequestStatus.OPEN,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };

  const tx = {
    bloodRequest: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    requestStatusHistory: {
      create: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  };

  const prismaMock = {
    userRole: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: BloodRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.userRole.findFirst.mockResolvedValue({ userId: 'recipient-1' });
    tx.bloodRequest.findFirst.mockResolvedValue({ ...openRequest });
    tx.bloodRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.bloodRequest.findUniqueOrThrow.mockResolvedValue({
      ...openRequest,
      status: BloodRequestStatus.IN_PROGRESS,
    });
    tx.requestStatusHistory.create.mockResolvedValue({});
    tx.notification.create.mockResolvedValue({});

    prismaMock.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    service = new BloodRequestsService(prismaMock as unknown as PrismaService, pushDeliveryMock as any);
  });

  it.each([
    [BloodRequestStatus.OPEN, BloodRequestStatus.IN_PROGRESS],
    [BloodRequestStatus.OPEN, BloodRequestStatus.CANCELLED],
    [BloodRequestStatus.IN_PROGRESS, BloodRequestStatus.FULFILLED],
  ])('allows transition from %s to %s', async (oldStatus, newStatus) => {
    tx.bloodRequest.findFirst.mockResolvedValue({
      ...openRequest,
      status: oldStatus,
    });
    tx.bloodRequest.findUniqueOrThrow.mockResolvedValue({
      ...openRequest,
      status: newStatus,
    });

    await service.updateStatus('recipient-1', 'request-1', {
      status: newStatus,
      reason: 'Status transition test',
    });

    expect(tx.bloodRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'request-1',
          requesterId: 'recipient-1',
          status: oldStatus,
        }),
        data: expect.objectContaining({
          status: newStatus,
          closedAt:
            newStatus === BloodRequestStatus.CANCELLED ||
            newStatus === BloodRequestStatus.FULFILLED
              ? expect.any(Date)
              : null,
        }),
      }),
    );

    expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1',
        changedBy: 'recipient-1',
        oldStatus,
        newStatus,
        reason: 'Status transition test',
      },
    });

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'recipient-1',
        type: 'REQUEST_UPDATE',
        payloadReference: 'request-1',
      },
    });
  });

  it.each([
    [BloodRequestStatus.OPEN, BloodRequestStatus.FULFILLED],
    [BloodRequestStatus.IN_PROGRESS, BloodRequestStatus.CANCELLED],
    [BloodRequestStatus.FULFILLED, BloodRequestStatus.OPEN],
    [BloodRequestStatus.CANCELLED, BloodRequestStatus.OPEN],
    [BloodRequestStatus.EXPIRED, BloodRequestStatus.OPEN],
  ])('rejects transition from %s to %s', async (oldStatus, newStatus) => {
    tx.bloodRequest.findFirst.mockResolvedValue({
      ...openRequest,
      status: oldStatus,
    });

    await expect(
      service.updateStatus('recipient-1', 'request-1', { status: newStatus }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.bloodRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.requestStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('rejects a request not owned by the recipient', async () => {
    tx.bloodRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.updateStatus('recipient-1', 'request-1', {
        status: BloodRequestStatus.IN_PROGRESS,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.bloodRequest.updateMany).not.toHaveBeenCalled();
  });

  it('does not select locationId in the updateStatus response', async () => {
    await service.updateStatus('recipient-1', 'request-1', {
      status: BloodRequestStatus.IN_PROGRESS,
      reason: 'Status transition test',
    });
    const args = tx.bloodRequest.findUniqueOrThrow.mock.calls[0][0];
    expect(args.select).not.toHaveProperty('locationId');
  });
  it('rejects an expired request', async () => {
    tx.bloodRequest.findFirst.mockResolvedValue({
      ...openRequest,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      service.updateStatus('recipient-1', 'request-1', {
        status: BloodRequestStatus.IN_PROGRESS,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.bloodRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects if the request changes before the conditional update', async () => {
    tx.bloodRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateStatus('recipient-1', 'request-1', {
        status: BloodRequestStatus.IN_PROGRESS,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.requestStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('trims a supplied history reason', async () => {
    await service.updateStatus('recipient-1', 'request-1', {
      status: BloodRequestStatus.IN_PROGRESS,
      reason: '  Coordinating donations  ',
    });

    expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reason: 'Coordinating donations',
      }),
    });
  });

  it('stores a missing reason as null in status history', async () => {
    await service.updateStatus('recipient-1', 'request-1', {
      status: BloodRequestStatus.IN_PROGRESS,
    });

    expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: null }),
    });
  });
});

describe('BloodRequestsService.cancelRequest', () => {
  let service: BloodRequestsService;

  beforeEach(() => {
    service = new BloodRequestsService({} as PrismaService, pushDeliveryMock as any);
    jest.spyOn(service, 'updateStatus').mockResolvedValue({} as never);
  });

  it('delegates cancellation with the supplied reason', async () => {
    await service.cancelRequest(
      'recipient-1',
      'request-1',
      'The request is no longer needed.',
    );

    expect(service.updateStatus).toHaveBeenCalledWith(
      'recipient-1',
      'request-1',
      {
        status: BloodRequestStatus.CANCELLED,
        reason: 'The request is no longer needed.',
      },
    );
  });

  it('allows cancellation without a reason', async () => {
    await service.cancelRequest('recipient-1', 'request-1');

    expect(service.updateStatus).toHaveBeenCalledWith(
      'recipient-1',
      'request-1',
      {
        status: BloodRequestStatus.CANCELLED,
        reason: undefined,
      },
    );
  });

  it('propagates cancellation failures from the shared status transition', async () => {
    (service.updateStatus as jest.Mock).mockRejectedValueOnce(
      new BadRequestException('Cannot cancel this request.'),
    );

    await expect(
      service.cancelRequest('recipient-1', 'request-1', 'No longer needed.'),
    ).rejects.toThrow(BadRequestException);
  });
});


describe('BloodRequestsService.create idempotency', () => {
  const dto = {
    bloodGroup: BloodGroup.O_POSITIVE,
    unitsNeeded: 2,
    hospitalName: 'City Hospital',
    city: 'Quetta',
  };

  const payloadHash = createHash('sha256')
    .update(JSON.stringify({
      bloodGroup: dto.bloodGroup,
      unitsNeeded: dto.unitsNeeded,
      hospitalName: dto.hospitalName,
      city: dto.city,
      locationId: null,
      urgency: RequestUrgency.NORMAL,
      contactReference: null,
      expiresAt: null,
    }))
    .digest('hex');

  const existingRequest = {
    id: 'request-1',
    requesterId: 'recipient-1',
    bloodGroup: dto.bloodGroup,
    unitsNeeded: dto.unitsNeeded,
    hospitalName: dto.hospitalName,
    city: dto.city,
    locationId: null,
    urgency: RequestUrgency.NORMAL,
    contactReference: null,
    status: BloodRequestStatus.OPEN,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    closedAt: null,
    requestPayloadHash: payloadHash,
  };

  const prismaMock = {
    userRole: {
      findFirst: jest.fn(),
    },
    bloodRequest: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  let service: BloodRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.userRole.findFirst.mockResolvedValue({
      userId: 'recipient-1',
    });
    prismaMock.bloodRequest.findUnique.mockResolvedValue(null);
    prismaMock.bloodRequest.create.mockResolvedValue({
      ...existingRequest,
    });

    service = new BloodRequestsService(
      prismaMock as unknown as PrismaService,
      pushDeliveryMock as any,
    );
  });

  it('returns the existing request for a retry with the same key and payload', async () => {
    prismaMock.bloodRequest.findUnique.mockResolvedValue({
      ...existingRequest,
    });

    const result = await service.create('recipient-1', dto, 'retry-key-1');

    expect(result.request.id).toBe('request-1');
    expect(result.request).not.toHaveProperty('requestPayloadHash');
    const retryArgs = prismaMock.bloodRequest.findUnique.mock.calls[0][0];
    expect(retryArgs.select).not.toHaveProperty('locationId');
    expect(prismaMock.bloodRequest.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a key with a different payload', async () => {
    prismaMock.bloodRequest.findUnique.mockResolvedValue({
      ...existingRequest,
    });

    await expect(
      service.create(
        'recipient-1',
        { ...dto, unitsNeeded: 3 },
        'retry-key-1',
      ),
    ).rejects.toThrow(ConflictException);

    expect(prismaMock.bloodRequest.create).not.toHaveBeenCalled();
  });

  it('creates a request normally when no idempotency key is supplied', async () => {
    await service.create('recipient-1', dto);

    expect(prismaMock.bloodRequest.create).toHaveBeenCalledTimes(1);

    const createArgs = prismaMock.bloodRequest.create.mock.calls[0][0];
    expect(createArgs.data).not.toHaveProperty('idempotencyKey');
    expect(createArgs.select).not.toHaveProperty('locationId');
    expect(createArgs.data).not.toHaveProperty('requestPayloadHash');
  });

  it('rejects a blank idempotency key', async () => {
    await expect(
      service.create('recipient-1', dto, '   '),
    ).rejects.toThrow(BadRequestException);

    expect(prismaMock.bloodRequest.create).not.toHaveBeenCalled();
  });
});
