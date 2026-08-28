import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorEnvelope } from '../index.js';

const statusCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.GONE]: 'GONE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

function normalizeHttpException(exception: HttpException): {
  code: string;
  message: string;
  details?: unknown;
} {
  const status = exception.getStatus();
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null) {
    const body = response as { code?: string; message?: string | string[]; details?: unknown };
    const messages = Array.isArray(body.message) ? body.message : undefined;
    return {
      code: body.code ?? statusCodes[status] ?? 'HTTP_ERROR',
      message: messages?.[0] ?? (typeof body.message === 'string' ? body.message : exception.message),
      ...(messages || body.details !== undefined
        ? { details: body.details ?? { violations: messages } }
        : {}),
    };
  }
  return { code: statusCodes[status] ?? 'HTTP_ERROR', message: String(response) };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const domainCode =
      typeof exception === 'object' && exception !== null && 'code' in exception
        ? String(exception.code)
        : null;
    const domainStatus =
      domainCode === 'INVALID_CURSOR'
        ? HttpStatus.BAD_REQUEST
        : domainCode === 'ENTITLEMENT_NOT_FOUND' || domainCode === 'RESERVATION_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : domainCode?.startsWith('INVALID_ENTITLEMENT') ||
              domainCode?.startsWith('INVALID_SEED') ||
              domainCode === 'INVALID_CARD_COUNT' ||
              domainCode === 'INVALID_ADJUSTMENT'
            ? HttpStatus.BAD_REQUEST
            : domainCode?.startsWith('ENTITLEMENT_') || domainCode === 'CONSUMPTION_ALREADY_SETTLED'
              ? HttpStatus.CONFLICT
              : domainCode?.startsWith('SEED_') || domainCode === 'INSUFFICIENT_WISDOM_SEEDS'
                ? HttpStatus.CONFLICT
                : domainCode === 'IDEMPOTENCY_KEY_REUSED' || domainCode === 'IDEMPOTENCY_IN_PROGRESS'
                  ? HttpStatus.CONFLICT
                  : HttpStatus.INTERNAL_SERVER_ERROR;
    const status = exception instanceof HttpException ? exception.getStatus() : domainStatus;
    if (status === 500) {
      console.error('unhandled_api_exception', {
        requestId: request.id,
        method: request.method,
        url: request.url,
        error: exception instanceof Error ? exception.message : String(exception),
      });
    }
    const normalized =
      exception instanceof HttpException
        ? normalizeHttpException(exception)
        : domainCode && domainStatus !== HttpStatus.INTERNAL_SERVER_ERROR
          ? { code: domainCode, message: exception instanceof Error ? exception.message : domainCode }
          : { code: 'INTERNAL_ERROR', message: 'Internal server error' };
    const body: ApiErrorEnvelope = {
      error: { ...normalized, requestId: request.id },
    };
    if (status === 429 && normalized.details && typeof normalized.details === 'object') {
      const details = normalized.details as {
        retryAfterSeconds?: number;
        limit?: number;
        resetAt?: number;
      };
      if (details.retryAfterSeconds !== undefined) reply.header('Retry-After', details.retryAfterSeconds);
      if (details.limit !== undefined) reply.header('X-RateLimit-Limit', details.limit);
      reply.header('X-RateLimit-Remaining', 0);
      if (details.resetAt !== undefined) reply.header('X-RateLimit-Reset', details.resetAt);
    }
    void reply.status(status).send(body);
  }
}
