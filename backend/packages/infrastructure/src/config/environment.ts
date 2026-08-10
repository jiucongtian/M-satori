import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url().default('postgresql://satori:satori@localhost:5432/satori'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    QUEUE_PREFIX: z.string().min(1).default('satori'),
    QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
    QUEUE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
    CORS_ORIGINS: z.string().default('http://localhost:3001'),
    CURSOR_SIGNING_SECRET: z.string().min(16).default('development-cursor-secret'),
    AUTH_HMAC_SECRET: z.string().min(32).default('development-auth-hmac-secret-0001'),
    ACCESS_TOKEN_SECRET: z.string().min(32).default('development-access-token-secret-01'),
    DATA_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i)
      .default('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
    COOKIE_SECURE: booleanFromString,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(60),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    SMS_PHONE_RATE_PER_HOUR: z.coerce.number().int().positive().default(5),
    SMS_DEVICE_RATE_PER_HOUR: z.coerce.number().int().positive().default(10),
    SMS_IP_RATE_PER_HOUR: z.coerce.number().int().positive().default(20),
    SMS_GATEWAY_URL: z.string().url().optional(),
    SMS_GATEWAY_API_KEY: z.string().min(16).optional(),
    SMS_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    PROFILE_PREVIEW_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    DAILY_INSIGHT_HISTORY_DAYS: z.coerce.number().int().positive().default(90),
    DAILY_INSIGHT_PRICE: z.coerce.number().int().positive().default(1),
    REGISTRATION_REWARD_AMOUNT: z.coerce.number().int().positive().default(3),
    ACCOUNT_DELETION_CANCELLATION_HOURS: z.coerce.number().int().positive().default(168),
  })
  .superRefine((environment, context) => {
    if (environment.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
      context.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Wildcard CORS is forbidden' });
    }
    if (environment.NODE_ENV === 'production' && !environment.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Secure refresh cookies are required in production',
      });
    }
    if (
      environment.NODE_ENV === 'production' &&
      (!environment.SMS_GATEWAY_URL || !environment.SMS_GATEWAY_API_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SMS_GATEWAY_URL'],
        message: 'Production SMS gateway URL and API key are required',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return environmentSchema.parse(input);
}
