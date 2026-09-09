import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const COMMERCE_PATH_PREFIXES = [
  '/api/v1/service-offerings',
  '/api/v1/membership-plans',
  '/api/v1/checkout-quotes',
  '/api/v1/money-orders',
  '/api/v1/payment-attempts',
  '/api/v1/internal/payment-webhooks',
  '/api/v1/me/entitlements',
  '/api/v1/me/usage-records',
  '/api/v1/entitlement-resolutions',
  '/api/v1/consumption-intents',
  '/api/v1/memberships',
  '/api/v1/membership-upgrades',
  '/api/v1/refund-quotes',
  '/api/v1/refunds',
] as const;

const IDENTIFIER_KEYS = new Set([
  'orderId',
  'paymentAttemptId',
  'fulfillmentId',
  'fulfillmentJobId',
  'subscriptionId',
  'grantId',
  'entitlementId',
  'consumptionIntentId',
  'intentId',
  'refundId',
  'quoteId',
]);

@Injectable()
export class CommerceObservabilityInterceptor implements NestInterceptor<unknown, unknown> {
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const path = new URL(request.url, 'http://satori.local').pathname;
    if (!COMMERCE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return next.handle();
    return next.handle().pipe(tap((body) => { request.observabilityIds = commerceIdentifiers(body); }));
  }
}

export function commerceIdentifiers(value: unknown) {
  const found: Record<string, string> = {};
  visit(value, found, 0);
  return found;
}

function visit(value: unknown, found: Record<string, string>, depth: number) {
  if (depth > 5 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) visit(item, found, depth + 1);
    return;
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (IDENTIFIER_KEYS.has(key) && typeof candidate === 'string' && candidate.length <= 128) {
      found[key === 'fulfillmentJobId' ? 'fulfillmentId' : key === 'entitlementId' ? 'grantId' : key === 'intentId' ? 'consumptionIntentId' : key] = candidate;
      continue;
    }
    if (typeof candidate === 'object') visit(candidate, found, depth + 1);
  }
}

// Metadata only. Fastify logs once after the actual response status is finalized.
declare module 'fastify' {
  interface FastifyRequest {
    observabilityIds?: Record<string, string>;
    observabilityError?: Record<string, string>;
  }
}
