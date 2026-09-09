import { AquaAIClient } from '@aqua-ai/sdk';
import { correlation, metrics, activeGauges } from '@satori/infrastructure';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeAquaWorkflows, observedAquaFetch } from './aqua-observability.js';

function client() {
  const value = new AquaAIClient({
    baseUrl: 'https://aqua.example.com',
    auth: { type: 'serviceKey', serviceKey: 'secret-service-key' },
    fetch: observedAquaFetch,
    retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  observeAquaWorkflows(value);
  return value;
}
describe('Aqua telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    metrics.drain();
  });
  it('records 429 and subsequent workflow success without changing SDK retry policy or logging content', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ requestId: 'provider-1', result: { text: 'secret-result' } }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const workflow = client();
    await expect(
      workflow.workflows.run('daily-insight', { idempotencyKey: 'key', runReference: 'ref', input: {} }),
    ).rejects.toMatchObject({ status: 429 });
    const result = await correlation.run({ requestId: 'http-1', taskId: 'task-1' }, () =>
      workflow.workflows.run('daily-insight', {
        idempotencyKey: 'key',
        runReference: 'ref',
        input: { prompt: 'secret-prompt' },
      }),
    );
    expect(result.result).toEqual({ text: 'secret-result' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const records = spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(records.find((row) => row.event === 'aqua_workflow_completed')).toMatchObject({
      attempts: 1,
      retries: 0,
      providerRequestId: 'provider-1',
      requestId: 'http-1',
      taskId: 'task-1',
    });
    expect(records.filter((row) => row.event === 'aqua_http_attempt').map((row) => row.statusCode)).toEqual([
      429, 200,
    ]);
    expect(JSON.stringify(records)).not.toMatch(/secret-|idempotencyKey|runReference/);
    expect(activeGauges().aquaCallsActive).toBe(0);
  });
  it('preserves SDK failures, counts transport attempts and releases active gauges', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('secret-url')));
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(
      client().workflows.run('daily-insight', { idempotencyKey: 'key', runReference: 'ref', input: {} }),
    ).rejects.toMatchObject({ kind: 'network' });
    const records = spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(records.find((row) => row.event === 'aqua_workflow_failed')).toMatchObject({
      kind: 'network',
      attempts: 1,
    });
    expect(JSON.stringify(records)).not.toContain('secret-url');
    expect(activeGauges().aquaCallsActive).toBe(0);
  });
  it('records an SDK timeout without changing cancellation behavior', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true,
            });
          }),
      ),
    );
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(
      client().workflows.run(
        'daily-insight',
        { idempotencyKey: 'key', runReference: 'ref', input: {} },
        { timeoutMs: 5 },
      ),
    ).rejects.toMatchObject({ kind: 'timeout' });
    const records = logs.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(records.find((row) => row.event === 'aqua_workflow_failed')).toMatchObject({
      kind: 'timeout',
      attempts: 1,
    });
    expect(activeGauges().aquaCallsActive).toBe(0);
  });
});
