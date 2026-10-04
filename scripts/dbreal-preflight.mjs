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
    SELECT version() AS version, current_database() AS database_name,
           to_regclass('public.workday_calculation_revisions') IS NOT NULL AS revision_schema`)
  console.log(`PostgreSQL: connected (${row.version.split(',')[0]})`)
  console.log(`Database: ${row.database_name}`)
  const args18 = 'uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer'
  const { rows: functions } = await client.query(`
    SELECT p.pronargs, p.oid::regprocedure::text AS signature,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
           EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p WHERE p.oid IN (to_regprocedure($1),to_regprocedure($2),to_regprocedure($3))
    ORDER BY p.pronargs`, [
    `public.upsert_workday_record(${args18})`,
    `public.upsert_workday_record(${args18},jsonb,jsonb)`,
    'public.upsert_workday_record(jsonb)',
  ])
  const required = row.revision_schema ? [18, 20] : functions.some(fn => fn.pronargs === 18) ? [18] : [1]
  if (!required.every(count => functions.some(fn => fn.pronargs === count))) throw new Error('Installed RPC contract preflight failed.')
  for (const fn of functions) {
    console.log(`RPC ${fn.pronargs}-arg grants: service_role=${fn.service_role_execute}; anon=${fn.anon_execute}; authenticated=${fn.authenticated_execute}; public=${fn.public_execute}`)
    if (!fn.service_role_execute || fn.anon_execute || fn.authenticated_execute || fn.public_execute) throw new Error('RPC grant preflight failed.')
  }
} finally { await client.end() }
console.log('DBREAL preflight PASS (non-mutating).')
