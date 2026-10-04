import { execFileSync, spawn } from 'node:child_process'
import pg from 'pg'

// Read credentials from the explicitly selected local stack, never .env.local.
const [workdir, cli = 'supabase', mode = 'test'] = process.argv.slice(2)
if (!workdir || !['test', 'inspect'].includes(mode)) throw new Error('Usage: node scripts/run-dbreal-dispatcher-retry.mjs LOCAL_WORKDIR [SUPABASE_CLI] [test|inspect]')
const status = JSON.parse(execFileSync(cli, ['status', '--workdir', workdir, '--output', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
}))
for (const key of ['API_URL', 'DB_URL']) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(status[key]).hostname)) throw new Error('DBREAL_LOCALHOST_REQUIRED')
}
if (mode === 'inspect') {
  const client = new pg.Client({ connectionString: status.DB_URL })
  await client.connect()
  try {
    console.log((await client.query(`SELECT proname,pronargs FROM pg_proc WHERE proname IN
      ('claim_attendance_persist_outbox','complete_attendance_persist_outbox','upsert_workday_record','link_attendance_source_event') ORDER BY 1,2`)).rows)
    console.log((await client.query('SELECT count(*)::int AS outbox_rows FROM public.attendance_persist_outbox')).rows)
  } finally { await client.end() }
} else {
  const child = spawn(process.execPath, ['--test', 'tests/compliance/dbreal-dispatcher-retry-idempotency.test.js'], {
    stdio: 'inherit', env: { ...process.env,
      SUPABASE_TEST_URL: status.API_URL, SUPABASE_TEST_ANON_KEY: status.ANON_KEY,
      SUPABASE_TEST_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      PHASE2_AUDIT_DATABASE_URL: status.DB_URL, PHASE2_AUDIT_DB_LABEL: 'local',
      ALLOW_DESTRUCTIVE_TEST_DB: 'true',
    },
  })
  child.on('error', () => { process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
