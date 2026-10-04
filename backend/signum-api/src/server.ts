import { loadConfig } from './config/env.js';
import { createDatabaseProvider } from './db/DatabaseProvider.js';
import { SupabaseAuthProvider } from './auth/SupabaseAuthProvider.js';
import { createApp } from './app.js';
import { jsonLog } from './middleware/requestContext.js';

async function main() {
  const config = loadConfig();
  const database = createDatabaseProvider(config);
  try { await database.verify(); }
  catch { await database.close(); throw new Error('Database readiness/RLS verification failed'); }
  const app = createApp({ auth: new SupabaseAuthProvider(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY),
    tenants: database.tenants, employees: database.employees, rateMax: config.RATE_LIMIT_MAX,
    rateWindowMs: config.RATE_LIMIT_WINDOW_MS, corsOrigin: config.CORS_ORIGIN });
  const server = app.listen(config.PORT, '0.0.0.0', () => jsonLog({ event: 'listening', port: config.PORT }));
  const stop = () => {
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => { void database.close().then(() => { clearTimeout(deadline); process.exit(0); }); });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
void main().catch(() => { jsonLog({ event: 'startup_failed' }); process.exitCode = 1; });
