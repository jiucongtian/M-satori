import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';

type Fields = Record<string, unknown>;
type Labels = Record<string, string | number>;
export const correlation = new AsyncLocalStorage<Record<string, string>>();
const idKeys = [
  'requestId',
  'traceId',
  'taskId',
  'orderId',
  'paymentAttemptId',
  'outboxId',
  'jobId',
] as const;
export function correlationIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Fields;
  return Object.fromEntries(
    idKeys.flatMap((key) =>
      typeof source[key] === 'string' && source[key].length <= 128 ? [[key, source[key]]] : [],
    ),
  );
}
export function errorFields(error: unknown): Fields {
  const value = error && typeof error === 'object' ? (error as Fields) : {};
  // Error messages, URLs, SQL values and provider response bodies can contain secrets.
  return Object.fromEntries(
    ['name', 'code', 'kind', 'status', 'retryable'].flatMap((key) => {
      const field = value[key];
      return typeof field === 'boolean' ||
        typeof field === 'number' ||
        (typeof field === 'string' && /^[\w.-]{1,80}$/.test(field))
        ? [[key === 'name' ? 'errorType' : key, field]]
        : [];
    }),
  );
}
const metadata = {
  service: 'satori',
  role: process.argv.some((arg) => arg.includes('/worker/')) ? 'worker' : 'api',
  environment: process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
  release: process.env['RELEASE_SHA'] ?? 'unknown',
  instance: hostname(),
  pid: process.pid,
};
let droppedLogs = 0;
export function logEvent(
  event: string,
  fields: Fields = {},
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  try {
    // Bound stdout buffering when the collector falls behind. Loss is explicit in the next record.
    if (process.stdout.writableLength > 1_048_576) {
      droppedLogs++;
      return;
    }
    const line = JSON.stringify({
      ...metadata,
      ...correlation.getStore(),
      ...fields,
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(droppedLogs ? { droppedLogs } : {}),
    });
    console.info(line);
    droppedLogs = 0;
  } catch {
    droppedLogs++;
  }
}
export const durationBoundsMs = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 360000, 900000,
];
type Series = { metric: string; labels: Labels; count: number; sum: number; max: number; buckets: number[] };
/** Interval deltas; bounded labels only. IDs belong in logs, never metric labels. */
export class MetricWindow {
  private series = new Map<string, Series>();
  private overflow = 0;
  private start = Date.now();
  observe(metric: string, value: number, labels: Labels = {}) {
    if (!Number.isFinite(value) || value < 0) return;
    const key = JSON.stringify([metric, Object.entries(labels).sort()]);
    let row = this.series.get(key);
    if (!row) {
      if (this.series.size >= 2048) {
        this.overflow++;
        return;
      }
      row = {
        metric,
        labels,
        count: 0,
        sum: 0,
        max: 0,
        buckets: Array<number>(durationBoundsMs.length + 1).fill(0),
      };
      this.series.set(key, row);
    }
    row.count++;
    row.sum += value;
    row.max = Math.max(row.max, value);
    const bucket = durationBoundsMs.findIndex((bound) => value <= bound);
    row.buckets[bucket === -1 ? durationBoundsMs.length : bucket]!++;
  }
  increment(metric: string, labels: Labels = {}) {
    this.observe(metric, 1, labels);
  }
  drain() {
    const end = Date.now();
    const result = {
      windowStart: new Date(this.start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      windowMs: end - this.start,
      overflow: this.overflow,
      boundsMs: durationBoundsMs,
      series: [...this.series.values()],
    };
    this.series.clear();
    this.overflow = 0;
    this.start = end;
    return result;
  }
}
export const metrics = new MetricWindow();
const active = new Map<string, number>();
export function trackActive(name: string): () => void {
  active.set(name, (active.get(name) ?? 0) + 1);
  let closed = false;
  return () => {
    if (!closed) {
      closed = true;
      active.set(name, Math.max(0, (active.get(name) ?? 0) - 1));
    }
  };
}
export function activeGauges() {
  return Object.fromEntries(active);
}
