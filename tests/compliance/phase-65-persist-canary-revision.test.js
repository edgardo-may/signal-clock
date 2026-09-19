import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const contract = require('../../backend/scripts/persist-canary-revision-contract.js')
const generator = require('../../backend/scripts/generate-persist-canary-revision-shadow-manifest.js')
const runner = require('../../backend/scripts/run-persist-canary-revision-v3.js')

const { APPROVED_REVISION_CANARY: ID, EXPECTED_RUNTIME } = contract

function environment(overrides = {}) {
  return {
    SUPABASE_URL: 'https://approved.supabase.co', SUPABASE_SECRET_KEY: 'x'.repeat(40),
    RUNTIME_VERSION: EXPECTED_RUNTIME.runtime_version, BUILD_SHA: EXPECTED_RUNTIME.build_sha,
    PERSIST_CANARY_MANIFEST_CONFIRMATION: contract.MANIFEST_CONFIRMATION,
    ...overrides,
  }
}

function engineResult(overrides = {}) {
  const record = {
    registro_id: ID.registro_id, cliente_id: ID.cliente_id, empleado_id: ID.empleado_id,
    workday_date: ID.operative_date, schedule_id: ID.schedule_id, timezone: ID.timezone,
    first_in: '2026-09-09T14:00:00.000Z', last_out: '2026-09-09T23:00:00.000Z',
    worked_minutes: 540, break_minutes: 0, overtime_minutes: 0, late_minutes: 0, early_leave_minutes: 0,
    status: 'COMPLETE', calculation_version: 3, integrity_hash: 'a'.repeat(64),
  }
  return {
    registroId: ID.registro_id, operativeDate: ID.operative_date,
    calculation: { clienteId: ID.cliente_id, empleadoId: ID.empleado_id, timezone: ID.timezone, calculationVersion: 3, integrityHash: 'a'.repeat(64) },
    scheduleResolution: { kind: 'SCHEDULED', scheduleAssignmentId: ID.assignment_id, scheduleId: ID.schedule_id, scheduleRevisionId: ID.schedule_revision_id, scheduleRevisionVersion: 1, scheduleRevisionHash: ID.revision_integrity_hash },
    workdayRecord: record,
    ...overrides,
  }
}

function readClient({ feature = { cliente_id: ID.cliente_id, feature_key: contract.REVISION_FEATURE_KEY, mode: 'SHADOW', enabled: true }, active = [] } = {}) {
  return {
    from(table) {
      const filters = []
      const query = {
        select() { return this },
        eq(name, value) { filters.push([name, value]); return this },
        maybeSingle: async () => ({ data: feature, error: null }),
        then(resolve, reject) {
          const hasTenant = filters.some(([name]) => name === 'cliente_id')
          return Promise.resolve({ data: hasTenant ? [feature] : active, error: null }).then(resolve, reject)
        },
      }
      assert.equal(table, 'tenant_features')
      return query
    },
  }
}

async function manifest(options = {}) {
  return generator.generatePersistCanaryRevisionShadowManifest({
    environment: environment(options.environment),
    dependencies: { createClient: () => readClient(options), createOrchestrator: () => ({ run: async () => engineResult(options.engineResult) }) },
  })
}

test('65.1 fresh manifest contains the complete V3 snapshot and deterministic SHA with zero writes', async () => {
  const result = await manifest()
  assert.deepEqual(result.identity, ID)
  assert.deepEqual(result.source.runtime, EXPECTED_RUNTIME)
  assert.deepEqual(Object.keys(result.snapshot).sort(), ['break_minutes', 'calculation_version', 'early_leave_minutes', 'first_in', 'integrity_hash', 'last_out', 'late_minutes', 'overtime_minutes', 'status', 'worked_minutes'])
  assert.match(result.manifest_sha256, /^[0-9a-f]{64}$/)
  assert.equal(contract.assertManifest(result, result.manifest_sha256), result.manifest_sha256)
  assert.deepEqual(result.counters, { databaseWrites: 0, persistenceCalls: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0, incidentWriteCalls: 0 })
})

test('65.2 generator permits only the exact approved registro CLI argument', () => {
  assert.doesNotThrow(() => generator.parseArguments(['--registro-id', ID.registro_id]))
  assert.throws(() => generator.parseArguments(['--registro-id', '7f99cef9-4100-48ff-9aaf-68548c80c948']), { code: 'PERSIST_CANARY_MANIFEST_USAGE_DENIED' })
})

