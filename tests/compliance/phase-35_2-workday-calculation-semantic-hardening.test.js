/** Phase 35.2 locks the corrected WORK/BREAK and pairing-warning contract. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const { AttendanceEngineOrchestrator } = require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')

const TENANT = 'trace-tenant'
const EMPLOYEE = 'trace-employee'
const DEVICE = 'trace-device'
const TIMEZONE = 'America/Cancun'

function event(id, timestamp, tipo) {
  return {
    id, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
    verificado_at: timestamp, tipo_verificacion: tipo, metodo: 'face', source_event_id: null, es_manual: false,
  }
}

/**
 * Sanitized semantic regression fixture from the confirmed Phase 35.1 shape:
 * 16 events, 7 ENTRY, 9 EXIT, two WORK intervals (21 + 65), one 7-minute
 * BREAK, seven orphan exits, and a terminal orphan entry. It contains no live
 * IDs or raw payload. Exact physical event IDs remain production evidence.
 */
function semanticFixture() {
  return [
    event('p01', '2026-09-03T16:26:04.000Z', 'entrada'),
    event('p02', '2026-09-03T17:00:00.000Z', 'entrada'),
    event('p03', '2026-09-03T17:15:00.000Z', 'entrada'),
    event('p04', '2026-09-03T17:25:00.000Z', 'entrada'),
    event('p05', '2026-09-03T17:34:00.000Z', 'entrada'),
    event('p06', '2026-09-03T17:55:00.000Z', 'salida'),
    event('p07', '2026-09-03T18:02:00.000Z', 'entrada'),
    event('p08', '2026-09-03T19:07:00.000Z', 'salida'),
    event('p09', '2026-09-03T19:15:00.000Z', 'salida'),
    event('p10', '2026-09-03T19:25:00.000Z', 'salida'),
    event('p11', '2026-09-03T19:35:00.000Z', 'salida'),
    event('p12', '2026-09-03T19:45:00.000Z', 'salida'),
    event('p13', '2026-09-03T19:55:00.000Z', 'salida'),
    event('p14', '2026-09-03T20:05:00.000Z', 'salida'),
    event('p15', '2026-09-03T20:15:00.000Z', 'salida'),
    event('p16', '2026-09-03T21:41:04.000Z', 'entrada'),
  ]
}

function shift() {
  return { id: 'semantic-schedule', operativeDate: '2026-09-03', startTime: '06:00', endTime: '14:00', toleranceMinutes: 5, hasBreak: false }
}

function calculation() {
  const records = semanticFixture()
  const raw = records.map((record) => ({ id: record.id, clienteId: TENANT, empleadoId: EMPLOYEE, timestamp: record.verificado_at, inOutState: record.tipo_verificacion }))
  const normalized = domain.AttendanceNormalizer.normalize(raw, TIMEZONE, TENANT, EMPLOYEE)
  const match = domain.ShiftMatcher.match(shift(), normalized.accepted, TIMEZONE)
  const metrics = domain.WorkdayCalculator.calculate(match, TIMEZONE, { timezone: TIMEZONE, operativeDate: '2026-09-03' })
  return { records, normalized, match, metrics, warnings: domain.pairingWarningCodes(metrics) }
}

class ReadOnlyFixtureRepository {
  constructor(records = semanticFixture()) { this.records = records; this.writeCalls = 0 }
  async loadRegistro(id) { return this.records.find((record) => record.id === id) || null }
  async loadDevice() { return { id: DEVICE, cliente_id: TENANT, timezone: TIMEZONE } }
  async loadEmployee() { return { id: EMPLOYEE, cliente_id: TENANT } }
  async loadScheduleContext() {
    const snapshot = {
      calculation_contract_version: 1,
      dias_config: {
        lun: { activo: false }, mar: { activo: false }, mie: { activo: false },
        jue: { activo: true, entrada: '06:00', salida: '14:00' }, vie: { activo: false },
        sab: { activo: false }, dom: { activo: false },
      },
      tolerancia_minutos: 5,
      horario_activo: true,
    }
    return {
      assignments: [{ id: 'assignment', cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: 'semantic-schedule', schedule_revision_id: 'revision-1', fecha_inicio: '2026-01-01', fecha_fin: null, activo: true }],
      revisions: [{ id: 'revision-1', cliente_id: TENANT, horario_id: 'semantic-schedule', version: 1, config_snapshot: snapshot, integrity_hash: domain.computeScheduleRevisionIntegrityHash(snapshot) }],
    }
  }
  async loadAttendanceEvents() { return this.records.slice() }
  async loadDevices() { return [{ id: DEVICE, cliente_id: TENANT, timezone: TIMEZONE }] }
}

async function orchestrated() {
  const repository = new ReadOnlyFixtureRepository()
  const result = await new AttendanceEngineOrchestrator({ repository, domain, mode: 'SHADOW', logger: { info: () => {}, error: () => {} } }).run({ registroId: 'p01' })
  return { repository, result }
}

