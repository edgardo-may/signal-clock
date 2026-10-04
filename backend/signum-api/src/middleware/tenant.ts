import type { RequestHandler } from 'express';
import type { TenantResolver } from '../auth/TenantResolver.js';
import { ApiError } from '../errors.js';

export function resolveTenant(resolver: TenantResolver): RequestHandler {
  return async (req, _res, next) => {
    if (!req.identity) throw new ApiError(401, 'TOKEN_REQUIRED');
    req.context.tenant = await resolver.resolve(req.identity);
    next();
  };
}
