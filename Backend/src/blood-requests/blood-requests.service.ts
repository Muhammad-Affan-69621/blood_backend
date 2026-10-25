import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  BloodGroup,
  BloodRequestStatus,
  Prisma,
  RequestUrgency,
  UserRoleType,
} from '@prisma/client';

import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { PushDeliveryService } from '../notifications/push-delivery.service';
import { CreateBloodRequestDto } from './blood-requests.dto';
import { UpdateBloodRequestDto } from './dto/update-blood-request.dto';
import { UpdateBloodRequestStatusDto } from './dto/update-blood-request-status.dto';
import { ListMyBloodRequestsDto } from './dto/list-my-blood-requests.dto';

@Injectable()
export class BloodRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushDelivery: PushDeliveryService,
  ) {}

  private async ensureRecipient(userId: string): Promise<void> {
    const recipientRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: UserRoleType.RECIPIENT,
      },
      select: { userId: true },
    });

    if (!recipientRole) {
      throw new ForbiddenException('Only users with the RECIPIENT role can manage blood requests.');
    }
  }

  async create(userId: string, dto: CreateBloodRequestDto, idempotencyKey?: string) {
    await this.ensureRecipient(userId);

    const keyProvided = idempotencyKey !== undefined;
    const key = idempotencyKey?.trim();

    if (keyProvided && (!key || key.length > 128)) {
      throw new BadRequestException(
        'Idempotency-Key must contain between 1 and 128 characters.',
      );
    }

    let expiresAt: Date | undefined;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('The expiration date is invalid.');
      }
    }

    const payloadHash = key
      ? createHash('sha256')
          .update(JSON.stringify({
            bloodGroup: dto.bloodGroup,
            unitsNeeded: dto.unitsNeeded,
            hospitalName: dto.hospitalName,
            city: dto.city,
            locationId: dto.locationId ?? null,
            urgency: dto.urgency ?? RequestUrgency.NORMAL,
            contactReference: dto.contactReference ?? null,
            expiresAt: expiresAt?.toISOString() ?? null,
          }))
          .digest('hex')
      : undefined;

    const select = {
      id: true,
      requesterId: true,
      bloodGroup: true,
      unitsNeeded: true,
      hospitalName: true,
      city: true,
      urgency: true,
      contactReference: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      closedAt: true,
      requestPayloadHash: true,
    } satisfies Prisma.BloodRequestSelect;

    const findExisting = () =>
      this.prisma.bloodRequest.findUnique({
        where: {
          requesterId_idempotencyKey: {
            requesterId: userId,
            idempotencyKey: key!,
          },
        },
        select,
      });

    const respondWithExisting = (existing: any) => {
      if (existing.requestPayloadHash !== payloadHash) {
        throw new ConflictException(
          'This Idempotency-Key was already used with a different request payload.',
        );
      }
      const { requestPayloadHash: _hash, ...request } = existing;
      return { message: 'Blood request created successfully.', request };
    };

    if (key) {
      const existing = await findExisting();
      if (existing) return respondWithExisting(existing);
    }

    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('The expiration date must be in the future.');
    }

    try {
      const request = await this.prisma.bloodRequest.create({
        data: {
          requesterId: userId,
          bloodGroup: dto.bloodGroup,
          unitsNeeded: dto.unitsNeeded,
          hospitalName: dto.hospitalName,
          city: dto.city,
          ...(dto.locationId !== undefined && { locationId: dto.locationId }),
          urgency: dto.urgency ?? RequestUrgency.NORMAL,
          ...(dto.contactReference !== undefined && {
            contactReference: dto.contactReference,
          }),
          ...(expiresAt !== undefined && { expiresAt }),
          ...(key && {
            idempotencyKey: key,
            requestPayloadHash: payloadHash,
          }),
          status: BloodRequestStatus.OPEN,
          statusHistory: {
            create: {
              changedBy: userId,
              newStatus: BloodRequestStatus.OPEN,
              reason: 'Request created',
            },
          },
        },
        select,
      });

      const { requestPayloadHash: _hash, ...publicRequest } = request;
      return {
        message: 'Blood request created successfully.',
        request: publicRequest,
      };
    } catch (error) {
      const uniqueViolation =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002';

      if (key && uniqueViolation) {
        const existing = await findExisting();
        if (existing) return respondWithExisting(existing);
      }
      throw error;
    }
  }
  async findMine(userId: string, query: ListMyBloodRequestsDto) {
    await this.ensureRecipient(userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.BloodRequestWhereInput = {
      requesterId: userId,
      ...(query.status !== undefined && { status: query.status }),
      ...(query.bloodGroup !== undefined && { bloodGroup: query.bloodGroup }),
      ...(query.city !== undefined && {
        city: { equals: query.city, mode: 'insensitive' },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.bloodRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          requesterId: true,
          bloodGroup: true,
          unitsNeeded: true,
          hospitalName: true,
          city: true,
          urgency: true,
          contactReference: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          closedAt: true,
        },
      }),
      this.prisma.bloodRequest.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async findOne(userId: string, requestId: string) {
    await this.ensureRecipient(userId);

    const request = await this.prisma.bloodRequest.findFirst({
      where: {
        id: requestId,
        requesterId: userId,
      },
      select: {
        id: true,
        requesterId: true,
        bloodGroup: true,
        unitsNeeded: true,
        hospitalName: true,
        city: true,
        urgency: true,
        contactReference: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Blood request not found.');
    }

    return request;
  }

  async update(userId: string, requestId: string, dto: UpdateBloodRequestDto) {
    await this.ensureRecipient(userId);

    const now = new Date();
    let expiresAt: Date | undefined;

    if (dto.expiresAt !== undefined) {
      expiresAt = new Date(dto.expiresAt);

      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException('The expiration date must be in the future.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.bloodRequest.findFirst({
        where: {
          id: requestId,
          requesterId: userId,
        },
      });

      if (!request) {
        throw new NotFoundException('Blood request not found or you do not have access to it.');
      }

      if (request.status !== BloodRequestStatus.OPEN) {
        throw new BadRequestException('Only open blood requests can be edited.');
      }

      if (request.expiresAt !== null && request.expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException(
          'This blood request has expired and can no longer be edited.',
        );
      }

      const result = await tx.bloodRequest.updateMany({
        where: {
          id: requestId,
          requesterId: userId,
          status: BloodRequestStatus.OPEN,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: {
          ...(dto.bloodGroup !== undefined && { bloodGroup: dto.bloodGroup }),
          ...(dto.unitsNeeded !== undefined && { unitsNeeded: dto.unitsNeeded }),
          ...(dto.hospitalName !== undefined && { hospitalName: dto.hospitalName }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.locationId !== undefined && { locationId: dto.locationId }),
          ...(dto.urgency !== undefined && { urgency: dto.urgency }),
          ...(dto.contactReference !== undefined && {
            contactReference: dto.contactReference,
          }),
          ...(expiresAt !== undefined && { expiresAt }),
        },
      });

      if (result.count !== 1) {
        throw new BadRequestException(
          'The request has expired or changed. Refresh it and try again.',
        );
      }

      return tx.bloodRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          id: true,
          requesterId: true,
          bloodGroup: true,
          unitsNeeded: true,
          hospitalName: true,
          city: true,
          urgency: true,
          contactReference: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          closedAt: true,
        },
      });
    });
  }
  async updateStatus(userId: string, requestId: string, dto: UpdateBloodRequestStatusDto) {
    await this.ensureRecipient(userId);

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.bloodRequest.findFirst({
        where: {
          id: requestId,
          requesterId: userId,
        },
      });

      if (!request) {
        throw new NotFoundException('Blood request not found or you do not have access to it.');
      }

      const now = new Date();

      if (request.expiresAt !== null && request.expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException(
          'This blood request has expired and can no longer be changed.',
        );
      }

      const allowedTransitions: Record<BloodRequestStatus, BloodRequestStatus[]> = {
        OPEN: [BloodRequestStatus.IN_PROGRESS, BloodRequestStatus.CANCELLED],
        IN_PROGRESS: [BloodRequestStatus.FULFILLED],
        FULFILLED: [],
        CANCELLED: [],
        EXPIRED: [],
      };

      if (!allowedTransitions[request.status].includes(dto.status)) {
        throw new BadRequestException(
          `Cannot change request status from ${request.status} to ${dto.status}.`,
        );
      }

      const isTerminalStatus =
        dto.status === BloodRequestStatus.FULFILLED || dto.status === BloodRequestStatus.CANCELLED;

      const updateResult = await tx.bloodRequest.updateMany({
        where: {
          id: request.id,
          requesterId: userId,
          status: request.status,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: {
          status: dto.status,
          closedAt: isTerminalStatus ? now : null,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException(
          'The request has expired or changed. Refresh it and try again.',
        );
      }

      await tx.requestStatusHistory.create({
        data: {
          requestId: request.id,
          changedBy: userId,
          oldStatus: request.status,
          newStatus: dto.status,
          reason: dto.reason?.trim() || null,
        },
      });

      const updatedRequest = await tx.bloodRequest.findUniqueOrThrow({
        where: {
          id: request.id,
        },
        select: {
          id: true,
          requesterId: true,
          bloodGroup: true,
          unitsNeeded: true,
          hospitalName: true,
          city: true,
          urgency: true,
          contactReference: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          closedAt: true,
        },
      });

      await tx.notification.create({
        data: {
          userId: request.requesterId,
          type: 'REQUEST_UPDATE',
          payloadReference: request.id,
        },
      });

      return updatedRequest;
    });

    try {
      await this.pushDelivery.sendToUser(userId, {
        title: 'Blood request updated',
        body: 'The status of your blood request has changed.',
        url: '/notifications',
      });
    } catch {
      // Push delivery must not fail a committed status update.
    }

    return result;
  }

  async cancelRequest(userId: string, requestId: string, reason?: string) {
    return this.updateStatus(userId, requestId, {
      status: BloodRequestStatus.CANCELLED,
      reason,
    });
  }
}
