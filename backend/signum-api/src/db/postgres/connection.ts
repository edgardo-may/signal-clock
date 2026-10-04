import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { Config } from '../../config/env.js';
import { jsonLog, requestStorage, type LogSink } from '../../middleware/requestContext.js';

export class PostgresConnection {
  constructor(readonly pool: Pool, private readonly timeoutMs: number, private readonly log: LogSink = jsonLog) {}

  async query<T extends QueryResultRow>(client: PoolClient, sql: string, values: unknown[] = []) {
    const start = performance.now();
    const metrics = requestStorage.getStore()?.metrics;
    if (metrics) metrics.queryCount++;
    try { return await client.query<T>(sql, values); }
    finally {
      const durationMs = Math.round(performance.now() - start);
      if (durationMs >= 500) this.log({ event: 'slow_query', durationMs,
        requestId: requestStorage.getStore()?.requestId, tenant: requestStorage.getStore()?.tenant?.tenantId });
    }
  }

  async transaction<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await this.query(client, 'BEGIN');
      await this.query(client, 'SET LOCAL ROLE authenticated');
      await this.query(client, 'SET LOCAL row_security = on');
      await this.query(client, "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('statement_timeout', $3, true), set_config('lock_timeout', $3, true)",
        [JSON.stringify({ sub: userId, role: 'authenticated' }), userId, String(this.timeoutMs)]);
      const result = await run(client);
      await this.query(client, 'COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }

  async verifyRls(): Promise<void> {
    // Read-only bootstrap gate: do not silently run with owner/BYPASSRLS privileges.
    await this.transaction('00000000-0000-0000-0000-000000000000', async client => {
      const { rows } = await this.query<{ safe: boolean }>(client, `
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls
          AND c.relrowsecurity AND c.relowner <> r.oid AS safe
        FROM pg_roles r CROSS JOIN pg_class c
        WHERE r.rolname = current_user AND c.oid = 'public.empleados'::regclass`);
      if (rows[0]?.safe !== true) throw new Error('PostgreSQL authenticated role must enforce employee RLS');
    });
  }
}

export function createConnection(config: Config): PostgresConnection {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS, idleTimeoutMillis: 30000,
    statement_timeout: config.DB_QUERY_TIMEOUT_MS, query_timeout: config.DB_QUERY_TIMEOUT_MS + 1000,
    application_name: 'signum-api' });
  pool.on('error', () => jsonLog({ event: 'pool_error' }));
  return new PostgresConnection(pool, config.DB_QUERY_TIMEOUT_MS);
}