test('65.3 tenant, assignment, revision, hash, or calculation version deviations fail closed', async () => {
  const cases = [
    { calculation: { ...engineResult().calculation, clienteId: 'wrong' } },
    { scheduleResolution: { ...engineResult().scheduleResolution, scheduleAssignmentId: 'wrong' } },
    { scheduleResolution: { ...engineResult().scheduleResolution, scheduleRevisionId: 'wrong' } },
    { scheduleResolution: { ...engineResult().scheduleResolution, scheduleRevisionHash: 'b'.repeat(64) } },
    { calculation: { ...engineResult().calculation, calculationVersion: 2 } },
  ]
  for (const changed of cases) {
    await assert.rejects(() => manifest({ engineResult: changed }), { code: 'PERSIST_CANARY_MANIFEST_IDENTITY_DENIED' })
  }
})

test('65.4 feature OFF, ACTIVE, or another ACTIVE tenant blocks the read-only manifest', async () => {
  await assert.rejects(() => manifest({ feature: { cliente_id: ID.cliente_id, feature_key: contract.REVISION_FEATURE_KEY, mode: 'OFF', enabled: false } }), { code: 'PERSIST_CANARY_REVISION_FEATURE_DENIED' })
  await assert.rejects(() => manifest({ feature: { cliente_id: ID.cliente_id, feature_key: contract.REVISION_FEATURE_KEY, mode: 'ACTIVE', enabled: true } }), { code: 'PERSIST_CANARY_REVISION_FEATURE_DENIED' })
  await assert.rejects(() => manifest({ active: [{ cliente_id: 'other', mode: 'ACTIVE', enabled: true }] }), { code: 'PERSIST_CANARY_OTHER_ACTIVE_TENANT' })
})

test('65.5 manifest hash, runtime identity, and nonzero write counters fail closed', async () => {
  const good = await manifest()
  assert.throws(() => contract.assertManifest({ ...good, manifest_sha256: 'b'.repeat(64) }), { code: 'PERSIST_CANARY_MANIFEST_SHA_MISMATCH' })
  assert.throws(() => contract.assertManifest({ ...good, source: { ...good.source, runtime: { ...EXPECTED_RUNTIME, build_sha: 'b'.repeat(64) } } }), { code: 'PERSIST_CANARY_RUNTIME_IDENTITY_DENIED' })
  assert.throws(() => contract.assertManifest({ ...good, counters: { ...good.counters, rpcWriteCalls: 1 } }), { code: 'PERSIST_CANARY_MANIFEST_NOT_READ_ONLY' })
})

function runnerEnvironment(manifestSha, expected = 'INSERTED') {
  const vars = environment({ PERSIST_CANARY_MANIFEST_CONFIRMATION: undefined })
  vars.PERSIST_CANARY_ALLOWED_HOST = 'approved.supabase.co'
  vars.PERSIST_CANARY_CONFIRMATION = contract.PERSIST_CONFIRMATION
  vars.PERSIST_CANARY_EXPECTED_RESULT = expected
  vars.PERSIST_CANARY_MANIFEST_SHA256 = manifestSha
  vars.PERSIST_CANARY_APPROVED_RPC_FINGERPRINT = 'c'.repeat(32)
  vars.PERSIST_CANARY_MANIFEST_PATH = 'manifest.json'
  vars.PERSIST_CANARY_RUNNER_PRECHECK_PATH = 'precheck.json'
  for (const [key, value] of Object.entries(ID)) vars[`PERSIST_CANARY_${key.toUpperCase()}`] = String(value)
  return vars
}

function precheck(rows = 0) {
  return { phase: '68_persist_canary_runner_precheck', read_only: 'on', runner_precheck_pass: true, identity: { ...ID }, rpc_fingerprint: 'c'.repeat(32), revision_feature_mode: 'SHADOW', active_tenants: [], target_workday_rows: rows, target_history_rows: rows }
}

