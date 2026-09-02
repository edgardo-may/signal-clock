/** Non-mutating DBREAL connectivity and safety preflight. Never prints credentials. */
import pg from 'pg'
import { auditConfig } from '../tests/helpers/testDb.js'

const { Client } = pg
const config = auditConfig()
for (const name of ['SUPABASE_TEST_URL', 'SUPABASE_TEST_ANON_KEY', 'SUPABASE_TEST_SERVICE_ROLE_KEY', 'PHASE2_AUDIT_DATABASE_URL', 'PHASE2_AUDIT_DB_LABEL', 'ALLOW_DESTRUCTIVE_TEST_DB']) {
  const present = name === 'ALLOW_DESTRUCTIVE_TEST_DB' ? process.env[name] === 'true' : Boolean(process.env[name])
  console.log(`${name}: ${present ? 'configured' : 'missing'}`)
}
if (!config.ready) {
  const reason = config.missing.length ? `missing ${config.missing.join(', ')}` : 'unsafe label or production-like host'
  throw new Error(`DBREAL preflight refused: ${reason}.`)
}

const rest = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/`, { headers: { apikey: config.anonKey } })
console.log(`Supabase REST endpoint: HTTP ${rest.status}`)
if (rest.status >= 500) throw new Error('Supabase REST endpoint is unhealthy.')

const client = new Client({ connectionString: config.dbUrl })
await client.connect()
try {
  const { rows: [row] } = await client.query(`
    SELECT version() AS version,
           current_database() AS database_name,
           has_function_privilege('service_role', 'public.upsert_workday_record(jsonb)', 'EXECUTE') AS service_role_execute,
           has_function_privilege('anon', 'public.upsert_workday_record(jsonb)', 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', 'public.upsert_workday_record(jsonb)', 'EXECUTE') AS authenticated_execute,
           has_function_privilege('public', 'public.upsert_workday_record(jsonb)', 'EXECUTE') AS public_execute`)
  console.log(`PostgreSQL: connected (${row.version.split(',')[0]})`)
  console.log(`Database: ${row.database_name}`)
  console.log(`RPC grants: service_role=${row.service_role_execute}; anon=${row.anon_execute}; authenticated=${row.authenticated_execute}; public=${row.public_execute}`)
  if (!row.service_role_execute || row.anon_execute || row.authenticated_execute || row.public_execute) throw new Error('RPC grant preflight failed.')
} finally { await client.end() }
console.log('DBREAL preflight PASS (non-mutating).')
