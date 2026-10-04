import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { RequestContext } from '../types/RequestContext.js';

export type LogSink = (record: Record<string, string | number | undefined>) => void;
export const requestStorage = new AsyncLocalStorage<RequestContext>();
export const jsonLog: LogSink = record => process.stdout.write(`${JSON.stringify(record)}\n`);

export function requestContext(log: LogSink): RequestHandler {
  return (req, res, next) => {
    req.context = { requestId: randomUUID(), metrics: { queryCount: 0, rowsReturned: 0 } };
    const start = performance.now();
    res.setHeader('X-Request-Id', req.context.requestId);
    res.once('finish', () => log({
      event: 'http', requestId: req.context.requestId, tenant: req.context.tenant?.tenantId,
      method: req.method, endpoint: req.context.endpoint ?? 'unmatched', status: res.statusCode,
      durationMs: Math.round(performance.now() - start), ...req.context.metrics,
    }));
    requestStorage.run(req.context, next);
  };
}
