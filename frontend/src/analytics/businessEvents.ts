import { beginAnalyticsJourney, completeAnalyticsJourney, track, updateAnalyticsContext } from './client';

type ApiContext = {
  method: string;
  path: string;
};

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;
const recentInteractions = new WeakMap<Element, number>();

const interactionRules: Array<{ test: (label: string, route: string) => boolean; eventName: string; actionCode: string }> = [
  { test: (label) => /领取.*智慧种子|领取.*启程礼/.test(label), eventName: 'onboarding_gift_claim_clicked', actionCode: 'claim_onboarding_gift' },
  { test: (label) => /获取今日能量指引|查看今日能量指引|继续开启/.test(label), eventName: 'daily_guidance_cta_clicked', actionCode: 'open_daily_guidance' },
  { test: (label) => /分享初见/.test(label), eventName: 'share_entry_clicked', actionCode: 'open_share_first_look' },
  { test: (label) => /预览这张海报/.test(label), eventName: 'share_poster_selected', actionCode: 'preview_share_poster' },
  { test: (label, route) => route === '/readings' && /问事|听听牌/.test(label), eventName: 'reading_entry_clicked', actionCode: 'open_card_reading' },
  { test: (label) => /^[1-5]张|一张|两张|三张|四张|五张/.test(label), eventName: 'reading_card_count_selected', actionCode: 'select_card_count' },
  { test: (label) => /开始抽卡|确认.*抽卡|开始洗牌|确认问题/.test(label), eventName: 'reading_draw_cta_clicked', actionCode: 'start_reading' },
  { test: (label) => /重试|重新生成|再试一次/.test(label), eventName: 'reading_retry_clicked', actionCode: 'retry_reading' },
  { test: (label, route) => route === '/shop' && /查看|体验|陪伴|计划|服务/.test(label), eventName: 'commerce_offering_clicked', actionCode: 'open_offering' },
  { test: (label) => /立即购买|续费当前方案|升级当前方案/.test(label), eventName: 'commerce_purchase_clicked', actionCode: 'start_purchase' },
  { test: (label) => /微信支付/.test(label), eventName: 'commerce_payment_clicked', actionCode: 'pay_with_wechat' },
  { test: (label) => /联系客服|联系官方客服|联系我们/.test(label), eventName: 'support_contact_clicked', actionCode: 'open_support' },
  { test: (label) => /用户协议|隐私政策|AI 内容说明/.test(label), eventName: 'legal_document_clicked', actionCode: 'open_legal_document' },
  { test: (label) => /稍后再说|取消|暂不/.test(label), eventName: 'user_action_cancelled', actionCode: 'cancel_or_defer' },
];

