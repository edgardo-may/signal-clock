import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const root = process.cwd()
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const phase49 = read('database/live-schema/49_schedule_assignment_data_repair_precheck.sql')
const phase50 = read('database/live-schema/50_schedule_assignment_data_repair_change.sql')
const phase51 = read('database/live-schema/51_schedule_assignment_data_repair_postcheck.sql')
const evidenceReader = read('scripts/read-phase49-schedule-assignment-evidence.mjs')
const removeComments = (sql) => sql.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

for (const [name, sql] of [['Phase 49', phase49], ['Phase 51', phase51]]) {
  test(`${name} is read-only and rolls back`, () => {
    const executable = removeComments(sql)
    assert.match(executable, /^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i)
    assert.match(executable, /\bROLLBACK\s*;\s*$/i)
    assert.doesNotMatch(executable, /\b(INSERT|UPDATE|DELETE|UPSERT|CALL|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|MERGE)\b/i)
  })
}

test('Phase 49 requires the exact three old states and detects extra employee rows', () => {
  for (const id of [
    'a290fc73-7ee6-4ea8-9e0e-8e92a683245f',
    '56f8c98d-5fe1-49d2-abe2-42182a4a830a',
    '2984316c-1c93-4f66-853e-349f90b9f82c',
  ]) assert.ok(phase49.includes(id))
  assert.match(phase49, /employee_assignment_count/)
  assert.match(phase49, /employee_assignment_count\.value = 3/)
  assert.match(phase49, /snapshot_hash/)
  assert.match(phase49, /only_c_is_active/)
  assert.match(phase49, /'safe_to_repair', false/)
})

test('Phase 50 binds the approved Phase 49 hash and one unique correlation id', () => {
  assert.match(phase50, /a7b24037-d23a-4804-a3c3-1670f551c67a/)
  assert.match(phase50, /ec8102bf5c15f153adc27d56a3419d85/)
  assert.doesNotMatch(phase50, /v_expected_snapshot_hash\s+text\s*:=\s*NULL/)
  assert.match(phase50, /BEGIN;[\s\S]*COMMIT;\s*$/)
})

test('Phase 50 permits only literal A/B/C rows, locks them, checks drift, and records decisions without assignment mutation', () => {
  const ids = [
    'a290fc73-7ee6-4ea8-9e0e-8e92a683245f',
    '56f8c98d-5fe1-49d2-abe2-42182a4a830a',
    '2984316c-1c93-4f66-853e-349f90b9f82c',
  ]
  for (const id of ids) assert.ok(phase50.includes(id))
  assert.match(phase50, /FOR SHARE/)
  assert.match(phase50, /SCHEDULE_ASSIGNMENT_REPAIR_DRIFT_DETECTED/)
  assert.match(phase50, /SCHEDULE_ASSIGNMENT_REPAIR_OLD_STATE_MISMATCH/)
  assert.match(phase50, /SCHEDULE_ASSIGNMENT_DECISION_AUDIT_ALREADY_EXISTS/)
  assert.equal((phase50.match(/INSERT INTO public\.audit_logs/g) ?? []).length, 1)
  assert.doesNotMatch(removeComments(phase50), /\b(UPDATE|DELETE)\b/i)
  for (const table of ['empleados_horarios', 'horarios', 'registro_asistencia', 'workday_records', 'workday_record_history', 'incidencias']) {
    assert.doesNotMatch(removeComments(phase50), new RegExp(`\\b(UPDATE|DELETE)\\s+(FROM\\s+)?public\\.${table}\\b`, 'i'))
  }
  assert.doesNotMatch(removeComments(phase50), /INSERT\s+INTO\s+public\.(?!audit_logs\b)/i)
  assert.match(phase50, /SCHEDULE_VOIDED/)
  assert.match(phase50, /SCHEDULE_VALIDATED/)
  assert.match(phase50, /'classification', decision\.classification/)
  assert.match(phase50, /'data_mutation', false/)
  for (const field of ['id', 'cliente_id', 'empleado_id', 'horario_id', 'activo', 'fecha_inicio', 'fecha_fin']) {
    assert.match(phase50, new RegExp(`'${field}', assignment\\.${field}`))
  }
  assert.match(phase50, /v_actor_user_id uuid := auth\.uid\(\)/)
  assert.match(phase50, /SQL_EDITOR_ADMINISTRATIVE_DECISION_NO_AUTH_UID/)
  assert.doesNotMatch(phase50, /upsert_workday_record/)
  const decisionBlock = phase50.match(/FROM \(VALUES([\s\S]*?)\) AS decision/)
  assert.ok(decisionBlock)
  assert.equal((decisionBlock[1].match(/'SCHEDULE_(?:VOIDED|VALIDATED)'/g) ?? []).length, 3)
})

