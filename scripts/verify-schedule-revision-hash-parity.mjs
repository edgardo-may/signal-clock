/** Read-only DB/backend hash parity evidence for Phase 58. */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { computeScheduleRevisionIntegrityHash } from '../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const REVISION_ID = '09df6a75-e231-4654-ae70-8448bdf2c312'
const EXPECTED_HASH = '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'
const APPROVED_HOST = 'tuhrqoihccfumlaxnbor.supabase.co'

function readDotEnv(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const env = readDotEnv(new URL('../backend/.env', import.meta.url))
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('HASH_PARITY_ENV_MISSING')
if (new URL(env.SUPABASE_URL).host !== APPROVED_HOST) throw new Error('HASH_PARITY_HOST_DENIED')
const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const revisionResponse = await client.from('schedule_revisions')
  .select('id,config_snapshot,integrity_hash').eq('id', REVISION_ID).single()
if (revisionResponse.error || !revisionResponse.data) throw new Error(`HASH_PARITY_REVISION_READ_FAILED: ${revisionResponse.error?.message ?? ''}`)
const revision = revisionResponse.data
// The SQL function is IMMUTABLE and performs only canonical JSONB hashing; it
// contains no DML. It is invoked only to compare DB text canonicalization.
const dbResponse = await client.rpc('schedule_revision_calculation_hash', { p_snapshot: revision.config_snapshot })
if (dbResponse.error || typeof dbResponse.data !== 'string') throw new Error(`HASH_PARITY_DB_FUNCTION_FAILED: ${dbResponse.error?.message ?? ''}`)
const backendHash = computeScheduleRevisionIntegrityHash(revision.config_snapshot)
const result = {
  phase: '58_schedule_revision_hash_parity', mode: 'READ_ONLY', databaseWrites: 0, rpcWrites: 0,
  revisionId: revision.id, expectedHash: EXPECTED_HASH, storedHash: revision.integrity_hash,
  dbHash: dbResponse.data, backendHash,
  parity: revision.integrity_hash === EXPECTED_HASH && dbResponse.data === EXPECTED_HASH && backendHash === EXPECTED_HASH,
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.parity) process.exitCode = 3
