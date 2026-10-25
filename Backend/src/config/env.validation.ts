const ALLOWED_NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

type Environment = Record<string, unknown>;

function requireString(config: Environment, key: string): string {
  const value = config[key];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Environment variable ${key} is required.`);
  }

  return value.trim();
}

function requireInteger(config: Environment, key: string, min: number, max: number): number {
  const raw = requireString(config, key);

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a valid integer.`);
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}.`);
  }

  return value;
}

function requireUrl(value: string, key: string, allowedProtocols: string[]): void {
  try {
    const parsed = new URL(value);

    if (!allowedProtocols.includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error(`${key} must be a valid URL using ${allowedProtocols.join(' or ')}.`);
  }
}

export function validateEnvironment(config: Environment): Environment {
  const nodeEnv = requireString(config, 'NODE_ENV');

  if (!ALLOWED_NODE_ENVIRONMENTS.includes(nodeEnv as (typeof ALLOWED_NODE_ENVIRONMENTS)[number])) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  requireInteger(config, 'PORT', 1, 65535);
  requireInteger(config, 'REDIS_PORT', 1, 65535);

  const databaseUrl = requireString(config, 'DATABASE_URL');

  requireUrl(databaseUrl, 'DATABASE_URL', ['postgres:', 'postgresql:']);

  const corsOrigin = requireString(config, 'CORS_ORIGIN');

  for (const origin of corsOrigin.split(',').map((item) => item.trim())) {
    requireUrl(origin, 'CORS_ORIGIN', ['http:', 'https:']);
  }

  const accessSecret = requireString(config, 'JWT_ACCESS_SECRET');
  const refreshSecret = requireString(config, 'JWT_REFRESH_SECRET');

  if (accessSecret.length < 32 || refreshSecret.length < 32) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each be at least 32 characters long.',
    );
  }

  if (accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  }

  const accessTtl = requireString(config, 'JWT_ACCESS_TTL');
  const refreshTtl = requireString(config, 'JWT_REFRESH_TTL');

  const ttlPattern = /^\d+(s|m|h|d)$/;

  if (!ttlPattern.test(accessTtl)) {
    throw new Error('JWT_ACCESS_TTL must use a duration such as 15m, 1h, or 30s.');
  }

  if (!ttlPattern.test(refreshTtl)) {
    throw new Error('JWT_REFRESH_TTL must use a duration such as 7d or 12h.');
  }

  // Optional SMTP configuration: empty placeholders are allowed until email delivery is enabled.
  // SMTP_PORT and SMTP_SECURE may have defaults; actual SMTP setup starts when a core value is supplied.
  const smtpCoreKeys = [
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
  ];

  const smtpConfigured = smtpCoreKeys.some(
    (key) => typeof config[key] === 'string' && (config[key] as string).trim() !== '',
  );

  if (smtpConfigured) {
    requireString(config, 'SMTP_HOST');
    requireInteger(config, 'SMTP_PORT', 1, 65535);

    const smtpSecure = requireString(config, 'SMTP_SECURE');

    if (smtpSecure !== 'true' && smtpSecure !== 'false') {
      throw new Error('SMTP_SECURE must be true or false.');
    }

    requireString(config, 'SMTP_USER');
    requireString(config, 'SMTP_PASS');

    const smtpFrom = requireString(config, 'SMTP_FROM');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpFrom)) {
      throw new Error('SMTP_FROM must be a valid email address.');
    }
  }

  // VAPID delivery is optional, but if any setting is supplied, all are required.
  const vapidKeys = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  const vapidConfigured = vapidKeys.some(
    (key) => typeof config[key] === 'string' && (config[key] as string).trim() !== '',
  );

  if (vapidConfigured) {
    const vapidPublicKey = requireString(config, 'VAPID_PUBLIC_KEY');
    const vapidPrivateKey = requireString(config, 'VAPID_PRIVATE_KEY');
    const vapidSubject = requireString(config, 'VAPID_SUBJECT');

    if (!/^[A-Za-z0-9_-]+$/.test(vapidPublicKey) ||
        !/^[A-Za-z0-9_-]+$/.test(vapidPrivateKey)) {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be base64url strings.');
    }

    requireUrl(vapidSubject, 'VAPID_SUBJECT', ['https:', 'mailto:']);
  }
  // Redis password is optional for local development.
  if (config.REDIS_PASSWORD === undefined) {
    config.REDIS_PASSWORD = '';
  }

  return config;
}
