import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const clientUrl = new URL('../src/analytics/client.ts', import.meta.url);
const providerUrl = new URL('../src/analytics/AnalyticsProvider.tsx', import.meta.url);

test('埋点 SDK 具备开关、批量、失败降级和敏感字段过滤', async () => {
  const client = await readFile(clientUrl, 'utf8');
  assert.match(client, /NEXT_PUBLIC_ANALYTICS_ENABLED/);
  assert.match(client, /queue\.length >= 10/);
  assert.match(client, /setTimeout\(\(\) => void flush\(\), 5000\)/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /retries <= 2/);
  assert.match(client, /Analytics must never affect the user journey/);
  for (const key of ['phone', 'question', 'report', 'birth', 'password', 'token', 'imei']) assert.match(client, new RegExp(key));
});

test('全局 Provider 自动记录页面浏览及客户端异常', async () => {
  const provider = await readFile(providerUrl, 'utf8');
  const client = await readFile(clientUrl, 'utf8');
  assert.match(provider, /global_page_viewed/);
  assert.match(client, /global_client_error_occurred/);
  assert.match(client, /pagehide/);
});
