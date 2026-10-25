import { Optional } from '@nestjs/common';
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
  DonorResponseStatus,
  Prisma,
  RecipientResponseDecision,
  UserRoleType,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PushDeliveryService } from '../notifications/push-delivery.service';
import { DonorEligibilityService } from '../donor-matching/donor-eligibility.service';
import { CreateDonorResponseDto } from './dto/create-donor-response.dto';
import { ListDonorRequestsDto } from './dto/list-donor-requests.dto';

const COMPATIBLE_DONORS: Record<BloodGroup, BloodGroup[]> = {
  O_NEGATIVE: ['O_NEGATIVE'],
  O_POSITIVE: ['O_NEGATIVE', 'O_POSITIVE'],
  A_NEGATIVE: ['O_NEGATIVE', 'A_NEGATIVE'],
  A_POSITIVE: ['O_NEGATIVE', 'O_POSITIVE', 'A_NEGATIVE', 'A_POSITIVE'],
  B_NEGATIVE: ['O_NEGATIVE', 'B_NEGATIVE'],
  B_POSITIVE: ['O_NEGATIVE', 'O_POSITIVE', 'B_NEGATIVE', 'B_POSITIVE'],
  AB_NEGATIVE: ['O_NEGATIVE', 'A_NEGATIVE', 'B_NEGATIVE', 'AB_NEGATIVE'],
  AB_POSITIVE: [
    'O_NEGATIVE',
    'O_POSITIVE',
    'A_NEGATIVE',
    'A_POSITIVE',
    'B_NEGATIVE',
    'B_POSITIVE',
    'AB_NEGATIVE',
    'AB_POSITIVE',
  ],
};

