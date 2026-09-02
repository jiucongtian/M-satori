import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { authenticateOperationsAccount, parseOperationsAccounts } from '../src/accounts.js';

const digest = (password: string) => createHash('sha256').update(password).digest('hex');

test('支持从 JSON 配置多个运营账号', () => {
  const accounts = parseOperationsAccounts({
    OPERATIONS_ACCOUNTS_JSON: JSON.stringify([
      { account: 'fred', passwordSha256: digest('first-password') },
      { account: 'alice', passwordSha256: digest('second-password') },
    ]),
  });

  assert.equal(accounts.length, 2);
  assert.equal(authenticateOperationsAccount(accounts, 'alice', 'second-password')?.account, 'alice');
  assert.equal(authenticateOperationsAccount(accounts, 'alice', 'wrong-password'), null);
});

test('未配置账号列表时兼容旧版引导账号', () => {
  const accounts = parseOperationsAccounts({
    OPERATIONS_BOOTSTRAP_USER: 'fred',
    OPERATIONS_BOOTSTRAP_PASSWORD_SHA256: digest('legacy-password'),
  });

  assert.equal(authenticateOperationsAccount(accounts, 'fred', 'legacy-password')?.account, 'fred');
});

test('拒绝重复账号', () => {
  assert.throws(() => parseOperationsAccounts({
    OPERATIONS_ACCOUNTS_JSON: JSON.stringify([
      { account: 'fred', passwordSha256: digest('first-password') },
      { account: 'fred', passwordSha256: digest('second-password') },
    ]),
  }), /重复账号/);
});
