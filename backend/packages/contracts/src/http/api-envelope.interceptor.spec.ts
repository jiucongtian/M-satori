import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('API protocol', () => {
  it('exposes a single exception filter for standard envelopes', () => {
    expect(new ApiExceptionFilter()).toBeInstanceOf(ApiExceptionFilter);
    const exception = new BadRequestException({ code: 'INVALID_INPUT', message: 'invalid input' });
    expect(exception.getStatus()).toBe(400);
  });

  it('classifies webhook validation and unavailable-provider failures without reporting 500', () => {
    const reply = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ id: 'request-1', method: 'POST', url: '/payment-webhook' }),
        getResponse: () => reply,
      }),
    } as unknown as ArgumentsHost;
    const filter = new ApiExceptionFilter();
    filter.catch(Object.assign(new Error('invalid signature'), { code: 'WECHAT_SIGNATURE_INVALID' }), host);
    expect(reply.status).toHaveBeenLastCalledWith(400);
    filter.catch(
      Object.assign(new Error('provider unavailable'), { code: 'PAYMENT_WEBHOOK_UNSUPPORTED' }),
      host,
    );
    expect(reply.status).toHaveBeenLastCalledWith(503);
    filter.catch(Object.assign(new Error('wechat unavailable'), { code: 'WECHAT_API_UNAVAILABLE' }), host);
    expect(reply.status).toHaveBeenLastCalledWith(503);
    filter.catch(Object.assign(new Error('该体验服务每位用户限购一次'), { code: 'PURCHASE_LIMIT_REACHED' }), host);
    expect(reply.status).toHaveBeenLastCalledWith(409);
    filter.catch(Object.assign(new Error('wechat payer required'), { code: 'WECHAT_PAYER_REQUIRED' }), host);
    expect(reply.status).toHaveBeenLastCalledWith(409);
  });
});
