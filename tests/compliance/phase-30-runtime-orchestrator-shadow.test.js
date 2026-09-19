/**
 * Phase 30 uses an in-memory backend repository only. It never contacts a
 * Supabase project, creates workday rows, or writes incidents.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const {
  AttendanceEngineOrchestrator,
  AttendanceOrchestratorError,
  DEFAULT_MODE,
  revisionObservabilityErrorCode,
} = require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')
const { WorkdayPersistenceService } = require('../../backend/services/attendance/WorkdayPersistenceService.js')

const TENANT = 'tenant-a'
const OTHER_TENANT = 'tenant-b'
const EMPLOYEE = 'employee-a'
const TZ = 'America/Cancun'

function at(date, time) {
  return domain.localToUtcIso(date, time, TZ)
}

function registro(id, localDate, localTime, type, overrides = {}) {
  return {
    id,
    cliente_id: TENANT,
    empleado_id: EMPLOYEE,
    dispositivo_id: 'device-a',
    verificado_at: at(localDate, localTime),
    tipo_verificacion: type,
    metodo: 'face',
    source_event_id: `source-${id}`,
    raw_payload: { must_not_be_used_for_relations: true },
    es_manual: false,
    ...overrides,
  }
}

function weekday(date) {
  return ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][new Date(`${date}T00:00:00.000Z`).getUTCDay()]
}

function revision(overrides = {}) {
  const { id: suppliedHorarioId, dias_config: dayOverrides, tolerancia_minutos: toleranceOverride, activo: activeOverride, ...recordOverrides } = overrides
  const horarioId = suppliedHorarioId || 'schedule-a'
  const config_snapshot = {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: false }, mar: { activo: false }, mie: { activo: false }, jue: { activo: false },
      vie: { activo: true, entrada: '08:00', salida: '17:00' }, sab: { activo: false }, dom: { activo: false }, ...(dayOverrides || {}),
    },
    tolerancia_minutos: toleranceOverride ?? 10,
    horario_activo: activeOverride ?? true,
  }
  return {
    id: `revision-${horarioId}`, cliente_id: TENANT, horario_id: horarioId, version: 1,
    config_snapshot, integrity_hash: domain.computeScheduleRevisionIntegrityHash(config_snapshot), ...recordOverrides,
  }
}

function assignment(overrides = {}) {
  const { horario_id: horarioIdOverride, schedule_revision_id: revisionIdOverride, ...rest } = overrides
  const horarioId = horarioIdOverride || 'schedule-a'
  return {
    id: 'assignment-a', cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: horarioId, schedule_revision_id: revisionIdOverride || `revision-${horarioId}`,
    fecha_inicio: '2026-01-01', fecha_fin: null, activo: true, ...rest,
  }
}

function memoryRepository({ records, devices, employee, assignments, revisions }) {
  return {
    async loadRegistro(id) { return records.find((record) => record.id === id) || null },
    async loadDevice({ deviceId }) { return devices.find((device) => device.id === deviceId) || null },
    async loadEmployee() { return employee },
    async loadScheduleContext() { return { assignments, revisions } },
    async loadAttendanceEvents({ clienteId, empleadoId, startUtc, endUtc }) {
      return records.filter((record) => record.cliente_id === clienteId && record.empleado_id === empleadoId &&
        new Date(record.verificado_at) >= new Date(startUtc) && new Date(record.verificado_at) <= new Date(endUtc))
    },
    async loadDevices({ deviceIds }) { return devices.filter((device) => deviceIds.includes(device.id)) },
  }
}

function fixture(overrides = {}) {
  const records = overrides.records || [
    registro('in', '2026-09-04', '08:00', 'entrada'),
    registro('out', '2026-09-04', '17:00', 'salida'),
  ]
  return {
    records,
    devices: overrides.devices || [{ id: 'device-a', cliente_id: TENANT, timezone: TZ }],
    employee: overrides.employee === undefined ? { id: EMPLOYEE, cliente_id: TENANT } : overrides.employee,
    assignments: overrides.assignments === undefined ? [assignment()] : overrides.assignments,
    revisions: overrides.revisions === undefined ? [revision()] : overrides.revisions,
  }
}

function orchestrator(data = fixture(), options = {}) {
  const logs = []
  return {
    logs,
    instance: new AttendanceEngineOrchestrator({
      repository: memoryRepository(data), domain, logger: { info: (_name, value) => logs.push(value), error: () => {} }, ...options,
    }),
  }
}

test('1. default backend configuration is SHADOW execution with READ_ONLY persistence', () => {
  assert.equal(DEFAULT_MODE, 'SHADOW')
  assert.equal(orchestrator().instance.executionMode, 'SHADOW')
  assert.equal(orchestrator().instance.persistenceMode, 'READ_ONLY')
})

test('2. normal entry resolves an incomplete workday without writes', async () => {
  const { instance } = orchestrator(fixture({ records: [registro('in', '2026-09-04', '08:00', 'entrada')] }))
  const result = await instance.run({ registroId: 'in' })
  assert.equal(result.operativeDate, '2026-09-04')
  assert.equal(result.workdayRecord.status, 'INCOMPLETE')
  assert.equal(result.persistenceResult, undefined)
})

test('3. normal exit resolves entry plus exit into one complete workday', async () => {
  const result = await orchestrator().instance.run({ registroId: 'out' })
  assert.equal(result.operativeDate, '2026-09-04')
  assert.equal(result.workdayRecord.status, 'COMPLETE')
  assert.equal(result.workdayRecord.worked_minutes, 540)
})

test('4. 2026-09-04 22:00 through 2026-09-05 06:00 belongs to Sep 4', async () => {
  const records = [
    registro('night-in', '2026-09-04', '22:00', 'entrada'),
    registro('night-out', '2026-09-05', '06:00', 'salida'),
  ]
  const result = await orchestrator(fixture({
    records,
    revisions: [revision({ id: 'night', dias_config: { vie: { activo: true, entrada: '22:00', salida: '06:00' } } })],
    assignments: [assignment({ horario_id: 'night' })],
  })).instance.run({ registroId: 'night-out' })
  assert.equal(result.operativeDate, '2026-09-04')
  assert.equal(result.workdayRecord.workday_date, '2026-09-04')
  assert.equal(result.workdayRecord.worked_minutes, 480)
})

test('5. device from another Empresa fails closed', async () => {
  const { instance } = orchestrator(fixture({ devices: [{ id: 'device-a', cliente_id: OTHER_TENANT, timezone: TZ }] }))
  await assert.rejects(() => instance.run({ registroId: 'in' }), (error) => error.code === 'TENANT_MISMATCH')
})

test('6. employee from another Empresa fails closed', async () => {
  const { instance } = orchestrator(fixture({ employee: { id: EMPLOYEE, cliente_id: OTHER_TENANT } }))
  await assert.rejects(() => instance.run({ registroId: 'in' }), (error) => error.code === 'TENANT_MISMATCH')
})

test('7. revision from another Empresa fails closed', async () => {
  const { instance } = orchestrator(fixture({ revisions: [revision({ cliente_id: OTHER_TENANT })] }))
  await assert.rejects(() => instance.run({ registroId: 'in' }), (error) => error.code === 'SCHEDULE_REVISION_TENANT_MISMATCH')
})

test('8. multiple valid schedules fail closed as AMBIGUOUS_SCHEDULE', async () => {
  const { instance } = orchestrator(fixture({
    assignments: [assignment(), assignment({ id: 'assignment-b', horario_id: 'schedule-b' })],
    revisions: [revision(), revision({ id: 'schedule-b' })],
  }))
  await assert.rejects(() => instance.run({ registroId: 'in' }), (error) => error.code === 'AMBIGUOUS_SCHEDULE')
})

test('9. no applicable schedule uses the explicit UNSCHEDULED contract', async () => {
  const result = await orchestrator(fixture({ assignments: [], revisions: [] })).instance.run({ registroId: 'out' })
  assert.equal(result.workdayRecord.status, 'UNSCHEDULED')
  assert.equal(result.workdayRecord.schedule_id, null)
})

test('10. SHADOW never calls PersistenceService', async () => {
  let calls = 0
  const result = await orchestrator(fixture(), { persistenceService: { persist: async () => { calls++ } } }).instance.run({ registroId: 'out' })
  assert.equal(result.executionMode, 'SHADOW')
  assert.equal(result.persistenceMode, 'READ_ONLY')
  assert.equal(calls, 0)
})

for (const outcome of ['INSERTED', 'UPDATED', 'UNCHANGED']) {
  test(`11-${outcome}. V3 persistence boundary handles ${outcome} safely`, async () => {
    let calls = 0
    const run = orchestrator(fixture(), {
      mode: 'PERSIST',
      persistenceService: new WorkdayPersistenceService({ rpc: async () => {
        calls++
        return {
          data: [{ workday_id: 'workday-1', persistence_result: outcome, integrity_hash: 'server-hash' }],
          error: null,
        }
      } }),
    }).instance.run({ registroId: 'out' })
    if (outcome === 'UPDATED') {
      await assert.rejects(() => run, (error) => error.code === 'PERSISTENCE_FAILED')
    } else {
      const result = await run
      assert.equal(result.persistenceResult, outcome)
      assert.equal(result.workdayId, 'workday-1')
    }
    assert.equal(calls, 1)
  })
}

test('14. PERSIST persistence error fails closed without fallback', async () => {
  const { instance } = orchestrator(fixture(), {
    mode: 'PERSIST', persistenceService: new WorkdayPersistenceService({ rpc: async () => ({
      data: null, error: { message: 'rpc denied' },
    }) }),
  })
  await assert.rejects(() => instance.run({ registroId: 'out' }), (error) =>
    error instanceof AttendanceOrchestratorError && error.code === 'PERSISTENCE_FAILED'
  )
})

test('15. identical SHADOW context has the same operative date, metrics, state, and hash', async () => {
  const { instance } = orchestrator()
  const first = await instance.run({ registroId: 'out' })
  const second = await instance.run({ registroId: 'out' })
  assert.deepEqual(
    [first.operativeDate, first.workdayRecord.worked_minutes, first.workdayRecord.status, first.workdayRecord.integrity_hash],
    [second.operativeDate, second.workdayRecord.worked_minutes, second.workdayRecord.status, second.workdayRecord.integrity_hash]
  )
})

test('16. structured log excludes raw payload and includes required calculation metadata', async () => {
  const { instance, logs } = orchestrator()
  await instance.run({ registroId: 'out' })
  assert.equal(logs.length, 1)
  assert.equal(logs[0].registroId, 'out')
  assert.equal(logs[0].execution_mode, 'SHADOW')
  assert.equal(logs[0].persistence_mode, 'READ_ONLY')
  assert.equal(Object.hasOwn(logs[0], 'raw_payload'), false)
  assert.equal(Object.hasOwn(logs[0], 'templates'), false)
  assert.deepEqual({
    tenant_id: logs[0].tenant_id, employee_id: logs[0].employee_id, operative_date: logs[0].operative_date,
    assignment_id: logs[0].assignment_id, schedule_revision_id: logs[0].schedule_revision_id,
    revision_version: logs[0].revision_version, resolution_mode: logs[0].resolution_mode,
    resolution_result: logs[0].resolution_result, error_code: logs[0].error_code,
  }, {
    tenant_id: TENANT, employee_id: EMPLOYEE, operative_date: '2026-09-04',
    assignment_id: 'assignment-a', schedule_revision_id: 'revision-schedule-a',
    revision_version: 1, resolution_mode: 'REVISION', resolution_result: 'SCHEDULED', error_code: null,
  })
})

test('17. revision-resolution failures receive stable, secret-free observability codes', () => {
  assert.equal(revisionObservabilityErrorCode('SCHEDULE_REVISION_REQUIRED'), 'REVISION_MISSING')
  assert.equal(revisionObservabilityErrorCode('SCHEDULE_REVISION_HASH_MISMATCH'), 'REVISION_HASH_MISMATCH')
  assert.equal(revisionObservabilityErrorCode('SCHEDULE_REVISION_TENANT_MISMATCH'), 'REVISION_TENANT_MISMATCH')
  assert.equal(revisionObservabilityErrorCode('SCHEDULE_REVISION_SCHEDULE_MISMATCH'), 'REVISION_SCHEDULE_MISMATCH')
  assert.equal(revisionObservabilityErrorCode('SCHEDULE_REVISION_CONTRACT_VERSION_UNSUPPORTED'), 'REVISION_VERSION_UNSUPPORTED')
  assert.equal(revisionObservabilityErrorCode('SCHEDULE_REVISION_SNAPSHOT_INVALID'), 'REVISION_CONFIG_INVALID')
  assert.equal(revisionObservabilityErrorCode('AMBIGUOUS_SCHEDULE'), 'MULTIPLE_APPLICABLE_ASSIGNMENTS')
})

test('18. orchestrator does not use the deprecated status type', async () => {
  const source = await readFile(new URL('../../backend/services/attendance/AttendanceEngineOrchestrator.js', import.meta.url), 'utf8')
  assert.equal(source.includes('Workday' + 'Status'), false)
  assert.match(source, /toWorkdayRecordWriteModel/)
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/)
})
