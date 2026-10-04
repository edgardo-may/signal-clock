import type { Request, RequestHandler } from 'express';

export interface RateLimitStore { hit(key: string, now: number, windowMs: number): { count: number; resetAt: number } }
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, now: number, windowMs: number) {
    for (const [id, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(id);
    const entry = this.entries.get(key) ?? { count: 0, resetAt: now + windowMs };
    // Bound memory; fail closed if too many distinct active keys.
    if (!this.entries.has(key) && this.entries.size >= 10000) return { count: Infinity, resetAt: now + windowMs };
    entry.count++;
    this.entries.set(key, entry);
    return entry;
  }
}
export function rateLimit(options: { max: number; windowMs: number; key?: (req: Request) => string; store?: RateLimitStore }): RequestHandler {
  const store = options.store ?? new MemoryRateLimitStore();
  return (req, res, next) => {
    const now = Date.now();
    const result = store.hit(options.key?.(req) ?? req.ip ?? 'unknown', now, options.windowMs);
    if (result.count > options.max) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((result.resetAt - now) / 1000)));
      res.status(429).json({ error: 'RATE_LIMITED' }); return;
    }
    next();
  };
}
