import { z } from 'zod';

const positive = (fallback: number, max: number) => z.coerce.number().int().min(1).max(max).default(fallback);
const schema = z.object({
  PORT: positive(3001, 65535),
  DB_PROVIDER: z.enum(['postgres', 'sqlserver']).default('postgres'),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: positive(10, 100),
  DB_CONNECTION_TIMEOUT_MS: positive(5000, 60000),
  DB_QUERY_TIMEOUT_MS: positive(10000, 120000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  RATE_LIMIT_MAX: positive(120, 10000),
  RATE_LIMIT_WINDOW_MS: positive(60000, 3600000),
  CORS_ORIGIN: z.string().url().optional(),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  // Only field names: validation diagnostics can contain secrets.
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  return parsed.data;
}
