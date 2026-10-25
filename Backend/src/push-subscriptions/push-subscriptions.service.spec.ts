import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

describe('PushSubscriptionsService', () => {
  const secret = 'test-refresh-secret-that-is-long-enough';
  const prisma = {
    pushSubscription: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const config = {
    getOrThrow: jest.fn(() => secret),
  };

  const dto = {
    endpoint: 'https://push.example.test/subscription',
    keys: {
      p256dh: 'test-public-key',
      auth: 'test-auth-key',
    },
  };

  let service: PushSubscriptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pushSubscription.findUnique.mockResolvedValue(null);
    prisma.pushSubscription.create.mockResolvedValue({
      id: 'subscription-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.pushSubscription.update.mockResolvedValue({
      id: 'subscription-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 });

    service = new PushSubscriptionsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('registers a new HTTPS subscription and encrypts its keys', async () => {
    const result = await service.register('user-1', dto);

    expect(result.message).toBe('Push subscription registered successfully.');
    expect(prisma.pushSubscription.create).toHaveBeenCalledTimes(1);

    const args = prisma.pushSubscription.create.mock.calls[0][0];
    expect(args.data.userId).toBe('user-1');
    expect(args.data.endpoint).toBe(dto.endpoint);
    expect(args.data.encryptedP256dhKey).not.toBe(dto.keys.p256dh);
    expect(args.data.encryptedAuthKey).not.toBe(dto.keys.auth);
    expect(args.select).toEqual({
      id: true,
      createdAt: true,
      updatedAt: true,
    });
  });

  it('refreshes an existing subscription owned by the same user', async () => {
    prisma.pushSubscription.findUnique.mockResolvedValue({
      id: 'subscription-1',
      userId: 'user-1',
    });

    await service.register('user-1', dto);

    expect(prisma.pushSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'subscription-1' },
        data: expect.objectContaining({
          revokedAt: null,
        }),
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
    expect(prisma.pushSubscription.create).not.toHaveBeenCalled();
  });

  it('rejects an endpoint owned by another account', async () => {
    prisma.pushSubscription.findUnique.mockResolvedValue({
      id: 'subscription-1',
      userId: 'other-user',
    });

    await expect(service.register('user-1', dto)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.pushSubscription.create).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.update).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS subscription endpoints', async () => {
    await expect(
      service.register('user-1', {
        ...dto,
        endpoint: 'http://push.example.test/subscription',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(prisma.pushSubscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.create).not.toHaveBeenCalled();
  });

  it('revokes only the current user active subscription', async () => {
    const result = await service.revoke('user-1', dto.endpoint);

    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        endpoint: dto.endpoint,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result.revoked).toBe(true);
  });

  it('handles missing or already revoked subscriptions idempotently', async () => {
    prisma.pushSubscription.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.revoke('user-1', dto.endpoint);

    expect(result).toEqual({
      message: 'Push subscription revoked if it was active.',
      revoked: false,
    });
  });

  it('rejects a non-HTTPS endpoint during revocation', async () => {
    await expect(
      service.revoke('user-1', 'http://push.example.test/subscription'),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
  });
});
