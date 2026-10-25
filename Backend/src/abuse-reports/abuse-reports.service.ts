import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AbuseReportStatus, AbuseTargetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAbuseReportDto, ReviewAbuseReportDto } from './abuse-reports.dto';

const MODERATOR_ROLES = ['MODERATOR', 'PLATFORM_ADMIN'] as const;

@Injectable()
export class AbuseReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertModerator(actorId: string): Promise<void> {
    const role = await this.prisma.userRole.findFirst({
      where: { userId: actorId, role: { in: [...MODERATOR_ROLES] } },
      select: { id: true },
    });
    if (!role) throw new ForbiddenException('Moderator access is required.');
  }

  private async assertTargetExists(type: AbuseTargetType, targetId: string) {
    let exists = false;
    if (type === AbuseTargetType.USER) {
      exists = !!(await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      }));
    } else if (type === AbuseTargetType.BLOOD_REQUEST) {
      exists = !!(await this.prisma.bloodRequest.findUnique({
        where: { id: targetId },
        select: { id: true },
      }));
    } else if (type === AbuseTargetType.ORGANIZATION) {
      exists = !!(await this.prisma.organization.findUnique({
        where: { id: targetId },
        select: { id: true },
      }));
    }
    if (!exists) throw new NotFoundException('Report target was not found.');
  }

  async create(reporterId: string, targetId: string, dto: CreateAbuseReportDto) {
    await this.assertTargetExists(dto.targetType, targetId);

    const existing = await this.prisma.abuseReport.findFirst({
      where: {
        reporterId,
        targetType: dto.targetType,
        targetId,
        status: { in: [AbuseReportStatus.OPEN, AbuseReportStatus.UNDER_REVIEW] },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('You already have an open report for this target.');
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.abuseReport.create({
        data: {
          reporterId,
          targetType: dto.targetType,
          targetId,
          category: dto.category.trim(),
          description: dto.description?.trim() || null,
        },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          category: true,
          description: true,
          status: true,
          createdAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: reporterId,
          action: 'ABUSE_REPORT_CREATED',
          targetType: 'AbuseReport',
          targetId: created.id,
          metadata: { reportTargetType: dto.targetType, reportTargetId: targetId },
        },
      });
      return created;
    });
    return { message: 'Report submitted for review.', report };
  }

  async listMine(reporterId: string) {
    const reports = await this.prisma.abuseReport.findMany({
      where: { reporterId },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        category: true,
        description: true,
        status: true,
        resolution: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { reports };
  }

  async listQueue(actorId: string, status?: AbuseReportStatus) {
    await this.assertModerator(actorId);
    const reports = await this.prisma.abuseReport.findMany({
      where: status
        ? { status }
        : { status: { in: [AbuseReportStatus.OPEN, AbuseReportStatus.UNDER_REVIEW] } },
      select: {
        id: true,
        reporterId: true,
        targetType: true,
        targetId: true,
        category: true,
        description: true,
        status: true,
        resolution: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const organizationTargetIds = Array.from(new Set(
      reports
        .filter((report) => report.targetType === AbuseTargetType.ORGANIZATION)
        .map((report) => report.targetId),
    ));
    const organizations = organizationTargetIds.length
      ? await this.prisma.organization.findMany({
          where: { id: { in: organizationTargetIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));
    const enrichedReports = reports.map((report) => {
      if (report.targetType !== AbuseTargetType.ORGANIZATION) return report;
      const organization = organizationById.get(report.targetId);
      return {
        ...report,
        targetName: organization?.name ?? null,
        targetSlug: organization?.slug ?? null,
      };
    });
    return { reports: enrichedReports };
  }

  async review(actorId: string, reportId: string, dto: ReviewAbuseReportDto) {
    await this.assertModerator(actorId);
    if (dto.status === AbuseReportStatus.OPEN) {
      throw new BadRequestException('A reviewed report cannot be reopened through this endpoint.');
    }
    if (
      [AbuseReportStatus.RESOLVED, AbuseReportStatus.DISMISSED].some(
        (status) => status === dto.status,
      ) &&
      !dto.resolution?.trim()
    ) {
      throw new BadRequestException('A resolution note is required when closing a report.');
    }

    const current = await this.prisma.abuseReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('Abuse report not found.');
    if (
      [AbuseReportStatus.RESOLVED, AbuseReportStatus.DISMISSED].some(
        (status) => status === current.status,
      )
    ) {
      throw new ConflictException('This report has already been closed.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.abuseReport.updateMany({
        where: {
          id: reportId,
          status: { in: [AbuseReportStatus.OPEN, AbuseReportStatus.UNDER_REVIEW] },
        },
        data: {
          status: dto.status,
          resolution: dto.resolution?.trim() || null,
          resolvedAt: [AbuseReportStatus.RESOLVED, AbuseReportStatus.DISMISSED].some(
            (status) => status === dto.status,
          )
            ? new Date()
            : null,
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'The report was changed by another moderator. Refresh and retry.',
        );
      }
      const report = await tx.abuseReport.findUniqueOrThrow({
        where: { id: reportId },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          category: true,
          status: true,
          resolution: true,
          resolvedAt: true,
          updatedAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'ABUSE_REPORT_REVIEWED',
          targetType: 'AbuseReport',
          targetId: reportId,
          metadata: { status: dto.status, resolution: dto.resolution?.trim() || null },
        },
      });
      return report;
    });
    return { message: 'Report review saved.', report: updated };
  }
}
