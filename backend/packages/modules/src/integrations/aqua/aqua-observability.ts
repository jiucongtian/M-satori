import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { AquaAIClient } from '@aqua-ai/sdk';
import { errorFields, logEvent, metrics, trackActive } from '@satori/infrastructure';

const calls = new AsyncLocalStorage<{ callId: string; workflowId: string; attempts: number }>();
/** The SDK invokes fetch once per retry. Time-to-headers is distinct from full workflow duration. */
export const observedAquaFetch: typeof fetch = async (input, init) => {
  const state = calls.getStore();
  const attempt = state ? ++state.attempts : 1;
  const start = performance.now();
  try {
    const response = await globalThis.fetch(input, init);
    const durationMs = performance.now() - start;
    metrics.observe('aqua_http_headers_ms', durationMs, { statusCode: response.status });
    logEvent(
      'aqua_http_attempt',
      {
        callId: state?.callId,
        workflowId: state?.workflowId,
        attempt,
        statusCode: response.status,
        durationMs,
      },
      response.ok ? 'info' : 'warn',
    );
    return response;
  } catch (error) {
    metrics.increment('aqua_http_transport_error');
    logEvent(
      'aqua_http_attempt_failed',
      {
        callId: state?.callId,
        workflowId: state?.workflowId,
        attempt,
        durationMs: performance.now() - start,
        ...errorFields(error),
      },
      'warn',
    );
    throw error;
  }
};
export function observeAquaWorkflows(client: AquaAIClient): void {
  const run = client.workflows.run.bind(client.workflows);
  client.workflows.run = (async (workflowId, request, options) => {
    const callId = randomUUID();
    const state = { callId, workflowId, attempts: 0 };
    return calls.run(state, async () => {
      const start = performance.now();
      const release = trackActive('aquaCallsActive');
      const providerRequestId = options?.requestId ?? callId;
      logEvent('aqua_workflow_started', { callId, workflowId, providerRequestId });
      try {
        const result = await run(workflowId, request, { ...options, requestId: providerRequestId });
        const durationMs = performance.now() - start;
        metrics.observe('aqua_workflow_ms', durationMs, { workflowId, outcome: 'ok' });
        logEvent('aqua_workflow_completed', {
          callId,
          workflowId,
          providerRequestId: result.requestId,
          durationMs,
          attempts: state.attempts,
          retries: Math.max(0, state.attempts - 1),
        });
        return result;
      } catch (error) {
        const durationMs = performance.now() - start;
        metrics.observe('aqua_workflow_ms', durationMs, { workflowId, outcome: 'error' });
        logEvent(
          'aqua_workflow_failed',
          {
            callId,
            workflowId,
            providerRequestId,
            durationMs,
            attempts: state.attempts,
            ...errorFields(error),
          },
          'error',
        );
        throw error;
      } finally {
        release();
      }
    });
  }) as AquaAIClient['workflows']['run'];
}
