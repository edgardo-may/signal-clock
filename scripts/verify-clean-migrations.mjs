/**
 * HISTORICAL DIAGNOSTIC ONLY: applies the archival chain in filename order.
 * It is not the supported fresh-install route while 041 has documented drift.
 */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const connection = process.env.PHASE2_AUDIT_DATABASE_URL
const label = process.env.PHASE2_AUDIT_DB_LABEL
const allow = process.env.ALLOW_DESTRUCTIVE_TEST_DB === 'true'
const productionHost = process.env.PHASE2_PRODUCTION_HOST

if (!connection || !allow || !/^(local|test|staging)$/i.test(label || '')) {
  throw new Error('Refusing migration verification: require PHASE2_AUDIT_DATABASE_URL, PHASE2_AUDIT_DB_LABEL=(local|test|staging), and ALLOW_DESTRUCTIVE_TEST_DB=true.')
}
const host = new URL(connection).hostname
if ((productionHost && host === productionHost) || /(^|[.-])(prod|production)([.-]|$)/i.test(host)) {
  throw new Error(`Refusing production-like database host: ${host}`)
}

const dir = resolve('supabase/migrations')
const files = readdirSync(dir).filter(name => /^\d+_.+\.sql$/i.test(name)).sort()
console.log('HISTORICAL DIAGNOSTIC: expected evidence is a failure at 041 until historical drift is separately repaired.')
for (const file of files) {
  const start = performance.now()
  const result = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', '--dbname', connection, '--file', resolve(dir, file)], { encoding: 'utf8' })
  const durationMs = Math.round(performance.now() - start)
  process.stdout.write(`${file}\t${durationMs}ms\t${result.status === 0 ? 'PASS' : 'FAIL'}\n`)
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'psql failed\n')
    process.exit(result.status || 1)
  }
}
