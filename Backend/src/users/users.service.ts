import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './update-user.dto';

const accountSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: true,
      organizationId: true,
    },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyMemberships(userId: string) {
    const memberships =
      await this.prisma.organizationMembership.findMany({
        where: { userId },
        select: {
          id: true,
          organizationId: true,
          status: true,
          role: true,
          organization: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

    return {
      memberships: memberships.map((membership) => ({
        membershipId: membership.id,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        role: membership.role,
        status: membership.status,
      })),
    };
  }
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: accountSelect,
    });

    if (!user) {
      throw new NotFoundException('Account not found.');
    }

    return { user };
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    const email = dto.email.toLowerCase();

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { email },
        select: accountSelect,
      });

      return {
        message: 'Account updated successfully.',
        user,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('That email address is already in use.');
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Account not found.');
      }

      throw error;
    }
  }

  async deactivateMe(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true },
      });

      if (!user) {
        throw new NotFoundException('Account not found.');
      }

      if (user.status === UserStatus.DEACTIVATED) {
        return { message: 'Account is already deactivated.' };
      }

      await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.DEACTIVATED },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      return { message: 'Account deactivated successfully.' };
    });
  }
}


