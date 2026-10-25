import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';

@Injectable()
export class PushSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encryptionKey(): Buffer {
    // Derive a fixed-length AES key from the existing high-entropy server secret.
    return createHash('sha256')
      .update(this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), 'utf8')
      .digest();
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
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

  private validateEndpoint(endpoint: string): void {
    try {
      if (new URL(endpoint).protocol !== 'https:') {
        throw new Error('HTTPS required');
      }
    } catch {
      throw new UnprocessableEntityException(
        'Push subscription endpoint must be a valid HTTPS URL.',
      );
    }
  }

  async register(userId: string, dto: RegisterPushSubscriptionDto) {
    this.validateEndpoint(dto.endpoint);

    const encryptedP256dhKey = this.encrypt(dto.keys.p256dh);
    const encryptedAuthKey = this.encrypt(dto.keys.auth);

    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: dto.endpoint },
      select: { id: true, userId: true },
    });

    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'This push endpoint is already registered to another account.',
      );
    }

    const subscription = existing
      ? await this.prisma.pushSubscription.update({
          where: { id: existing.id },
          data: {
            encryptedP256dhKey,
            encryptedAuthKey,
            revokedAt: null,
          },
          select: { id: true, createdAt: true, updatedAt: true },
        })
      : await this.prisma.pushSubscription.create({
          data: {
            userId,
            endpoint: dto.endpoint,
            encryptedP256dhKey,
            encryptedAuthKey,
          },
          select: { id: true, createdAt: true, updatedAt: true },
        });

    return {
      message: 'Push subscription registered successfully.',
      subscription,
    };
  }

  async revoke(userId: string, endpoint: string) {
    this.validateEndpoint(endpoint);

    const result = await this.prisma.pushSubscription.updateMany({
      where: { userId, endpoint, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Idempotent: a missing or already revoked endpoint is still safely revoked.
    return {
      message: 'Push subscription revoked if it was active.',
      revoked: result.count === 1,
    };
  }
}