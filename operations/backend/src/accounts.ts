import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const accountSchema = z.object({
  account: z.string().min(3),
  passwordSha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type OperationsAccount = z.infer<typeof accountSchema>;

type AccountEnvironment = {
  OPERATIONS_ACCOUNTS_JSON?: string;
  OPERATIONS_BOOTSTRAP_USER?: string;
  OPERATIONS_BOOTSTRAP_PASSWORD_SHA256?: string;
};

export function parseOperationsAccounts(environment: AccountEnvironment): OperationsAccount[] {
  let accounts: OperationsAccount[];

  if (environment.OPERATIONS_ACCOUNTS_JSON) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(environment.OPERATIONS_ACCOUNTS_JSON);
    } catch {
      throw new Error('OPERATIONS_ACCOUNTS_JSON 必须是有效的 JSON');
    }
    accounts = z.array(accountSchema).min(1).parse(parsed);
  } else if (environment.OPERATIONS_BOOTSTRAP_USER && environment.OPERATIONS_BOOTSTRAP_PASSWORD_SHA256) {
    accounts = [accountSchema.parse({
      account: environment.OPERATIONS_BOOTSTRAP_USER,
      passwordSha256: environment.OPERATIONS_BOOTSTRAP_PASSWORD_SHA256,
    })];
  } else {
    throw new Error('必须配置 OPERATIONS_ACCOUNTS_JSON，或同时配置旧版引导账号和密码摘要');
  }

  if (new Set(accounts.map(({ account }) => account)).size !== accounts.length) {
    throw new Error('OPERATIONS_ACCOUNTS_JSON 中存在重复账号');
  }

  return accounts;
}

export function authenticateOperationsAccount(
  accounts: OperationsAccount[],
  account: string,
  password: string,
): OperationsAccount | null {
  const matched = accounts.find((candidate) => candidate.account === account);
  const actual = createHash('sha256').update(password).digest();
  const expected = Buffer.from(matched?.passwordSha256 ?? '0'.repeat(64), 'hex');
  const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  return matched && valid ? matched : null;
}
