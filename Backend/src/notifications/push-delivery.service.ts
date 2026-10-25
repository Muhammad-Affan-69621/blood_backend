import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createDecipheriv, createHash } from 'node:crypto';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];
const BATCH_SIZE = 20;

@Injectable()
export class PushDeliveryService {
  private readonly enabled: boolean;
  private readonly encryptionKey: Buffer;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject = config.get<string>('VAPID_SUBJECT')?.trim();
    const refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');

    this.enabled = Boolean(publicKey && privateKey && subject);
    this.encryptionKey = createHash('sha256')
      .update(refreshSecret, 'utf8')
      .digest();

    if (this.enabled && publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }
  }

  private decrypt(value: string): string {
    const [ivText, tagText, ciphertextText, extra] = value.split('.');
    if (!ivText || !tagText || !ciphertextText || extra !== undefined) {
      throw new Error('Invalid encrypted push key format.');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });

    if (!subscriptions.length) return;

    // Persist every delivery before attempting to send it.
    await this.prisma.pushDelivery.createMany({
      data: subscriptions.map((subscription) => ({
        subscriptionId: subscription.id,
        payload: payload as unknown as Prisma.InputJsonValue,
      })),
    });

    // Best-effort immediate processing. The scheduled worker retries later.
    await this.processPendingDeliveries();
  }

  async processPendingDeliveries(limit = BATCH_SIZE): Promise<void> {
    if (!this.enabled || this.processing) return;

    this.processing = true;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 5 * 60_000);

      // Recover jobs abandoned by a crashed worker.
      await this.prisma.pushDelivery.updateMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: staleBefore },
        },
        data: { status: 'PENDING' },
      });

      const jobs = await this.prisma.pushDelivery.findMany({
        where: {
          status: 'PENDING',
          nextAttemptAt: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
        take: Math.max(1, Math.min(limit, 100)),
        include: {
          subscription: {
            select: {
              id: true,
              endpoint: true,
              encryptedP256dhKey: true,
              encryptedAuthKey: true,
              revokedAt: true,
            },
          },
        },
      });

      await Promise.all(jobs.map((job) => this.processOne(job)));
    } finally {
      this.processing = false;
    }
  }

  private async processOne(job: any): Promise<void> {
    const claimTime = new Date();
    const claimed = await this.prisma.pushDelivery.updateMany({
      where: {
        id: job.id,
        status: 'PENDING',
        nextAttemptAt: { lte: claimTime },
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lastAttemptAt: claimTime,
      },
    });

    // Another worker may have claimed this job already.
    if (claimed.count !== 1) return;

    const attempt = job.attempts + 1;
    const subscription = job.subscription;

    if (!subscription || subscription.revokedAt) {
      await this.markFailed(job.id, 'subscription_unavailable');
      return;
    }

    try {
      const p256dh = this.decrypt(subscription.encryptedP256dhKey);
      const auth = this.decrypt(subscription.encryptedAuthKey);

      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh, auth },
        },
        JSON.stringify(job.payload),
        { TTL: 60 },
      );

      await this.prisma.pushDelivery.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          lastError: null,
        },
      });
    } catch (error: unknown) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;

      if (statusCode === 404 || statusCode === 410) {
        await this.prisma.pushSubscription.updateMany({
          where: { id: subscription.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }).catch(() => undefined);

        await this.markFailed(job.id, `subscription_gone_${statusCode}`);
        return;
      }

      const permanentClientError =
        typeof statusCode === 'number' &&
        statusCode >= 400 &&
        statusCode < 500 &&
        statusCode !== 408 &&
        statusCode !== 429;

      const keyDecryptionFailure =
        error instanceof Error &&
        (error.message === 'Invalid encrypted push key format.' ||
          error.name === 'TypeError');

      if (
        permanentClientError ||
        keyDecryptionFailure ||
        attempt >= MAX_ATTEMPTS
      ) {
        await this.markFailed(
          job.id,
          keyDecryptionFailure
            ? 'push_key_decryption_failed'
            : statusCode
              ? `push_provider_${statusCode}`
              : 'push_delivery_failed',
        );
        return;
      }

      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
      await this.prisma.pushDelivery.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: statusCode
            ? `push_provider_${statusCode}`
            : 'push_delivery_temporarily_failed',
        },
      });
    }
  }

  private async markFailed(id: string, safeError: string): Promise<void> {
    await this.prisma.pushDelivery.updateMany({
      where: { id, status: 'PROCESSING' },
      data: { status: 'FAILED', lastError: safeError },
    });
  }
}

