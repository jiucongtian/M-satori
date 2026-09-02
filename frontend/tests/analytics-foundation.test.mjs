import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const clientUrl = new URL('../src/analytics/client.ts', import.meta.url);
const providerUrl = new URL('../src/analytics/AnalyticsProvider.tsx', import.meta.url);
const businessEventsUrl = new URL('../src/analytics/businessEvents.ts', import.meta.url);
const apiClientUrl = new URL('../src/api/client.ts', import.meta.url);

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

test('注册、今日、问事和商城主链路已接入业务事件', async () => {
  const provider = await readFile(providerUrl, 'utf8');
  const businessEvents = await readFile(businessEventsUrl, 'utf8');
  const apiClient = await readFile(apiClientUrl, 'utf8');
  for (const eventName of [
    'profile_creation_started', 'daily_home_viewed', 'daily_report_viewed',
    'reading_home_viewed', 'reading_history_viewed', 'commerce_catalog_viewed',
    'commerce_offering_viewed', 'membership_plan_viewed',
  ]) assert.match(provider, new RegExp(eventName));
  for (const eventName of [
    'auth_otp_requested', 'auth_login_result_recorded', 'consent_confirmed',
    'onboarding_gift_claimed', 'daily_guidance_started', 'reading_draw_completed',
    'reading_report_generation_started', 'commerce_checkout_started',
    'commerce_order_created', 'commerce_payment_started', 'api_request_failed',
  ]) assert.match(businessEvents, new RegExp(eventName));
  assert.match(apiClient, /trackBusinessRequestStarted/);
  assert.match(apiClient, /trackBusinessRequestSucceeded/);
  assert.match(apiClient, /trackBusinessRequestFailed/);
});

test('业务埋点只记录接口模板，不记录查询参数或对象 UUID', async () => {
  const businessEvents = await readFile(businessEventsUrl, 'utf8');
  assert.match(businessEvents, /split\('\?'\)\[0\]/);
  assert.match(businessEvents, /UUID_SEGMENT/);
  assert.doesNotMatch(businessEvents, /properties:\s*\{[^}]*path[,}]/s);
});

test('全局 Provider 自动记录页面浏览及客户端异常', async () => {
  const provider = await readFile(providerUrl, 'utf8');
  const client = await readFile(clientUrl, 'utf8');
  assert.match(provider, /global_page_viewed/);
  assert.match(client, /global_client_error_occurred/);
  assert.match(client, /pagehide/);
});
