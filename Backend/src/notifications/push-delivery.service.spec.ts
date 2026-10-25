import { createCipheriv, randomBytes, createHash } from 'node:crypto';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PushDeliveryService } from './push-delivery.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('PushDeliveryService', () => {
  const refreshSecret = 'test-refresh-secret';
  const encryptionKey = createHash('sha256')
    .update(refreshSecret, 'utf8')
    .digest();

  const prisma = {
    pushSubscription: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    pushDelivery: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  function encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  function makeConfig(enabled = true) {
    const values: Record<string, string | undefined> = {
      VAPID_PUBLIC_KEY: enabled ? 'test-public-key' : undefined,
      VAPID_PRIVATE_KEY: enabled ? 'test-private-key' : undefined,
      VAPID_SUBJECT: enabled ? 'mailto:test@example.com' : undefined,
    };
    return {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn(() => refreshSecret),
    };
  }

  function makeSubscription() {
    return {
      id: 'subscription-1',
      endpoint: 'https://push.example.test/subscription',
      encryptedP256dhKey: encrypt('test-p256dh-key'),
      encryptedAuthKey: encrypt('test-auth-key'),
      revokedAt: null,
    };
  }

  function makeJob(subscription = makeSubscription()) {
    return {
      id: 'delivery-1',
      subscriptionId: subscription.id,
      payload: {
        title: 'Blood request updated',
        body: 'Your request changed.',
        url: '/notifications',
      },
      status: 'PENDING',
      attempts: 0,
      subscription,
    };
  }

  function makeService(enabled = true) {
    return new PushDeliveryService(
      prisma as unknown as PrismaService,
      makeConfig(enabled) as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pushSubscription.findMany.mockResolvedValue([]);
    prisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.pushDelivery.createMany.mockResolvedValue({ count: 0 });
    prisma.pushDelivery.findMany.mockResolvedValue([]);
    prisma.pushDelivery.updateMany.mockResolvedValue({ count: 1 });
    (webpush.sendNotification as jest.Mock).mockResolvedValue(undefined);
  });

  it('does not query subscriptions when VAPID is not configured', async () => {
    await makeService(false).sendToUser('user-1', {
      title: 'Test',
      body: 'Test body',
    });

    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(prisma.pushDelivery.createMany).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('persists a delivery for every active subscription', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: 'subscription-1' },
      { id: 'subscription-2' },
    ]);

    await makeService().sendToUser('user-1', {
      title: 'Test',
      body: 'Test body',
    });

    expect(prisma.pushDelivery.createMany).toHaveBeenCalledWith({
      data: [
        {
          subscriptionId: 'subscription-1',
          payload: { title: 'Test', body: 'Test body' },
        },
        {
          subscriptionId: 'subscription-2',
          payload: { title: 'Test', body: 'Test body' },
        },
      ],
    });
    expect(prisma.pushDelivery.findMany).toHaveBeenCalled();
  });

  it('sends a queued payload and marks it delivered', async () => {
    const subscription = makeSubscription();
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: subscription.id },
    ]);
    prisma.pushDelivery.findMany.mockResolvedValue([makeJob(subscription)]);

    await makeService().sendToUser('user-1', {
      title: 'Blood request updated',
      body: 'Your request changed.',
      url: '/notifications',
    });

    expect(webpush.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key',
        },
      },
      JSON.stringify({
        title: 'Blood request updated',
        body: 'Your request changed.',
        url: '/notifications',
      }),
      { TTL: 60 },
    );

    expect(prisma.pushDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', status: 'PROCESSING' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
          lastError: null,
        }),
      }),
    );
  });

  it.each([404, 410])(
    'revokes an expired subscription and marks its delivery failed (%i)',
    async (statusCode) => {
      const subscription = makeSubscription();
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: subscription.id },
      ]);
      prisma.pushDelivery.findMany.mockResolvedValue([makeJob(subscription)]);
      (webpush.sendNotification as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Provider error'), { statusCode }),
      );

      await makeService().sendToUser('user-1', {
        title: 'Test',
        body: 'Test body',
      });

      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
        where: { id: subscription.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.pushDelivery.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'delivery-1', status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            lastError: `subscription_gone_${statusCode}`,
          },
        }),
      );
    },
  );

  it('schedules a retry after a temporary provider failure', async () => {
    const subscription = makeSubscription();
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: subscription.id },
    ]);
    prisma.pushDelivery.findMany.mockResolvedValue([makeJob(subscription)]);
    (webpush.sendNotification as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Temporary failure'), { statusCode: 503 }),
    );

    await makeService().sendToUser('user-1', {
      title: 'Test',
      body: 'Test body',
    });

    expect(prisma.pushDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', status: 'PROCESSING' },
        data: expect.objectContaining({
          status: 'PENDING',
          nextAttemptAt: expect.any(Date),
          lastError: 'push_provider_503',
        }),
      }),
    );
  });

  it('marks a delivery failed when its stored key cannot be decrypted', async () => {
    const subscription = {
      ...makeSubscription(),
      encryptedP256dhKey: 'invalid-encrypted-value',
    };
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: subscription.id },
    ]);
    prisma.pushDelivery.findMany.mockResolvedValue([makeJob(subscription)]);

    await makeService().sendToUser('user-1', {
      title: 'Test',
      body: 'Test body',
    });

    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(prisma.pushDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          lastError: 'push_key_decryption_failed',
        },
      }),
    );
  });

  it('does not claim a delivery already claimed by another worker', async () => {
    const subscription = makeSubscription();
    prisma.pushDelivery.findMany.mockResolvedValue([makeJob(subscription)]);
    prisma.pushDelivery.updateMany
      .mockResolvedValueOnce({ count: 0 }); // stale-job recovery
    // The claim is the second updateMany call.
    prisma.pushDelivery.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    await makeService().processPendingDeliveries();

    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('does not throw if revoking an expired subscription fails', async () => {
    const subscription = makeSubscription();
    prisma.pushDelivery.findMany.mockResolvedValue([makeJob(subscription)]);
    (webpush.sendNotification as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );
    prisma.pushSubscription.updateMany.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(makeService().processPendingDeliveries()).resolves.toBeUndefined();
    expect(prisma.pushDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          lastError: 'subscription_gone_410',
        },
      }),
    );
  });
});

