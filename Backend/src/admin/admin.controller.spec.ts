jest.mock('../auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class MockJwtAuthGuard {},
}));

import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: {
    getStats: jest.Mock;
  };

  beforeEach(() => {
    adminService = {
      getStats: jest.fn(),
    };

    controller = new AdminController(adminService as unknown as AdminService);
  });

  it('passes the authenticated user ID to AdminService', async () => {
    const expectedStats = {
      generatedAt: '2026-10-23T00:00:00.000Z',
      users: { total: 100 },
      donors: {
        totalProfiles: 50,
        availableProfiles: 30,
        verifiedProfiles: 25,
        eligibleAndAvailable: 20,
      },
      bloodRequests: {
        OPEN: 5,
        IN_PROGRESS: 2,
        FULFILLED: 10,
        CANCELLED: 1,
        EXPIRED: 3,
      },
      verifications: {
        recordsByStatus: {
          NOT_SUBMITTED: 0,
          PENDING: 4,
          VERIFIED: 25,
          REJECTED: 2,
          SUSPENDED: 0,
        },
        pendingRecords: 4,
      },
      abuseReports: {
        reportsByStatus: {
          OPEN: 2,
          UNDER_REVIEW: 1,
          RESOLVED: 8,
          DISMISSED: 3,
        },
        unresolvedReports: 3,
      },
    };

    adminService.getStats.mockResolvedValue(expectedStats);

    const result = await controller.getStats({
      user: {
        sub: 'admin-user-123',
        email: 'admin@example.com',
        roles: ['PLATFORM_ADMIN'],
      },
    });

    expect(adminService.getStats).toHaveBeenCalledTimes(1);
    expect(adminService.getStats).toHaveBeenCalledWith('admin-user-123');
    expect(result).toEqual(expectedStats);
  });

  it('propagates service authorization errors', async () => {
    adminService.getStats.mockRejectedValue(
      new ForbiddenException(
        'Only active platform administrators can access dashboard statistics.',
      ),
    );

    await expect(
      controller.getStats({
        user: {
          sub: 'ordinary-user-123',
          email: 'user@example.com',
          roles: ['DONOR'],
        },
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(adminService.getStats).toHaveBeenCalledWith('ordinary-user-123');
  });
});
