import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

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
    const response = http.getResponse<FastifyReply>();
    const path = new URL(request.url, 'http://satori.local').pathname;
    if (!COMMERCE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return next.handle();
    const startedAt = performance.now();
    return next.handle().pipe(
      tap((body) => {
        console.info('commerce_api_completed', {
          requestId: request.id,
          method: request.method,
          path,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
          ...commerceIdentifiers(body),
        });
      }),
      catchError((error: unknown) => {
        console.warn('commerce_api_failed', {
          requestId: request.id,
          method: request.method,
          path,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
          code: errorCode(error),
        });
        throw error;
      }),
    );
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

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'INTERNAL_ERROR';
}
