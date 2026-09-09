import type { FastifyInstance, FastifyRequest } from 'fastify';
import { correlation, logEvent, metrics, trackActive } from '@satori/infrastructure';

export function registerRequestObservability(server: FastifyInstance): void {
  const states = new WeakMap<FastifyRequest, { start: number; end: () => void; finished: boolean }>();
  const finish = (request: FastifyRequest, statusCode: number, aborted: boolean) => {
    const state = states.get(request);
    if (!state || state.finished) return;
    state.finished = true;
    state.end();
    const route = request.routeOptions.url ?? 'unmatched';
    const durationMs = performance.now() - state.start;
    const stream = route.endsWith('/events');
    const labels = { route, method: request.method, statusCode, outcome: aborted ? 'aborted' : 'completed' };
    metrics.observe(stream ? 'http_stream_lifetime_ms' : 'http_request_ms', durationMs, labels);
    logEvent(
      'http_request_completed',
      {
        requestId: request.id,
        traceId: request.id,
        ...labels,
        durationMs,
        ...request.observabilityIds,
        ...request.observabilityError,
      },
      aborted || statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
    );
  };
  server.addHook('onRequest', (request, reply, done) => {
    const state = { start: performance.now(), end: trackActive('httpActive'), finished: false };
    states.set(request, state);
    reply.raw.once('close', () =>
      finish(request, reply.raw.writableFinished ? reply.statusCode : 499, !reply.raw.writableFinished),
    );
    correlation.run({ requestId: request.id, traceId: request.id }, done);
  });
  server.addHook('onResponse', (request, reply, done) => {
    finish(request, reply.statusCode, false);
    done();
  });
}
