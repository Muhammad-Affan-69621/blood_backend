import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AbuseReportsService } from './abuse-reports.service';

type MockMethod = jest.Mock;

interface AbuseReportsPrismaMock {
  userRole: { findFirst: MockMethod };
  user: { findUnique: MockMethod };
  bloodRequest: { findUnique: MockMethod };
  organization: { findUnique: MockMethod };
  abuseReport: {
    findFirst: MockMethod;
    create: MockMethod;
    findMany: MockMethod;
    findUnique: MockMethod;
    updateMany: MockMethod;
    findUniqueOrThrow: MockMethod;
  };
  auditLog: { create: MockMethod };
  $transaction: MockMethod;
}

describe('AbuseReportsService', () => {
  let service: AbuseReportsService;
  let prisma: AbuseReportsPrismaMock;

  beforeEach(() => {
    prisma = {
      userRole: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
      bloodRequest: { findUnique: jest.fn() },
      organization: { findUnique: jest.fn() },
      abuseReport: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: AbuseReportsPrismaMock) => unknown) => cb(prisma)),
    };
    service = new AbuseReportsService(
      prisma as unknown as ConstructorParameters<typeof AbuseReportsService>[0],
    );
  });

  it('rejects a report for a nonexistent target', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create('reporter', 'target', { targetType: 'USER', category: 'spam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents duplicate open reports by the same reporter', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target' });
    prisma.abuseReport.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create('reporter', 'target', { targetType: 'USER', category: 'spam' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires moderator role to view queue', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);
    await expect(service.listQueue('user')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes a review and audit record for an authorized moderator', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ id: 'role' });
    prisma.abuseReport.findUnique.mockResolvedValue({ id: 'r1', status: 'OPEN' });
    prisma.abuseReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.abuseReport.findUniqueOrThrow.mockResolvedValue({ id: 'r1', status: 'UNDER_REVIEW' });
    prisma.auditLog.create.mockResolvedValue({});
    const result = await service.review('moderator', 'r1', { status: 'UNDER_REVIEW' });
    expect(result.report.status).toBe('UNDER_REVIEW');
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