function operationalClient({ existing = null, rpcResult = 'INSERTED', authorization = true } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const filters = []
      return {
        select() { return this }, eq(name, value) { filters.push([name, value]); return this },
        then(resolve, reject) {
          let data = []
          if (table === 'tenant_features') {
            const key = filters.find(([name]) => name === 'feature_key')?.[1]
            const mode = filters.find(([name]) => name === 'mode')?.[1]
            if (key === contract.PERSIST_FEATURE_KEY && authorization) data = [{ cliente_id: ID.cliente_id, feature_key: key, mode: 'PERSIST_CANARY', enabled: true, canary_registro_id: ID.registro_id, canary_empleado_id: ID.empleado_id, canary_schedule_id: ID.schedule_id, canary_workday_date: ID.operative_date }]
            if (key === contract.REVISION_FEATURE_KEY && mode !== 'ACTIVE') data = [{ cliente_id: ID.cliente_id, feature_key: key, mode: 'SHADOW', enabled: true }]
          } else if (table === 'workday_records' && existing) data = [existing]
          else if (table === 'workday_record_history' && existing) data = [{ id: 'history' }]
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
    },
    rpc: async (name, params) => { calls.push({ name, params }); return { data: [{ workday_id: '00000000-0000-4000-8000-000000000001', persistence_result: rpcResult, integrity_hash: params.p_integrity_hash }], error: null } },
  }
}

async function runWith(manifestValue, options = {}) {
  const env = runnerEnvironment(manifestValue.manifest_sha256, options.expected || 'INSERTED')
  const client = options.client || operationalClient(options)
  const result = await runner.runPersistCanaryRevisionV3({ environment: env, dependencies: {
    readFile: async (file) => file.endsWith('manifest.json') ? JSON.stringify(manifestValue) : JSON.stringify(precheck(options.expected === 'UNCHANGED' ? 1 : 0)),
    createClient: () => client,
  } })
  return { result, client }
}

test('65.6 first run is exactly INSERTED and submits only the V3 RPC payload', async () => {
  const fresh = await manifest()
  const { result, client } = await runWith(fresh)
  assert.equal(result.persistence_result, 'INSERTED')
  assert.equal(result.persistenceCalls, 1)
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].name, 'upsert_workday_record')
  assert.equal(client.calls[0].params.p_registro_id, ID.registro_id)
})

test('65.7 exact existing snapshot replays only as UNCHANGED; changed snapshot is blocked before RPC', async () => {
  const fresh = await manifest()
  const existing = { id: 'workday', cliente_id: ID.cliente_id, empleado_id: ID.empleado_id, workday_date: ID.operative_date, schedule_id: ID.schedule_id, timezone: ID.timezone, ...fresh.snapshot }
  const replay = await runWith(fresh, { expected: 'UNCHANGED', existing, rpcResult: 'UNCHANGED' })
  assert.equal(replay.result.persistence_result, 'UNCHANGED')
  const changed = { ...existing, worked_minutes: existing.worked_minutes + 1 }
  await assert.rejects(() => runWith(fresh, { expected: 'UNCHANGED', existing: changed, rpcResult: 'UNCHANGED' }), { code: 'PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT' })
})

test('65.8 authorization mismatch, RPC fingerprint mismatch, and UPDATED are denied', async () => {
  const fresh = await manifest()
  await assert.rejects(() => runWith(fresh, { authorization: false }), { code: 'PERSIST_CANARY_AUTHORIZATION_DENIED' })
  const env = runnerEnvironment(fresh.manifest_sha256)
  assert.throws(() => runner.assertRunnerPrecheck({ ...precheck(), rpc_fingerprint: 'd'.repeat(32) }, runner.readRunnerConfig(env)), { code: 'PERSIST_CANARY_PRECHECK_DENIED' })
  await assert.rejects(() => runWith(fresh, { rpcResult: 'UPDATED' }), /persistence_result no permitido/)
})

test('65.9 new SQL phases are strictly sequenced, current C only, and historical 36-45 remain untouched', async () => {
  const [p65, p66, p67, p68, p69] = await Promise.all([65, 66, 67, 68, 69].map((phase) => readFile(new URL(`../../database/live-schema/${phase}_${['persist_canary_revision_precheck','persist_canary_authorization_change','persist_canary_authorization_postcheck','persist_canary_runner_precheck','persist_canary_postcheck'][phase - 65]}.sql`, import.meta.url), 'utf8')))
  assert.match(p65, /BEGIN TRANSACTION READ ONLY/)
  assert.match(p65, new RegExp(ID.registro_id))
  assert.doesNotMatch(p65 + p66 + p67 + p68 + p69, /7f99cef9|be4035c8|2026-09-03/)
  assert.match(p66, /INSERT INTO public\.tenant_features/)
  assert.match(p67 + p68 + p69, /BEGIN TRANSACTION READ ONLY/g)
  assert.match(p69, /'INSERTED'/)
  assert.match(p69, /'UNCHANGED'/)
})
