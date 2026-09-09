import { createDatabaseDiagnostics } from './database-diagnostics.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { activeGauges, errorFields, logEvent, metrics } from './telemetry.js';

export function startRuntimeTelemetry(pool: Pool, queues: Queue[]): () => Promise<void> {
  const diagnostics = createDatabaseDiagnostics(pool);
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  let cpu = process.cpuUsage();
  let sampledAt = performance.now();
  let stopped = false;
  let queueSampling = false;
  let queueSampleStartedAt = 0;
  const sampleQueues = async () => {
    if (queueSampling || stopped) return;
    queueSampling = true;
    queueSampleStartedAt = performance.now();
    try {
      for (const queue of queues) {
        const [counts, workers, oldest, paused] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'prioritized'),
          queue.getWorkersCount(),
          queue.getJobs(['wait'], 0, 0, true),
          queue.isPaused(),
        ]);
        if (!stopped)
          logEvent('queue_snapshot', {
            queue: queue.name,
            ...counts,
            workers,
            paused,
            oldestWaitingAgeMs: oldest[0] ? Math.max(0, Date.now() - oldest[0].timestamp) : 0,
          });
      }
    } catch (error) {
      if (!stopped) logEvent('queue_snapshot_failed', errorFields(error), 'warn');
    } finally {
      queueSampling = false;
    }
  };
  const sample = () => {
    const now = performance.now();
    const nextCpu = process.cpuUsage();
    const memory = process.memoryUsage();
    logEvent('runtime_snapshot', {
      windowMs: now - sampledAt,
      cpuCoresUsed: (nextCpu.user - cpu.user + (nextCpu.system - cpu.system)) / ((now - sampledAt) * 1000),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      eventLoopP95Ms: lag.percentile(95) / 1e6,
      eventLoopMaxMs: lag.max / 1e6,
      dbPoolTotal: pool.totalCount,
      dbPoolIdle: pool.idleCount,
      dbPoolWaiting: pool.waitingCount,
      dbPoolMax: pool.options.max,
      queueSnapshotPendingMs: queueSampling ? now - queueSampleStartedAt : 0,
      ...activeGauges(),
    });
    cpu = nextCpu;
    sampledAt = now;
    lag.reset();
    const window = metrics.drain();
    // One series per line keeps records bounded even with many routes.
    for (const series of window.series)
      logEvent('metric_window', { ...window, series: undefined, ...series });
    if (window.overflow) logEvent('metric_series_overflow', { count: window.overflow }, 'warn');
    void sampleQueues();
    if (!stopped) void diagnostics.sample();
  };
  const timer = setInterval(sample, 15_000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    sample();
    lag.disable();
    await diagnostics.close();
  };
}
