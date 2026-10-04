import test from 'node:test'
import assert from 'node:assert/strict'
import { AttendanceEngine, localToUtcIso } from '../../src/domain/attendance/index.ts'

const TZ = 'America/Cancun'
const TENANT = 'dbreal-multiple-tenant'
const EMPLOYEE = 'dbreal-multiple-employee'
const DATE = '2030-07-01'
const SHIFT = { operativeDate: DATE, startTime: '09:00', endTime: '18:00', toleranceMinutes: 10 }

function run(id, sequence, times = ['09:00', '12:00', '13:00', '18:00']) {
  const punches = sequence.map((kind, index) => ({
    id: `${id}-${index}`,
    clienteId: TENANT,
    empleadoId: EMPLOYEE,
    timestamp: localToUtcIso(DATE, times[index], TZ),
    inOutState: kind === 'IN' ? 0 : 1,
  }))
  return AttendanceEngine.process(TENANT, EMPLOYEE, SHIFT, punches, { timezone: TZ })
}

test('DBREAL multiple punches M1: IN/OUT is one complete pair', () => {
  const result = run('m1', ['IN', 'OUT'], ['09:00', '12:00'])
  assert.equal(result.workedMinutes, 180)
  assert.equal(result.workdayState, 'COMPLETE')
  assert.equal(result.missingEntry, false)
  assert.equal(result.missingExit, false)
})

test('DBREAL multiple punches M2: IN/OUT/IN/OUT sums both complete pairs', () => {
  const result = run('m2', ['IN', 'OUT', 'IN', 'OUT'])
  assert.equal(result.workedMinutes, 480)
  assert.equal(result.segments.filter((segment) => segment.segmentType === 'WORK').length, 2)
  assert.equal(result.workdayState, 'COMPLETE')
})

test('DBREAL multiple punches M3: IN/IN/OUT retains ambiguity and current canonical fallback', () => {
  const result = run('m3', ['IN', 'IN', 'OUT'], ['09:00', '12:00', '13:00'])
  assert.equal(result.workedMinutes, 240)
  assert.equal(result.workdayState, 'COMPLETE')
  assert.equal(result.missingExit, false)
  assert.ok(result.incidents.some((incident) => incident.code === 'CONSECUTIVE_ENTRY'))
})

test('DBREAL multiple punches M4: IN/OUT/OUT preserves the orphan exit warning', () => {
  const result = run('m4', ['IN', 'OUT', 'OUT'], ['09:00', '12:00', '13:00'])
  assert.equal(result.workedMinutes, 180)
  assert.equal(result.workdayState, 'COMPLETE')
  assert.equal(result.missingEntry, false)
  assert.ok(result.incidents.some((incident) => incident.code === 'CONSECUTIVE_EXIT'))
})

test('DBREAL multiple punches M5: IN/OUT/IN keeps completed work and open-cycle incomplete state', () => {
  const result = run('m5', ['IN', 'OUT', 'IN'], ['09:00', '12:00', '13:00'])
  assert.equal(result.workedMinutes, 180)
  assert.equal(result.workdayState, 'INCOMPLETE')
  assert.equal(result.missingExit, true)
})

test('DBREAL multiple punches M6: EXIT first is incomplete with missing entry', () => {
  const result = run('m6', ['OUT'], ['09:00'])
  assert.equal(result.workedMinutes, 0)
  assert.equal(result.workdayState, 'INCOMPLETE')
  assert.equal(result.missingEntry, true)
  assert.equal(result.missingExit, false)
})

test('DBREAL multiple punches M7: four AUTO-resolved directions behave as two cycles', () => {
  const result = run('m7', ['IN', 'OUT', 'IN', 'OUT'])
  assert.equal(result.workedMinutes, 480)
  assert.equal(result.workdayState, 'COMPLETE')
})

test('DBREAL multiple punches M8: input order is normalized before current pairing contract', () => {
  const result = run('m8', ['OUT', 'IN'], ['12:00', '09:00'])
  assert.equal(result.workedMinutes, 180)
  assert.equal(result.workdayState, 'COMPLETE')
  assert.equal(result.missingEntry, false)
  assert.equal(result.missingExit, false)
})
