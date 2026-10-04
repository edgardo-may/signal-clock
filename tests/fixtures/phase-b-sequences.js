import assert from 'node:assert/strict'
import { AttendanceEngine, AttendanceNormalizer, ShiftMatcher, WorkdayCalculator, pairingWarningCodes, localToUtcIso } from '../../src/domain/attendance/index.ts'

export const timezone = 'America/Cancun'
// Expected pair indexes and anomaly indexes are product examples, not a second pairing algorithm.
export const cases = [
  ['B1', ['08:00 E','08:10 E','17:00 X'], [[0,2]], 540, [[1,'CONSECUTIVE_ENTRY']]],
  ['B2', ['08:00 E','17:00 X','17:10 X'], [[0,1]], 540, [[2,'CONSECUTIVE_EXIT']]],
  ['B3 only EXIT', ['08:00 X'], [], 0, [[0,'ORPHAN_EXIT']]],
  ['B4 leading EXIT', ['07:50 X','08:00 E','17:00 X'], [[1,2]], 540, [[0,'ORPHAN_EXIT']]],
  ['B5 duplicate entry then pair', ['08:00 E','08:10 E','12:00 X','13:00 E','17:00 X'], [[0,2],[3,4]], 480, [[1,'CONSECUTIVE_ENTRY']]],
  ['B6 pair then duplicate exit', ['08:00 E','12:00 X','13:00 E','17:00 X','17:10 X'], [[0,1],[2,3]], 480, [[4,'CONSECUTIVE_EXIT']]],
  ['B7 exit between pairs', ['08:00 E','12:00 X','12:05 X','13:00 E','17:00 X'], [[0,1],[3,4]], 480, [[2,'CONSECUTIVE_EXIT']]],
  ['B8 entry between pairs', ['08:00 E','12:00 X','13:00 E','13:10 E','17:00 X'], [[0,1],[2,4]], 480, [[3,'CONSECUTIVE_ENTRY']]],
  ['B9 anomaly before pairs', ['07:50 X','08:00 E','12:00 X','13:00 E','17:00 X'], [[1,2],[3,4]], 480, [[0,'ORPHAN_EXIT']]],
  ['B10 anomaly after pairs', ['08:00 E','12:00 X','13:00 E','17:00 X','17:10 X','17:20 X'], [[0,1],[2,3]], 480, [[4,'CONSECUTIVE_EXIT'],[5,'CONSECUTIVE_EXIT']]],
  ['B11 multiple anomalies', ['07:50 X','08:00 E','08:10 E','12:00 X','12:05 X','13:00 E','13:10 E','17:00 X','17:10 X'], [[1,3],[5,7]], 480, [[0,'ORPHAN_EXIT'],[2,'CONSECUTIVE_ENTRY'],[4,'CONSECUTIVE_EXIT'],[6,'CONSECUTIVE_ENTRY'],[8,'CONSECUTIVE_EXIT']]],
  ['B12 open final cycle', ['08:00 E','12:00 X','13:00 E'], [[0,1]], 240, [], 2],
  ['B13 overnight entry', ['23:00 E','23:10 E','03:00 X'], [[0,2]], 240, [[1,'CONSECUTIVE_ENTRY']], undefined, true],
  ['B14 overnight exit', ['23:00 E','03:00 X','03:10 X'], [[0,1]], 240, [[2,'CONSECUTIVE_EXIT']], undefined, true],
  ['B15 only orphan exits', ['08:00 X','09:00 X'], [], 0, [[0,'ORPHAN_EXIT'],[1,'ORPHAN_EXIT']]],
  ['B16 anomalies and open cycle', ['07:50 X','08:00 E','08:10 E','12:00 X','13:00 E','13:10 E'], [[1,3]], 240, [[0,'ORPHAN_EXIT'],[2,'CONSECUTIVE_ENTRY'],[5,'CONSECUTIVE_ENTRY']], 4],
]

export function inputFor(c, tenant = 'phase-b-tenant', employee = 'phase-b-employee') {
  const overnight = c[6]
  const shift = { operativeDate:'2030-06-10', startTime:overnight ? '22:00':'08:00', endTime:overnight ? '06:00':'17:00', toleranceMinutes:10 }
  const raw = c[1].map((event,i) => {
    const [time,kind] = event.split(' ')
    const date = overnight && time < '22:00' ? '2030-06-11':'2030-06-10'
    return {id:`p${i}`,clienteId:tenant,empleadoId:employee,timestamp:localToUtcIso(date,time+':00',timezone),inOutState:kind === 'E' ? 'entrada':'salida'}
  })
  return {shift,raw,tenant,employee}
}

export function verifyCase(c, input) {
  const {shift,raw,tenant,employee} = input
  const untouched = structuredClone(raw)
  const normalized = AttendanceNormalizer.normalize(raw,timezone,tenant,employee)
  const match = ShiftMatcher.match(shift,normalized.accepted,timezone)
  const pairing = WorkdayCalculator.pairPunches(match.matchedPunches)
  const metrics = WorkdayCalculator.calculate(match,timezone)
  const result = AttendanceEngine.process(tenant,employee,shift,raw,{timezone})
  const pairs = c[2], anomalies = c[4], open = c[5]
  const expectedPairs = pairs.map(([a,b]) => [raw[a].id,raw[b].id])
  assert.deepEqual(pairing.pairs.map(p => [p.entry.id,p.exit.id]),expectedPairs)
  assert.deepEqual(result.segments.map(s => [s.startPunch.id,s.endPunch.id]),expectedPairs)
  assert.equal(result.workedMinutes,c[3])
  assert.equal(metrics.workedMinutes,c[3])
  assert.equal(result.actualStart,raw.find(p => p.inOutState === 'entrada')?.timestamp)
  assert.equal(result.actualEnd,pairs.length ? raw[pairs.at(-1)[1]].timestamp : undefined)
  assert.equal(result.workdayState,open !== undefined || !pairs.length ? 'INCOMPLETE':'COMPLETE')
  assert.equal(result.missingExit,open !== undefined)
  assert.equal(pairing.orphanEntry?.id,open === undefined ? undefined : raw[open].id)
  assert.equal(result.operativeDate,shift.operativeDate)
  assert.equal(result.breakMinutes,0)
  assert.deepEqual(metrics.pairingIncidents.map(i => i.code),anomalies.map(a => a[1]))
  for (const [index,code] of anomalies) {
    const incident = metrics.pairingIncidents.find(i => i.code === code && (i.metadata.discardedPunchId ?? i.metadata.orphanExitPunchId) === raw[index].id)
    assert.ok(incident)
    assert.equal(incident.severity,'WARNING')
    assert.equal(incident.metadata.discardedTimestamp ?? incident.metadata.orphanExitTimestamp,raw[index].timestamp)
    assert.equal(incident.metadata.position,index)
    assert.equal(incident.metadata.reason,code)
    assert.ok(incident.metadata.type)
    assert.ok(pairingWarningCodes(metrics).includes(code))
    assert.ok(result.incidents.some(i => i.code === code))
    assert.ok(metrics.supplementalEvents.some(e => e.logId === raw[index].id))
  }
  assert.deepEqual(result.sourceLogIds,raw.map(p => p.id))
  assert.deepEqual(raw,untouched)
  assert.equal(result.incidents.some(i => i.code === 'PUNCH_SEQUENCE_AMBIGUOUS'),false)
  return result
}
