import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const { AttendanceRuntimeService, AttendanceRuntimeError, ENGINE_VERSION, CALCULATION_VERSION } = require('../../backend/attendance-runtime/AttendanceRuntimeService.js')
const { createRuntimeApp } = require('../../backend/attendance-runtime/app.js')
const { runPostDeployReadOnlyCheck, runtimeSourceSha256, TARGET } = require('../../backend/attendance-runtime/postdeploy-readonly-check.js')
const { FEATURE_KEY } = require('../../backend/attendance-runtime/tenantFeature.js')
const { createReadOnlyClient } = require('../../backend/attendance-runtime/readOnlySupabase.js')
const { loadRuntimeConfig } = require('../../backend/attendance-runtime/config.js')
const { installGracefulShutdown } = require('../../backend/attendance-runtime/server.js')
const { verifyPackageClosure } = require('../../backend/attendance-runtime/verify-package-closure.js')

const TENANT = '69095bd5-fee5-4237-a1a4-186dd88310ff'
const EMPLOYEE = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'
const REGISTRO = '7f99cef9-4100-48ff-9aaf-68548c80c948'
const DEVICE = 'f693aea8-9f80-4e81-a99c-91b39e6d66d9'
const TOKEN = 't'.repeat(32)

function snapshot() {
  return {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: true, entrada: '09:00', salida: '18:00' }, mar: { activo: true, entrada: '09:00', salida: '18:00' },
      mie: { activo: true, entrada: '09:00', salida: '18:00' }, jue: { activo: true, entrada: '09:00', salida: '18:00' },
      vie: { activo: true, entrada: '09:00', salida: '18:00' }, sab: { activo: false }, dom: { activo: false },
    }, tolerancia_minutos: 10, horario_activo: true,
  }
}

function registration(overrides = {}) {
  return { id: REGISTRO, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE, verificado_at: '2026-09-14T14:00:00.000Z', ...overrides }
}

function memoryClient(data, unavailable = false) {
  return {
    from(table) {
      const filters = []
      const rows = () => (data[table] || []).filter((row) => filters.every(([field, value]) => row[field] === value))
      const response = () => unavailable ? { data: null, error: { code: 'DB_DOWN' } } : { data: rows(), error: null }
      const builder = {
        select() { return this },
        eq(field, value) { filters.push([field, value]); return this },
        limit() { return this },
        maybeSingle: async () => {
          const result = response()
          return { data: Array.isArray(result.data) ? result.data[0] || null : null, error: result.error }
        },
        then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject) },
        insert() { throw new Error('write reached raw fake client') },
        update() { throw new Error('write reached raw fake client') },
        delete() { throw new Error('write reached raw fake client') },
        upsert() { throw new Error('write reached raw fake client') },
      }
      return builder
    },
    rpc() { throw new Error('rpc reached raw fake client') },
  }
}

function rows(mode = 'SHADOW') {
  return {
    registro_asistencia: [registration()],
    tenant_features: mode === 'ABSENT' ? [] : [{ cliente_id: TENANT, feature_key: FEATURE_KEY, mode, enabled: true }],
  }
}

function engineResult({ kind = 'SCHEDULED', code, revisionId = TARGET.revisionId } = {}) {
  if (code) {
    const error = new Error(code)
    error.code = code
    throw error
  }
  return {
    registroId: REGISTRO,
    operativeDate: '2026-09-14',
    scheduleResolution: kind === 'UNSCHEDULED' ? { kind } : {
      kind, scheduleAssignmentId: TARGET.assignmentId, scheduleRevisionId: revisionId,
      scheduleRevisionVersion: 1, scheduleRevisionHash: TARGET.integrityHash,
    },
    calculation: { clienteId: TENANT, empleadoId: EMPLOYEE, calculationVersion: 3 },
  }
}

