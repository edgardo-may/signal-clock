import test from 'node:test'
import assert from 'node:assert/strict'
import { AttendanceEngine, ScheduleResolver, localToUtcIso } from '../../src/domain/attendance/index.ts'
import { computeScheduleRevisionIntegrityHash } from '../../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const TZ = 'America/Cancun'
const TENANT = 'dbreal-overnight-tenant'
const EMPLOYEE = 'dbreal-overnight-employee'

function punch(id, date, time, inOutState) {
  return {
    id,
    clienteId: TENANT,
    empleadoId: EMPLOYEE,
    timestamp: localToUtcIso(date, `${time}:00`, TZ),
    inOutState,
    source: 'DBREAL',
    deviceSerial: 'DBREAL-OVERNIGHT',
  }
}

function shift(operativeDate) {
  return {
    operativeDate,
    startTime: '22:00',
    endTime: '06:00',
    toleranceMinutes: 60,
  }
}

test('DBREAL overnight O1: 23:00 to 03:00 keeps operative date and complete workday', () => {
  const result = AttendanceEngine.process(TENANT, EMPLOYEE, shift('2030-06-10'), [
    punch('o1-in', '2030-06-10', '23:00', 0),
    punch('o1-out', '2030-06-11', '03:00', 1),
  ], { timezone: TZ })

  assert.equal(result.operativeDate, '2030-06-10')
  assert.equal(result.actualStart, '2030-06-11T04:00:00.000Z')
  assert.equal(result.actualEnd, '2030-06-11T08:00:00.000Z')
  assert.equal(result.workdayState, 'COMPLETE')
  assert.equal(result.workedMinutes, 240)
})

test('DBREAL overnight O2: a 09:00 next-day punch remains outside the overnight workday', () => {
  const first = AttendanceEngine.process(TENANT, EMPLOYEE, shift('2030-06-10'), [
    punch('o2-in', '2030-06-10', '23:00', 0),
    punch('o2-out', '2030-06-11', '03:00', 1),
  ], { timezone: TZ })
  const next = AttendanceEngine.process(TENANT, EMPLOYEE, shift('2030-06-11'), [
    punch('o2-next-in', '2030-06-11', '09:00', 0),
  ], { timezone: TZ })

  assert.equal(first.operativeDate, '2030-06-10')
  assert.equal(first.workdayState, 'COMPLETE')
  assert.equal(first.workedMinutes, 240)
  assert.equal(next.operativeDate, '2030-06-11')
  assert.equal(next.actualStart, undefined)
  assert.equal(next.actualEnd, undefined)
  assert.equal(next.workdayState, 'ABSENT')
  assert.equal(next.status, 'ABSENT')
  assert.equal(next.sourceLogIds.includes('o2-next-in'), false)
  assert.equal(next.punchDispositions.find((d) => d.logId === 'o2-next-in')?.disposition, 'OUT_OF_WINDOW')
})

