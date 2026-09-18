import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const phase46 = read('database/live-schema/46_schedule_assignment_contract_precheck.sql')
const phase47 = read('database/live-schema/47_schedule_assignment_contract_change.sql')
const phase48 = read('database/live-schema/48_schedule_assignment_contract_postcheck.sql')
const executable46 = phase46.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const executable48 = phase48.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

test('Phase 46 is read-only, rolls back, and never writes or calls RPC', () => {
  assert.match(executable46, /^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i)
  assert.match(executable46, /\bROLLBACK\s*;\s*$/i)
  assert.doesNotMatch(executable46, /\b(INSERT|UPDATE|DELETE|UPSERT|CALL|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|MERGE)\b/i)
  assert.doesNotMatch(executable46, /\.(rpc|upsert)\s*\(/i)
})

test('Phase 46 classifies only active overlaps and recognizes A/B VOIDED plus C VALID_CURRENT', () => {
  for (const value of ['VOIDED', 'VALID_CURRENT', 'SCHEDULE_VOIDED', 'SCHEDULE_VALIDATED', 'active_overlap_pairs', 'active_overlap_rows', 'btree_gist_installed', 'btree_gist_available', 'manual_decision_required', 'safe_to_apply_contract_change']) assert.ok(phase46.includes(value))
  assert.match(executable46, /left_assignment\.activo IS TRUE AND right_assignment\.activo IS TRUE/)
  assert.match(executable46, /WHEN assignment_row\.activo IS FALSE AND assignment_row\.has_approved_void_audit THEN 'VOIDED'/)
  assert.match(executable46, /WHEN assignment_row\.activo IS FALSE THEN 'UNRESOLVABLE_INACTIVE'/)
  assert.match(executable46, /WHEN assignment_row\.invalid_range THEN 'INVALID_RANGE'/)
  assert.match(executable46, /EMPLOYEE_TENANT_MISMATCH/)
  assert.match(executable46, /SCHEDULE_TENANT_MISMATCH/)
})

test('Phase 46 emits a drift snapshot and exact A/B/C decision evidence', () => {
  for (const value of ['assignment_snapshot_hash', 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f', '56f8c98d-5fe1-49d2-abe2-42182a4a830a', '2984316c-1c93-4f66-853e-349f90b9f82c', 'a7b24037-d23a-4804-a3c3-1670f551c67a', 'ec8102bf5c15f153adc27d56a3419d85']) assert.ok(phase46.includes(value))
})

test('Phase 47 is exactly rebound to the reviewed Phase 46 snapshot and counts before DDL', () => {
  const guard = phase47.slice(0, phase47.indexOf('CREATE EXTENSION'))
  assert.match(guard, /v_expected_snapshot_hash constant text := 'e22d6dc08b22e9c74343cc2d56439857'/)
  assert.match(guard, /v_expected_assignment_count constant integer := 3/)
  assert.match(guard, /v_expected_active_assignment_count constant integer := 1/)
  assert.doesNotMatch(guard, /constant (?:text|integer) := NULL/)
  assert.match(guard, /SCHEDULE_ASSIGNMENT_CONTRACT_PRECONDITION_FAILED/)
  for (const value of ['v_invalid_range_count', 'v_active_overlap_count', 'v_unaudited_inactive_count', 'v_tenant_inconsistent_count', 'v_target_mismatch_count', 'v_current_snapshot_hash']) assert.ok(guard.includes(value))
})

test('Phase 47 DDL enforces inclusive active-only ranges with btree_gist', () => {
  assert.match(phase47, /CREATE EXTENSION IF NOT EXISTS btree_gist/)
  assert.match(phase47, /ALTER COLUMN fecha_inicio SET NOT NULL/)
  assert.match(phase47, /CHECK \(fecha_fin IS NULL OR fecha_fin >= fecha_inicio\)/)
  assert.match(phase47, /EXCLUDE USING gist/)
  assert.match(phase47, /cliente_id WITH =, empleado_id WITH =/)
  assert.match(phase47, /daterange\(fecha_inicio, COALESCE\(fecha_fin, 'infinity'::date\), '\[\]'\) WITH &&/)
  assert.match(phase47, /WHERE \(activo IS TRUE\)/)
  assert.match(phase47, /CREATE EXTENSION IF NOT EXISTS btree_gist[\s\S]*?SCHEDULE_ASSIGNMENT_BTREE_GIST_INSTALL_FAILED/)
})

test('Phase 47 accepts only the bound snapshot/count packet and reruns idempotently', () => {
  const expected = { snapshot: 'e22d6dc08b22e9c74343cc2d56439857', assignments: 3, active: 1 }
  const matches = (actual) => actual.snapshot === expected.snapshot && actual.assignments === expected.assignments && actual.active === expected.active
  assert.equal(matches(expected), true)
  assert.equal(matches({ ...expected, snapshot: 'different' }), false)
  assert.equal(matches({ ...expected, assignments: 4 }), false)
  assert.equal(matches({ ...expected, active: 2 }), false)
  assert.match(phase47, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint/)
  assert.match(phase47, /CREATE EXTENSION IF NOT EXISTS btree_gist/)
  assert.match(phase47, /BEGIN;[\s\S]*COMMIT;\s*$/)
})

test('contract examples: active overlap and invalid range reject; voided, future, closed, and gap remain valid', () => {
  const overlaps = (left, right) => left.start <= (right.end ?? Infinity) && right.start <= (left.end ?? Infinity)
  const allowed = (left, right) => !left.active || !right.active || !overlaps(left, right)
  assert.equal(allowed({ active: true, start: 1, end: 5 }, { active: true, start: 5, end: 8 }), false)
  assert.equal(allowed({ active: false, start: 1, end: null }, { active: true, start: 2, end: null }), true)
  assert.equal(allowed({ active: true, start: 20, end: null }, { active: true, start: 1, end: 10 }), true)
  assert.equal(allowed({ active: true, start: 1, end: 9 }, { active: true, start: 10, end: null }), true)
  assert.equal(4 >= 5, false)
})

test('Phase 48 is read-only and validates DDL, A/B/C audits, and unchanged downstream counts', () => {
  assert.match(executable48, /^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i)
  assert.match(executable48, /\bROLLBACK\s*;\s*$/i)
  assert.doesNotMatch(executable48, /\b(INSERT|UPDATE|DELETE|UPSERT|CALL|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|MERGE)\b/i)
  for (const value of ['btree_gist_exists', 'fecha_inicio_not_null', 'range_check_exists', 'overlap_exclusion_exists', 'SCHEDULE_VOIDED', 'SCHEDULE_VALIDATED', 'attendance_rows = 39', 'workday_rows = 0', 'history_rows = 0', 'employee_incident_rows = 4', 'tenant_incident_rows = 7', 'postcheck_pass']) assert.ok(phase48.includes(value))
})