test('Phase 50 fails closed for the approved snapshot, every assignment drift, extra rows, and duplicate evidence', () => {
  assert.match(phase50, /v_expected_snapshot_hash constant text := 'ec8102bf5c15f153adc27d56a3419d85'/)
  assert.match(phase50, /v_current_snapshot_hash IS DISTINCT FROM v_expected_snapshot_hash/)
  for (const state of ['v_a_state', 'v_b_state', 'v_c_state']) assert.match(phase50, new RegExp(`${state} IS NULL`))
  assert.match(phase50, /v_assignment_count <> 3/)
  assert.match(phase50, /v_active_assignment_count <> 1/)
  assert.match(phase50, /SCHEDULE_ASSIGNMENT_DECISION_AUDIT_ALREADY_EXISTS/)
})

test('Phase 50 uses one atomic three-row audit insert and no prohibited write surface', () => {
  const executable = removeComments(phase50)
  assert.match(executable, /^\s*BEGIN;/)
  assert.match(executable, /COMMIT;\s*$/)
  assert.equal((executable.match(/INSERT INTO public\.audit_logs/g) ?? []).length, 1)
  const decisionBlock = executable.match(/FROM \(VALUES([\s\S]*?)\) AS decision/)
  assert.ok(decisionBlock)
  assert.equal((decisionBlock[1].match(/'SCHEDULE_(?:VOIDED|VALIDATED)'/g) ?? []).length, 3)
  assert.doesNotMatch(executable, /INSERT\s+INTO\s+public\.(?!audit_logs\b)/i)
  assert.doesNotMatch(executable, /\b(UPDATE|DELETE)\s+(FROM\s+)?public\.(empleados_horarios|horarios|registro_asistencia|workday_records|workday_record_history|incidencias)\b/i)
})

test('Phase 51 compares downstream baselines and exact repair audit evidence', () => {
  for (const expected of [
    'expected_attendance_rows', 'expected_workday_rows', 'expected_history_rows',
    'expected_incident_rows', 'expected_tenant_incident_rows', 'valid_active_overlap_count', 'date_cardinality',
    'SCHEDULE_VOIDED', 'SCHEDULE_VALIDATED', 'downstream_baseline_matches', 'assignment_snapshot',
    'approved_audit_event_count', 'ec8102bf5c15f153adc27d56a3419d85',
    'a7b24037-d23a-4804-a3c3-1670f551c67a',
  ]) assert.ok(phase51.includes(expected), `missing ${expected}`)
})

test('Phase 51 final projection binds approval before referencing its correlation and snapshot', () => {
  const finalProjection = phase51.match(/SELECT jsonb_build_object\([\s\S]*?\) AS schedule_assignment_data_repair_postcheck\s+FROM[\s\S]*?;/)
  assert.ok(finalProjection)
  assert.match(finalProjection[0], /approval\.correlation_id/)
  assert.match(finalProjection[0], /approval\.phase49_snapshot_hash/)
  assert.match(finalProjection[0], /CROSS JOIN approval\s*;/)
})

test('Phase 51 is rebound to the fresh downstream baseline and rejects the obsolete 35/5/2 packet', () => {
  const fresh = {
    attendance: 39,
    withDeviceTimezone: 32,
    withoutDeviceTimezone: 7,
    workdays: 0,
    history: 0,
    employeeIncidents: 4,
    tenantIncidents: 7,
  }
  const matches = (actual, expected) => Object.keys(expected).every((key) => actual[key] === expected[key])

  assert.match(phase51, /39::integer AS expected_attendance_rows/)
  assert.match(phase51, /32::integer AS expected_attendance_rows_with_device_timezone/)
  assert.match(phase51, /7::integer AS expected_attendance_rows_without_device_timezone/)
  assert.match(phase51, /4::integer AS expected_incident_rows/)
  assert.match(phase51, /7::integer AS expected_tenant_incident_rows/)
  assert.match(phase51, /downstream_counts\.attendance_rows_with_device_timezone = approval\.expected_attendance_rows_with_device_timezone/)
  assert.match(phase51, /downstream_counts\.attendance_rows_without_device_timezone = approval\.expected_attendance_rows_without_device_timezone/)
  assert.doesNotMatch(phase51, /35::integer AS expected_attendance_rows/)
  assert.doesNotMatch(phase51, /2::integer AS expected_incident_rows/)
  assert.doesNotMatch(phase51, /5::integer AS expected_tenant_incident_rows/)
  assert.equal(matches(fresh, fresh), true)
  assert.equal(matches(fresh, { ...fresh, attendance: 35, employeeIncidents: 2, tenantIncidents: 5 }), false)
})

test('the evidence reader has no writer surface', () => {
  assert.match(evidenceReader, /databaseWrites: 0/)
  assert.match(evidenceReader, /rpcWrites: 0/)
  assert.doesNotMatch(evidenceReader, /\.rpc\s*\(/)
  assert.doesNotMatch(evidenceReader, /\.(insert|update|upsert|delete)\s*\(/i)
})
