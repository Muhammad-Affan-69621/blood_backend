import { UserRoleType, UserStatus, VerificationStatus } from '@prisma/client';
import { DonorEligibilityService } from './donor-eligibility.service';

describe('DonorEligibilityService', () => {
  const service = new DonorEligibilityService();
  const now = new Date('2026-10-21T12:00:00.000Z');

  const donor = {
    userStatus: UserStatus.ACTIVE,
    roles: [UserRoleType.DONOR],
    isAvailable: true,
    verificationStatus: VerificationStatus.VERIFIED,
    dateOfBirth: new Date('1995-06-15T00:00:00.000Z'),
    weightKg: 65,
    lastDonationDate: null,
  };

  it('accepts a donor who passes the configured checks', () => {
    expect(service.evaluate(donor, now)).toEqual({ eligible: true });
  });

  it('rejects a suspended account', () => {
    expect(service.evaluate({ ...donor, userStatus: UserStatus.SUSPENDED }, now).reason).toBe(
      'ACCOUNT_NOT_ACTIVE',
    );
  });

  it('rejects a donor who is unavailable', () => {
    expect(service.evaluate({ ...donor, isAvailable: false }, now).reason).toBe(
      'DONOR_UNAVAILABLE',
    );
  });

  it('rejects a donor who is not verified', () => {
    expect(
      service.evaluate({ ...donor, verificationStatus: VerificationStatus.PENDING }, now).reason,
    ).toBe('DONOR_NOT_VERIFIED');
  });

  it('rejects a donation within the default waiting period', () => {
    expect(
      service.evaluate({ ...donor, lastDonationDate: new Date('2026-10-01T00:00:00.000Z') }, now)
        .reason,
    ).toBe('DONATION_WAITING_PERIOD');
  });

  it('rejects a donation date in the future', () => {
    expect(
      service.evaluate({ ...donor, lastDonationDate: new Date('2026-10-22T00:00:00.000Z') }, now)
        .reason,
    ).toBe('DONATION_DATE_IN_FUTURE');
  });

  it('rejects a donor below the configured minimum weight', () => {
    expect(service.evaluate({ ...donor, weightKg: 45 }, now).reason).toBe(
      'WEIGHT_BELOW_CONFIGURED_MINIMUM',
    );
  });

  it('rejects a donation 55 days ago but accepts one 56 days ago', () => {
    const utcToday = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    const donationDaysAgo = (days: number) =>
      new Date(utcToday - days * 86_400_000);

    expect(
      service.evaluate(
        { ...donor, lastDonationDate: donationDaysAgo(55) },
        now,
      ),
    ).toEqual({
      eligible: false,
      reason: 'DONATION_WAITING_PERIOD',
    });

    expect(
      service.evaluate(
        { ...donor, lastDonationDate: donationDaysAgo(56) },
        now,
      ),
    ).toEqual({ eligible: true });
  });

  it('rejects an invalid date of birth', () => {
    expect(
      service.evaluate(
        { ...donor, dateOfBirth: new Date('invalid') },
        now,
      ),
    ).toEqual({
      eligible: false,
      reason: 'INVALID_DATE_OF_BIRTH',
    });
  });

  it('explicitly allows a first-time donor with no donation history', () => {
    expect(
      service.evaluate({ ...donor, lastDonationDate: null }, now),
    ).toEqual({ eligible: true });
  });

  it('uses the 56-day default when no interval environment variable is set', () => {
    const previous = process.env.MIN_DAYS_BETWEEN_DONATIONS;

    try {
      delete process.env.MIN_DAYS_BETWEEN_DONATIONS;

      const donationDaysAgo = (days: number) =>
        new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
          ) - days * 86_400_000,
        );

      expect(
        service.evaluate(
          { ...donor, lastDonationDate: donationDaysAgo(55) },
          now,
        ),
      ).toEqual({
        eligible: false,
        reason: 'DONATION_WAITING_PERIOD',
      });

      expect(
        service.evaluate(
          { ...donor, lastDonationDate: donationDaysAgo(56) },
          now,
        ),
      ).toEqual({ eligible: true });
    } finally {
      if (previous === undefined) {
        delete process.env.MIN_DAYS_BETWEEN_DONATIONS;
      } else {
        process.env.MIN_DAYS_BETWEEN_DONATIONS = previous;
      }
    }
  });

  it('uses the configured donation waiting period', () => {
    const previous = process.env.MIN_DAYS_BETWEEN_DONATIONS;

    try {
      process.env.MIN_DAYS_BETWEEN_DONATIONS = '30';

      const donationDaysAgo = (days: number) =>
        new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
          ) - days * 86_400_000,
        );

      expect(
        service.evaluate(
          { ...donor, lastDonationDate: donationDaysAgo(29) },
          now,
        ),
      ).toEqual({
        eligible: false,
        reason: 'DONATION_WAITING_PERIOD',
      });

      expect(
        service.evaluate(
          { ...donor, lastDonationDate: donationDaysAgo(30) },
          now,
        ),
      ).toEqual({ eligible: true });
    } finally {
      if (previous === undefined) {
        delete process.env.MIN_DAYS_BETWEEN_DONATIONS;
      } else {
        process.env.MIN_DAYS_BETWEEN_DONATIONS = previous;
      }
    }
  });
});


