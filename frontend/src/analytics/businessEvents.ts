import { track } from './client';

type ApiContext = {
  method: string;
  path: string;
};

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;

export function trackBusinessRequestStarted({ method, path }: ApiContext): void {
  const route = apiTemplate(path);
  const eventName = startedEvent(method, route);
  if (eventName) track(eventName, { properties: { api_template: route } });
}

export function trackBusinessRequestSucceeded({ method, path }: ApiContext): void {
  const route = apiTemplate(path);
  const eventName = successEvent(method, route);
  if (eventName) track(eventName, { result: 'success', properties: { api_template: route } });
}

export function trackBusinessRequestFailed(
  { method, path }: ApiContext,
  failure: { status: number; code?: string; requestId?: string },
): void {
  if (path.startsWith('/analytics/')) return;
  track('api_request_failed', {
    result: 'failed',
    reason_code: failure.code || `HTTP_${failure.status}`,
    request_id: failure.requestId,
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
  if (method === 'POST' && route === '/money-orders') return 'commerce_order_created';
  return undefined;
}

function apiTemplate(path: string): string {
  return path.split('?')[0].replace(UUID_SEGMENT, '/:id').slice(0, 240);
}
