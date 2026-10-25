jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email/email.service';
import { AuthService } from './auth.service';

describe('AuthService password recovery', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'donor@example.com';
  const resetUrl = 'https://frontend.example.com/reset-password';
  const now = new Date('2026-01-01T00:00:00.000Z');

  const user = { id: userId, email };

  const settings: Record<string, string> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-password',
    SMTP_FROM: 'noreply@example.com',
    PASSWORD_RESET_URL: resetUrl,
  };

  let service: AuthService;
  let prisma: any;
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let emailService: { sendMail: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordResetToken: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(
        async (operation: (tx: any) => Promise<unknown>) =>
          operation(prisma),
      ),
    };

    configService = {
      get: jest.fn((key: string) => settings[key]),
      getOrThrow: jest.fn((key: string) => {
        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    emailService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      prisma as PrismaService,
      {} as JwtService,
      configService as unknown as ConfigService,
      emailService as unknown as EmailService,
    );
  });

  it('keeps recovery unavailable when SMTP settings are incomplete', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'SMTP_HOST' ? '' : settings[key],
    );

    await expect(
      service.forgotPassword({ email }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it('returns a generic response and sends no email for an unknown account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.forgotPassword({ email });

    expect(result.message).toMatch(/If an account exists/i);
    expect(emailService.sendMail).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('stores only a token hash and emails a reset link for an existing account', async () => {
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.forgotPassword({ email });

    expect(result.message).toMatch(/If an account exists/i);
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });

    const createCall = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(createCall.data.userId).toBe(userId);
    expect(createCall.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createCall.data.tokenHash).not.toMatch(/token/i);
    expect(createCall.data.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    expect(emailService.sendMail.mock.calls[0][0]).toBe(email);
    expect(emailService.sendMail.mock.calls[0][2]).toContain(resetUrl);
    expect(emailService.sendMail.mock.calls[0][2]).toContain('token=');
  });

  it('rejects a reset token that does not exist', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        token: 'not-a-valid-token',
        newPassword: 'NewSecurePass123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an expired reset token', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-id',
      userId,
      expiresAt: new Date(now.getTime() - 1000),
      consumedAt: null,
    });

    await expect(
      service.resetPassword({
        token: 'expired-token',
        newPassword: 'NewSecurePass123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('hashes the new password with Argon2id and revokes active refresh tokens', async () => {
    const rawToken = 'valid-test-reset-token';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-id',
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });

    await service.resetPassword({
      token: rawToken,
      newPassword: 'NewSecurePass123!',
    });

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reset-token-id',
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { consumedAt: expect.any(Date) },
    });

    const updateCall = prisma.user.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: userId });
    expect(
      await argon2.verify(updateCall.data.passwordHash, 'NewSecurePass123!'),
    ).toBe(true);

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a token that has already been consumed', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-id',
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });

    await expect(
      service.resetPassword({
        token: 'used-token',
        newPassword: 'NewSecurePass123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a reset if another request consumes the token first', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-id',
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.resetPassword({
        token: 'raced-token',
        newPassword: 'NewSecurePass123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

