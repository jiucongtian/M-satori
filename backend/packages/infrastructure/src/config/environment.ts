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
    QUEUE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(360_000),
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
    DAILY_INSIGHT_GENERATOR: z.enum(['STUB', 'AQUA']).default('STUB'),
    DAILY_INSIGHT_STUB_MODE: z.enum(['SUCCESS', 'FAILURE', 'DELAY']).default('SUCCESS'),
    DAILY_INSIGHT_STUB_DELAY_MS: z.coerce.number().int().min(0).default(0),
    AQUA_AI_BASE_URL: z.string().url().optional(),
    AQUA_AI_SERVICE_KEY: z.string().min(20).optional(),
    AQUA_AI_WORKFLOW_ID: z.string().min(1).default('daily-insight'),
    AQUA_AI_WORKFLOW_VERSION: z.string().min(1).optional(),
    HOME_ENERGY_SUMMARY_ENABLED: booleanFromString,
    HOME_ENERGY_SUMMARY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    HOME_ENERGY_SUMMARY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(2),
    HOME_ENERGY_SUMMARY_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).default(250),
    HOME_ENERGY_PREWARM_ENABLED: booleanFromString,
    HOME_ENERGY_PREWARM_DAYS: z.coerce.number().int().min(1).max(7).default(3),
    HOME_ENERGY_PREWARM_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
    HOME_ENERGY_PREWARM_SPACING_MS: z.coerce.number().int().min(0).max(60_000).default(3_000),
    HOME_ENERGY_PREWARM_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
    AQUA_BASE_URL: z.string().url().optional(),
    AQUA_TENANT_SERVICE_KEY: z.string().min(20).optional(),
    FEATURE_LIFE_PROFILE: booleanFromString.default(true),
    FEATURE_PROFILE_LIBRARY: booleanFromString.default(true),
    FEATURE_WISDOM_SEEDS: booleanFromString.default(true),
    FEATURE_DAILY_INSIGHT: booleanFromString.default(true),
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
    if (environment.NODE_ENV === 'production' && environment.DAILY_INSIGHT_STUB_MODE !== 'SUCCESS') {
      context.addIssue({
        code: 'custom',
        path: ['DAILY_INSIGHT_STUB_MODE'],
        message: 'Failure and delay generator modes are test-only',
      });
    }
    if (environment.NODE_ENV === 'production' && environment.DAILY_INSIGHT_GENERATOR !== 'AQUA') {
      context.addIssue({
        code: 'custom',
        path: ['DAILY_INSIGHT_GENERATOR'],
        message: 'Production daily insight generation must use Aqua AI',
      });
    }
    if (
      environment.DAILY_INSIGHT_GENERATOR === 'AQUA' &&
      (!environment.AQUA_AI_BASE_URL || !environment.AQUA_AI_SERVICE_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AQUA_AI_BASE_URL'],
        message: 'Aqua AI base URL and service key are required when Aqua generation is enabled',
      });
    }
    if (
      environment.HOME_ENERGY_SUMMARY_ENABLED &&
      (!environment.AQUA_BASE_URL || !environment.AQUA_TENANT_SERVICE_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AQUA_BASE_URL'],
        message: 'Aqua base URL and tenant service key are required for home energy summaries',
      });
    }
    if (environment.HOME_ENERGY_PREWARM_ENABLED && !environment.HOME_ENERGY_SUMMARY_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['HOME_ENERGY_PREWARM_ENABLED'],
        message: 'Home energy summary prewarming requires home energy summaries to be enabled',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return environmentSchema.parse(input);
}
