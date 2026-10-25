import { NotFoundException } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const prisma = {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );

    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  describe('findMine', () => {
    it('returns paginated notifications belonging to the user', async () => {
      const items = [{ id: 'notification-1' }];

      prisma.notification.findMany.mockResolvedValue(items);
      prisma.notification.count.mockResolvedValue(21);

      const result = await service.findMine('user-1', {
        page: 2,
        limit: 10,
      });

      expect(result).toEqual({
        items,
        pagination: {
          page: 2,
          limit: 10,
          total: 21,
          totalPages: 3,
        },
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          skip: 10,
          take: 10,
        }),
      );

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            userId: true,
            type: true,
            payloadReference: true,
            readAt: true,
            createdAt: true,
          },
        }),
      );
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('counts only unread notifications belonging to the user', async () => {
      prisma.notification.count.mockResolvedValue(4);

      await expect(service.getUnreadCount('user-1')).resolves.toEqual({
        count: 4,
      });

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          readAt: null,
        },
      });
    });
  });

  describe('markAsRead', () => {
    it('marks an unread notification belonging to the user as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const notification = {
        id: 'notification-1',
        userId: 'user-1',
        readAt: new Date(),
      };

      prisma.notification.findFirstOrThrow.mockResolvedValue(notification);

      await expect(service.markAsRead('user-1', 'notification-1')).resolves.toEqual(notification);
      expect(prisma.notification.findFirstOrThrow).toHaveBeenCalledWith({
        where: {
          id: 'notification-1',
          userId: 'user-1',
        },
        select: {
          id: true,
          userId: true,
          type: true,
          payloadReference: true,
          readAt: true,
          createdAt: true,
        },
      });

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'notification-1',
            userId: 'user-1',
            readAt: null,
          },
          data: {
            readAt: expect.any(Date),
          },
        }),
      );
    });

    it('does not update a notification owned by another user', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('user-1', 'notification-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'notification-2',
          userId: 'user-1',
        },
        select: {
          id: true,
          readAt: true,
        },
      });
    });

    it('preserves the timestamp when the notification is already read', async () => {
      const readAt = new Date('2026-10-20T12:00:00.000Z');

      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue({
        id: 'notification-1',
        readAt,
      });

      await expect(service.markAsRead('user-1', 'notification-1')).resolves.toEqual({
        id: 'notification-1',
        readAt,
      });
    });
  });

  describe('markAllAsRead', () => {
    it('marks only the current user’s unread notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.markAllAsRead('user-1')).resolves.toEqual({
        updatedCount: 3,
      });

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          readAt: null,
        },
        data: {
          readAt: expect.any(Date),
        },
      });
    });
  });
});
