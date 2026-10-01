/** Local calculator/engine regression; these fixtures do not exercise DBREAL. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { AttendanceEngine, AttendanceNormalizer, ShiftMatcher, WorkdayCalculator, localToUtcIso } from '../../src/domain/attendance/index.ts'

const timezone = 'America/Cancun'
function run(times, kinds, startTime = '09:00', endTime = '18:00') {
  const shift = { operativeDate: '2030-06-10', startTime, endTime, toleranceMinutes: 10 }
  const raw = times.map((time, i) => ({
    id: `p${i}`, clienteId: 'tenant', empleadoId: 'employee',
    timestamp: localToUtcIso(`2030-06-${time < startTime ? '11' : '10'}`, `${time}:00`, timezone),
    inOutState: kinds[i],
  }))
  const normalized = AttendanceNormalizer.normalize(raw, timezone, 'tenant', 'employee')
  const metrics = WorkdayCalculator.calculate(ShiftMatcher.match(shift, normalized.accepted, timezone), timezone)
  const result = AttendanceEngine.process('tenant', 'employee', shift, raw, { timezone })
  assert.equal(result.workedMinutes, metrics.workedMinutes)
  return { metrics, result, raw }
}

for (const [name, times, kinds, start, end, durations, state, early, overtime] of [
  ['A O3', ['22:10', '01:00', '02:00', '05:30'], [0, 1, 0, 1], '22:00', '06:00', [170, 210], 'COMPLETE', 30, 0],
  ['B daytime', ['09:00', '12:00', '13:00', '18:00'], [0, 1, 0, 1], '09:00', '18:00', [180, 300], 'COMPLETE', 0, 0],
  ['C open second cycle', ['09:00', '12:00', '13:00'], [0, 1, 0], '09:00', '18:00', [180], 'INCOMPLETE', 360, 0],
  ['D overnight', ['23:00', '03:00'], [0, 1], '22:00', '06:00', [240], 'COMPLETE', 180, 0],
  ['E simple productive shape', ['09:00', '18:00'], [0, 1], '09:00', '18:00', [540], 'COMPLETE', 0, 60],
  ['F daily overtime', ['09:00', '12:00', '13:00', '19:00'], [0, 1, 0, 1], '09:00', '18:00', [180, 360], 'COMPLETE', 0, 60],
]) {
  test(name, () => {
    const { metrics, result, raw } = run(times, kinds, start, end)
    assert.deepEqual(metrics.segments.map(s => s.durationMinutes), durations)
    assert.equal(metrics.workedMinutes, durations.reduce((a, b) => a + b, 0))
    assert.equal(metrics.actualStart, raw[0].timestamp)
    assert.equal(metrics.actualEnd, raw[kinds.lastIndexOf(1)].timestamp)
    assert.equal(result.workdayState, state)
    assert.equal(metrics.missingExit, state === 'INCOMPLETE')
    assert.equal(metrics.earlyLeaveMinutes, early)
    assert.equal(metrics.overtimeMinutes, overtime)
    assert.equal(metrics.breakMinutes, 0)
    assert.equal(metrics.effectiveMinutes, metrics.workedMinutes)
    assert.equal(metrics.missingEntry, false)
    assert.deepEqual(metrics.segments.map(s => s.segmentType), durations.map(() => 'WORK'))
    assert.deepEqual(metrics.pairingIncidents, [])
    assert.equal(result.actualStart, metrics.actualStart)
    assert.equal(result.actualEnd, metrics.actualEnd)
    assert.equal(result.lateMinutes, metrics.lateMinutes)
    assert.equal(result.earlyLeaveMinutes, early)
    assert.equal(result.overtimeMinutes, overtime)
  })
}

test('late remains measured once from scheduled start', () => {
  const { metrics } = run(['09:15', '12:00', '13:00', '18:00'], [0, 1, 0, 1])
  assert.equal(metrics.lateMinutes, 15)
  assert.equal(metrics.workedMinutes, 465)
})

test('all three closed cycles contribute, excluding intervening gaps', () => {
  const { metrics, result } = run(['09:00', '11:00', '12:00', '14:00', '15:00', '18:00'], [0, 1, 0, 1, 0, 1])
  assert.equal(metrics.workedMinutes, 420)
  assert.deepEqual(metrics.segments.map(s => s.durationMinutes), [120, 120, 180])
  assert.equal(result.workdayState, 'COMPLETE')
})

// Freeze existing behavior only. Phase B must decide the replacement contract.
for (const [name, times, kinds, minutes, first, last] of [
  ['ENTRY ENTRY EXIT', ['09:00', '10:00', '18:00'], [0, 0, 1], 540, 0, 2],
  ['ENTRY EXIT EXIT', ['09:00', '12:00', '18:00'], [0, 1, 1], 180, 0, 1],
  ['EXIT ENTRY EXIT', ['09:00', '10:00', '18:00'], [1, 0, 1], 480, 1, 2],
]) {
  test(`Phase B unchanged: ${name}`, () => {
    const { metrics, result, raw } = run(times, kinds)
    assert.equal(metrics.workedMinutes, minutes)
    assert.equal(metrics.actualStart, raw[first].timestamp)
    assert.equal(metrics.actualEnd, raw[last].timestamp)
    assert.equal(result.workdayState, 'COMPLETE')
    assert.ok(metrics.pairingIncidents.length > 0)
  })
}

test('Phase B unchanged: EXIT alone remains missing entry evidence', () => {
  const { metrics, result } = run(['18:00'], [1])
  assert.equal(metrics.workedMinutes, 0)
  assert.equal(metrics.actualStart, undefined)
  assert.equal(metrics.actualEnd, undefined)
  assert.equal(metrics.missingEntry, true)
  assert.equal(result.workdayState, 'INCOMPLETE')
})

test('UNKNOWN cannot close a canonical ENTRY or contribute another WORK pair', () => {
  const { metrics } = run(['09:00', '12:00', '13:00', '18:00'], [0, null, 0, 1])
  assert.equal(metrics.workedMinutes, 540)
  assert.equal(metrics.segments.length, 1)
  const open = run(['09:00', '12:00'], [0, null]).metrics
  assert.equal(open.workedMinutes, 0)
  assert.equal(open.actualEnd, undefined)
  assert.equal(open.missingExit, true)
})
