import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    organizationMembership: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const txMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => Promise<unknown>) =>
        callback(txMock),
    );

    service = new UsersService(prismaMock as unknown as PrismaService);
  });

  describe('getMe', () => {
    it('returns the account details', async () => {
      const user = {
        id: 'user-1',
        email: 'donor@example.com',
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: [{ role: 'DONOR', organizationId: null }],
      };

      prismaMock.user.findUnique.mockResolvedValue(user);

      await expect(service.getMe('user-1')).resolves.toEqual({ user });
    });

    it('throws when the account does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyMemberships', () => {
    it('returns memberships and invitations for the logged-in user', async () => {
      prismaMock.organizationMembership.findMany.mockResolvedValue([
        {
          id: 'membership-1',
          organizationId: 'org-1',
          status: 'INVITED',
          role: 'MEMBER',
          organization: { name: 'Community Blood Network' },
        },
      ]);

      await expect(service.getMyMemberships('user-1')).resolves.toEqual({
        memberships: [
          {
            membershipId: 'membership-1',
            organizationId: 'org-1',
            status: 'INVITED',
            role: 'MEMBER',
            organizationName: 'Community Blood Network',
          },
        ],
      });

      expect(
        prismaMock.organizationMembership.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        }),
      );
    });

    it('returns an empty list when the user has no memberships', async () => {
      prismaMock.organizationMembership.findMany.mockResolvedValue([]);

      await expect(service.getMyMemberships('user-2')).resolves.toEqual({
        memberships: [],
      });
    });
  });
  describe('updateMe', () => {
    it('normalizes the email to lowercase', async () => {
      const user = {
        id: 'user-1',
        email: 'donor@example.com',
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: [],
      };

      prismaMock.user.update.mockResolvedValue(user);

      await service.updateMe('user-1', {
        email: 'DONOR@EXAMPLE.COM',
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { email: 'donor@example.com' },
        }),
      );
    });

    it('maps duplicate email errors to ConflictException', async () => {
      prismaMock.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: 'test' },
        ),
      );

      await expect(
        service.updateMe('user-1', { email: 'used@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a missing account to NotFoundException', async () => {
      prismaMock.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Record not found',
          { code: 'P2025', clientVersion: 'test' },
        ),
      );

      await expect(
        service.updateMe('missing-user', {
          email: 'new@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateMe', () => {
    it('deactivates the account and revokes active refresh tokens', async () => {
      txMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
      });
      txMock.user.update.mockResolvedValue({});
      txMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.deactivateMe('user-1')).resolves.toEqual({
        message: 'Account deactivated successfully.',
      });

      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.DEACTIVATED },
      });

      expect(txMock.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: expect.objectContaining({
            revokedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('throws when the account does not exist', async () => {
      txMock.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivateMe('missing-user')).rejects.toThrow(
        NotFoundException,
      );

      expect(txMock.user.update).not.toHaveBeenCalled();
    });

    it('does not update an already deactivated account', async () => {
      txMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.DEACTIVATED,
      });

      await expect(service.deactivateMe('user-1')).resolves.toEqual({
        message: 'Account is already deactivated.',
      });

      expect(txMock.user.update).not.toHaveBeenCalled();
      expect(txMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});



