/** Generate a schema-only baseline from a known-good local/test/staging database. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.env.PHASE2_AUDIT_DATABASE_URL
const label = process.env.PHASE2_AUDIT_DB_LABEL
const generatedAt = process.env.PHASE2_BASELINE_GENERATED_DATE
const productionHost = (process.env.PHASE2_PRODUCTION_HOST || '').toLowerCase()
const allowedLabel = /^(local|test|staging)$/i.test(label || '')
let host = ''
try { host = new URL(url || '').hostname.toLowerCase() } catch { /* reported below */ }
const productionLike = /(^|[.-])(prod|production)([.-]|$)/i.test(host) || (productionHost && host === productionHost)

if (!url || !allowedLabel || process.env.ALLOW_DESTRUCTIVE_TEST_DB !== 'true' || productionLike) {
  throw new Error('Refusing baseline generation: require guarded local|test|staging URL, ALLOW_DESTRUCTIVE_TEST_DB=true, and a non-production host.')
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedAt || '')) {
  throw new Error('Set PHASE2_BASELINE_GENERATED_DATE=YYYY-MM-DD so baseline metadata is reviewed and reproducible.')
}

mkdirSync('supabase/baseline', { recursive: true })
const output = resolve('supabase/baseline/000_current_schema_baseline.sql')
const temporary = `${output}.tmp`
const dump = spawnSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '--dbname', url, '--file', temporary], { encoding: 'utf8' })
if (dump.status !== 0) throw new Error(dump.stderr || 'pg_dump failed')

const schema = readFileSync(temporary, 'utf8')
rmSync(temporary, { force: true })
const forbiddenData = /INSERT\s+INTO\s+(?:public\.)?(?:clientes|empleados|attendance_logs|biometric_templates|auth\.users)\b/i
const forbiddenSecrets = /(?:jwt[ _-]?secret|service[ _-]?role|password|token)\s*=/i
if (forbiddenData.test(schema) || forbiddenSecrets.test(schema)) {
  throw new Error('Refusing baseline: generated schema appears to contain real data or a secret-like assignment.')
}

const header = `-- SIGNUM_SCHEMA_BASELINE_2026_09\n-- source_environment: TEST/STAGING KNOWN-GOOD\n-- schema_revision: 047\n-- generated_at: ${generatedAt}\n-- Schema only. Do not add tenant, auth, attendance, biometric, token, or secret data.\n\n`
writeFileSync(output, `${header}${schema}`, 'utf8')
console.log(`Generated schema-only baseline: ${output}`)
