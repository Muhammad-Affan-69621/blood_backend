jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
}));
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRoleType, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as argon2 from 'argon2';

import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { EmailService } from '../notifications/email/email.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
    decode: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };

  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'donor@example.com';
  const now = new Date('2026-01-01T00:00:00.000Z');

  const user = {
    id: userId,
    email,
    status: UserStatus.ACTIVE,
    createdAt: now,
    roles: [{ role: UserRoleType.DONOR }],
  };

  const refreshClaims = {
    sub: userId,
    jti: 'refresh-jti',
    tokenUse: 'refresh' as const,
    exp: Math.floor(now.getTime() / 1000) + 604800,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 'refresh-record-id' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(
        async (operation: (tx: typeof prisma) => Promise<unknown>) =>
          operation(prisma),
      ),
    };

    jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      verifyAsync: jest.fn().mockResolvedValue(refreshClaims),
      decode: jest.fn().mockReturnValue({ exp: refreshClaims.exp }),
    };

    configService = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'JWT_ACCESS_TTL') return '15m';
        if (key === 'JWT_REFRESH_TTL') return '7d';
        return fallback;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_REFRESH_SECRET') return 'r'.repeat(64);
        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      {
        sendMail: jest.fn().mockResolvedValue(undefined),
      } as unknown as EmailService,
    );
  });

  it('returns access and refresh tokens after successful registration', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(user);

    const result = await service.register({
      email: ' Donor@Example.com ',
      password: 'TestPass123!',
      role: 'DONOR',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'donor@example.com',
          roles: { create: { role: UserRoleType.DONOR } },
        }),
      }),
    );
    const storedHash = prisma.user.create.mock.calls[0][0].data.passwordHash as string;
    expect(storedHash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(storedHash, 'TestPass123!')).toBe(true);
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.tokenType).toBe('Bearer');
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          expiresAt: new Date(refreshClaims.exp * 1000),
        }),
      }),
    );
  });

  it('rejects registration when the email already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: userId });

    await expect(
      service.register({
        email,
        password: 'TestPass123!',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects login when the password is incorrect', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      passwordHash: await bcrypt.hash('DifferentPass123!', 4),
    });

    await expect(
      service.login({ email, password: 'WrongPass123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('upgrades a legacy bcrypt password hash after successful login', async () => {
    const legacyHash = await bcrypt.hash('TestPass123!', 4);
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      passwordHash: legacyHash,
    });

    await service.login({ email, password: 'TestPass123!' });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: userId, passwordHash: legacyHash },
      data: { passwordHash: expect.stringMatching(/^\$argon2id\$/) },
    });

    const upgradedHash =
      prisma.user.updateMany.mock.calls[0][0].data.passwordHash as string;
    expect(await argon2.verify(upgradedHash, 'TestPass123!')).toBe(true);
  });

  it('rotates a valid refresh token and stores a new token hash', async () => {
    jwtService.signAsync.mockReset();
    jwtService.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');
    jwtService.decode.mockReturnValue({
      exp: refreshClaims.exp + 604800,
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.refresh({
      refreshToken: 'old-refresh-token',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toBe('new-refresh-token');
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('rejects refresh-token replay when the token is already revoked', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.refresh({ refreshToken: 'replayed-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens that fail JWT verification', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(
      service.refresh({ refreshToken: 'invalid-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokes an active refresh token during logout', async () => {
    const result = await service.logout({
      refreshToken: 'refresh-token-to-revoke',
    });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          revokedAt: null,
        }),
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(result).toEqual({ success: true });
  });
});