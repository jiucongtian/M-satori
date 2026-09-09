import 'reflect-metadata';
import { Controller, Get, Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiExceptionFilter, CommerceObservabilityInterceptor } from '@satori/contracts';
import { correlation, metrics, activeGauges } from '@satori/infrastructure';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFastifyAdapter } from './configure-api.js';

@Controller()
class TestController {
  @Get('money-orders/:id') async ok() { await new Promise((resolve) => setTimeout(resolve, 2)); return { orderId: 'order-1', context: correlation.getStore() }; }
  @Get('denied') denied() { throw new UnauthorizedException('secret-token'); }
  @Get('broken') broken() { throw new Error('secret-sql'); }
}
@Module({ controllers: [TestController] })
class TestModule {}

describe('request telemetry', () => {
  afterEach(() => { vi.restoreAllMocks(); metrics.drain(); });
  it('records final error status once, hides query/body, isolates overlapping request contexts', async () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    const app = await NestFactory.create<NestFastifyApplication>(TestModule, createFastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new CommerceObservabilityInterceptor());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    try {
      const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
      const results = await Promise.all(ids.map((id) => app.inject({ method: 'GET', url: '/api/v1/money-orders/private-id?token=secret-token', headers: { 'x-request-id': id } })));
      results.forEach((result, i) => expect(result.json().context.requestId).toBe(ids[i]));
      expect((await app.inject('/api/v1/denied')).statusCode).toBe(401);
      expect((await app.inject('/api/v1/broken')).statusCode).toBe(500);
      const records = logs.mock.calls.map(([line]) => JSON.parse(String(line))).filter((row) => row.event === 'http_request_completed');
      expect(records).toHaveLength(4);
      expect(records.map((row) => row.statusCode)).toEqual([200, 200, 401, 500]);
      expect(records[0]).toMatchObject({ route: '/api/v1/money-orders/:id', orderId: 'order-1' });
      expect(JSON.stringify(records)).not.toMatch(/secret-token|secret-sql|private-id/);
      expect(metrics.drain().series.reduce((sum, row) => sum + row.count, 0)).toBe(4);
      expect(activeGauges().httpActive).toBe(0);
    } finally { await app.close(); }
  });
});
