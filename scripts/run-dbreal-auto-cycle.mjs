import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Explicit isolated stack only. Never reads application/production credentials.
const [workdir, cli = 'supabase'] = process.argv.slice(2)
if (!workdir) throw new Error('Usage: node scripts/run-dbreal-auto-cycle.mjs LOCAL_WORKDIR [SUPABASE_CLI]')
const status = JSON.parse(execFileSync(cli, ['status', '--workdir', workdir, '--output', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
}))
for (const key of ['API_URL', 'DB_URL']) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(status[key]).hostname)) throw new Error('DBREAL_LOCALHOST_REQUIRED')
}
const require = createRequire(new URL('../zkteco-push-ta/package.json', import.meta.url))
const loader = pathToFileURL(require.resolve('tsx')).href
const child = spawn(process.execPath, ['--import', loader, '--test', '--test-concurrency=1',
  'tests/compliance/dbreal-auto-open-cycle.test.js', 'tests/compliance/phase-99-source-event-link-order.test.js'], {
  stdio: 'inherit', env: { ...process.env,
    SUPABASE_TEST_URL: status.API_URL, SUPABASE_TEST_ANON_KEY: status.ANON_KEY,
    SUPABASE_TEST_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    PHASE2_AUDIT_DATABASE_URL: status.DB_URL, PHASE2_AUDIT_DB_LABEL: 'local',
    ALLOW_DESTRUCTIVE_TEST_DB: 'true',
  },
})
child.on('error', () => { process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
