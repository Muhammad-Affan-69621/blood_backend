jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
}));

import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const jwtService = {
    verifyAsync: jest.fn(),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const request: {
    headers: { authorization?: string };
    user?: { sub: string; email: string; roles: string[] };
  } = {
    headers: {},
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    request.headers = {};
    delete request.user;

    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
  });

  it('rejects requests without a Bearer token', async () => {
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects invalid access tokens', async () => {
    request.headers.authorization = 'Bearer invalid-token';
    jwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows an active account and attaches the JWT payload', async () => {
    const payload = {
      sub: 'user-1',
      email: 'donor@example.com',
      roles: ['DONOR'],
    };

    request.headers.authorization = 'Bearer valid-token';
    jwtService.verifyAsync.mockResolvedValue(payload);
    prisma.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { status: true },
    });
    expect(request.user).toEqual(payload);
  });

  it.each([
    UserStatus.PENDING,
    UserStatus.SUSPENDED,
    UserStatus.DEACTIVATED,
  ])('rejects an account with status %s', async (status) => {
    request.headers.authorization = 'Bearer valid-token';
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'donor@example.com',
      roles: ['DONOR'],
    });
    prisma.user.findUnique.mockResolvedValue({ status });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Account is not active',
    );

    expect(request.user).toBeUndefined();
  });

  it('rejects a token whose account no longer exists', async () => {
    request.headers.authorization = 'Bearer valid-token';
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'deleted-user',
      email: 'donor@example.com',
      roles: ['DONOR'],
    });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Account is not active',
    );
  });

  it('rejects a token without a subject', async () => {
    request.headers.authorization = 'Bearer valid-token';
    jwtService.verifyAsync.mockResolvedValue({
      email: 'donor@example.com',
      roles: ['DONOR'],
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid access token payload',
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});