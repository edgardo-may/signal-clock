import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../errors.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApiError) { res.status(error.status).json({ error: error.code }); return; }
  if (error instanceof SyntaxError) { res.status(400).json({ error: 'INVALID_JSON' }); return; }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return;
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === '23505') { res.status(409).json({ error: 'EMPLOYEE_CONFLICT', code }); return; }
  if (code === '42501') { res.status(403).json({ error: 'FORBIDDEN' }); return; }
  if (code === 'P0001' || code === '23514' || code === '23503') {
    res.status(409).json({ error: 'EMPLOYEE_RULE_CONFLICT' }); return;
  }
  // Never return PostgreSQL details, request bodies or auth provider errors.
  res.status(500).json({ error: 'INTERNAL_ERROR' });
};
