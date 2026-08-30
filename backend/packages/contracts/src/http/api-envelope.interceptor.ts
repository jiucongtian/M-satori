import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiEnvelope, ApiListEnvelope } from '../index.js';

type AlreadyWrapped<T> = ApiEnvelope<T> | ApiListEnvelope<T>;

function isWrapped(value: unknown): value is AlreadyWrapped<unknown> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, 'data');
}

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor<unknown, unknown> {
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      map((value) => {
        if (response.statusCode === 204 || value === undefined || isWrapped(value)) return value;
        return { data: value } satisfies ApiEnvelope<unknown>;
      }),
    );
  }
}
