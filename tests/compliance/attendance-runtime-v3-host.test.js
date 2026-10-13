import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const { AttendanceRuntimeService, ENGINE_VERSION, RUNTIME_EXECUTION_MODE } = require('../../backend/attendance-runtime-v3/AttendanceRuntimeService.js')
const { createRuntimeApp } = require('../../backend/attendance-runtime-v3/app.js')
const { loadRuntimeConfig } = require('../../backend/attendance-runtime-v3/config.js')
const { createReadOnlyClient } = require('../../backend/attendance-runtime-v3/readOnlySupabase.js')
const TENANT = '11111111-1111-4111-8111-111111111111'
const EMPLOYEE = '22222222-2222-4222-8222-222222222222'
const REGISTRO = '33333333-3333-4333-8333-333333333333'
const DEVICE = '44444444-4444-4444-8444-444444444444'
const REVISION = '55555555-5555-4555-8555-555555555555'
const ASSIGNMENT = '66666666-6666-4666-8666-666666666666'
const TOKEN = 't'.repeat(32)
const HASH = 'a'.repeat(64)
const config = { runtimeVersion: 'attendance-runtime-v3-test', buildSha: 'test-build-sha', internalToken: TOKEN, runtimeCapability: 'ACTIVE_PERSIST_CAPABLE' }

function result(overrides = {}) {
  return { registroId: REGISTRO, executionMode: 'ACTIVE', persistenceMode: 'READ_ONLY', operativeDate: '2026-09-14', scheduleResolution: { kind: 'SCHEDULED', scheduleAssignmentId: ASSIGNMENT, scheduleRevisionId: REVISION, scheduleRevisionVersion: 1, scheduleRevisionHash: HASH }, calculation: { clienteId: TENANT, empleadoId: EMPLOYEE, calculationVersion: 3 }, ...overrides }
}
function fixture({ mode = 'ACTIVE', trusted = {}, run = async () => result(), logger = { info() {}, error() {} }, unavailable = false } = {}) {
  const reads = [], engineOptions = []
  const client = {
    from(table) {
      reads.push(table)
      const data = table === 'registro_asistencia'
        ? { id: REGISTRO, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE, ...trusted }
        : { cliente_id: TENANT, feature_key: 'REVISION_SCHEDULE_RESOLVER', mode, enabled: true }
      const response = () => ({ data, error: unavailable ? { code: 'DB_DOWN' } : null })
      return { select() { return this }, eq() { return this }, limit() { return this }, maybeSingle: async () => response(), then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject) }, insert() { throw Error('Unexpected write') }, update() { throw Error('Unexpected write') }, upsert() { throw Error('Unexpected write') }, delete() { throw Error('Unexpected write') } }
    },
    rpc() { throw Error('Unexpected RPC') },
  }
  const service = new AttendanceRuntimeService({ client, logger, orchestratorFactory: options => { engineOptions.push(options); return { run } } })
  return { service, reads, engineOptions, client }
}
async function withApp(service, callback, readinessProbe = async () => {}) {
  const app = createRuntimeApp({ service, config, readinessProbe })
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try { await callback('http://127.0.0.1:' + server.address().port) }
  finally { await new Promise(resolve => server.close(resolve)) }
}
const post = (url, body, authorization = 'Bearer ' + TOKEN) => fetch(url + '/internal/attendance/active', { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify(body) })