test('DBREAL overnight O2B: a valid daytime assignment resolves a separate incomplete workday', () => {
  const overnightId = 'overnight-assignment'
  const daytimeId = 'daytime-assignment'
  const overnightSchedule = 'overnight-schedule'
  const daytimeSchedule = 'daytime-schedule'
  const overnightRevisionId = 'overnight-revision'
  const daytimeRevisionId = 'daytime-revision'
  const active = (entrada, salida) => ({ activo: true, entrada, salida })
  const inactive = { activo: false }
  const overnightDays = {
    lun: active('22:00', '06:00'), mar: inactive, mie: inactive, jue: inactive,
    vie: inactive, sab: inactive, dom: inactive,
  }
  const daytimeDays = {
    lun: inactive, mar: active('09:00', '18:00'), mie: inactive, jue: inactive,
    vie: inactive, sab: inactive, dom: inactive,
  }
  const makeRevision = (id, scheduleId, days) => {
    const config_snapshot = {
      calculation_contract_version: 1,
      dias_config: days,
      tolerancia_minutos: 10,
      horario_activo: true,
    }
    return {
      id,
      cliente_id: TENANT,
      horario_id: scheduleId,
      version: 1,
      config_snapshot,
      integrity_hash: computeScheduleRevisionIntegrityHash(config_snapshot),
    }
  }
  const assignments = [
    { id: overnightId, cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: overnightSchedule, schedule_revision_id: overnightRevisionId, fecha_inicio: '2030-06-10', fecha_fin: '2030-06-10', activo: true },
    { id: daytimeId, cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: daytimeSchedule, schedule_revision_id: daytimeRevisionId, fecha_inicio: '2030-06-11', fecha_fin: null, activo: true },
  ]
  const resolution = ScheduleResolver.resolve({
    clienteId: TENANT,
    empleadoId: EMPLOYEE,
    candidateDate: '2030-06-11',
    assignments,
    revisions: [
      makeRevision(overnightRevisionId, overnightSchedule, overnightDays),
      makeRevision(daytimeRevisionId, daytimeSchedule, daytimeDays),
    ],
  })
  assert.equal(resolution.kind, 'SCHEDULED')
  assert.equal(resolution.scheduleId, daytimeSchedule)
  assert.equal(resolution.shift.startTime, '09:00')
  assert.equal(resolution.shift.endTime, '18:00')

  const night = AttendanceEngine.process(TENANT, EMPLOYEE, shift('2030-06-10'), [
    punch('o2b-in', '2030-06-10', '23:00', 0),
    punch('o2b-out', '2030-06-11', '03:00', 1),
  ], { timezone: TZ })
  const day = AttendanceEngine.process(TENANT, EMPLOYEE, resolution.shift, [
    punch('o2b-next-in', '2030-06-11', '09:00', 0),
  ], { timezone: TZ })
  assert.equal(night.operativeDate, '2030-06-10')
  assert.equal(night.workdayState, 'COMPLETE')
  assert.equal(night.workedMinutes, 240)
  assert.equal(day.operativeDate, '2030-06-11')
  assert.equal(day.actualStart, '2030-06-11T14:00:00.000Z')
  assert.equal(day.actualEnd, undefined)
  assert.equal(day.workdayState, 'INCOMPLETE')
})

test('DBREAL overnight O3: two work pairs sum real worked minutes', () => {
  const result = AttendanceEngine.process(TENANT, EMPLOYEE, shift('2030-06-10'), [
    punch('o3-in-1', '2030-06-10', '22:10', 0),
    punch('o3-out-1', '2030-06-11', '01:00', 1),
    punch('o3-in-2', '2030-06-11', '02:00', 0),
    punch('o3-out-2', '2030-06-11', '05:30', 1),
  ], { timezone: TZ })

  assert.equal(result.operativeDate, '2030-06-10')
  assert.equal(result.workdayState, 'COMPLETE')
  assert.equal(result.workedMinutes, 380)
})

test('DBREAL multi-pair B: daytime two complete cycles sum 480 minutes', () => {
  const result = AttendanceEngine.process(TENANT, EMPLOYEE, {
    operativeDate: '2030-06-12', startTime: '09:00', endTime: '18:00', toleranceMinutes: 10,
  }, [
    punch('b-in-1', '2030-06-12', '09:00', 0),
    punch('b-out-1', '2030-06-12', '12:00', 1),
    punch('b-in-2', '2030-06-12', '13:00', 0),
    punch('b-out-2', '2030-06-12', '18:00', 1),
  ], { timezone: TZ })
  assert.equal(result.workedMinutes, 480)
  assert.equal(result.workdayState, 'COMPLETE')
})

test('DBREAL multi-pair C: an open final cycle keeps completed minutes and incomplete state', () => {
  const result = AttendanceEngine.process(TENANT, EMPLOYEE, {
    operativeDate: '2030-06-12', startTime: '09:00', endTime: '18:00', toleranceMinutes: 10,
  }, [
    punch('c-in-1', '2030-06-12', '09:00', 0),
    punch('c-out-1', '2030-06-12', '12:00', 1),
    punch('c-in-2', '2030-06-12', '13:00', 0),
  ], { timezone: TZ })
  assert.equal(result.workedMinutes, 180)
  assert.equal(result.workdayState, 'INCOMPLETE')
  assert.equal(result.actualEnd, '2030-06-12T17:00:00.000Z')
})

test('DBREAL multi-pair E: simple IN/OUT remains unchanged', () => {
  const result = AttendanceEngine.process(TENANT, EMPLOYEE, {
    operativeDate: '2030-06-12', startTime: '09:00', endTime: '18:00', toleranceMinutes: 10,
  }, [
    punch('e-in', '2030-06-12', '09:00', 0),
    punch('e-out', '2030-06-12', '18:00', 1),
  ], { timezone: TZ })
  assert.equal(result.workedMinutes, 540)
  assert.equal(result.workdayState, 'COMPLETE')
})
