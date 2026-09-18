/**
 * Phase 26 contract tests. These operate only on in-memory records and never
 * connect the engine, adapters, or persistence contract to Supabase.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RegistroAttendanceAdapter,
  ScheduleResolver,
  AmbiguousScheduleError,
  ShiftMatcher,
  computeScheduleRevisionIntegrityHash,
  localToUtcIso,
  toWorkdayRecordWriteModel,
} from '../../src/domain/attendance/index.ts'

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const EMPLOYEE_A = 'employee-a'
const TIMEZONE = 'America/Cancun'
const DATE = '2026-09-04' // Friday

function assignment(overrides = {}) {
  const { horario_id: horarioIdOverride, schedule_revision_id: revisionIdOverride, ...rest } = overrides
  const horarioId = horarioIdOverride || 'schedule-a'
  return {
    id: 'assignment-a',
    cliente_id: TENANT_A,
    empleado_id: EMPLOYEE_A,
    horario_id: horarioId,
    schedule_revision_id: revisionIdOverride || `revision-${horarioId}`,
    fecha_inicio: '2026-01-01',
    fecha_fin: null,
    activo: true,
    ...rest,
  }
}

function schedule(overrides = {}) {
  const { id: suppliedHorarioId, dias_config: dayOverrides, tolerancia_minutos: toleranceOverride, activo: activeOverride, ...recordOverrides } = overrides
  const horarioId = suppliedHorarioId || 'schedule-a'
  const config_snapshot = {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: false }, mar: { activo: false }, mie: { activo: false }, jue: { activo: false },
      vie: { activo: true, entrada: '08:00', salida: '17:00' }, sab: { activo: false }, dom: { activo: false },
      ...(dayOverrides || {}),
    },
    tolerancia_minutos: toleranceOverride ?? 10,
    horario_activo: activeOverride ?? true,
  }
  return {
    id: `revision-${horarioId}`,
    cliente_id: TENANT_A,
    horario_id: horarioId,
    version: 1,
    config_snapshot,
    integrity_hash: computeScheduleRevisionIntegrityHash(config_snapshot),
    ...recordOverrides,
  }
}

function resolve(assignments, schedules, candidateDate = DATE) {
  return ScheduleResolver.resolve({
    clienteId: TENANT_A,
    empleadoId: EMPLOYEE_A,
    candidateDate,
    assignments,
    revisions: schedules,
  })
}

function normalizedPunch(id, timestamp) {
  return {
    id,
    clienteId: TENANT_A,
    empleadoId: EMPLOYEE_A,
    utcTimestamp: timestamp,
    epochMs: new Date(timestamp).getTime(),
    localDate: DATE,
    localTime: '00:00:00',
    localMinutesOfDay: 0,
    inOutType: 'UNSPECIFIED',
    direction: 'UNKNOWN',
    source: 'ADMS',
  }
}

function calculationResult(overrides = {}) {
  return {
    clienteId: TENANT_A,
    empleadoId: EMPLOYEE_A,
    operativeDate: DATE,
    timezone: TIMEZONE,
    shiftType: 'DIURNA',
    isRestDay: false,
    isHoliday: false,
    scheduledMinutes: 540,
    actualStart: localToUtcIso(DATE, '08:00', TIMEZONE),
    actualEnd: localToUtcIso(DATE, '17:00', TIMEZONE),
    workedMinutes: 540,
    breakMinutes: 0,
    effectiveMinutes: 540,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    ordinaryMinutes: 480,
    overtimeMinutes: 60,
    nightShiftMinutes: 0,
    workdayState: 'COMPLETE',
    // Deliberately different: the baseline must persist workdayState instead.
    status: 'LATE',
    missingEntry: false,
    missingExit: false,
    segments: [],
    sourceLogIds: ['registro-1'],
    punchDispositions: [],
    devicesInvolved: ['device-a'],
    warnings: [],
    incidents: [],
    calculationVersion: 1,
    integrityHash: 'phase-26-integrity-hash',
    ...overrides,
  }
}

test('1. ZKTeco physical record resolves timezone from its same-tenant device', () => {
  const event = RegistroAttendanceAdapter.fromRegistro(
    {
      id: 'registro-1',
      cliente_id: TENANT_A,
      empleado_id: EMPLOYEE_A,
      dispositivo_id: 'device-a',
      verificado_at: '2026-09-04T13:00:00.000Z',
      tipo_verificacion: 'entrada',
      metodo: 'face',
      source_event_id: 'source-1',
      raw_payload: { ignored_for_relations: true },
      es_manual: false,
    },
    { id: 'device-a', cliente_id: TENANT_A, timezone: TIMEZONE }
  )

  assert.equal(event.timezone, TIMEZONE)
  assert.equal(event.localEventDate, DATE)
  assert.equal(event.rawPunch.inOutState, 'entrada')
  assert.equal(event.rawPunch.source, 'ADMS')
  assert.equal(event.sourceEventId, 'source-1')
})

test('2. a device from another Empresa fails closed', () => {
  assert.throws(
    () => RegistroAttendanceAdapter.fromRegistro(
      {
        id: 'registro-1', cliente_id: TENANT_A, empleado_id: EMPLOYEE_A,
        dispositivo_id: 'device-b', verificado_at: '2026-09-04T13:00:00.000Z',
        tipo_verificacion: 'entrada', metodo: 'face', source_event_id: null,
        raw_payload: null, es_manual: false,
      },
      { id: 'device-b', cliente_id: TENANT_B, timezone: TIMEZONE }
    ),
    (error) => error?.code === 'TENANT_MISMATCH'
  )
})

test('3. an employee with no applicable schedule is UNSCHEDULED', () => {
  assert.deepEqual(resolve([], []), { kind: 'UNSCHEDULED', candidateDate: DATE })
})

test('4. one valid schedule resolves horarios.id as the persisted schedule id', () => {
  const result = resolve([assignment()], [schedule()])
  assert.equal(result.kind, 'SCHEDULED')
  assert.equal(result.scheduleId, 'schedule-a')
  assert.equal(result.scheduleAssignmentId, 'assignment-a')
  assert.equal(result.shift.operativeDate, DATE)
})

test('5. more than one valid schedule fails closed as AMBIGUOUS_SCHEDULE', () => {
  assert.throws(
    () => resolve(
      [assignment(), assignment({ id: 'assignment-b', horario_id: 'schedule-b' })],
      [schedule(), schedule({ id: 'schedule-b' })]
    ),
    (error) => error instanceof AmbiguousScheduleError && error.code === 'AMBIGUOUS_SCHEDULE'
  )
})

test('6. an assignment outside its validity period is not used', () => {
  assert.deepEqual(
    resolve([assignment({ fecha_inicio: '2026-09-05' })], [schedule()]),
    { kind: 'UNSCHEDULED', candidateDate: DATE }
  )
})

test('7. a schedule belonging to another Empresa fails closed', () => {
  assert.throws(
    () => resolve([assignment()], [schedule({ cliente_id: TENANT_B })]),
    (error) => error?.code === 'SCHEDULE_REVISION_TENANT_MISMATCH'
  )
})

test('8. a normal 08:00–17:00 schedule keeps its requested operative date', () => {
  const resolved = resolve([assignment()], [schedule()])
  assert.equal(resolved.kind, 'SCHEDULED')
  const match = ShiftMatcher.match(
    resolved.shift,
    [
      normalizedPunch('in', localToUtcIso(DATE, '08:00', TIMEZONE)),
      normalizedPunch('out', localToUtcIso(DATE, '17:00', TIMEZONE)),
    ],
    TIMEZONE
  )
  assert.equal(match.operativeDate, DATE)
  assert.equal(match.crossesMidnight, false)
  assert.equal(match.matchedPunches.length, 2)
})

test('9. a 22:00–06:00 shift assigns both events to the entry date', () => {
  const overnight = schedule({
    id: 'schedule-night',
    dias_config: { vie: { activo: true, entrada: '22:00', salida: '06:00' } },
  })
  const resolved = resolve([assignment({ horario_id: 'schedule-night' })], [overnight])
  assert.equal(resolved.kind, 'SCHEDULED')
  const match = ShiftMatcher.match(
    resolved.shift,
    [
      normalizedPunch('in', localToUtcIso('2026-09-04', '22:00', TIMEZONE)),
      normalizedPunch('out', localToUtcIso('2026-09-05', '06:00', TIMEZONE)),
    ],
    TIMEZONE
  )
  assert.equal(match.operativeDate, '2026-09-04')
  assert.equal(match.crossesMidnight, true)
  assert.equal(match.matchedPunches.length, 2)
})

test('10. a reprocess preserves the same logical identity even when schedule evidence changes', () => {
  const original = toWorkdayRecordWriteModel(calculationResult(), 'schedule-a')
  const reprocessed = toWorkdayRecordWriteModel(calculationResult(), 'schedule-b')
  assert.deepEqual(
    [original.cliente_id, original.empleado_id, original.workday_date],
    [reprocessed.cliente_id, reprocessed.empleado_id, reprocessed.workday_date]
  )
  assert.notEqual(original.schedule_id, reprocessed.schedule_id)
})

test('11. workday persistence maps WorkdayState and never deprecated WorkdayStatus', () => {
  const model = toWorkdayRecordWriteModel(calculationResult({ workdayState: 'INCOMPLETE', status: 'LATE' }), 'schedule-a')
  assert.equal(model.status, 'INCOMPLETE')
  assert.equal(Object.hasOwn(model, 'workday_status'), false)
})