export function installBusinessInteractionTracking(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onClick = (event: MouseEvent) => {
    const origin = event.target instanceof Element ? event.target.closest('button,a,[role="button"]') : null;
    if (!origin) return;
    const label = normalizeLabel(origin.getAttribute('aria-label') || origin.textContent || '');
    const route = window.location.pathname;
    const rule = interactionRules.find((candidate) => candidate.test(label, route));
    if (!rule) return;
    const now = Date.now();
    const previous = recentInteractions.get(origin) ?? 0;
    recentInteractions.set(origin, now);
    const object = interactionObject(origin);
    if (now - previous < 800) track('rapid_interaction_detected', {
      result: 'blocked',
      reason_code: 'RAPID_REPEAT',
      object_type: object?.type,
      object_id: object?.id,
      properties: { action_code: rule.actionCode },
    });
    track(rule.eventName, {
      result: rule.eventName === 'user_action_cancelled' ? 'cancelled' : undefined,
      object_type: object?.type,
      object_id: object?.id,
      properties: { action_code: rule.actionCode },
    });
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

export function trackBusinessRequestStarted({ method, path }: ApiContext): void {
  const route = apiTemplate(path);
  const eventName = startedEvent(method, route);
  const object = apiObject(path);
  const journey = journeyFor(route);
  if (journey && (eventName || (method === 'GET' && /\/:id$/.test(route)))) beginAnalyticsJourney(journey, eventName ?? route, object);
  if (eventName) track(eventName, {
    object_type: object?.type,
    object_id: object?.id,
    properties: { api_template: route },
  });
}

export function trackBusinessRequestSucceeded({ method, path }: ApiContext, payload?: unknown): void {
  const route = apiTemplate(path);
  let eventName = successEvent(method, route);
  const object = apiObject(path);
  enrichUserContext(route, payload);
  if (eventName === 'commerce_payment_result_recorded' && !['SUCCEEDED', 'FAILED', 'CLOSED'].includes(requestStatus(payload) ?? '')) eventName = undefined;
  if (eventName) track(eventName, {
    result: 'success',
    object_type: object?.type,
    object_id: object?.id,
    properties: { api_template: route, ...safeOutcome(route, payload) },
  });
  const completed = completedJourney(route, payload);
  if (completed) completeAnalyticsJourney(completed);
}

export function trackBusinessRequestFailed(
  { method, path }: ApiContext,
  failure: { status: number; code?: string; requestId?: string },
): void {
  if (path.startsWith('/analytics/')) return;
  const object = apiObject(path);
  track('api_request_failed', {
    result: failure.status === 408 || failure.status === 504 ? 'timeout' : failure.status === 409 || failure.status === 422 ? 'blocked' : 'failed',
    reason_code: failure.code || `HTTP_${failure.status}`,
    request_id: failure.requestId,
    object_type: object?.type,
    object_id: object?.id,
    properties: {
      api_template: apiTemplate(path),
      http_method: method,
      http_status: failure.status,
    },
  });
}

function startedEvent(method: string, route: string): string | undefined {
  if (method !== 'POST') return undefined;
  if (route === '/daily-insights/today') return 'daily_guidance_started';
  if (route === '/card-readings/draws') return 'reading_question_confirmed';
  if (route === '/card-readings/:id/complete') return 'reading_report_generation_started';
  if (route === '/card-readings/:id/retry') return 'reading_retry_requested';
  if (route === '/checkout-quotes') return 'commerce_checkout_started';
  if (route === '/money-orders/:id/payment-attempts') return 'commerce_payment_started';
  return undefined;
}

function successEvent(method: string, route: string): string | undefined {
  if (method === 'POST' && route === '/auth/sms-challenges') return 'auth_otp_requested';
  if (method === 'POST' && route === '/auth/sessions') return 'auth_login_result_recorded';
  if (method === 'POST' && route === '/me/consents') return 'consent_confirmed';
  if (method === 'POST' && route === '/me/life-profile/revisions/:id/confirm') return 'profile_information_confirmed';
  if (method === 'POST' && route === '/me/life-profile/revisions/:id/first-look') return 'profile_generation_result_recorded';
  if (method === 'POST' && route === '/me/registration-reward/claim') return 'onboarding_gift_claimed';
  if (method === 'POST' && route === '/card-readings/draws') return 'reading_draw_completed';
  if (method === 'POST' && route === '/card-readings/:id/complete') return 'reading_generation_requested';
  if (method === 'POST' && route === '/card-readings/:id/retry') return 'reading_retry_accepted';
  if (method === 'POST' && route === '/checkout-quotes') return 'commerce_quote_created';
  if (method === 'POST' && route === '/money-orders') return 'commerce_order_created';
  if (method === 'POST' && route === '/money-orders/:id/payment-attempts') return 'commerce_payment_attempt_created';
  if (method === 'GET' && route === '/payment-attempts/:id') return 'commerce_payment_result_recorded';
  if (method === 'POST' && route === '/entitlement-resolutions') return 'daily_benefit_resolution_recorded';
  return undefined;
}

function apiTemplate(path: string): string {
  return path.split('?')[0].replace(UUID_SEGMENT, '/:id').slice(0, 240);
}

function apiObject(path: string): { type: string; id: string } | undefined {
  const clean = path.split('?')[0];
  const id = clean.match(UUID_SEGMENT)?.[0]?.slice(1);
  if (!id) return undefined;
  const type = clean.includes('/payment-attempts') ? 'payment_attempt'
    : clean.includes('/money-orders') ? 'order'
      : clean.includes('/card-readings') ? 'reading'
        : clean.includes('/life-profile') ? 'profile_revision'
          : clean.includes('/service-offerings') ? 'offering'
            : 'business_object';
  return { type, id };
}

function journeyFor(route: string): string | undefined {
  if (route.includes('/life-profile') || route.includes('/registration-reward')) return 'onboarding';
  if (route.startsWith('/daily-insights') || route === '/entitlement-resolutions') return 'daily_guidance';
  if (route.startsWith('/card-readings')) return 'card_reading';
  if (route === '/checkout-quotes' || route.startsWith('/money-orders') || route.startsWith('/payment-attempts')) return 'commerce';
  return undefined;
}

function completedJourney(route: string, payload: unknown): string | undefined {
  if (route === '/me/registration-reward/claim') return 'onboarding';
  if (route.startsWith('/daily-insights/') && requestStatus(payload) === 'READY') return 'daily_guidance';
  if (route.startsWith('/card-readings/') && requestStatus(payload) === 'READY') return 'card_reading';
  if ((route.startsWith('/payment-attempts/') || route.startsWith('/money-orders/')) && ['SUCCEEDED', 'FAILED', 'CLOSED', 'FULFILLED', 'FULFILLMENT_FAILED'].includes(requestStatus(payload) ?? '')) return 'commerce';
  return undefined;
}

function enrichUserContext(route: string, payload: unknown): void {
  const data = responseData(payload);
  if (!data) return;
  if (route === '/auth/sessions' || route === '/me') {
    updateAnalyticsContext({
      user_stage: data.nextAction === 'VIEW_HOME' ? 'returning_or_ready' : 'onboarding',
      profile_state: stringValue(data.profileState) ?? null,
      account_state: stringValue(data.status) ?? null,
    });
  }
  if (route === '/memberships/current') updateAnalyticsContext({
    membership_state: stringValue(data.status) || (data.subscription ? 'active' : 'none'),
    membership_plan: stringValue(data.planCode) ?? null,
  });
  if (route === '/me/wisdom-seed-account') updateAnalyticsContext({ seed_balance_band: numberBand(data.available) });
}

function safeOutcome(route: string, payload: unknown): Record<string, string | number | boolean | null> {
  const data = responseData(payload);
  if (!data) return {};
  if (route === '/entitlement-resolutions') return { benefit_source: stringValue(data.sourceType) ?? null, resolution_result: stringValue(data.status) ?? null };
  if (route.startsWith('/card-readings')) return { reading_status: stringValue(data.status) ?? null, card_count: typeof data.cardCount === 'number' ? data.cardCount : null };
  if (route.startsWith('/payment-attempts') || route.startsWith('/money-orders')) return { commerce_status: stringValue(data.status) ?? null };
  return {};
}

function responseData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as Record<string, unknown>).data;
  return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

function requestStatus(payload: unknown): string | undefined {
  return stringValue(responseData(payload)?.status);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 64) : undefined;
}

function numberBand(value: unknown): string {
  if (typeof value !== 'number') return 'unknown';
  if (value <= 0) return 'zero';
  if (value <= 10) return 'one_to_ten';
  if (value <= 50) return 'eleven_to_fifty';
  return 'above_fifty';
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function interactionObject(element: Element): { type: string; id: string } | undefined {
  if (!(element instanceof HTMLAnchorElement)) return undefined;
  try {
    const url = new URL(element.href, window.location.origin);
    for (const [key, type] of [['offeringId', 'offering'], ['orderId', 'order'], ['paymentAttemptId', 'payment_attempt'], ['readingId', 'reading']] as const) {
      const id = url.searchParams.get(key);
      if (id && /^[0-9a-f-]{16,}$/i.test(id)) return { type, id: id.slice(0, 128) };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