test('v3 health exposes release and capabilities without credentials', async () => {
  await withApp(fixture().service, async url => {
    const response = await fetch(url + '/health'); assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.runtime_version, config.runtimeVersion); assert.equal(body.build_sha, config.buildSha)
    assert.equal(body.engine_version, ENGINE_VERSION); assert.equal(body.calculation_version, 3)
    assert.equal(body.execution_mode, RUNTIME_EXECUTION_MODE); assert.equal(body.runtime_capability, 'ACTIVE_PERSIST_CAPABLE')
    assert.deepEqual(body.persistence_modes, ['READ_ONLY', 'PERSIST'])
    assert.doesNotMatch(JSON.stringify(body), /SUPABASE|service_role|token|secret/i)
  })
})
test('v3 readiness succeeds with a read-only probe', async () => {
  const f = fixture(); let probes = 0
  await withApp(f.service, async url => { const response = await fetch(url + '/ready'); assert.equal(response.status, 200); assert.equal((await response.json()).database, 'reachable') }, async () => { probes++ })
  assert.equal(probes, 1); assert.equal(f.engineOptions.length, 0)
})
test('v3 readiness reports an unavailable DB without revealing its error', async () => {
  await withApp(fixture().service, async url => { const response = await fetch(url + '/ready'); assert.equal(response.status, 503); const body = await response.json(); assert.equal(body.database, 'unreachable'); assert.doesNotMatch(JSON.stringify(body), /private-detail/) }, async () => { throw Error('private-detail') })
})
test('v3 HTTP rejects missing and modified internal bearer before reading DB', async () => {
  const f = fixture()
  await withApp(f.service, async url => { for (const token of ['', 'Bearer bad', 'Basic ' + TOKEN]) assert.equal((await post(url, { registro_id: REGISTRO }, token)).status, 401) })
  assert.deepEqual(f.reads, [])
})
test('v3 HTTP rejects caller-provided tenant, employee and persistence authority', async () => {
  const f = fixture()
  await withApp(f.service, async url => { for (const field of ['cliente_id', 'empleado_id', 'persistence_mode']) assert.equal((await post(url, { registro_id: REGISTRO, [field]: 'spoof' })).status, 400) })
  assert.deepEqual(f.reads, [])
})
test('v3 HTTP rejects malformed registro identity', async () => {
  await withApp(fixture().service, async url => { for (const id of [null, '', 'not-uuid']) assert.equal((await post(url, { registro_id: id })).status, 400) })
})
test('v3 ACTIVE endpoint derives identity from registro and never persists', async () => {
  const f = fixture()
  await withApp(f.service, async url => { const response = await post(url, { registro_id: REGISTRO }); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.tenant_id, TENANT); assert.equal(body.employee_id, EMPLOYEE); assert.equal(body.schedule_revision_id, REVISION); assert.equal(body.revision_integrity_hash, HASH); for (const key of ['databaseWrites', 'persistenceCalls', 'rpcWriteCalls', 'incidentWriteCalls']) assert.equal(body[key], 0, key) })
  assert.deepEqual(f.engineOptions, [{ executionMode: 'ACTIVE', persistenceMode: 'READ_ONLY', persistenceService: null }])
})
test('v3 has no legacy shadow HTTP execution route', async () => {
  await withApp(fixture().service, async url => { assert.equal((await fetch(url + '/internal/attendance/shadow', { method: 'POST' })).status, 404) })
  await assert.rejects(() => fixture().service.executeShadow(), { code: 'RUNTIME_SHADOW_WRITE_DENIED' })
})
test('v3 OFF and SHADOW feature modes cannot run ACTIVE calculation', async () => {
  for (const mode of ['OFF', 'SHADOW']) { const f = fixture({ mode }); await assert.rejects(() => f.service.executeActive({ registroId: REGISTRO }), { code: 'RUNTIME_RESOLUTION_MODE_MISMATCH' }); assert.equal(f.engineOptions.length, 0) }
})
test('v3 unsupported feature and corrupt revision evidence fail closed', async () => {
  await assert.rejects(() => fixture({ mode: 'PERSIST_CANARY' }).service.executeActive({ registroId: REGISTRO }), { code: 'FEATURE_MODE_UNSUPPORTED' })
  for (const code of ['SCHEDULE_REVISION_REQUIRED', 'SCHEDULE_REVISION_NOT_FOUND', 'SCHEDULE_REVISION_HASH_MISMATCH', 'AMBIGUOUS_SCHEDULE', 'TENANT_MISMATCH']) await assert.rejects(() => fixture({ run: async () => { const error = Error(code); error.code = code; throw error } }).service.executeActive({ registroId: REGISTRO }), { code })
})
test('v3 incomplete trusted identity or failed reads cannot reach engine', async () => {
  for (const field of ['cliente_id', 'empleado_id', 'dispositivo_id']) { const f = fixture({ trusted: { [field]: null } }); await assert.rejects(() => f.service.executeActive({ registroId: REGISTRO }), { code: 'RUNTIME_REGISTRO_INVALID' }); assert.equal(f.engineOptions.length, 0) }
  await assert.rejects(() => fixture({ unavailable: true }).service.executeActive({ registroId: REGISTRO }), { code: 'RUNTIME_REGISTRO_READ_FAILED' })
})
test('v3 failure observability excludes error detail and source payload', async () => {
  const logs = []
  const f = fixture({ logger: { info() {}, error: (_event, payload) => logs.push(payload) }, run: async () => { const error = Error('private-raw-payload'); error.code = 'SCHEDULE_REVISION_HASH_MISMATCH'; throw error } })
  await assert.rejects(() => f.service.executeActive({ registroId: REGISTRO }), { code: 'SCHEDULE_REVISION_HASH_MISMATCH' })
  assert.equal(logs[0].registro_id, REGISTRO); assert.equal(logs[0].error_code, 'SCHEDULE_REVISION_HASH_MISMATCH'); assert.equal(logs[0].databaseWrites, 0)
  assert.doesNotMatch(JSON.stringify(logs), /private-raw-payload|token|service_role|raw_payload/)
})
test('v3 read-only wrapper blocks every direct and indirect write path', () => {
  const counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }
  const client = createReadOnlyClient(fixture().client, counters)
  for (const method of ['insert', 'update', 'upsert', 'delete']) assert.throws(() => client.from('registro_asistencia')[method]({}), { code: 'ATTENDANCE_RUNTIME_WRITE_DENIED' })
  assert.throws(() => client.rpc('upsert_workday_record'), { code: 'ATTENDANCE_RUNTIME_WRITE_DENIED' })
  assert.throws(() => client.storage.from('bucket').upload('x', 'y'), { code: 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED' })
  assert.throws(() => client.functions.invoke('writer'), { code: 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED' })
  assert.throws(() => client.auth.signInWithPassword({}), { code: 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED' })
})
test('v3 concurrent same-registro requests share one read-only calculation', async () => {
  let release; const wait = new Promise(resolve => { release = resolve })
  const f = fixture({ run: async () => { await wait; return result() } })
  const first = f.service.executeActive({ registroId: REGISTRO }); const second = f.service.executeActive({ registroId: REGISTRO }); release()
  const [a, b] = await Promise.all([first, second]); assert.equal(f.engineOptions.length, 1); assert.equal(a.deduplicated, false); assert.equal(b.deduplicated, true); assert.equal(b.databaseWrites, 0)
})
test('v3 no assignment preserves UNSCHEDULED without manufactured revision', async () => {
  const body = await fixture({ run: async () => result({ scheduleResolution: { kind: 'UNSCHEDULED' } }) }).service.executeActive({ registroId: REGISTRO })
  assert.equal(body.result, 'UNSCHEDULED'); assert.equal(body.schedule_revision_id, null); assert.equal(body.databaseWrites, 0)
})
test('v3 rejects engine execution, persistence and calculation mode mismatches', async () => {
  for (const change of [{ executionMode: 'SHADOW' }, { persistenceMode: 'PERSIST' }, { calculation: { clienteId: TENANT, empleadoId: EMPLOYEE, calculationVersion: 2 } }]) await assert.rejects(() => fixture({ run: async () => result(change) }).service.executeActive({ registroId: REGISTRO }), { code: 'RUNTIME_ENGINE_MODE_MISMATCH' })
})
test('v3 release identifiers and deployment capabilities are mandatory', () => {
  const env = { SUPABASE_URL: 'https://project.example', SUPABASE_SECRET_KEY: 's'.repeat(20), ATTENDANCE_RUNTIME_INTERNAL_TOKEN: TOKEN, RUNTIME_VERSION: 'v3', BUILD_SHA: 'abcdef1', ATTENDANCE_RUNTIME_CAPABILITY: 'ACTIVE_PERSIST_CAPABLE' }
  assert.throws(() => loadRuntimeConfig({ ...env, BUILD_SHA: undefined }), { code: 'ATTENDANCE_RUNTIME_CONFIG_MISSING' })
  for (const capability of ['ACTIVE_PERSIST_CAPABLE', 'REVISION_AWARE_V3_ONLY']) assert.equal(loadRuntimeConfig({ ...env, ATTENDANCE_RUNTIME_CAPABILITY: capability }).runtimeCapability, capability)
  for (const capability of [undefined, 'SHADOW_ONLY', 'ACTIVE_CAPABLE', 'invalid']) assert.throws(() => loadRuntimeConfig({ ...env, ATTENDANCE_RUNTIME_CAPABILITY: capability }), { code: 'ATTENDANCE_RUNTIME_CAPABILITY_INVALID' })
})
test('v3 Docker closure and env keep backend-only dependency and secret boundaries', async () => {
  const text = p => readFile(new URL('../../' + p, import.meta.url), 'utf8')
  const [env, docker, dispatcher, phase59] = await Promise.all([text('backend/attendance-runtime-v3/.env.example'), text('backend/attendance-runtime-v3/Dockerfile'), text('backend/attendance-persist-dispatcher/Dockerfile'), text('database/live-schema/59_revision_resolver_activation_precheck.sql')])
  assert.match(env, /SUPABASE_SECRET_KEY=/); assert.doesNotMatch(env, /VITE_|PUBLIC_/)
  for (const file of [docker, dispatcher]) { assert.match(file, /COPY backend\/package\.json backend\/package-lock\.json/); assert.match(file, /npm ci --omit=dev/); assert.doesNotMatch(file, /zkteco-push-ta|frontend/) }
  assert.match(docker, /attendance-runtime-v3\/server\.js/); assert.match(docker, /COPY src\/domain\/attendance/)
  assert.match(phase59, /BEGIN TRANSACTION READ ONLY/); assert.doesNotMatch(phase59, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i)
})
test('v3 uses immutable schedule revisions without live-horario fallback', async () => {
  const source = await readFile(new URL('../../backend/services/attendance/AttendanceEngineOrchestrator.js', import.meta.url), 'utf8')
  const context = source.slice(source.indexOf('async loadScheduleContext'), source.indexOf('async loadAttendanceEvents'))
  assert.doesNotMatch(context, /from\('horarios'\)/); assert.match(context, /schedule_revisions/)
})
test('retained revision V1 fixture resolves its own 09:00-18:00 snapshot and hash', () => {
  const active = { activo: true, entrada: '09:00', salida: '18:00' }
  const snapshot = { calculation_contract_version: 1, dias_config: { lun: active, mar: active, mie: active, jue: active, vie: active, sab: { activo: false }, dom: { activo: false } }, tolerancia_minutos: 10, horario_activo: true }
  const hash = domain.computeScheduleRevisionIntegrityHash(snapshot)
  const resolution = domain.ScheduleResolver.resolve({ clienteId: TENANT, empleadoId: EMPLOYEE, candidateDate: '2026-09-14', assignments: [{ id: ASSIGNMENT, cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: DEVICE, schedule_revision_id: REVISION, activo: true, fecha_inicio: '2026-09-09', fecha_fin: null }], revisions: [{ id: REVISION, cliente_id: TENANT, horario_id: DEVICE, version: 1, config_snapshot: snapshot, integrity_hash: hash }] })
  assert.equal(resolution.kind, 'SCHEDULED'); assert.equal(resolution.shift.startTime, '09:00'); assert.equal(resolution.shift.endTime, '18:00'); assert.equal(resolution.shift.toleranceMinutes, 10)
})
