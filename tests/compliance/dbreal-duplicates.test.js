import test from 'node:test'
import assert from 'node:assert/strict'
import { AttendanceEngine, localToUtcIso } from '../../src/domain/attendance/index.ts'

const TZ = 'America/Cancun'
const TENANT = 'dbreal-duplicates-tenant'
const EMPLOYEE = 'dbreal-duplicates-employee'
const DATE = '2030-07-02'
const SHIFT = { operativeDate: DATE, startTime: '09:00', endTime: '18:00', toleranceMinutes: 10 }

function punch(id, time, state) {
  const localTime = time.split(':').length === 2 ? `${time}:00` : time
  return { id, clienteId: TENANT, empleadoId: EMPLOYEE, timestamp: localToUtcIso(DATE, localTime, TZ), inOutState: state }
}

function process(rawPunches, options = {}) {
  return AttendanceEngine.process(TENANT, EMPLOYEE, SHIFT, rawPunches, { timezone: TZ, ...options })
}

test('DBREAL duplicates A: exact technical duplicate is traced as DUPLICATE and not paired twice', () => {
  const result = process([
    punch('same-record', '09:00', 0),
    punch('same-record-replay', '09:00', 0),
    punch('out', '18:00', 1),
  ])
  assert.equal(result.sourceLogIds.length, 2)
  assert.equal(result.punchDispositions.filter((d) => d.disposition === 'DUPLICATE').length, 1)
  assert.equal(result.workedMinutes, 540)
})

test('DBREAL duplicates B: different physical IDs at identical timestamp are deterministic', () => {
  const raw = [punch('physical-a', '09:00', 0), punch('physical-b', '09:00', 0), punch('out', '18:00', 1)]
  const first = process(raw)
  const second = process(raw)
  assert.equal(first.integrityHash, second.integrityHash)
  assert.equal(first.sourceLogIds.length, 2)
  assert.equal(first.workedMinutes, 540)
})

test('DBREAL duplicates C: AUTO-equivalent punches two seconds apart are retained as separate cycle evidence', () => {
  const result = process([
    punch('auto-1', '09:00', 0),
    punch('auto-2', '09:00:02', 1),
  ], { deduplication: { minSecondsBetweenPunches: 1, mode: 'KEEP_FIRST' } })
  assert.equal(result.sourceLogIds.length, 2)
  assert.equal(result.workedMinutes, 0)
  assert.equal(result.workdayState, 'COMPLETE')
})

test('DBREAL duplicates D: consecutive explicit entries remain an anomaly', () => {
  const result = process([punch('in-1', '09:00', 0), punch('in-2', '12:00', 0), punch('out', '18:00', 1)])
  assert.ok(result.incidents.some((incident) => incident.code === 'CONSECUTIVE_ENTRY'))
  assert.equal(result.workdayState, 'COMPLETE')
})

test('DBREAL duplicates E: consecutive explicit exits remain an anomaly', () => {
  const result = process([punch('in', '09:00', 0), punch('out-1', '12:00', 1), punch('out-2', '13:00', 1)])
  assert.ok(result.incidents.some((incident) => incident.code === 'CONSECUTIVE_EXIT'))
  assert.equal(result.workdayState, 'COMPLETE')
})
