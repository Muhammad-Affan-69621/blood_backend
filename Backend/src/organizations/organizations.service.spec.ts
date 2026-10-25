import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  const organizationId = 'a947e651-348b-4d6b-8995-7394ded0bfc6';
  const adminId = '11111111-1111-4111-8111-111111111111';
  const invitedUserId = '32089d63-77bb-4cf6-b9a9-090047357617';
  const membershipId = 'bbe60703-b35c-4335-8e77-61a0cf5d54af';

  let prisma: {
    organization: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    organizationMembership: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
    userRole: {
      findFirst: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({
          id: organizationId,
        }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      organizationMembership: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: membershipId,
          organizationId,
          userId: invitedUserId,
          role: 'MEMBER',
          status: 'ACTIVE',
          updatedAt: new Date(),
        }),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
        }),
      },
      userRole: {
        findFirst: jest.fn().mockResolvedValue({ id: 'platform-admin-role' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
      },
      $transaction: jest.fn(async (operation: unknown): Promise<unknown> => {
        if (typeof operation === 'function') {
          return (operation as (tx: typeof prisma) => Promise<unknown>)(prisma);
        }

        throw new Error('Unexpected transaction input');
      }),
    };

    service = new OrganizationsService(prisma as unknown as PrismaService);
  });

  describe('restore', () => {
    const archivedOrganization = {
      id: organizationId,
      name: 'Test Organization',
      status: 'ARCHIVED',
    };

    beforeEach(() => {
      prisma.userRole.findFirst.mockResolvedValue({
        id: 'platform-admin-role',
      });
    });

    it('restores an archived organization and records an audit log', async () => {
      prisma.organization.findUnique.mockResolvedValue(archivedOrganization);
      prisma.organization.update.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        slug: 'test-organization',
        status: 'ACTIVE',
        updatedAt: new Date(),
      });

      const result = await service.restore(adminId, organizationId);

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: organizationId },
        data: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          updatedAt: true,
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: adminId,
          organizationId,
          action: 'ORGANIZATION_RESTORED',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: {
            previousStatus: 'ARCHIVED',
            newStatus: 'ACTIVE',
          },
        },
      });
      expect(result.organization.status).toBe('ACTIVE');
    });

    it('denies restoration by a non-platform administrator', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.restore(adminId, organizationId),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('returns not found for a missing organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.restore(adminId, organizationId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects restoration when the organization is already active', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...archivedOrganization,
        status: 'ACTIVE',
      });

      await expect(
        service.restore(adminId, organizationId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects restoration when the organization is suspended', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...archivedOrganization,
        status: 'SUSPENDED',
      });

      await expect(
        service.restore(adminId, organizationId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates audit-log failures', async () => {
      prisma.organization.findUnique.mockResolvedValue(archivedOrganization);
      prisma.organization.update.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        slug: 'test-organization',
        status: 'ACTIVE',
        updatedAt: new Date(),
      });
      prisma.auditLog.create.mockRejectedValue(
        new Error('Audit database failure'),
      );

      await expect(
        service.restore(adminId, organizationId),
      ).rejects.toThrow('Audit database failure');
    });
  });

  describe('archive', () => {
    it('archives an active organization and records the audit log', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        status: 'ACTIVE',
      });

      prisma.organization.update.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        slug: 'test-organization',
        status: 'ARCHIVED',
        updatedAt: new Date(),
      });

      const result = await service.archive(adminId, organizationId);

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: organizationId },
        data: { status: 'ARCHIVED' },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          updatedAt: true,
        },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: adminId,
          organizationId,
          action: 'ORGANIZATION_ARCHIVED',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: {
            previousStatus: 'ACTIVE',
            newStatus: 'ARCHIVED',
          },
        },
      });

      expect(result.message).toBe('Organization archived successfully.');
      expect(result.organization.status).toBe('ARCHIVED');
      expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
      expect(prisma.organizationMembership.updateMany).not.toHaveBeenCalled();
    });

    it('denies archiving by a non-platform administrator', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.archive(adminId, organizationId),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('returns not found when the organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.archive(adminId, organizationId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects an organization that is already archived', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        status: 'ARCHIVED',
      });

      await expect(
        service.archive(adminId, organizationId),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects archiving an organization that is suspended', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        status: 'SUSPENDED',
      });

      await expect(
        service.archive(adminId, organizationId),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('propagates audit-log failures so the transaction can roll back', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        status: 'ACTIVE',
      });

      prisma.organization.update.mockResolvedValue({
        id: organizationId,
        name: 'Test Organization',
        slug: 'test-organization',
        status: 'ARCHIVED',
        updatedAt: new Date(),
      });

      const auditError = new Error('Audit storage unavailable');
      prisma.auditLog.create.mockRejectedValueOnce(auditError);

      await expect(
        service.archive(adminId, organizationId),
      ).rejects.toThrow('Audit storage unavailable');

      expect(prisma.organization.update).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const dto = { name: 'Test Organization', slug: 'test-organization' };

    it('allows an active platform administrator to create an organization', async () => {
      prisma.organization.create.mockResolvedValue({
        id: organizationId,
        name: dto.name,
        slug: dto.slug,
        memberships: [],
      });

      const result = await service.create(adminId, dto);

      expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
        where: {
          userId: adminId,
          role: 'PLATFORM_ADMIN',
          user: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
      });
      expect(prisma.organization.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(result.message).toBe('Organization created successfully.');
    });

    it.each([
      ['donor', null],
      ['recipient', null],
      ['inactive platform administrator', null],
    ])('denies creation for an unauthorized caller (%s)', async (_label, _unused) => {
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(service.create(adminId, dto)).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.organization.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('accepts a pending invitation for the invited active user', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValue({
      id: membershipId,
      userId: invitedUserId,
      role: 'MEMBER',
      status: 'INVITED',
    });

    const result = await service.acceptInvitation(invitedUserId, organizationId, membershipId);

    expect(prisma.organizationMembership.updateMany).toHaveBeenCalledWith({
      where: {
        id: membershipId,
        organizationId,
        userId: invitedUserId,
        status: 'INVITED',
      },
      data: { status: 'ACTIVE' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: invitedUserId,
        organizationId,
        action: 'ORGANIZATION_INVITATION_ACCEPTED',
        targetId: membershipId,
      }),
    });

    expect(result.membership.status).toBe('ACTIVE');
  });

  it('prevents a different user from accepting the invitation', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValue({
      id: membershipId,
      userId: invitedUserId,
      role: 'MEMBER',
      status: 'INVITED',
    });

    await expect(
      service.acceptInvitation(adminId, organizationId, membershipId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.organizationMembership.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an invitation that is no longer pending', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValue({
      id: membershipId,
      userId: invitedUserId,
      role: 'MEMBER',
      status: 'ACTIVE',
    });

    await expect(
      service.acceptInvitation(invitedUserId, organizationId, membershipId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.organizationMembership.updateMany).not.toHaveBeenCalled();
  });

  it('rejects acceptance if another request already processed the invitation', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValue({
      id: membershipId,
      userId: invitedUserId,
      role: 'MEMBER',
      status: 'INVITED',
    });
    prisma.organizationMembership.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.acceptInvitation(invitedUserId, organizationId, membershipId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('prevents demoting the last active organization administrator', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValueOnce({
      id: membershipId,
      userId: adminId,
      role: 'ORGANIZATION_ADMIN',
      status: 'ACTIVE',
    });
    prisma.organizationMembership.count.mockResolvedValue(0);

    await expect(
      service.updateMembershipRole(adminId, organizationId, membershipId, { role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
  });

  it('prevents suspending the last active organization administrator', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValueOnce({
      id: membershipId,
      userId: adminId,
      role: 'ORGANIZATION_ADMIN',
      status: 'ACTIVE',
    });
    prisma.organizationMembership.count.mockResolvedValue(0);

    await expect(
      service.updateMembershipStatus(adminId, organizationId, membershipId, {
        status: 'SUSPENDED',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
  });

  it('prevents an administrator from changing a membership in another organization', async () => {
    const otherOrganizationId = '22222222-2222-4222-8222-222222222222';

    prisma.organizationMembership.findFirst.mockResolvedValueOnce(null); // target membership is not in this organization

    await expect(
      service.updateMembershipRole(adminId, otherOrganizationId, membershipId, {
        role: 'VERIFIER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('prevents a status update for a membership outside the requested organization', async () => {
    const otherOrganizationId = '33333333-3333-4333-8333-333333333333';

    prisma.organizationMembership.findFirst.mockResolvedValueOnce(null); // target membership is not in this organization

    await expect(
      service.updateMembershipStatus(adminId, otherOrganizationId, membershipId, {
        status: 'SUSPENDED',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('denies membership role changes to non-platform administrators', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMembershipRole(adminId, organizationId, membershipId, {
        role: 'VERIFIER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
  });

  it('denies membership reactivation by organization administrators', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMembershipStatus(adminId, organizationId, membershipId, {
        status: 'ACTIVE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.organizationMembership.update).not.toHaveBeenCalled();
  });
  it('denies member listing when the caller is not an active organization administrator', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);
    prisma.organizationMembership.findFirst.mockResolvedValueOnce(null);

    await expect(service.listMembers(adminId, organizationId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.organizationMembership.findMany).not.toHaveBeenCalled();
  });
});


