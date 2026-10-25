import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BloodGroup,
  BloodRequestStatus,
  Prisma,
  UserRoleType,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DonorEligibilityService } from './donor-eligibility.service';

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

type DistanceRow = {
  userId: string;
  distanceMeters: number | null;
  withinRadius: boolean;
};

@Injectable()
export class DonorMatchingService {
  private readonly eligibility = new DonorEligibilityService();
  private readonly defaultRadiusKm = this.readPositiveNumber(process.env.DONOR_MATCH_RADIUS_KM, 50);
  private readonly maxRadiusKm = this.readPositiveNumber(
    process.env.DONOR_MATCH_MAX_RADIUS_KM,
    200,
  );

  constructor(private readonly prisma: PrismaService) {}

  private readPositiveNumber(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  async findMatches(userId: string, requestId: string, requestedRadiusKm?: number) {
    const recipientRole = await this.prisma.userRole.findFirst({
      where: { userId, role: UserRoleType.RECIPIENT },
      select: { user: { select: { status: true } } },
    });

    if (!recipientRole) {
      throw new ForbiddenException(
        'Only recipients can search for donors for their blood requests.',
      );
    }

    if (recipientRole.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account must be active to search for donors.');
    }

    const request = await this.prisma.bloodRequest.findFirst({
      where: {
        id: requestId,
        requesterId: userId,
        status: BloodRequestStatus.OPEN,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        bloodGroup: true,
        city: true,
        unitsNeeded: true,
        hospitalName: true,
        urgency: true,
        status: true,
        locationId: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Open blood request not found or you do not have access to it.');
    }

    const radiusKm = requestedRadiusKm ?? this.defaultRadiusKm;
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > this.maxRadiusKm) {
      throw new BadRequestException(
        `Radius must be greater than 0 and no more than ${this.maxRadiusKm} km.`,
      );
    }

    const donorWhere = {
      bloodGroup: { in: COMPATIBLE_DONORS[request.bloodGroup] },
      isAvailable: true,
      verificationStatus: VerificationStatus.VERIFIED,
      user: {
        is: {
          status: UserStatus.ACTIVE,
          roles: { some: { role: UserRoleType.DONOR } },
        },
      },
    };

    const candidates = await this.prisma.donorProfile.findMany({
      where: donorWhere,
      select: {
        userId: true,
        bloodGroup: true,
        city: true,
        isAvailable: true,
        verificationStatus: true,
        dateOfBirth: true,
        weightKg: true,
        lastDonationDate: true,
        locationId: true,
        user: {
          select: {
            status: true,
            roles: { select: { role: true } },
          },
        },
      },
    });

    const now = new Date();
    const eligibleCandidates = candidates.filter((donor) => {
      const result = this.eligibility.evaluate(
        {
          userStatus: donor.user.status,
          roles: donor.user.roles.map((role) => role.role),
          isAvailable: donor.isAvailable,
          verificationStatus: donor.verificationStatus,
          dateOfBirth: donor.dateOfBirth,
          weightKg: donor.weightKg.toNumber(),
          lastDonationDate: donor.lastDonationDate,
        },
        now,
      );
      return result.eligible;
    });

    const distanceByUserId = new Map<string, DistanceRow>();
    const missingDistanceUserIds = new Set<string>();
    const candidateIds = eligibleCandidates.map((donor) => donor.userId);

    if (request.locationId && candidateIds.length > 0) {
      const idList = Prisma.join(
        candidateIds.map((id) => Prisma.sql`${id}::uuid`),
      );

      const spatialRows = await this.prisma.$queryRaw<DistanceRow[]>(
        Prisma.sql`
          SELECT
            dp.user_id::text AS "userId",
            ST_Distance(
              donor_location.geography,
              request_location.geography
            ) AS "distanceMeters",
            TRUE AS "withinRadius"
          FROM locations donor_location
          INNER JOIN donor_profiles dp
            ON dp.location_id = donor_location.id
          INNER JOIN locations request_location
            ON request_location.id = ${request.locationId}::uuid
          WHERE dp.user_id IN (${idList})
            AND donor_location.geography IS NOT NULL
            AND request_location.geography IS NOT NULL
            AND ST_DWithin(
              donor_location.geography,
              request_location.geography,
              ${radiusKm * 1000}
            )
        `,
      );

      for (const row of spatialRows) {
        distanceByUserId.set(row.userId, row);
      }

      const missingDistanceRows = await this.prisma.$queryRaw<
        Array<{ userId: string }>
      >(
        Prisma.sql`
          SELECT dp.user_id::text AS "userId"
          FROM donor_profiles dp
          LEFT JOIN locations donor_location
            ON donor_location.id = dp.location_id
          LEFT JOIN locations request_location
            ON request_location.id = ${request.locationId}::uuid
          WHERE dp.user_id IN (${idList})
            AND (
              donor_location.geography IS NULL
              OR request_location.geography IS NULL
            )
        `,
      );

      for (const row of missingDistanceRows) {
        missingDistanceUserIds.add(row.userId);
      }
    }
    const spatialMatches: Array<{
      userId: string;
      bloodGroup: BloodGroup;
      city: string;
      sameCity: boolean;
      distanceKm: number;
      locationMatch: 'WITHIN_RADIUS';
    }> = [];

    const fallbackMatches: Array<{
      userId: string;
      bloodGroup: BloodGroup;
      city: string;
      sameCity: boolean;
      distanceKm: null;
      locationMatch: 'CITY_FALLBACK';
    }> = [];

    for (const donor of eligibleCandidates) {
      const distance = distanceByUserId.get(donor.userId);
      const sameCity =
        donor.city.localeCompare(request.city, undefined, { sensitivity: 'accent' }) === 0;

      if (distance?.withinRadius && distance.distanceMeters !== null) {
        spatialMatches.push({
          userId: donor.userId,
          bloodGroup: donor.bloodGroup,
          city: donor.city,
          sameCity,
          distanceKm: Math.round((Number(distance.distanceMeters) / 1000) * 10) / 10,
          locationMatch: 'WITHIN_RADIUS',
        });
      } else if (sameCity && (missingDistanceUserIds.has(donor.userId) || (!request.locationId && !distance))) {
        fallbackMatches.push({
          userId: donor.userId,
          bloodGroup: donor.bloodGroup,
          city: donor.city,
          sameCity: true,
          distanceKm: null,
          locationMatch: 'CITY_FALLBACK',
        });
      }
    }

    spatialMatches.sort((a, b) => a.distanceKm - b.distanceKm);

    const matches = [
      ...spatialMatches.slice(0, 100),
      ...fallbackMatches.slice(0, Math.max(0, 100 - spatialMatches.length)),
    ];

    return {
      request: {
        id: request.id,
        bloodGroup: request.bloodGroup,
        city: request.city,
        unitsNeeded: request.unitsNeeded,
        hospitalName: request.hospitalName,
        urgency: request.urgency,
        status: request.status,
      },
      radiusKm,
      maxRadiusKm: this.maxRadiusKm,
      totalMatches: matches.length,
      spatialMatches: spatialMatches.length,
      cityFallbackMatches: fallbackMatches.length,
      matches,
    };
  }
}
