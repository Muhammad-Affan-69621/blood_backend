import { UserRoleType, UserStatus, VerificationStatus } from '@prisma/client';

export interface DonorEligibilityInput {
  userStatus: UserStatus;
  roles: UserRoleType[];
  isAvailable: boolean;
  verificationStatus: VerificationStatus;
  dateOfBirth: Date;
  weightKg: number;
  lastDonationDate: Date | null;
}

export interface DonorEligibilityResult {
  eligible: boolean;
  reason?: string;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function ageOnDate(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const birthdayNotReached =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      now.getUTCDate() < dateOfBirth.getUTCDate());

  if (birthdayNotReached) age--;
  return age;
}

export class DonorEligibilityService {
  evaluate(donor: DonorEligibilityInput, now: Date = new Date()): DonorEligibilityResult {
    const minAge = envNumber('MIN_DONOR_AGE_YEARS', 18);
    const maxAge = envNumber('MAX_DONOR_AGE_YEARS', 65);
    const minWeightKg = envNumber('MIN_DONOR_WEIGHT_KG', 50);
    const waitingDays = envNumber('MIN_DAYS_BETWEEN_DONATIONS', 56);

    if (donor.userStatus !== UserStatus.ACTIVE) {
      return { eligible: false, reason: 'ACCOUNT_NOT_ACTIVE' };
    }

    if (!donor.roles.includes(UserRoleType.DONOR)) {
      return { eligible: false, reason: 'DONOR_ROLE_REQUIRED' };
    }

    if (!donor.isAvailable) {
      return { eligible: false, reason: 'DONOR_UNAVAILABLE' };
    }

    if (donor.verificationStatus !== VerificationStatus.VERIFIED) {
      return { eligible: false, reason: 'DONOR_NOT_VERIFIED' };
    }

    if (
      !(donor.dateOfBirth instanceof Date) ||
      Number.isNaN(donor.dateOfBirth.getTime()) ||
      donor.dateOfBirth.getTime() > now.getTime()
    ) {
      return { eligible: false, reason: 'INVALID_DATE_OF_BIRTH' };
    }

    const age = ageOnDate(donor.dateOfBirth, now);
    if (age < minAge || age > maxAge) {
      return { eligible: false, reason: 'AGE_OUTSIDE_CONFIGURED_RANGE' };
    }

    if (!Number.isFinite(donor.weightKg) || donor.weightKg < minWeightKg) {
      return { eligible: false, reason: 'WEIGHT_BELOW_CONFIGURED_MINIMUM' };
    }

    if (donor.lastDonationDate) {
      if (Number.isNaN(donor.lastDonationDate.getTime())) {
        return { eligible: false, reason: 'INVALID_DONATION_DATE' };
      }

      const daysSinceDonation = Math.floor(
        (utcDay(now) - utcDay(donor.lastDonationDate)) / 86_400_000,
      );

      if (daysSinceDonation < 0) {
        return { eligible: false, reason: 'DONATION_DATE_IN_FUTURE' };
      }

      if (daysSinceDonation < waitingDays) {
        return { eligible: false, reason: 'DONATION_WAITING_PERIOD' };
      }
    }

    return { eligible: true };
  }
}
