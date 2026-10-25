type EnvironmentVariables = Record<string, unknown>;

const REQUIRED_VARIABLES = [
  'NODE_ENV',
  'PORT',
  'CORS_ORIGIN',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

export function validateEnvironment(config: EnvironmentVariables): EnvironmentVariables {
  const missing = REQUIRED_VARIABLES.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const nodeEnv = config.NODE_ENV;
  if (!['development', 'test', 'production'].includes(String(nodeEnv))) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const port = Number(config.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  for (const key of ['CORS_ORIGIN', 'DATABASE_URL'] as const) {
    const value = String(config[key]);

    try {
      const parsed = new URL(value);

      if (key === 'DATABASE_URL') {
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
          throw new Error('Unsupported database protocol.');
        }
      } else if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('CORS_ORIGIN must use HTTP or HTTPS.');
      }
    } catch {
      throw new Error(`${key} must be a valid URL.`);
    }
  }

  const accessSecret = String(config.JWT_ACCESS_SECRET);
  const refreshSecret = String(config.JWT_REFRESH_SECRET);

  if (accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  }

  if (nodeEnv === 'production') {
    if (accessSecret.length < 32 || refreshSecret.length < 32) {
      throw new Error('Production JWT secrets must each contain at least 32 characters.');
    }

    if (
      accessSecret.toLowerCase().includes('replace_with') ||
      refreshSecret.toLowerCase().includes('replace_with')
    ) {
      throw new Error('Replace the example JWT secrets before production deployment.');
    }

    if (config.CORS_ORIGIN === 'http://localhost:5173' || config.CORS_ORIGIN === '*') {
      throw new Error('Production CORS_ORIGIN must specify your actual frontend origin.');
    }
  }

  return {
    ...config,
    PORT: port,
  };
}