@Injectable()
export class DonorResponsesService {
  private readonly eligibility = new DonorEligibilityService();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly pushDelivery?: PushDeliveryService,
  ) {}

  private async ensureActiveRole(userId: string, role: UserRoleType): Promise<void> {
    const userRole = await this.prisma.userRole.findFirst({
      where: { userId, role },
      select: { user: { select: { status: true } } },
    });

    if (!userRole) {
      throw new ForbiddenException(
        role === UserRoleType.DONOR
          ? 'Only users with the DONOR role can use donor responses.'
          : 'Only users with the RECIPIENT role can view or decide responses.',
      );
    }

    if (userRole.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account must be active to perform this action.');
    }
  }

  private isEligibleProfile(profile: {
    bloodGroup: BloodGroup;
    isAvailable: boolean;
    verificationStatus: VerificationStatus;
    dateOfBirth: Date;
    weightKg: { toNumber(): number } | number;
    lastDonationDate: Date | null;
  }): boolean {
    return this.eligibility.evaluate({
      userStatus: UserStatus.ACTIVE,
      roles: [UserRoleType.DONOR],
      isAvailable: profile.isAvailable,
      verificationStatus: profile.verificationStatus,
      dateOfBirth: profile.dateOfBirth,
      weightKg:
        typeof profile.weightKg === 'number' ? profile.weightKg : profile.weightKg.toNumber(),
      lastDonationDate: profile.lastDonationDate,
    }).eligible;
  }

  async findOpenRequestsForDonor(donorId: string, query: ListDonorRequestsDto) {
    await this.ensureActiveRole(donorId, UserRoleType.DONOR);

    const profile = await this.prisma.donorProfile.findUnique({
      where: { userId: donorId },
      select: {
        bloodGroup: true,
        isAvailable: true,
        verificationStatus: true,
        dateOfBirth: true,
        weightKg: true,
        lastDonationDate: true,
      },
    });

    if (!profile || !this.isEligibleProfile(profile)) {
      throw new ForbiddenException(
        'Your donor profile must be verified and available to browse matching requests.',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();

    const where: Prisma.BloodRequestWhereInput = {
      status: BloodRequestStatus.OPEN,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' as const } } : {}),
      bloodGroup: {
        in: (Object.values(BloodGroup) as BloodGroup[]).filter((requestGroup) =>
          COMPATIBLE_DONORS[requestGroup].includes(profile.bloodGroup),
        ),
      },
      requesterId: { not: donorId },
      donorResponses: { none: { donorId } },
    };

    const [total, requests] = await this.prisma.$transaction([
      this.prisma.bloodRequest.count({ where }),
      this.prisma.bloodRequest.findMany({
        where,
        orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          bloodGroup: true,
          unitsNeeded: true,
          hospitalName: true,
          city: true,
          urgency: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items: requests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findMine(donorId: string) {
    await this.ensureActiveRole(donorId, UserRoleType.DONOR);

    const responses = await this.prisma.donorResponse.findMany({
      where: { donorId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        message: true,
        recipientDecision: true,
        recipientDecisionAt: true,
        createdAt: true,
        updatedAt: true,
        request: {
          select: {
            id: true,
            bloodGroup: true,
            unitsNeeded: true,
            hospitalName: true,
            city: true,
            urgency: true,
            status: true,
            expiresAt: true,
          },
        },
      },
    });

    return { totalResponses: responses.length, responses };
  }

  async create(donorId: string, requestId: string, dto: CreateDonorResponseDto) {
    await this.ensureActiveRole(donorId, UserRoleType.DONOR);

    const request = await this.prisma.bloodRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requesterId: true,
        bloodGroup: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Blood request not found.');
    }

    if (request.requesterId === donorId) {
      throw new BadRequestException('You cannot respond to your own blood request.');
    }

    const donorProfile = await this.prisma.donorProfile.findUnique({
      where: { userId: donorId },
      select: {
        bloodGroup: true,
        isAvailable: true,
        verificationStatus: true,
        dateOfBirth: true,
        weightKg: true,
        lastDonationDate: true,
      },
    });

    if (!donorProfile || !this.isEligibleProfile(donorProfile)) {
      throw new ForbiddenException(
        'Your donor profile must be verified and available before responding.',
      );
    }

    if (!COMPATIBLE_DONORS[request.bloodGroup].includes(donorProfile.bloodGroup)) {
      throw new ForbiddenException('Your blood group is not compatible with this request.');
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // Recheck the request inside the transaction before inserting.
          const openRequest = await tx.bloodRequest.findFirst({
            where: {
              id: requestId,
              status: BloodRequestStatus.OPEN,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            select: { id: true },
          });

          if (!openRequest) {
            throw new BadRequestException(
              'You cannot respond to a closed or expired blood request.',
            );
          }

          const response = await tx.donorResponse.create({
            data: {
              requestId,
              donorId,
              status: dto.status,
              ...(dto.message !== undefined && {
                message: dto.message.trim() || null,
              }),
            },
            select: {
              id: true,
              requestId: true,
              donorId: true,
              status: true,
              message: true,
              recipientDecision: true,
              recipientDecisionAt: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          await tx.notification.create({
            data: {
              userId: request.requesterId,
              type: 'BLOOD_REQUEST',
              payloadReference: requestId,
            },
          });

          return {
            message: 'Your response was submitted successfully.',
            response,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      try {
        await this.pushDelivery?.sendToUser(request.requesterId, {
          title: 'Donor response received',
          body: 'Someone has responded to your blood request.',
          url: '/notifications',
        });
      } catch {
        // Push failures must not undo a committed donor response.
      }

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already responded to this blood request.');
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException(
          'The blood request changed while you were responding. Reload the request and try again.',
        );
      }

      throw error;
    }
  }

  async findForRecipient(recipientId: string, requestId: string) {
    await this.ensureActiveRole(recipientId, UserRoleType.RECIPIENT);

    const request = await this.prisma.bloodRequest.findFirst({
      where: { id: requestId, requesterId: recipientId },
      select: { id: true },
    });

    if (!request) {
      throw new NotFoundException('Blood request not found or you do not have access to it.');
    }

    const responses = await this.prisma.donorResponse.findMany({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        message: true,
        recipientDecision: true,
        recipientDecisionAt: true,
        createdAt: true,
        updatedAt: true,
        donor: {
          select: {
            id: true,
            donorProfile: {
              select: { bloodGroup: true, city: true },
            },
          },
        },
      },
    });

    return { requestId, totalResponses: responses.length, responses };
  }

  async decideForRecipient(
    recipientId: string,
    requestId: string,
    responseId: string,
    decision: RecipientResponseDecision,
  ) {
    if (
      decision !== RecipientResponseDecision.ACCEPTED &&
      decision !== RecipientResponseDecision.REJECTED
    ) {
      throw new BadRequestException('Decision must be ACCEPTED or REJECTED.');
    }

    await this.ensureActiveRole(recipientId, UserRoleType.RECIPIENT);

    const pushUserIds = new Set<string>();

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.bloodRequest.findFirst({
            where: {
              id: requestId,
              requesterId: recipientId,
            },
            select: {
              id: true,
              status: true,
              expiresAt: true,
            },
          });

          if (!request) {
            throw new NotFoundException('Blood request not found or you do not have access to it.');
          }

          const now = new Date();

          if (
            request.status !== BloodRequestStatus.OPEN ||
            (request.expiresAt !== null && request.expiresAt.getTime() <= now.getTime())
          ) {
            throw new BadRequestException(
              'This blood request is closed or expired and can no longer receive a decision.',
            );
          }

          const response = await tx.donorResponse.findFirst({
            where: { id: responseId, requestId },
            select: {
              id: true,
              donorId: true,
              status: true,
              recipientDecision: true,
            },
          });

          if (!response) {
            throw new NotFoundException('Donor response not found for this blood request.');
          }

          if (response.status !== DonorResponseStatus.WILLING) {
            throw new BadRequestException(
              'Only willing donor responses can be accepted or rejected.',
            );
          }

          if (response.recipientDecision !== RecipientResponseDecision.PENDING) {
            throw new ConflictException('This donor response has already been decided.');
          }

          if (decision === RecipientResponseDecision.ACCEPTED) {
            const claimedRequest = await tx.bloodRequest.updateMany({
              where: {
                id: requestId,
                requesterId: recipientId,
                status: BloodRequestStatus.OPEN,
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              data: {
                status: BloodRequestStatus.IN_PROGRESS,
              },
            });

            if (claimedRequest.count !== 1) {
              throw new ConflictException('This blood request has already been claimed or closed.');
            }

            await tx.requestStatusHistory.create({
              data: {
                requestId,
                changedBy: recipientId,
                oldStatus: BloodRequestStatus.OPEN,
                newStatus: BloodRequestStatus.IN_PROGRESS,
                reason: 'A donor response was accepted.',
              },
            });
          }

          const updatedResponse = await tx.donorResponse.updateMany({
            where: {
              id: responseId,
              requestId,
              status: DonorResponseStatus.WILLING,
              recipientDecision: RecipientResponseDecision.PENDING,
            },
            data: {
              recipientDecision: decision,
              recipientDecisionAt: now,
            },
          });

          if (updatedResponse.count !== 1) {
            throw new ConflictException('This donor response has already been decided.');
          }

          if (decision === RecipientResponseDecision.ACCEPTED) {
            const otherPendingResponses = await tx.donorResponse.findMany({
              where: {
                requestId,
                id: { not: responseId },
                status: DonorResponseStatus.WILLING,
                recipientDecision: RecipientResponseDecision.PENDING,
              },
              select: {
                id: true,
                donorId: true,
              },
            });

            await tx.donorResponse.updateMany({
              where: {
                requestId,
                id: { not: responseId },
                status: DonorResponseStatus.WILLING,
                recipientDecision: RecipientResponseDecision.PENDING,
              },
              data: {
                recipientDecision: RecipientResponseDecision.REJECTED,
                recipientDecisionAt: now,
              },
            });

            if (otherPendingResponses.length > 0) {
              for (const otherResponse of otherPendingResponses) {
                pushUserIds.add(otherResponse.donorId);
              }

              await tx.notification.createMany({
                data: otherPendingResponses.map((otherResponse) => ({
                  userId: otherResponse.donorId,
                  type: 'REQUEST_UPDATE',
                  payloadReference: otherResponse.id,
                })),
              });
            }
          }

          const savedResponse = await tx.donorResponse.findUniqueOrThrow({
            where: { id: responseId },
            select: {
              id: true,
              requestId: true,
              donorId: true,
              status: true,
              message: true,
              recipientDecision: true,
              recipientDecisionAt: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          pushUserIds.add(savedResponse.donorId);

          await tx.notification.create({
            data: {
              userId: savedResponse.donorId,
              type: 'REQUEST_UPDATE',
              payloadReference: savedResponse.id,
            },
          });

          return {
            message:
              decision === RecipientResponseDecision.ACCEPTED
                ? 'Donor response accepted. The blood request is now in progress.'
                : 'Donor response rejected successfully.',
            response: savedResponse,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      await Promise.all(
        [...pushUserIds].map(async (recipientId) => {
          try {
            await this.pushDelivery?.sendToUser(recipientId, {
              title: 'Blood request updated',
              body: 'A donor response has been decided.',
              url: '/notifications',
            });
          } catch {
            // Push failures must not undo a committed decision.
          }
        }),
      );

      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')
      ) {
        throw new ConflictException(
          'A concurrent change occurred. Reload the responses and try again.',
        );
      }

      throw error;
    }
  }
}
