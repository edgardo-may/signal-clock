/** Official fresh-install route: current baseline, then migrations newer than revision 047. */
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const connection = process.env.PHASE2_BOOTSTRAP_DATABASE_URL || process.env.PHASE2_AUDIT_DATABASE_URL
const label = process.env.PHASE2_AUDIT_DB_LABEL
const productionHost = (process.env.PHASE2_PRODUCTION_HOST || '').toLowerCase()
let host = ''
try { host = new URL(connection || '').hostname.toLowerCase() } catch { /* validation below */ }
if (!connection || process.env.ALLOW_DESTRUCTIVE_TEST_DB !== 'true' || !/^(local|test|staging)$/i.test(label || '') || /(^|[.-])(prod|production)([.-]|$)/i.test(host) || (productionHost && host === productionHost)) {
  throw new Error('Refusing bootstrap: require a guarded local|test|staging empty DB and ALLOW_DESTRUCTIVE_TEST_DB=true.')
}

const baseline = resolve('supabase/baseline/000_current_schema_baseline.sql')
if (!existsSync(baseline)) throw new Error('Missing generated baseline. Generate it from a known-good TEST/STAGING schema first.')
const run = file => {
  const result = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', '--dbname', connection, '--file', file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `psql failed for ${file}`)
  console.log(`PASS ${file}`)
}

run(baseline)
const subsequent = readdirSync('supabase/migrations')
  .filter(name => /^(\d+)_.*\.sql$/i.test(name) && Number(name.match(/^(\d+)/)[1]) > 47)
  .sort()
for (const name of subsequent) run(resolve('supabase/migrations', name))
console.log('Fresh bootstrap complete: baseline + post-047 migrations only.')
