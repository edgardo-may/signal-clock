/** Phase 35.4: canonical attendance is first ENTRY + first later EXIT. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as domain from '../../src/domain/attendance/index.ts'

const TENANT = 'canonical-tenant'
const EMPLOYEE = 'canonical-employee'
const TIMEZONE = 'America/Cancun'
const SHIFT = {
  id: 'canonical-schedule', operativeDate: '2026-09-03',
  startTime: '06:00', endTime: '14:00', toleranceMinutes: 5, hasBreak: false,
}

function punch(id, timestamp, inOutState) {
  return { id, clienteId: TENANT, empleadoId: EMPLOYEE, timestamp, inOutState }
}

/** Sanitized equivalent shape of the 16-event production evidence. */
function realShapeFixture() {
  return [
    punch('7f99cef9-4100-48ff-9aaf-68548c80c948', '2026-09-03T16:26:04.000Z', 'entrada'),
    punch('entry-02', '2026-09-03T16:50:00.000Z', 'entrada'),
    punch('entry-03', '2026-09-03T17:05:00.000Z', 'entrada'),
    punch('entry-04', '2026-09-03T17:15:00.000Z', 'entrada'),
    punch('entry-05', '2026-09-03T17:25:00.000Z', 'entrada'),
    punch('entry-06', '2026-09-03T17:34:00.000Z', 'entrada'),
    punch('1c306739-220d-436a-b7e6-9d2c66aa9003', '2026-09-03T17:55:13.000Z', 'salida'),
    punch('entry-07', '2026-09-03T18:02:00.000Z', 'entrada'),
    punch('exit-02', '2026-09-03T19:07:00.000Z', 'salida'),
    punch('exit-03', '2026-09-03T19:15:00.000Z', 'salida'),
    punch('exit-04', '2026-09-03T19:25:00.000Z', 'salida'),
    punch('exit-05', '2026-09-03T19:35:00.000Z', 'salida'),
    punch('exit-06', '2026-09-03T19:45:00.000Z', 'salida'),
    punch('exit-07', '2026-09-03T19:55:00.000Z', 'salida'),
    punch('exit-08', '2026-09-03T20:05:00.000Z', 'salida'),
    punch('exit-09', '2026-09-03T20:15:00.000Z', 'salida'),
  ]
}

function calculate(raw = realShapeFixture()) {
  const normalized = domain.AttendanceNormalizer.normalize(raw, TIMEZONE, TENANT, EMPLOYEE)
  const match = domain.ShiftMatcher.match(SHIFT, normalized.accepted, TIMEZONE)
  return { normalized, match, metrics: domain.WorkdayCalculator.calculate(match, TIMEZONE) }
}

function processed(raw = realShapeFixture()) {
  return domain.AttendanceEngine.process(TENANT, EMPLOYEE, SHIFT, raw, { timezone: TIMEZONE })
}

test('1. first of consecutive ENTRY events wins canonically', () => assert.equal(calculate().metrics.actualStart, '2026-09-03T16:26:04.000Z'))
test('2. later ENTRY does not replace firstIn', () => assert.notEqual(calculate().metrics.actualStart, '2026-09-03T17:34:00.000Z'))
test('3. first EXIT after firstIn wins canonically', () => assert.equal(calculate().metrics.actualEnd, '2026-09-03T17:55:13.000Z'))
test('4. later EXIT does not replace firstOut', () => assert.notEqual(calculate().metrics.actualEnd, '2026-09-03T20:15:00.000Z'))
test('5. EXIT before firstIn is not a canonical out', () => {
  const { metrics } = calculate([punch('early-exit', '2026-09-03T10:55:00.000Z', 'salida'), punch('in', '2026-09-03T11:00:00.000Z', 'entrada'), punch('out', '2026-09-03T19:00:00.000Z', 'salida')])
  assert.equal(metrics.actualEnd, '2026-09-03T19:00:00.000Z')
  assert.equal(metrics.supplementalEvents[0].reason, 'EXIT_BEFORE_FIRST_IN')
})
test('6. supplemental ENTRY is retained', () => assert.equal(calculate().metrics.supplementalEvents.some((event) => event.reason === 'ADDITIONAL_ENTRY'), true))
test('7. supplemental EXIT is retained', () => assert.equal(calculate().metrics.supplementalEvents.some((event) => event.reason === 'ADDITIONAL_EXIT'), true))
test('8. supplemental entries do not alter firstIn', () => assert.equal(calculate().metrics.actualStart, realShapeFixture()[0].timestamp))
test('9. supplemental exits do not alter firstOut', () => assert.equal(calculate().metrics.actualEnd, realShapeFixture()[6].timestamp))
test('10. supplemental events do not alter canonical workedMinutes', () => assert.equal(calculate().metrics.workedMinutes, 89))
test('11. supplemental events do not alter lateMinutes', () => assert.equal(calculate().metrics.lateMinutes, 326))
test('12. supplemental events do not alter earlyLeaveMinutes', () => assert.equal(calculate().metrics.earlyLeaveMinutes, 65))
test('13. later orphan entry cannot make a canonical day incomplete', () => assert.equal(processed().workdayState, 'COMPLETE'))
test('14. missing firstOut remains incomplete', () => assert.equal(processed([punch('in-only', '2026-09-03T16:26:04.000Z', 'entrada')]).workdayState, 'INCOMPLETE'))
test('15. break is not inferred from supplemental punches', () => assert.equal(calculate().metrics.breakMinutes, 0))
test('16. workedMinutes is the canonical interval only', () => assert.equal(calculate().metrics.segments[0].durationMinutes, calculate().metrics.workedMinutes))
test('17. overtime follows canonical worked time', () => assert.equal(calculate().metrics.overtimeMinutes, 0))
test('18. sanitized real-shape fixture has 16 events', () => assert.equal(realShapeFixture().length, 16))
test('19. exactly fourteen supplemental events are preserved', () => assert.equal(calculate().metrics.supplementalEvents.length, 14))
test('20. replay is deterministic', () => assert.deepEqual(calculate().metrics, calculate().metrics))
test('21. version-three integrity hash is deterministic', () => assert.equal(processed().integrityHash, processed().integrityHash))
test('22. warnings contain only sanitized codes', () => assert.deepEqual(domain.pairingWarningCodes(calculate().metrics), ['CONSECUTIVE_ENTRY', 'CONSECUTIVE_EXIT', 'ADDITIONAL_ENTRY', 'ADDITIONAL_EXIT']))
test('23. canonical calculation has no write capability', () => assert.equal(typeof domain.WorkdayCalculator.persist, 'undefined'))
test('24. production shadow runner has no persistence implementation dependency', () => {
  const source = fs.readFileSync(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.equal(source.includes('WorkdayPersistenceService'), false)
  assert.equal(source.includes('upsert_workday_record'), false)
})
