import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const environmentShape = {
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().default('postgresql://satori:satori@localhost:5432/satori'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().min(1).default('satori'),
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  QUEUE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(360_000),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  CURSOR_SIGNING_SECRET: z.string().min(16).default('development-cursor-secret'),
  AUTH_HMAC_SECRET: z.string().min(32).default('development-auth-hmac-secret-0001'),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('development-access-token-secret-01'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .default('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
  COOKIE_SECURE: booleanFromString,
  SMS_DELIVERY_MODE: z.enum(['FIXED_CODE', 'GATEWAY']),
  SMS_GATEWAY_URL: z.string().url().optional(),
  SMS_GATEWAY_API_KEY: z.string().min(16).optional(),
  SMS_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AQUA_AI_BASE_URL: z.string().url().optional(),
  AQUA_AI_SERVICE_KEY: z.string().min(20).optional(),
  AQUA_AI_WORKFLOW_ID: z.string().min(1).default('daily-insight'),
  AQUA_AI_WORKFLOW_VERSION: z.string().min(1).optional(),
  HOME_ENERGY_SUMMARY_ENABLED: booleanFromString,
  HOME_ENERGY_SUMMARY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HOME_ENERGY_SUMMARY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(2),
  HOME_ENERGY_SUMMARY_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).default(250),
  HOME_ENERGY_PREWARM_ENABLED: booleanFromString,
  HOME_ENERGY_PREWARM_PROFILE: z.enum(['CONSERVATIVE', 'NORMAL']).default('NORMAL'),
  AQUA_BASE_URL: z.string().url().optional(),
  AQUA_TENANT_SERVICE_KEY: z.string().min(20).optional(),
} as const;

/** 需要在 `.env.example` 中逐项说明的部署环境变量名称。 */
export const environmentVariableNames = Object.keys(environmentShape) as Array<keyof typeof environmentShape>;

export const environmentSchema = z.object(environmentShape).superRefine((environment, context) => {
  if (environment.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
    context.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Wildcard CORS is forbidden' });
  }
  if (
    environment.SMS_DELIVERY_MODE === 'GATEWAY' &&
    (!environment.SMS_GATEWAY_URL || !environment.SMS_GATEWAY_API_KEY)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['SMS_GATEWAY_URL'],
      message: 'SMS gateway URL and API key are required in GATEWAY mode',
    });
  }
  if (!environment.AQUA_AI_BASE_URL || !environment.AQUA_AI_SERVICE_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['AQUA_AI_BASE_URL'],
      message: 'Aqua AI base URL and service key are required for daily insight generation',
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
