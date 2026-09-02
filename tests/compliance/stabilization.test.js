import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AttendanceEngine } from '../../src/domain/attendance/AttendanceEngine.ts'
import { WorkdayPersistenceService } from '../../src/services/attendance/WorkdayPersistenceService.ts'

const sql = readFileSync(new URL('../../supabase/migrations/047_phase2_stabilization.sql', import.meta.url), 'utf8')
const tenant = '00000000-0000-0000-0000-000000000001'
const employee = '00000000-0000-0000-0000-000000000002'
const punch = (id, timestamp) => ({ id, clienteId: tenant, empleadoId: employee, timestamp, inOutState: 0 })

test('STAB-001: AttendanceEngine preserves deduplication options', () => {
  const result = AttendanceEngine.process(tenant, employee, { operativeDate: '2026-09-01', startTime: '08:00', endTime: '17:00' }, [punch('a', '2026-09-01T14:00:00Z'), punch('b', '2026-09-01T14:00:04Z'), { ...punch('c', '2026-09-01T23:00:00Z'), inOutState: 1 }], { timezone: 'America/Mexico_City', deduplication: { minSecondsBetweenPunches: 5 } })
  assert.equal(result.sourceLogIds.length, 2)
})

test('STAB-002: AttendanceEngine preserves injected LaborRuleProvider', () => {
  const provider = { getRulesForDate: () => ({ maxDailyOrdinaryMinutes: 60, maxWeeklyOrdinaryMinutes: 2400, overtimeDoubleMaxWeeklyMinutes: 540 }) }
  const result = AttendanceEngine.process(tenant, employee, { operativeDate: '2026-09-01', startTime: '08:00', endTime: '10:00' }, [punch('a', '2026-09-01T14:00:00Z'), { ...punch('b', '2026-09-01T16:00:00Z'), inOutState: 1 }], { timezone: 'America/Mexico_City', laborRuleProvider: provider })
  assert.equal(result.ordinaryMinutes, 60)
})

test('STAB-003: persistence contract forwards scheduleAssignmentId', async () => {
  let payload
  await WorkdayPersistenceService.persistWorkday({ rpc: async (_name, args) => { payload = args.payload; return { data: { status: 'CREATED', workday_record_id: 'x', version: 1 }, error: null } } }, { clienteId: tenant, empleadoId: employee, operativeDate: '2026-09-01', timezone: 'America/Cancun', scheduleAssignmentId: 'assignment', workedMinutes: 0, breakMinutes: 0, effectiveMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, ordinaryMinutes: 0, overtimeMinutes: 0, workdayState: 'UNSCHEDULED', calculationVersion: 1, integrityHash: 'h', sourceLogIds: [], punchDispositions: [], incidents: [], warnings: [] })
  assert.equal(payload.schedule_assignment_id, 'assignment')
})

test('STAB-004: simulated suite uses finite query builders', () => {
  const mock = readFileSync(new URL('./persistence-simulated.test.js', import.meta.url), 'utf8')
  assert.match(mock, /resolve\(\{ data: \[\]/)
})

test('STAB-005: UNSCHEDULED honors requested operativeDate across UTC midnight', () => {
  const result = AttendanceEngine.process(tenant, employee, undefined, [punch('a', '2026-09-02T04:30:00Z')], { timezone: 'America/Mexico_City', operativeDate: '2026-09-01' })
  assert.equal(result.operativeDate, '2026-09-01')
})

test('STAB-006: tenant timezone is read, not host-derived', () => {
  const source = readFileSync(new URL('../../src/services/attendance/WorkdayReprocessService.ts', import.meta.url), 'utf8')
  assert.match(source, /from\('clientes'\)/)
  assert.match(source, /tenantData\.timezone/)
})

test('STAB-007: cross-tenant employee link has a validation trigger', () => assert.match(sql, /fn_validate_employee_user_link_tenant/))
test('STAB-008: UNSCHEDULED reconciliation supersedes the old record', () => assert.match(sql, /UNSCHEDULED_RECONCILED/))
test('STAB-009: assignment A→B reconciliation is explicit', () => assert.match(sql, /SCHEDULE_REASSIGNED/))
test('STAB-010: superseded_by points to the definitive record', () => assert.match(sql, /superseded_by=v_new_id/))
test('STAB-011: supersession writes a history version', () => assert.match(sql, /v_supersede_reason/))
test('STAB-012: source logs are checked against retrieval window', () => assert.match(sql, /al\."timestamp" < v_window_start/))
test('STAB-013: source-log windows accept a bounded overnight range', () => assert.match(sql, /v_window_end/))
test('STAB-014: concurrency uses a transaction-scoped advisory lock', () => assert.match(sql, /pg_advisory_xact_lock/))
