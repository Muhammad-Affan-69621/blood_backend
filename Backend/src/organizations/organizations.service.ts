import { Prisma , OrganizationStatus } from "@prisma/client";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,

  BadRequestException,} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './organization.dto';
import {
  InviteOrganizationMemberDto,
  UpdateMembershipRoleDto,
  UpdateMembershipStatusDto,
} from './organization-membership.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const platformAdmin = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: 'PLATFORM_ADMIN',
        user: {
          is: {
            status: 'ACTIVE',
          },
        },
      },
      select: { id: true },
    });

    if (!platformAdmin) {
      throw new ForbiddenException('Only active platform administrators can create organizations.');
    }

    const existing = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('This organization slug is already in use.');
    }

    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          memberships: {
            create: {
              userId,
              role: 'ORGANIZATION_ADMIN',
              status: 'ACTIVE',
            },
          },
        },
        include: {
          memberships: {
            where: { userId },
            select: {
              id: true,
              role: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          organizationId: created.id,
          action: 'ORGANIZATION_CREATED',
          targetType: 'Organization',
          targetId: created.id,
        },
      });

      return created;
    });

    return {
      message: 'Organization created successfully.',
      organization,
    };
  }

  private async isActivePlatformAdmin(userId: string): Promise<boolean> {
    const platformAdmin = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: 'PLATFORM_ADMIN',
        user: {
          is: {
            status: 'ACTIVE',
          },
        },
      },
      select: { id: true },
    });

    return Boolean(platformAdmin);
  }

  async restore(actorId: string, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const platformAdmin = await tx.userRole.findFirst({
        where: {
          userId: actorId,
          role: 'PLATFORM_ADMIN',
          user: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
      });

      if (!platformAdmin) {
        throw new ForbiddenException(
          'Only active platform administrators can restore organizations.',
        );
      }

      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, status: true },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }

      if (organization.status === 'ACTIVE') {
        throw new ConflictException(
          'This organization is already active.',
        );
      }

      if (organization.status !== 'ARCHIVED') {
        throw new ConflictException(
          'Only archived organizations can be restored.',
        );
      }

      const restored = await tx.organization.update({
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

      await tx.auditLog.create({
        data: {
          actorId,
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

      return {
        message: 'Organization restored successfully.',
        organization: restored,
      };
    });
  }


  async archive(actorId: string, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const platformAdmin = await tx.userRole.findFirst({
        where: {
          userId: actorId,
          role: 'PLATFORM_ADMIN',
          user: {
            is: {
              status: 'ACTIVE',
            },
          },
        },
        select: { id: true },
      });

      if (!platformAdmin) {
        throw new ForbiddenException(
          'Only active platform administrators can archive organizations.',
        );
      }

      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          status: true,
        },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }

      if (organization.status === 'ARCHIVED') {
        throw new ConflictException('This organization has already been archived.');
      }

      if (organization.status !== 'ACTIVE') {
        throw new ConflictException(
          'Only active organizations can be archived.',
        );
      }

      const archived = await tx.organization.update({
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

      await tx.auditLog.create({
        data: {
          actorId,
          organizationId,
          action: 'ORGANIZATION_ARCHIVED',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: {
            previousStatus: organization.status,
            newStatus: 'ARCHIVED',
          },
        },
      });

      return {
        message: 'Organization archived successfully.',
        organization: archived,
      };
    });
  }

  async listByStatus(userId: string, status?: string) {
    const allowedStatuses = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;

    if (
      status !== undefined &&
      !allowedStatuses.includes(status as (typeof allowedStatuses)[number])
    ) {
      throw new BadRequestException(
        'Invalid organization status. Use ACTIVE, SUSPENDED, or ARCHIVED.',
      );
    }

    const isPlatformAdmin = await this.isActivePlatformAdmin(userId);

    if (status && status !== 'ACTIVE' && !isPlatformAdmin) {
      throw new ForbiddenException(
        'Only active platform administrators can list non-active organizations.',
      );
    }

    if (
      status &&
      !allowedStatuses.includes(status as (typeof allowedStatuses)[number])
    ) {
      throw new BadRequestException('Invalid organization status');
    }

    const selectedStatus: OrganizationStatus =
      (status ?? OrganizationStatus.ACTIVE) as OrganizationStatus;

    const organizations = await this.prisma.organization.findMany({
      where: isPlatformAdmin
        ? { status: selectedStatus }
        : {
            status: 'ACTIVE',
            memberships: {
              some: {
                userId,
                status: 'ACTIVE',
              },
            },
          },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    return { organizations };
  }

  async getById(userId: string, id: string) {
    const isPlatformAdmin = await this.isActivePlatformAdmin(userId);

    const organization = await this.prisma.organization.findFirst({
      where: isPlatformAdmin
        ? { id, status: 'ACTIVE' }
        : {
            id,
            status: 'ACTIVE',
            memberships: {
              some: {
                userId,
                status: 'ACTIVE',
              },
            },
          },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Active organization not found.');
    }

    return { organization };
  }

  private async assertActiveOrganizationAdmin(organizationId: string, userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        id: organizationId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (!organization) {
      throw new NotFoundException('Active organization not found.');
    }

    const platformAdmin = await this.isActivePlatformAdmin(userId);

    if (platformAdmin) {
      return;
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        role: 'ORGANIZATION_ADMIN',
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (!membership) {
      throw new ForbiddenException('An active organization administrator membership is required.');
    }
  }

  private async assertAnotherActiveAdminExists(
    organizationId: string,
    excludedMembershipId: string,
  ) {
    const otherAdmins = await this.prisma.organizationMembership.count({
      where: {
        organizationId,
        id: { not: excludedMembershipId },
        role: 'ORGANIZATION_ADMIN',
        status: 'ACTIVE',
      },
    });

    if (otherAdmins === 0) {
      throw new ConflictException(
        'The last active organization administrator cannot be demoted, suspended, or removed.',
      );
    }
  }

  async listMembers(actorId: string, organizationId: string) {
    await this.assertActiveOrganizationAdmin(organizationId, actorId);

    const members = await this.prisma.organizationMembership.findMany({
      where: { organizationId },
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { members };
  }

  async inviteMember(actorId: string, organizationId: string, dto: InviteOrganizationMemberDto) {
    await this.assertActiveOrganizationAdmin(organizationId, actorId);

    if (!dto.userId && !dto.email) {
      throw new BadRequestException("Provide the existing user's email address or userId.");
    }
    if (dto.userId && dto.email) {
      throw new BadRequestException('Provide either email or userId, not both.');
    }

    const user = dto.userId
      ? await this.prisma.user.findUnique({
          where: { id: dto.userId },
          select: { id: true, email: true, status: true },
        })
      : await this.prisma.user.findFirst({
          where: { email: { equals: dto.email!.trim(), mode: 'insensitive' } },
          select: { id: true, email: true, status: true },
        });

    if (!user || user.status !== 'ACTIVE') {
      throw new NotFoundException('Active user not found.');
    }

    if (actorId === user.id && dto.role !== 'MEMBER') {
      throw new ConflictException('You cannot invite yourself into another membership role.');
    }

    const existingMembership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.id,
        },
      },
      select: { id: true },
    });

    if (existingMembership) {
      throw new ConflictException(
        'This user already has a membership record for the organization.',
      );
    }

    try {
      const membership = await this.prisma.$transaction(async (tx) => {
        const created = await tx.organizationMembership.create({
          data: {
            organizationId,
            userId: user.id,
            role: dto.role,
            status: 'INVITED',
          },
          select: {
            id: true,
            organizationId: true,
            userId: true,
            role: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                email: true,
                status: true,
              },
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorId,
            organizationId,
            action: 'ORGANIZATION_MEMBER_INVITED',
            targetType: 'OrganizationMembership',
            targetId: created.id,
            metadata: {
              role: dto.role,
              userId: user.id,
              email: user.email,
            },
          },
        });

        return created;
      });

      return {
        message: 'Organization member invited successfully.',
        membership,
      };
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This user already has a membership record for the organization.',
        );
      }

      throw error;
    }
  }

  async updateMembershipRole(
    actorId: string,
    organizationId: string,
    membershipId: string,
    dto: UpdateMembershipRoleDto,
  ) {
    const updated = await this.prisma
      .$transaction(
        async (tx) => {
          const organization = await tx.organization.findFirst({
            where: { id: organizationId, status: 'ACTIVE' },
            select: { id: true },
          });

          if (!organization) {
            throw new NotFoundException('Active organization not found.');
          }

          const platformAdmin = await tx.userRole.findFirst({
            where: {
              userId: actorId,
              role: 'PLATFORM_ADMIN',
              user: {
                is: {
                  status: 'ACTIVE',
                },
              },
            },
            select: { id: true },
          });

          if (!platformAdmin) {
            throw new ForbiddenException(
              'Only active platform administrators can change membership roles.',
            );
          }

          const membership = await tx.organizationMembership.findFirst({
            where: { id: membershipId, organizationId },
            select: {
              id: true,
              userId: true,
              role: true,
              status: true,
            },
          });

          if (!membership) {
            throw new NotFoundException('Organization membership not found.');
          }

          if (
            membership.role === 'ORGANIZATION_ADMIN' &&
            membership.status === 'ACTIVE' &&
            dto.role !== 'ORGANIZATION_ADMIN'
          ) {
            const otherAdmins = await tx.organizationMembership.count({
              where: {
                organizationId,
                id: { not: membershipId },
                role: 'ORGANIZATION_ADMIN',
                status: 'ACTIVE',
              },
            });

            if (otherAdmins === 0) {
              throw new ConflictException(
                'The last active organization administrator cannot be demoted, suspended, or removed.',
              );
            }
          }

          const result = await tx.organizationMembership.update({
            where: { id: membershipId },
            data: { role: dto.role },
            select: {
              id: true,
              organizationId: true,
              userId: true,
              role: true,
              status: true,
              updatedAt: true,
            },
          });

          await tx.auditLog.create({
            data: {
              actorId,
              organizationId,
              action: 'ORGANIZATION_MEMBER_ROLE_UPDATED',
              targetType: 'OrganizationMembership',
              targetId: membershipId,
              metadata: {
                oldRole: membership.role,
                newRole: dto.role,
              },
            },
          });

          return result;
        },
        { isolationLevel: 'Serializable' },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          throw new ConflictException(
            'Organization membership changed concurrently. Please retry the operation.',
          );
        }
        throw error;
      });

    return {
      message: 'Organization member role updated successfully.',
      membership: updated,
    };
  }

  async updateMembershipStatus(
    actorId: string,
    organizationId: string,
    membershipId: string,
    dto: UpdateMembershipStatusDto,
  ) {
    const updated = await this.prisma
      .$transaction(
        async (tx) => {
          const organization = await tx.organization.findFirst({
            where: { id: organizationId, status: 'ACTIVE' },
            select: { id: true },
          });

          if (!organization) {
            throw new NotFoundException('Active organization not found.');
          }

          const platformAdmin = await tx.userRole.findFirst({
            where: {
              userId: actorId,
              role: 'PLATFORM_ADMIN',
              user: {
                is: {
                  status: 'ACTIVE',
                },
              },
            },
            select: { id: true },
          });

          if (!platformAdmin) {
            if (dto.status === 'ACTIVE') {
              throw new ForbiddenException(
                'Only active platform administrators can reactivate memberships.',
              );
            }

            const actorMembership = await tx.organizationMembership.findFirst({
              where: {
                organizationId,
                userId: actorId,
                role: 'ORGANIZATION_ADMIN',
                status: 'ACTIVE',
              },
              select: { id: true },
            });

            if (!actorMembership) {
              throw new ForbiddenException(
                'An active organization administrator membership is required.',
              );
            }
          }

          const membership = await tx.organizationMembership.findFirst({
            where: { id: membershipId, organizationId },
            select: {
              id: true,
              userId: true,
              role: true,
              status: true,
            },
          });

          if (!membership) {
            throw new NotFoundException('Organization membership not found.');
          }

          if (
            membership.role === 'ORGANIZATION_ADMIN' &&
            membership.status === 'ACTIVE' &&
            dto.status !== 'ACTIVE'
          ) {
            const otherAdmins = await tx.organizationMembership.count({
              where: {
                organizationId,
                id: { not: membershipId },
                role: 'ORGANIZATION_ADMIN',
                status: 'ACTIVE',
              },
            });

            if (otherAdmins === 0) {
              throw new ConflictException(
                'The last active organization administrator cannot be demoted, suspended, or removed.',
              );
            }
          }

          const result = await tx.organizationMembership.update({
            where: { id: membershipId },
            data: { status: dto.status },
            select: {
              id: true,
              organizationId: true,
              userId: true,
              role: true,
              status: true,
              updatedAt: true,
            },
          });

          await tx.auditLog.create({
            data: {
              actorId,
              organizationId,
              action: 'ORGANIZATION_MEMBER_STATUS_UPDATED',
              targetType: 'OrganizationMembership',
              targetId: membershipId,
              metadata: {
                oldStatus: membership.status,
                newStatus: dto.status,
              },
            },
          });

          return result;
        },
        { isolationLevel: 'Serializable' },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          throw new ConflictException(
            'Organization membership changed concurrently. Please retry the operation.',
          );
        }
        throw error;
      });

    return {
      message: 'Organization member status updated successfully.',
      membership: updated,
    };
  }
  async acceptInvitation(actorId: string, organizationId: string, membershipId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, status: 'ACTIVE' },
      select: { id: true },
    });

    if (!organization) {
      throw new NotFoundException('Active organization not found.');
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Organization membership not found.');
    }

    if (membership.userId !== actorId) {
      throw new ForbiddenException('You can only accept your own organization invitation.');
    }

    if (membership.status !== 'INVITED') {
      throw new ConflictException('This membership does not have a pending invitation.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { status: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('An active user account is required to accept an invitation.');
    }

    const accepted = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organizationMembership.updateMany({
        where: {
          id: membershipId,
          organizationId,
          userId: actorId,
          status: 'INVITED',
        },
        data: { status: 'ACTIVE' },
      });

      if (result.count !== 1) {
        throw new ConflictException('This invitation has already been processed.');
      }

      const updated = await tx.organizationMembership.findUniqueOrThrow({
        where: { id: membershipId },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          status: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          organizationId,
          action: 'ORGANIZATION_INVITATION_ACCEPTED',
          targetType: 'OrganizationMembership',
          targetId: membershipId,
          metadata: {
            role: membership.role,
            previousStatus: 'INVITED',
            newStatus: 'ACTIVE',
          },
        },
      });

      return updated;
    });

    return {
      message: 'Organization invitation accepted successfully.',
      membership: accepted,
    };
  }
}






