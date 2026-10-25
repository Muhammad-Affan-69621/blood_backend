import { Injectable, Logger } from '@nestjs/common';
import { BloodRequestStatus } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RequestExpirationService {
  private readonly logger = new Logger(RequestExpirationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireRequests(): Promise<void> {
    const now = new Date();

    let candidates: {
      id: string;
      status: BloodRequestStatus;
    }[];

    try {
      candidates = await this.prisma.bloodRequest.findMany({
        where: {
          status: {
            in: [BloodRequestStatus.OPEN, BloodRequestStatus.IN_PROGRESS],
          },
          expiresAt: {
            lte: now,
          },
        },
        select: {
          id: true,
          status: true,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to find expired blood requests: ${message}`);

      return;
    }

    let expiredCount = 0;

    for (const candidate of candidates) {
      try {
        const changed = await this.prisma.$transaction(async (tx) => {
          const result = await tx.bloodRequest.updateMany({
            where: {
              id: candidate.id,
              status: candidate.status,
              expiresAt: {
                lte: now,
              },
            },
            data: {
              status: BloodRequestStatus.EXPIRED,
              closedAt: now,
            },
          });

          if (result.count !== 1) {
            return false;
          }

          await tx.requestStatusHistory.create({
            data: {
              requestId: candidate.id,
              changedBy: null,
              oldStatus: candidate.status,
              newStatus: BloodRequestStatus.EXPIRED,
              reason: 'Request expiration time reached',
            },
          });

          return true;
        });

        if (changed) {
          expiredCount += 1;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(`Failed to expire blood request ${candidate.id}: ${message}`);
      }
    }

    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} blood request(s).`);
    }
  }
}
