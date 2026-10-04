import type { RequestHandler } from 'express';
import { ApiError } from '../errors.js';

// Mirror the historical auth_can_write_tenant rule; installed RLS/RPC remains
// authoritative for more restrictive deployments (e.g. employee hardening 101).
export const employeeWriteRole: RequestHandler = (req, _res, next) => {
  const role = req.context.tenant?.role;
  if (!role || role === 'auditor') throw new ApiError(403, 'FORBIDDEN');
  next();
};
