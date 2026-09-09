import type { Job, Worker } from 'bullmq';
import { correlation, correlationIds, errorFields, logEvent, metrics, trackActive } from './telemetry.js';

export async function observeJob<T>(queue: string, job: Job, work: () => Promise<T>): Promise<T> {
  const data = job.data as Record<string, unknown>;
  const context: Record<string, string> = {
    ...correlationIds(data),
    ...correlationIds(data['_telemetry']),
    jobId: job.id ?? 'unknown',
  };
  context.traceId ??= context.jobId ?? 'unknown';
  return correlation.run(context, async () => {
    const start = performance.now();
    const release = trackActive(`${queue}JobsActive`);
    const attempt = job.attemptsMade + 1;
    const ageAtStartMs = Math.max(0, Date.now() - job.timestamp);
    const fields = { queue, jobType: job.name, attempt, ageAtStartMs };
    // Retry age includes earlier execution/backoff; never present it as pure queue wait.
    if (attempt === 1)
      metrics.observe('queue_first_attempt_wait_ms', Math.max(0, ageAtStartMs - (job.opts.delay ?? 0)), {
        queue,
        jobType: job.name,
      });
    metrics.increment('queue_attempt_started', { queue, attemptType: attempt === 1 ? 'initial' : 'retry' });
    logEvent('queue_job_started', fields);
    try {
      const result = await work();
      const durationMs = performance.now() - start;
      metrics.observe('queue_execution_ms', durationMs, { queue, jobType: job.name, outcome: 'ok' });
      metrics.observe('queue_completion_age_ms', Math.max(0, Date.now() - job.timestamp), {
        queue,
        jobType: job.name,
      });
      logEvent('queue_job_completed', {
        ...fields,
        durationMs,
        completionAgeMs: Math.max(0, Date.now() - job.timestamp),
      });
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      metrics.observe('queue_execution_ms', durationMs, { queue, jobType: job.name, outcome: 'error' });
      logEvent(
        'queue_job_failed',
        {
          ...fields,
          durationMs,
          attemptsExhausted: attempt >= (job.opts.attempts ?? 1),
          ...errorFields(error),
        },
        'error',
      );
      throw error;
    } finally {
      release();
    }
  });
}
export function observeWorker(worker: Worker, queue: string): void {
  worker.on('error', (error) => {
    metrics.increment('queue_worker_error', { queue });
    logEvent('queue_worker_error', { queue, ...errorFields(error) }, 'error');
  });
  worker.on('stalled', (jobId) => {
    metrics.increment('queue_job_stalled', { queue });
    logEvent('queue_job_stalled', { queue, jobId }, 'warn');
  });
}
