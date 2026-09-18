/** Phase 34.1 validates the guarded read-smoke path with no network access. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { computeScheduleRevisionIntegrityHash } from '../../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const require = createRequire(import.meta.url)
const runner = require('../../backend/scripts/run-production-workday-shadow-canary.js')

const {
  APPROVED_REGISTRO_ID: REGISTRO,
  APPROVED_TENANT_ID: TENANT,
  APPROVED_EMPLOYEE_ID: EMPLOYEE,
  APPROVED_DEVICE_ID: DEVICE,
  APPROVED_SCHEDULE_ID: SCHEDULE,
  WINDOW_START,
  WINDOW_END,
  ProductionShadowGuardError,
  readProductionShadowConfig,
  runProductionReadSmoke,
  sanitizedEnvironmentCheck,
} = runner

function environment(overrides = {}) {
  return {
    SUPABASE_URL: 'https://project.example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-real-secret',
    SHADOW_CANARY_ALLOWED_HOST: 'project.example.supabase.co',
    SHADOW_CANARY_ENVIRONMENT: 'PRODUCTION_SHADOW',
    SHADOW_CANARY_CONFIRMATION: 'I_APPROVE_READ_ONLY_SHADOW',
    ...overrides,
  }
}

function rowsForReadSmoke() {
  const revisionSnapshot = {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: false }, mar: { activo: false }, mie: { activo: false },
      jue: { activo: true, entrada: '06:00', salida: '14:00' }, vie: { activo: false },
      sab: { activo: false }, dom: { activo: false },
    },
    tolerancia_minutos: 0,
    horario_activo: true,
  }
  return {
    registro_asistencia: [{
      id: REGISTRO, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
      verificado_at: '2026-09-03T16:26:04.000Z', tipo_verificacion: 'entrada', metodo: 'face',
      source_event_id: 'source-event', es_manual: false,
    }],
    empleados: [{ id: EMPLOYEE, cliente_id: TENANT }],
    devices: [{ id: DEVICE, cliente_id: TENANT, timezone: 'America/Cancun' }],
    empleados_horarios: [{
      id: 'assignment-1', cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: SCHEDULE,
      schedule_revision_id: 'revision-1', fecha_inicio: '2026-01-01', fecha_fin: null, activo: true,
    }],
    schedule_revisions: [{
      id: 'revision-1', cliente_id: TENANT, horario_id: SCHEDULE, version: 1,
      config_snapshot: revisionSnapshot, integrity_hash: computeScheduleRevisionIntegrityHash(revisionSnapshot),
    }],
    horarios: [{
      id: SCHEDULE, cliente_id: TENANT, nombre: 'Turno Matutino Industrial', tolerancia_minutos: 0,
      activo: true, dias_config: { jue: { activo: true, entrada: '06:00', salida: '14:00' } },
    }],
  }
}

function fakeClient(rows = rowsForReadSmoke()) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push(['from', table])
      const builder = {
        select(columns) { calls.push(['select', table, columns]); return this },
        eq(column, value) { calls.push(['eq', table, column, value]); return this },
        gte(column, value) { calls.push(['gte', table, column, value]); return this },
        lte(column, value) { calls.push(['lte', table, column, value]); return this },
        in(column, value) { calls.push(['in', table, column, value]); return this },
        or(value) { calls.push(['or', table, value]); return this },
        order(column, options) { calls.push(['order', table, column, options]); return this },
        maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

function smoke(rows) {
  const client = fakeClient(rows)
  return {
    client,
    report: runProductionReadSmoke(REGISTRO, environment(), { createClient: () => client }),
  }
}

test('1. complete backend environment passes the non-network check', () => {
  assert.equal(sanitizedEnvironmentCheck(environment()).envReady, true)
})

test('2. missing SUPABASE_URL fails closed', () => {
  assert.throws(() => readProductionShadowConfig(REGISTRO, environment({ SUPABASE_URL: '' })), /SUPABASE_URL/)
})

test('3. missing service role fails closed', () => {
  assert.throws(() => readProductionShadowConfig(REGISTRO, environment({ SUPABASE_SERVICE_ROLE_KEY: '' })), /SUPABASE_SERVICE_ROLE_KEY/)
})

test('4. allowed host mismatch fails closed', () => {
  assert.throws(() => readProductionShadowConfig(REGISTRO, environment({ SHADOW_CANARY_ALLOWED_HOST: 'wrong.example' })),
    (error) => error instanceof ProductionShadowGuardError && error.code === 'SHADOW_DESTINATION_DENIED')
})

test('5. environment guard mismatch fails closed', () => {
  assert.throws(() => readProductionShadowConfig(REGISTRO, environment({ SHADOW_CANARY_ENVIRONMENT: 'development' })),
    (error) => error.code === 'SHADOW_ENVIRONMENT_DENIED')
})

test('6. confirmation mismatch fails closed', () => {
  assert.throws(() => readProductionShadowConfig(REGISTRO, environment({ SHADOW_CANARY_CONFIRMATION: 'yes' })),
    (error) => error.code === 'SHADOW_CONFIRMATION_DENIED')
})

test('7. a candidate other than the approved UUID fails closed', () => {
  assert.throws(() => readProductionShadowConfig('00000000-0000-4000-8000-000000000000', environment()),
    (error) => error.code === 'SHADOW_CANDIDATE_DENIED')
})

test('8. attendance lookup is tenant-safe and uses no raw payload', async () => {
  const { client, report } = smoke()
  await report
  const select = client.calls.find((call) => call[0] === 'select' && call[1] === 'registro_asistencia')
  assert.match(select[2], /cliente_id/)
  assert.doesNotMatch(select[2], /raw_payload/)
})

test('9. employee lookup is tenant-safe', async () => {
  const { client, report } = smoke()
  await report
  assert.deepEqual(client.calls.filter((call) => call[0] === 'eq' && call[1] === 'empleados'), [
    ['eq', 'empleados', 'id', EMPLOYEE], ['eq', 'empleados', 'cliente_id', TENANT],
  ])
})

test('10. device lookup is tenant-safe', async () => {
  const { client, report } = smoke()
  await report
  assert.deepEqual(client.calls.filter((call) => call[0] === 'eq' && call[1] === 'devices'), [
    ['eq', 'devices', 'id', DEVICE], ['eq', 'devices', 'cliente_id', TENANT],
  ])
})

test('11. real ScheduleResolver resolves exactly the approved tenant schedule', async () => {
  const { report } = smoke()
  assert.equal((await report).scheduleId, SCHEDULE)
})

test('12. event window lookup constrains tenant, employee, and exact timestamps', async () => {
  const { client, report } = smoke()
  await report
  assert.deepEqual(client.calls.filter((call) => call[1] === 'registro_asistencia' && ['eq', 'gte', 'lte'].includes(call[0])).slice(-4), [
    ['eq', 'registro_asistencia', 'cliente_id', TENANT],
    ['eq', 'registro_asistencia', 'empleado_id', EMPLOYEE],
    ['gte', 'registro_asistencia', 'verificado_at', WINDOW_START],
    ['lte', 'registro_asistencia', 'verificado_at', WINDOW_END],
  ])
})

test('13. read-smoke never requests raw_payload', async () => {
  const { client, report } = smoke()
  await report
  assert.equal(client.calls.filter((call) => call[0] === 'select').some((call) => /raw_payload/i.test(call[2])), false)
})

test('14. successful read-smoke reports zero write calls', async () => {
  assert.equal((await smoke().report).writeCalls, 0)
})

test('15. successful read-smoke reports zero persistence calls', async () => {
  assert.equal((await smoke().report).persistenceCalls, 0)
})

test('16. successful read-smoke reports zero RPC write calls', async () => {
  assert.equal((await smoke().report).rpcWriteCalls, 0)
})

test('17. sanitized reports never include the service credential', async () => {
  const serialized = JSON.stringify(await smoke().report)
  assert.doesNotMatch(serialized, /test-only-not-a-real-secret|serviceRoleKey|raw_payload/i)
})

test('18. service role stays inside the backend runner', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.match(source, /backend\/scripts|SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(source, /VITE_|frontend/)
})

test('19. persistence implementation is unreachable from the read-smoke dependency graph', async () => {
  const [runnerSource, orchestratorSource] = await Promise.all([
    readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/services/attendance/AttendanceEngineOrchestrator.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(runnerSource + orchestratorSource, /WorkdayPersistenceService\.js/)
})

test('20. upsert RPC is unreachable from the read-smoke path', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /upsert_workday_record|\.rpc\(/)
})
