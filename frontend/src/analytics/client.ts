export type AnalyticsValue = string | number | boolean | null | AnalyticsValue[] | { [key: string]: AnalyticsValue };
export type AnalyticsProperties = Record<string, AnalyticsValue>;

type AnalyticsEvent = {
  event_id: string;
  event_name: string;
  schema_version: number;
  occurred_at: string;
  environment: 'local' | 'test' | 'production';
  release: string;
  app_version: string;
  commit_sha?: string;
  anonymous_id: string;
  session_id: string;
  page_code?: string;
  route?: string;
  source_page?: string;
  object_type?: string;
  object_id?: string;
  result?: 'success' | 'failed' | 'cancelled' | 'blocked' | 'timeout';
  reason_code?: string;
  request_id?: string;
  entry?: string;
  properties: AnalyticsProperties;
  consent_version?: string;
  device: AnalyticsProperties;
};

const enabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true';
const environment = normalizeEnvironment(process.env.NEXT_PUBLIC_APP_ENV);
const forbiddenKey = /(phone|mobile|name|question|prompt|report|birth|address|password|token|cookie|secret|credential|identity|imei)/i;
const queue: AnalyticsEvent[] = [];
const retryCounts = new Map<string, number>();
const analyticsContext: AnalyticsProperties = {};
const journeyKey = 'fresh:analytics:active-journey';
let flushTimer: number | undefined;
let sending = false;
let analyticsAccessToken: string | null = null;

export function setAnalyticsAccessToken(token: string | null): void {
  analyticsAccessToken = token;
}

export function updateAnalyticsContext(patch: AnalyticsProperties): void {
  try {
    Object.assign(analyticsContext, sanitize(patch));
  } catch {
    // Context enrichment must never affect the user journey.
  }
}

export function beginAnalyticsJourney(journey: string, step: string, object?: { type: string; id: string }): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(journeyKey, JSON.stringify({ journey, step, object, touchedAt: Date.now() }));
  } catch {
    // Journey persistence is best effort only.
  }
}

export function completeAnalyticsJourney(journey: string): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const active = readActiveJourney();
    if (active?.journey === journey) window.sessionStorage.removeItem(journeyKey);
  } catch {
    // Journey persistence is best effort only.
  }
}

export function track(eventName: string, input: Partial<Omit<AnalyticsEvent, 'event_id' | 'event_name' | 'schema_version' | 'occurred_at' | 'environment' | 'release' | 'app_version' | 'anonymous_id' | 'session_id' | 'properties' | 'device'>> & { properties?: AnalyticsProperties } = {}): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const event: AnalyticsEvent = {
      event_id: crypto.randomUUID(),
      event_name: eventName,
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      environment,
      release: process.env.NEXT_PUBLIC_RELEASE ?? 'R1.1',
      app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'development',
      ...(process.env.NEXT_PUBLIC_COMMIT_SHA ? { commit_sha: process.env.NEXT_PUBLIC_COMMIT_SHA } : {}),
      anonymous_id: persistentId('fresh:analytics:anonymous-id'),
      session_id: sessionId(),
      route: cleanRoute(window.location.pathname),
      ...input,
      properties: sanitize({ ...analyticsContext, ...(input.properties ?? {}) }) as AnalyticsProperties,
      device: deviceContext(),
    };
    queue.push(event);
    if (queue.length >= 10) void flush();
    else scheduleFlush();
  } catch {
    // Analytics must never affect the user journey.
  }
}

export async function flush(): Promise<void> {
  if (!enabled || sending || queue.length === 0) return;
  sending = true;
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  const batch = queue.splice(0, 20);
  try {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (analyticsAccessToken) headers.set('authorization', `Bearer ${analyticsAccessToken}`);
    const response = await fetch('/api/v1/analytics/events/batch', {
      method: 'POST',
      headers,
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({ events: batch }),
    });
    if (!response.ok && response.status >= 500) requeueRetryable(batch);
    else batch.forEach((event) => retryCounts.delete(event.event_id));
  } catch {
    requeueRetryable(batch);
  } finally {
    if (queue.length > 100) queue.splice(0, queue.length - 100);
    sending = false;
    if (queue.length) scheduleFlush();
  }
}

function requeueRetryable(batch: AnalyticsEvent[]): void {
  const retryable = batch.filter((event) => {
    const retries = (retryCounts.get(event.event_id) ?? 0) + 1;
    retryCounts.set(event.event_id, retries);
    if (retries <= 2) return true;
    retryCounts.delete(event.event_id);
    return false;
  });
  queue.unshift(...retryable);
}

export function installAnalyticsLifecycle(): () => void {
  if (!enabled || typeof window === 'undefined') return () => undefined;
  const onPageHide = () => {
    const active = readActiveJourney();
    if (active) track('user_journey_interrupted', {
      result: 'cancelled',
      reason_code: 'PAGE_HIDDEN',
      object_type: active.object?.type,
      object_id: active.object?.id,
      properties: { journey: active.journey, step: active.step },
    });
    void flush();
  };
  const onError = (event: Event) => {
    const target = event.target;
    const resourceType = target instanceof HTMLElement ? target.tagName.toLowerCase() : undefined;
    track('global_client_error_occurred', {
      reason_code: resourceType ? 'RESOURCE_LOAD_FAILED' : 'UNCAUGHT_ERROR',
      properties: resourceType ? { resource_type: resourceType } : {},
    });
  };
  const onRejection = () => track('global_client_error_occurred', { reason_code: 'UNHANDLED_REJECTION' });
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

type ActiveJourney = { journey: string; step: string; object?: { type: string; id: string }; touchedAt: number };

function readActiveJourney(): ActiveJourney | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(journeyKey) ?? 'null') as ActiveJourney | null;
    if (!parsed?.journey || !parsed.step || Date.now() - parsed.touchedAt > 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function scheduleFlush(): void {
  if (!flushTimer) flushTimer = window.setTimeout(() => void flush(), 5000);
}

function persistentId(key: string): string {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.localStorage.setItem(key, value);
  return value;
}

function sessionId(): string {
  const key = 'fresh:analytics:session';
  const now = Date.now();
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as { id?: string; touchedAt?: number } | null;
    const id = existing?.id && existing.touchedAt && now - existing.touchedAt < 30 * 60 * 1000 ? existing.id : crypto.randomUUID();
    window.sessionStorage.setItem(key, JSON.stringify({ id, touchedAt: now }));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function cleanRoute(path: string): string {
  return path.slice(0, 240);
}

function deviceContext(): AnalyticsProperties {
  const width = window.innerWidth;
  return {
    category: width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop',
    viewport_group: width <= 360 ? 'small' : width <= 767 ? 'regular' : width <= 1200 ? 'wide' : 'desktop',
    viewport_width: width,
    viewport_height: window.innerHeight,
    language: navigator.language,
    online: navigator.onLine,
  };
}

function sanitize(value: AnalyticsValue, depth = 0): AnalyticsValue {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenKey.test(key)).slice(0, 50).map(([key, child]) => [key, sanitize(child, depth + 1)]));
}

function normalizeEnvironment(value: string | undefined): AnalyticsEvent['environment'] {
  return value === 'production' || value === 'test' ? value : 'local';
}
