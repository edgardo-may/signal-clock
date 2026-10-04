import type { RequestHandler } from 'express';
import type { AuthProvider } from '../auth/AuthProvider.js';
import type { AuthIdentity } from '../auth/AuthProvider.js';
import { ApiError } from '../errors.js';

declare global { namespace Express { interface Request { identity?: AuthIdentity } } }
export function authenticate(provider: AuthProvider): RequestHandler {
  return async (req, _res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '');
    if (!match?.[1]) throw new ApiError(401, 'TOKEN_REQUIRED');
    req.identity = await provider.verifyToken(match[1]);
    next();
  };
}