test('1. workedMinutes uses the canonical firstIn to firstOut interval', () => assert.equal(calculation().metrics.workedMinutes, 89))
test('2. BREAK segments are excluded from workedMinutes', () => assert.notEqual(calculation().metrics.workedMinutes, 93))
test('3. breakMinutes never derives from supplemental punches', () => assert.equal(calculation().metrics.breakMinutes, 0))
test('4. gross 315-minute span cannot replace workedMinutes', () => {
  const { match, metrics } = calculation()
  const span = Math.round((match.matchedPunches.at(-1).epochMs - match.matchedPunches[0].epochMs) / 60000)
  assert.equal(span, 315)
  assert.equal(metrics.workedMinutes, 89)
})
test('5. four consecutive-entry events remain pairing evidence', () => assert.equal(calculation().metrics.pairingIncidents.filter((item) => item.code === 'CONSECUTIVE_ENTRY').length, 4))
test('6. seven consecutive-exit events remain pairing evidence', () => assert.equal(calculation().metrics.pairingIncidents.filter((item) => item.code === 'CONSECUTIVE_EXIT').length, 7))
test('7. additional entries produce deterministic evidence', () => assert.equal(calculation().warnings.includes('ADDITIONAL_ENTRY'), true))
test('8. additional exits produce deterministic evidence', () => assert.equal(calculation().warnings.includes('ADDITIONAL_EXIT'), true))
test('9. warnings reach the SHADOW orchestrator without incidents', async () => {
  const { result } = await orchestrated()
  assert.deepEqual(result.calculationWarnings, ['CONSECUTIVE_ENTRY', 'CONSECUTIVE_EXIT', 'ADDITIONAL_ENTRY', 'ADDITIONAL_EXIT'])
  assert.deepEqual(result.calculation.incidents, [])
})
test('10. warnings are deterministic and deduplicated', () => assert.deepEqual(calculation().warnings, ['CONSECUTIVE_ENTRY', 'CONSECUTIVE_EXIT', 'ADDITIONAL_ENTRY', 'ADDITIONAL_EXIT']))
test('11. terminal supplemental entry does not invalidate a canonical complete day', async () => assert.equal((await orchestrated()).result.workdayRecord.status, 'COMPLETE'))
test('12. firstIn is the earliest canonical ENTRY, even if pairing discards it', () => assert.equal(calculation().metrics.actualStart, '2026-09-03T16:26:04.000Z'))
test('13. late calculation uses canonical firstIn and full scheduled-start difference', () => assert.equal(calculation().metrics.lateMinutes, 326))
test('14. tolerance boundary returns zero at exactly five minutes late', () => {
  const normalized = domain.AttendanceNormalizer.normalize([{ id: 'boundary', clienteId: TENANT, empleadoId: EMPLOYEE, timestamp: '2026-09-03T11:05:00.000Z', inOutState: 'entrada' }], TIMEZONE, TENANT, EMPLOYEE)
  const metrics = domain.WorkdayCalculator.calculate(domain.ShiftMatcher.match(shift(), normalized.accepted, TIMEZONE), TIMEZONE)
  assert.equal(metrics.lateMinutes, 0)
})
test('15. overtime uses corrected effective WORK semantics', () => assert.equal(calculation().metrics.overtimeMinutes, 0))
test('16. early leave uses canonical firstOut only', () => {
  const metrics = calculation().metrics
  assert.equal(metrics.actualEnd, '2026-09-03T17:55:00.000Z')
  assert.equal(metrics.earlyLeaveMinutes, 65)
})
test('17. sanitized 16-event semantic fixture preserves the real trace shape', () => {
  const records = semanticFixture()
  assert.equal(records.length, 16)
  assert.deepEqual(records.reduce((total, record) => ({ ...total, [record.tipo_verificacion]: total[record.tipo_verificacion] + 1 }), { entrada: 0, salida: 0 }), { entrada: 7, salida: 9 })
})
test('18. deterministic replay produces identical metrics and warnings', () => {
  const a = calculation(); const b = calculation()
  assert.deepEqual([a.metrics.workedMinutes, a.metrics.actualStart, a.metrics.actualEnd, a.metrics.breakMinutes, a.metrics.lateMinutes, a.warnings], [b.metrics.workedMinutes, b.metrics.actualStart, b.metrics.actualEnd, b.metrics.breakMinutes, b.metrics.lateMinutes, b.warnings])
})
test('19. integrity hash is deterministic and changes from gross-span snapshot', async () => {
  const { result } = await orchestrated()
  const record = result.workdayRecord
  const current = record.integrity_hash
  const oldSemanticHash = domain.WorkdayIntegrityHasher.computeHash({ clienteId: TENANT, empleadoId: EMPLOYEE, operativeDate: '2026-09-03', timezone: TIMEZONE, scheduleId: 'semantic-schedule', scheduledStart: '2026-09-03T11:00:00.000Z', scheduledEnd: '2026-09-03T19:00:00.000Z', actualStart: '2026-09-03T16:26:04.000Z', workedMinutes: 315, breakMinutes: 7, effectiveMinutes: 86, lateMinutes: 326, earlyLeaveMinutes: 0, ordinaryMinutes: 86, overtimeMinutes: 0, status: 'INCOMPLETE', sourceLogIds: calculation().metrics.sourceLogIds, incidentCodes: [], calculationVersion: 1 })
  assert.equal(current, (await orchestrated()).result.workdayRecord.integrity_hash)
  assert.notEqual(current, oldSemanticHash)
})
test('20. SHADOW semantic hardening performs no writes', async () => {
  const { repository, result } = await orchestrated()
  assert.equal(repository.writeCalls, 0)
  assert.equal(result.persistenceResult, undefined)
})