function runtime({ mode = 'SHADOW', run = async () => engineResult(), logger = { info() {}, error() {} } } = {}) {
  let calls = 0
  const service = new AttendanceRuntimeService({
    client: memoryClient(rows(mode)), logger,
    orchestratorFactory: () => ({ run: async (input) => { calls += 1; return run(input) } }),
  })
  return { service, calls: () => calls }
}

function config() {
  return { runtimeVersion: 'test-runtime-v1', buildSha: 'test-build-sha', internalToken: TOKEN }
}

async function withApp(app, callback) {
  const server = await new Promise((resolve) => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current))
  })
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('health is public but non-sensitive, readiness performs only a database read', async () => {
  const { service } = runtime()
  const app = createRuntimeApp({ service, config: config(), readinessProbe: async () => {} })
  await withApp(app, async (url) => {
    const health = await (await fetch(`${url}/health`)).json()
    const ready = await (await fetch(`${url}/ready`)).json()
    assert.deepEqual(health, { status: 'ok', runtime_version: 'test-runtime-v1', build_sha: 'test-build-sha', engine_version: ENGINE_VERSION, calculation_version: 3, execution_mode: 'SHADOW_ONLY' })
    assert.equal(ready.database, 'reachable')
    assert.doesNotMatch(JSON.stringify(health), /SUPABASE|service_role|token/i)
  })
})

test('readiness reports DB unavailable without writing', async () => {
  const { service } = runtime()
  const app = createRuntimeApp({ service, config: config(), readinessProbe: async () => { throw new Error('down') } })
  await withApp(app, async (url) => {
    const response = await fetch(`${url}/ready`)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).database, 'unreachable')
  })
})

test('OFF is skipped, while SHADOW and ACTIVE resolve revision only with zero writes', async () => {
  for (const mode of ['OFF', 'SHADOW', 'ACTIVE']) {
    const { service, calls } = runtime({ mode })
    const result = await service.executeShadow({ registroId: REGISTRO })
    if (mode === 'OFF') {
      assert.equal(result.result, 'SKIPPED_FLAG_OFF')
      assert.equal(calls(), 0)
    } else {
      assert.equal(result.resolution_mode, mode)
      assert.equal(result.schedule_revision_id, TARGET.revisionId)
      assert.equal(calls(), 1)
    }
    assert.equal(result.databaseWrites, 0)
    assert.equal(result.persistenceCalls, 0)
    assert.equal(result.rpcWriteCalls, 0)
    assert.equal(result.incidentWriteCalls, 0)
  }
})

test('unsupported feature mode, revision corruption and tenant mismatch fail closed', async () => {
  const unsupported = new AttendanceRuntimeService({ client: memoryClient(rows('PERSIST_CANARY')), logger: { info() {}, error() {} } })
  await assert.rejects(() => unsupported.executeShadow({ registroId: REGISTRO }), { code: 'FEATURE_MODE_UNSUPPORTED' })
  for (const code of ['SCHEDULE_REVISION_REQUIRED', 'SCHEDULE_REVISION_NOT_FOUND', 'SCHEDULE_REVISION_HASH_MISMATCH', 'AMBIGUOUS_SCHEDULE', 'TENANT_MISMATCH']) {
    const { service } = runtime({ run: async () => engineResult({ code }) })
    await assert.rejects(() => service.executeShadow({ registroId: REGISTRO }), { code })
  }
})

test('failure observability keeps trusted identity and excludes request secrets', async () => {
  const logs = []
  const { service } = runtime({
    logger: { info() {}, error: (_event, payload) => logs.push(payload) },
    run: async () => engineResult({ code: 'SCHEDULE_REVISION_HASH_MISMATCH' }),
  })
  await assert.rejects(() => service.executeShadow({ registroId: REGISTRO }), { code: 'SCHEDULE_REVISION_HASH_MISMATCH' })
  assert.deepEqual(logs[0].tenant_id, TENANT)
  assert.deepEqual(logs[0].employee_id, EMPLOYEE)
  assert.equal(logs[0].error_code, 'SCHEDULE_REVISION_HASH_MISMATCH')
  assert.doesNotMatch(JSON.stringify(logs[0]), /token|service_role|raw_payload/i)
})

