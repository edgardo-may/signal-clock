/** Phase 35 exercises the production ENGINE_SHADOW runner with an in-memory read client only. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { computeScheduleRevisionIntegrityHash } from '../../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const require = createRequire(import.meta.url)
const runner = require('../../backend/scripts/run-production-workday-shadow-canary.js')
const {
  APPROVED_REGISTRO_ID: REGISTRO, APPROVED_TENANT_ID: TENANT,
  APPROVED_EMPLOYEE_ID: EMPLOYEE, APPROVED_DEVICE_ID: DEVICE,
  APPROVED_SCHEDULE_ID: SCHEDULE, WINDOW_START, WINDOW_END,
  ProductionShadowGuardError, runProductionEngineShadow,
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

function attendanceEvents() {
  const anchor = {
    id: REGISTRO, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
    verificado_at: '2026-09-03T16:26:04.000Z', tipo_verificacion: 'entrada', metodo: 'face',
    source_event_id: 'source-anchor', es_manual: false,
  }
  const rest = Array.from({ length: 15 }, (_, index) => {
    const eventNumber = index + 1
    return {
      id: `event-${String(eventNumber).padStart(2, '0')}`,
      cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
      verificado_at: `2026-09-03T${String(11 + Math.floor(index / 5)).padStart(2, '0')}:${String((eventNumber * 5) % 60).padStart(2, '0')}:00.000Z`,
      tipo_verificacion: eventNumber <= 6 ? 'entrada' : 'salida', metodo: 'face',
      source_event_id: `source-${eventNumber}`, es_manual: false,
    }
  })
  return [anchor, ...rest]
}

function rows(overrides = {}) {
  const records = attendanceEvents()
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
    registro_asistencia: records,
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
    ...overrides,
  }
}

function fakeClient(data = rows()) {
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
        // The production query is `registro_asistencia.id = approved UUID`;
        // preserve that contract even when the window fixture is reordered.
        maybeSingle: async () => ({
          data: table === 'registro_asistencia'
            ? (data[table] ?? []).find((row) => row.id === REGISTRO) ?? null
            : data[table]?.[0] ?? null,
          error: null,
        }),
        then(resolve, reject) { return Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

function engine(data) {
  const client = fakeClient(data)
  return { client, report: runProductionEngineShadow(REGISTRO, environment(), { createClient: () => client }) }
}

test('1. approved candidate is accepted by ENGINE_SHADOW', async () => {
  assert.equal((await engine().report).registroId, REGISTRO)
})

test('2. alternate candidate is denied', async () => {
  await assert.rejects(() => runProductionEngineShadow('00000000-0000-4000-8000-000000000000', environment(), { createClient: fakeClient }),
    (error) => error instanceof ProductionShadowGuardError && error.code === 'SHADOW_CANDIDATE_DENIED')
})

test('3. engine mode is fixed to SHADOW', async () => {
  assert.equal((await engine().report).mode, 'SHADOW')
})

test('4. PERSIST cannot be selected from the CLI', () => {
  const completed = spawnSync(process.execPath, ['backend/scripts/run-production-workday-shadow-canary.js', '--engine-shadow', '--persist'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
  })
  assert.equal(completed.status, 2)
})

test('5. destination guard remains mandatory', async () => {
  await assert.rejects(() => runProductionEngineShadow(REGISTRO, environment({ SHADOW_CANARY_ALLOWED_HOST: 'wrong.example' }), { createClient: fakeClient }),
    (error) => error.code === 'SHADOW_DESTINATION_DENIED')
})

test('6. attendance is constrained to the approved tenant', async () => {
  const candidate = attendanceEvents()[0]
  candidate.cliente_id = 'other-tenant'
  await assert.rejects(() => engine(rows({ registro_asistencia: [candidate] })).report, /Empresa|tenant|Device/i)
})

test('7. employee lookup fails closed on a tenant mismatch', async () => {
  await assert.rejects(() => engine(rows({ empleados: [{ id: EMPLOYEE, cliente_id: 'other-tenant' }] })).report, /Empresa|tenant/i)
})

test('8. device lookup fails closed on a tenant mismatch', async () => {
  await assert.rejects(() => engine(rows({ devices: [{ id: DEVICE, cliente_id: 'other-tenant', timezone: 'America\/Cancun' }] })).report, /Empresa|tenant/i)
})

test('9. revision lookup fails closed on a tenant mismatch', async () => {
  await assert.rejects(() => engine(rows({ schedule_revisions: [{ ...rows().schedule_revisions[0], cliente_id: 'other-tenant' }] })).report, /tenant|Empresa/i)
})

test('10. an event outside the tenant fails closed', async () => {
  const records = attendanceEvents()
  records[3] = { ...records[3], cliente_id: 'other-tenant' }
  await assert.rejects(() => engine(rows({ registro_asistencia: records })).report, /tenant|Empresa/i)
})

test('11. all 16 events from the real-window-shaped fixture reach the engine', async () => {
  const { client, report } = engine()
  const result = await report
  assert.equal(result.inputEventCount, 16)
  assert.deepEqual(result.inputEventTypes, { entrada: 7, salida: 9 })
  assert.equal(result.normalizedEventCount, 16)
  assert.equal(client.calls.some((call) => call[0] === 'gte' && call[3] === WINDOW_START), true)
  assert.equal(client.calls.some((call) => call[0] === 'lte' && call[3] === WINDOW_END), true)
})

test('12. ordering is deterministic even when storage returns the window reversed', async () => {
  const forward = await engine().report
  const reversed = rows({ registro_asistencia: attendanceEvents().slice().reverse() })
  const anchor = attendanceEvents()[0]
  reversed.registro_asistencia = [anchor, ...reversed.registro_asistencia.filter((event) => event.id !== REGISTRO)]
  const reverseResult = await engine(reversed).report
  for (const field of ['workdayState', 'firstIn', 'lastOut', 'workedMinutes', 'breakMinutes', 'overtimeMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'integrityHash']) {
    assert.deepEqual(reverseResult[field], forward[field])
  }
})

test('13. runner performs and confirms a deterministic replay', async () => {
  assert.equal((await engine().report).deterministicReplay, true)
})

test('14. write call count is zero', async () => assert.equal((await engine().report).writeCalls, 0))
test('15. persistence call count is zero', async () => assert.equal((await engine().report).persistenceCalls, 0))
test('16. RPC write call count is zero', async () => assert.equal((await engine().report).rpcWriteCalls, 0))
test('17. incident write call count is zero', async () => assert.equal((await engine().report).incidentWriteCalls, 0))

test('18. persistence implementation is unreachable from this runner graph', async () => {
  const [runnerSource, orchestratorSource] = await Promise.all([
    readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/services/attendance/AttendanceEngineOrchestrator.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(runnerSource + orchestratorSource, /WorkdayPersistenceService\.js/)
})

test('19. upsert RPC is unreachable', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /upsert_workday_record|\.rpc\(/)
})

test('20. no incident writer is reachable', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /IncidentDetector|incidencias|incidentWriter\.write/i)
})

test('21. raw payload is neither selected for engine reads nor logged', async () => {
  const { client, report } = engine()
  const result = await report
  assert.equal(client.calls.filter((call) => call[0] === 'select').some((call) => /raw_payload/i.test(call[2])), false)
  assert.doesNotMatch(JSON.stringify(result), /raw_payload/i)
})

test('22. credentials are not included in the sanitized result', async () => {
  assert.doesNotMatch(JSON.stringify(await engine().report), /test-only-not-a-real-secret|serviceRoleKey/i)
})

test('23. output contains the required sanitized SHADOW evidence', async () => {
  const output = await engine().report
  for (const field of ['windowStart', 'windowEnd', 'inputEventCount', 'normalizedEventCount', 'calculationVersion', 'workdayState', 'firstIn', 'lastOut', 'integrityHash', 'calculationWarnings']) {
    assert.equal(Object.hasOwn(output, field), true)
  }
})

test('24. domain/engine failures propagate fail closed', async () => {
  await assert.rejects(() => engine(rows({ registro_asistencia: [] })).report, (error) => error.code === 'REGISTRO_NOT_FOUND')
})

test('25. an ambiguous schedule propagates fail closed', async () => {
  const duplicate = { ...rows().empleados_horarios[0], id: 'assignment-2' }
  const schedule2 = { ...rows().horarios[0], id: 'schedule-2' }
  duplicate.horario_id = 'schedule-2'
  await assert.rejects(() => engine(rows({ empleados_horarios: [rows().empleados_horarios[0], duplicate], horarios: [rows().horarios[0], schedule2] })).report,
    (error) => error.code === 'AMBIGUOUS_SCHEDULE')
})

test('26. missing device timezone propagates fail closed', async () => {
  await assert.rejects(() => engine(rows({ devices: [{ id: DEVICE, cliente_id: TENANT, timezone: '' }] })).report,
    (error) => error.code === 'DEVICE_TIMEZONE_MISSING')
})
