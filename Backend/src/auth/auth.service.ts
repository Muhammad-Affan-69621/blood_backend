import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRoleType, UserStatus } from '@prisma/client';
import type { SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import * as argon2 from 'argon2';

import { EmailService } from '../notifications/email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto, LoginDto, RefreshTokenDto, RegisterDto, ResetPasswordDto } from './auth.dto';

type SafeUser = {
  id: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  roles: { role: UserRoleType }[];
};

type RefreshClaims = {
  sub: string;
  jti: string;
  tokenUse: 'refresh';
  exp: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    if (bcrypt.truncates(dto.password)) {
      throw new ConflictException('Password is too long for the selected password-hashing method.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const role = dto.role === 'RECIPIENT' ? UserRoleType.RECIPIENT : UserRoleType.DONOR;

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          roles: { create: { role } },
        },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          roles: { select: { role: true } },
        },
      });

      return this.createTokenResponse(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists.');
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        createdAt: true,
        roles: { select: { role: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isArgon2Hash = user.passwordHash.startsWith('$argon2id$');
    let passwordMatches = false;

    try {
      if (isArgon2Hash) {
        passwordMatches = await argon2.verify(user.passwordHash, dto.password);
      } else if (user.passwordHash.startsWith('$2')) {
        passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
      }
    } catch {
      passwordMatches = false;
    }

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    this.ensureAccountAvailable(user.status);

    // Upgrade legacy bcrypt hashes without overwriting a concurrently changed password.
    if (!isArgon2Hash) {
      const upgradedHash = await argon2.hash(dto.password, {
        type: argon2.argon2id,
      });

      await this.prisma.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
        },
        data: { passwordHash: upgradedHash },
      });
    }

    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      roles: user.roles,
    };

    return this.createTokenResponse(safeUser);
  }

  async refresh(dto: RefreshTokenDto) {
    const claims = await this.verifyRefreshToken(dto.refreshToken);
    const tokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const revoked = await tx.refreshToken.updateMany({
          where: {
            tokenHash,
            userId: claims.sub,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });

        if (revoked.count !== 1) {
          throw new UnauthorizedException('Invalid or expired refresh token.');
        }

        const user = await tx.user.findUnique({
          where: { id: claims.sub },
          select: {
            id: true,
            email: true,
            status: true,
            createdAt: true,
            roles: { select: { role: true } },
          },
        });

        if (!user) {
          throw new UnauthorizedException('Invalid or expired refresh token.');
        }

        this.ensureAccountAvailable(user.status);
        return this.createTokenResponse(user, tx);
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2025', 'P2034'].includes(error.code)
      ) {
        throw new UnauthorizedException('Invalid or expired refresh token.');
      }

      throw error;
    }
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const configKeys = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
      'PASSWORD_RESET_URL',
    ];

    const settings = Object.fromEntries(
      configKeys.map((key) => [key, this.configService.get<string>(key)?.trim() ?? '']),
    );

    if (configKeys.some((key) => !settings[key])) {
      throw new ServiceUnavailableException(
        'Password recovery is not currently available.',
      );
    }

    let resetUrl: URL;
    try {
      resetUrl = new URL(settings.PASSWORD_RESET_URL!);
      if (!['http:', 'https:'].includes(resetUrl.protocol)) {
        throw new Error('Unsupported URL protocol');
      }
    } catch {
      throw new ServiceUnavailableException(
        'Password recovery is not currently available.',
      );
    }

    const genericResponse = {
      message:
        'If an account exists for this email, password-reset instructions will be sent.',
    };

    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      return genericResponse;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });

      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
    });

    resetUrl.searchParams.set('token', rawToken);

    try {
      await this.emailService.sendMail(
        user.email,
        'Reset your Blood Donation account password',
        [
          'We received a request to reset your password.',
          '',
          `Use this link to reset it: ${resetUrl.toString()}`,
          '',
          'This link expires in 30 minutes and can only be used once.',
          'If you did not request this, you can ignore this email.',
        ].join('\n'),
      );
    } catch {
      // Never log the token, reset URL, recipient, or provider error details.
      Logger.error('Password reset email delivery failed.', 'AuthService');

      await this.prisma.passwordResetToken.updateMany({
        where: { tokenHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    }

    return genericResponse;
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (bcrypt.truncates(dto.newPassword)) {
      throw new BadRequestException(
        'Password is too long for the configured password policy.',
      );
    }

    const tokenHash = this.hashToken(dto.token);
    const now = new Date();

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    if (
      !resetToken ||
      resetToken.consumedAt !== null ||
      resetToken.expiresAt <= now
    ) {
      throw new BadRequestException('Invalid or expired password-reset token.');
    }

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException(
          'Invalid or expired password-reset token.',
        );
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });

      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    return { message: 'Password has been reset successfully.' };
  }
  async logout(dto: RefreshTokenDto) {
    // Revocation is deliberately idempotent; the token is never returned.
    const tokenHash = this.hashToken(dto.refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  private async createTokenResponse(
    user: SafeUser,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const accessToken = await this.createAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id, tx);

    return {
      user,
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_ACCESS_TTL', '15m'),
      refreshExpiresIn: this.configService.get<string>('JWT_REFRESH_TTL', '7d'),
    };
  }

  private async createAccessToken(user: SafeUser): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      roles: user.roles.map((item) => item.role),
    });
  }

  private async createRefreshToken(
    userId: string,
    tx: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const refreshSecret = this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    const refreshTtl = this.configService.get<string>(
      'JWT_REFRESH_TTL',
      '7d',
    ) as SignOptions['expiresIn'];
    const tokenId = randomUUID();

    const token = await this.jwtService.signAsync(
      {
        sub: userId,
        jti: tokenId,
        tokenUse: 'refresh',
      },
      {
        secret: refreshSecret,
        expiresIn: refreshTtl,
      },
    );

    const decoded = this.jwtService.decode(token);

    if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
      throw new Error('Unable to determine refresh-token expiration.');
    }

    await tx.refreshToken.create({
      data: {
        tokenHash: this.hashToken(token),
        userId,
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return token;
  }

  private async verifyRefreshToken(token: string): Promise<RefreshClaims> {
    try {
      const claims = await this.jwtService.verifyAsync<RefreshClaims & Record<string, unknown>>(
        token,
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        },
      );

      if (
        typeof claims.sub !== 'string' ||
        typeof claims.jti !== 'string' ||
        claims.tokenUse !== 'refresh' ||
        typeof claims.exp !== 'number'
      ) {
        throw new UnauthorizedException('Invalid or expired refresh token.');
      }

      return claims;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
  }

  private ensureAccountAvailable(status: UserStatus): void {
    if (status === UserStatus.SUSPENDED || status === UserStatus.DEACTIVATED) {
      throw new UnauthorizedException('This account is not available.');
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}