test('read-only Supabase wrapper blocks DML, RPC, storage, functions and auth capability paths', () => {
  const counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }
  const client = createReadOnlyClient(memoryClient(rows()), counters)
  assert.throws(() => client.from('registro_asistencia').insert({}), { code: 'ATTENDANCE_RUNTIME_WRITE_DENIED' })
  assert.throws(() => client.rpc('upsert_workday_record'), { code: 'ATTENDANCE_RUNTIME_WRITE_DENIED' })
  assert.throws(() => client.storage.from('bucket').upload('x', 'y'), { code: 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED' })
  assert.throws(() => client.functions.invoke('writer'), { code: 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED' })
  assert.throws(() => client.auth.signInWithPassword({}), { code: 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED' })
  assert.equal(counters.databaseWrites, 1)
  assert.equal(counters.rpcWriteCalls, 1)
  assert.equal(counters.storageWriteCalls, 1)
  assert.equal(counters.indirectSupabaseCalls, 3)
})

test('runtime release identifiers are mandatory and graceful shutdown closes once', () => {
  assert.throws(() => loadRuntimeConfig({ SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(20), ATTENDANCE_RUNTIME_INTERNAL_TOKEN: TOKEN, RUNTIME_VERSION: 'v1' }), { code: 'ATTENDANCE_RUNTIME_CONFIG_MISSING' })
  const configLoaded = loadRuntimeConfig({ SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(20), ATTENDANCE_RUNTIME_INTERNAL_TOKEN: TOKEN, RUNTIME_VERSION: 'v1', BUILD_SHA: 'abcdef1' })
  assert.equal(configLoaded.buildSha, 'abcdef1')
  let closes = 0
  const exits = []
  const shutdown = installGracefulShutdown({ close(callback) { closes += 1; callback() } }, { runtimeVersion: 'v1', buildSha: 'abcdef1', exit: (code) => exits.push(code), logger: { info() {} } })
  shutdown('TEST')
  shutdown('TEST_AGAIN')
  assert.equal(closes, 1)
  assert.deepEqual(exits, [0])
})

test('no assignment preserves UNSCHEDULED instead of treating it as corruption', async () => {
  const { service } = runtime({ run: async () => engineResult({ kind: 'UNSCHEDULED' }) })
  const result = await service.executeShadow({ registroId: REGISTRO })
  assert.equal(result.result, 'UNSCHEDULED')
  assert.equal(result.schedule_revision_id, null)
  assert.equal(result.databaseWrites, 0)
})

test('revision V1 fixture resolves 09:00-18:00 with its integrity hash', () => {
  const configSnapshot = snapshot()
  const hash = domain.computeScheduleRevisionIntegrityHash(configSnapshot)
  const target = { ...TARGET, integrityHash: hash }
  const resolution = domain.ScheduleResolver.resolve({
    clienteId: TENANT, empleadoId: EMPLOYEE, candidateDate: target.operativeDate,
    assignments: [{ id: target.assignmentId, cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: target.scheduleId, schedule_revision_id: target.revisionId, activo: true, fecha_inicio: '2026-09-09', fecha_fin: null }],
    revisions: [{ id: target.revisionId, cliente_id: TENANT, horario_id: target.scheduleId, version: 1, config_snapshot: configSnapshot, integrity_hash: hash }],
  })
  assert.equal(resolution.kind, 'SCHEDULED')
  assert.equal(resolution.shift.startTime, '09:00')
  assert.equal(resolution.shift.endTime, '18:00')
  assert.equal(resolution.shift.toleranceMinutes, 10)
})

test('duplicate and concurrent executions share one shadow calculation and remain write-free', async () => {
  let release
  const wait = new Promise((resolve) => { release = resolve })
  const { service, calls } = runtime({ run: async () => { await wait; return engineResult() } })
  const first = service.executeShadow({ registroId: REGISTRO })
  const second = service.executeShadow({ registroId: REGISTRO })
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls(), 1)
  assert.equal(a.deduplicated, false)
  assert.equal(b.deduplicated, true)
  assert.equal(a.databaseWrites, 0)
  assert.equal(b.persistenceCalls, 0)
})

test('internal endpoint rejects unauthorised and malformed requests and never receives tenant authority', async () => {
  const { service } = runtime()
  const app = createRuntimeApp({ service, config: config(), readinessProbe: async () => {} })
  await withApp(app, async (url) => {
    const unauthorized = await fetch(`${url}/internal/attendance/shadow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registro_id: REGISTRO }) })
    assert.equal(unauthorized.status, 401)
    const malformed = await fetch(`${url}/internal/attendance/shadow`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ registro_id: REGISTRO, cliente_id: TENANT }) })
    assert.equal(malformed.status, 400)
    const valid = await fetch(`${url}/internal/attendance/shadow`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ registro_id: REGISTRO }) })
    assert.equal(valid.status, 200)
    assert.equal((await valid.json()).tenant_id, TENANT)
  })
})

test('runtime postdeploy check is read-only and validates runtime, feature, C revision and hash', async () => {
  const configSnapshot = snapshot()
  const integrityHash = domain.computeScheduleRevisionIntegrityHash(configSnapshot)
  const target = { ...TARGET, integrityHash }
  const data = {
    tenant_features: [{ cliente_id: TENANT, feature_key: FEATURE_KEY, mode: 'OFF', enabled: false }],
    empleados_horarios: [{ id: target.assignmentId, cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: target.scheduleId, schedule_revision_id: target.revisionId, fecha_inicio: '2026-09-09', fecha_fin: null, activo: true }],
    schedule_revisions: [{ id: target.revisionId, cliente_id: TENANT, horario_id: target.scheduleId, version: 1, config_snapshot: configSnapshot, integrity_hash: integrityHash }],
  }
  const expectedSha = await runtimeSourceSha256()
  const report = await runPostDeployReadOnlyCheck({
    ATTENDANCE_RUNTIME_URL: 'https://runtime.example', ATTENDANCE_RUNTIME_EXPECTED_VERSION: 'test-runtime-v1',
    ATTENDANCE_RUNTIME_EXPECTED_SHA256: expectedSha, ATTENDANCE_RUNTIME_EXPECTED_BUILD_SHA: 'test-build-sha',
  }, {
    createClient: () => memoryClient(data), target,
    fetch: async (url) => ({ ok: true, json: async () => url.endsWith('/health')
      ? { status: 'ok', runtime_version: 'test-runtime-v1', build_sha: 'test-build-sha', execution_mode: 'SHADOW_ONLY' }
      : { status: 'ok', database: 'reachable' } }),
  })
  assert.equal(report.postcheck_pass, true, JSON.stringify(report))
  assert.equal(report.databaseWrites, 0)
  assert.equal(report.persistenceCalls, 0)
  assert.equal(report.incidentWriteCalls, 0)
})

test('runtime package has no browser exposure and Phase59 remains read-only', () => {
  const env = readFileSync(new URL('../../backend/attendance-runtime/.env.example', import.meta.url), 'utf8')
  const docker = readFileSync(new URL('../../backend/attendance-runtime/Dockerfile', import.meta.url), 'utf8')
  const phase59 = readFileSync(new URL('../../database/live-schema/59_revision_resolver_activation_precheck.sql', import.meta.url), 'utf8')
  assert.match(env, /SUPABASE_SERVICE_ROLE_KEY=/)
  assert.doesNotMatch(env, /VITE_|PUBLIC_/)
  assert.match(docker, /node:22\.18-alpine/)
  assert.doesNotMatch(docker, /zkteco-push-ta|frontend/i)
  assert.match(phase59, /BEGIN TRANSACTION READ ONLY;/)
  assert.doesNotMatch(phase59, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i)
  assert.equal(CALCULATION_VERSION, 3)
  assert.equal(verifyPackageClosure().package_closure_pass, true)
})
