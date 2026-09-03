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

test('关键点击、漏斗中断、对象关联和用户状态快照均已覆盖', async () => {
  const client = await readFile(clientUrl, 'utf8');
  const provider = await readFile(providerUrl, 'utf8');
  const businessEvents = await readFile(businessEventsUrl, 'utf8');
  for (const marker of [
    'navigation_tab_clicked', 'onboarding_gift_claim_clicked', 'daily_guidance_cta_clicked',
    'reading_entry_clicked', 'reading_card_count_selected', 'reading_draw_cta_clicked',
    'reading_retry_clicked', 'commerce_offering_clicked', 'commerce_purchase_clicked',
    'commerce_payment_clicked', 'support_contact_clicked', 'legal_document_clicked',
  ]) assert.match(businessEvents, new RegExp(marker));
  for (const marker of ['beginAnalyticsJourney', 'completeAnalyticsJourney', 'user_journey_interrupted']) assert.match(client + businessEvents, new RegExp(marker));
  for (const marker of ['object_type', 'object_id', 'UUID_SEGMENT', 'apiObject']) assert.match(businessEvents, new RegExp(marker));
  for (const marker of ['user_stage', 'profile_state', 'membership_state', 'membership_plan', 'seed_balance_band']) assert.match(businessEvents, new RegExp(marker));
  assert.match(provider, /installBusinessInteractionTracking/);
  assert.match(client, /RESOURCE_LOAD_FAILED/);
  assert.match(businessEvents, /rapid_interaction_detected/);
});

test('支付取消、失败和授权结果具有独立事件', async () => {
  const commerce = await readFile(new URL('../src/features/commerce/CommerceScreens.tsx', import.meta.url), 'utf8');
  assert.match(commerce, /commerce_payment_cancelled/);
  assert.match(commerce, /commerce_payment_launch_failed/);
  assert.match(commerce, /commerce_payment_authorized/);
  assert.match(commerce, /commerce_checkout_submit_failed/);
});

test('所有声明的事件名均符合后端事件命名约束', async () => {
  const sources = await Promise.all([clientUrl, providerUrl, businessEventsUrl, new URL('../src/features/commerce/CommerceScreens.tsx', import.meta.url)].map((url) => readFile(url, 'utf8')));
  const names = sources.flatMap((source) => [...source.matchAll(/(?:track\(|eventName:\s*)['"]([a-z0-9_]+)['"]/g)].map((match) => match[1]));
  assert.ok(names.length > 20);
  for (const name of names) assert.match(name, /^[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}$/);
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

test('商品详情访问携带可关联的商品编号', async () => {
  const provider = await readFile(providerUrl, 'utf8');
  assert.match(provider, /URLSearchParams\(window\.location\.search\)/);
  assert.match(provider, /object_type: offeringId \? 'offering'/);
  assert.match(provider, /object_id: offeringId/);
});
