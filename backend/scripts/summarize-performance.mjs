import { createInterface } from 'node:readline';

// Input: docker logs (without --timestamps), or Docker json-file records on stdin.
const groups = new Map();
const peaks = {};
let droppedLogs = 0;
let overflowSamples = 0;
let records = 0;
let start = Infinity;
let end = -Infinity;
const peakKeys = [
  'cpuCoresUsed',
  'rssBytes',
  'eventLoopP95Ms',
  'eventLoopMaxMs',
  'dbPoolWaiting',
  'httpActive',
  'sseActive',
  'generationJobsActive',
  'commerceJobsActive',
  'aquaCallsActive',
  'queueSnapshotPendingMs',
];
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let row;
  try {
    row = JSON.parse(line);
    if (typeof row.log === 'string') row = JSON.parse(row.log);
  } catch {
    continue;
  }
  if (!row || typeof row !== 'object' || !row.event) continue;
  records++;
  droppedLogs += Number(row.droppedLogs) || 0;
  if (row.event === 'metric_series_overflow') overflowSamples += Number(row.count) || 0;
  if (row.event === 'runtime_snapshot') {
    for (const key of peakKeys)
      if (typeof row[key] === 'number') peaks[key] = Math.max(peaks[key] ?? 0, row[key]);
  }
  if (row.event !== 'metric_window' || !Array.isArray(row.buckets) || !Array.isArray(row.boundsMs)) continue;
  const from = Date.parse(row.windowStart);
  const to = Date.parse(row.windowEnd);
  if (Number.isFinite(from)) start = Math.min(start, from);
  if (Number.isFinite(to)) end = Math.max(end, to);
  const key = JSON.stringify([row.metric, Object.entries(row.labels ?? {}).sort(), row.boundsMs]);
  let group = groups.get(key);
  if (!group) {
    group = {
      metric: row.metric,
      labels: row.labels,
      count: 0,
      sum: 0,
      max: 0,
      boundsMs: row.boundsMs,
      buckets: row.buckets.map(() => 0),
    };
    groups.set(key, group);
  }
  group.count += row.count;
  group.sum += row.sum;
  group.max = Math.max(group.max, row.max);
  row.buckets.forEach((count, i) => {
    group.buckets[i] += count;
  });
}
function percentileBound(group, percentile) {
  let count = 0;
  for (let i = 0; i < group.buckets.length; i++) {
    count += group.buckets[i];
    if (count >= Math.ceil(group.count * percentile)) return group.boundsMs[i] ?? `>${group.boundsMs.at(-1)}`;
  }
  return null;
}
const durationMetrics = [];
const counters = [];
for (const group of groups.values()) {
  const base = { metric: group.metric, labels: group.labels, count: group.count };
  if (group.metric.endsWith('_ms'))
    durationMetrics.push({
      ...base,
      meanMs: group.sum / group.count,
      maxMs: group.max,
      p95UpperBoundMs: percentileBound(group, 0.95),
      p99UpperBoundMs: percentileBound(group, 0.99),
    });
  else counters.push(base);
}
console.log(
  JSON.stringify(
    {
      records,
      windowStart: Number.isFinite(start) ? new Date(start).toISOString() : null,
      windowEnd: Number.isFinite(end) ? new Date(end).toISOString() : null,
      droppedLogs,
      overflowSamples,
      peaks,
      durationMetrics,
      counters,
      note: 'Histograms are interval deltas. Percentiles are bucket upper bounds, not exact values. Do not concatenate overlapping exports; missing collector data cannot be reconstructed.',
    },
    null,
    2,
  ),
);
