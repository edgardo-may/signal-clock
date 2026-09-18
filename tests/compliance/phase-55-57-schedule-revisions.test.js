import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(process.cwd());
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const phase55 = read('database/live-schema/55_schedule_revision_precheck.sql');
const phase56 = read('database/live-schema/56_schedule_revision_change.sql');
const phase57 = read('database/live-schema/57_schedule_revision_postcheck.sql');
const resolver = read('src/domain/attendance/adapters/ScheduleResolver.ts');
const revisionAdapter = read('src/domain/attendance/adapters/ScheduleRevisionAdapter.ts');
const schedulePage = read('src/features/schedules/pages/HorariosPage.jsx');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function calculationHash(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(snapshot))).digest('hex');
}

test('Phase55 is an explicit read-only precheck that rolls back', () => {
  assert.match(phase55, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(phase55, /ROLLBACK;/);
  assert.doesNotMatch(phase55, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
});

test('Phase55 inventories the mutable calculation configuration and migration ambiguity', () => {
  for (const expected of ['dias_config', 'tolerancia_minutos', 'schedules_with_missing_calculation_config', 'schedules_with_incomplete_week', 'deterministic_current_revision_candidate', 'voided_history_must_remain_unlinked']) {
    assert.match(phase55, new RegExp(expected));
  }
  assert.match(phase55, /safe_to_apply_schedule_revision_change/);
});

test('Phase55 identifies the production C assignment and leaves the two VOIDED targets unlinked', () => {
  for (const assignmentId of ['a290fc73-7ee6-4ea8-9e0e-8e92a683245f', '56f8c98d-5fe1-49d2-abe2-42182a4a830a', '2984316c-1c93-4f66-853e-349f90b9f82c']) {
    assert.match(phase55, new RegExp(assignmentId));
  }
  assert.match(phase55, /h\.actualizado_at::date <= eh\.fecha_inicio/);
});

test('Phase56 is exactly rebound and remains fail-closed for any Phase55 drift', () => {
  assert.match(phase56, /v_expected_snapshot_hash text := 'dad64dfa2920b3c00cb6aae75283a835'/);
  for (const expected of ['v_expected_assignment_count integer := 3', 'v_expected_active_assignment_count integer := 1', 'v_expected_voided_assignment_count integer := 2', 'v_expected_deterministic_candidate_count integer := 1', 'v_expected_voided_unlinked_count integer := 2', 'v_expected_attendance_rows integer := 40', 'v_expected_workday_records integer := 0', 'v_expected_workday_record_history integer := 0', 'v_expected_incidencias integer := 7']) assert.match(phase56, new RegExp(expected));
  assert.match(phase56, /SCHEDULE_REVISION_REBIND_REQUIRED/);
  assert.match(phase56, /SCHEDULE_REVISION_PRECHECK_DRIFT/);
  assert.match(phase56, /SCHEDULE_REVISION_DOWNSTREAM_PRECHECK_DRIFT/);
  assert.match(phase56, /SCHEDULE_REVISION_TENANT_RLS_RESOLVER_MISSING/);
  assert.match(phase56, /BEGIN ISOLATION LEVEL REPEATABLE READ/);
  assert.match(phase56, /LOCK TABLE public\.horarios, public\.empleados_horarios/);
});

test('Phase56 installs only one deterministic revision backfill for C', () => {
  assert.match(phase56, /INSERT INTO public\.schedule_revisions/);
  assert.match(phase56, /2984316c-1c93-4f66-853e-349f90b9f82c/);
  assert.match(phase56, /5a753368-f019-4230-89e2-79beaa39ff0f/);
  assert.match(phase56, /schedule_revision_id IS NOT NULL/);
  assert.match(phase56, /a290fc73-7ee6-4ea8-9e0e-8e92a683245f/);
  assert.match(phase56, /56f8c98d-5fe1-49d2-abe2-42182a4a830a/);
  assert.match(phase56, /schedule_revision_id IS NOT NULL\) THEN/);
});

test('Phase56 requires installed pgcrypto and detects C snapshot drift before DDL', () => {
  assert.match(phase56, /SCHEDULE_REVISION_PGCRYPTO_PRECHECK_DRIFT/);
  assert.match(phase56, /SCHEDULE_REVISION_PGCRYPTO_SCHEMA_UNSUPPORTED/);
  assert.match(phase56, /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
  assert.match(phase56, /h\.actualizado_at::date <= eh\.fecha_inicio/);
  assert.match(phase56, /SCHEDULE_REVISION_PRECHECK_DRIFT/);
});

test('Schedule revision storage has tenant-safe identity, version uniqueness and assignment FK', () => {
  assert.match(phase56, /schedule_revisions_horario_version_unique UNIQUE \(horario_id, version\)/);
  assert.match(phase56, /schedule_revisions_id_tenant_unique UNIQUE \(id, cliente_id\)/);
  assert.match(phase56, /FOREIGN KEY \(schedule_revision_id,cliente_id\) REFERENCES public\.schedule_revisions\(id,cliente_id\)/);
});

test('Calculation hash covers all persisted calculation inputs consumed by the immutable revision adapter', () => {
  for (const field of ['calculation_contract_version', 'dias_config', 'tolerancia_minutos', 'horario_activo']) {
    assert.match(phase56, new RegExp(`'${field}'`));
  }
  assert.match(phase56, /extensions\.digest\(/);
  assert.match(phase56, /'sha256'/);
  assert.match(revisionAdapter, /tolerancia_minutos/);
  assert.match(revisionAdapter, /dias_config/);
  assert.match(revisionAdapter, /horario_activo/);
  assert.doesNotMatch(resolver, /horarios\(\*\)|dias_config|tolerancia_minutos|schedule\.activo/);
});

test('Canonical calculation hash ignores JSON key order', () => {
  const a = { horario_activo: true, dias_config: { mar: { salida: '18:00', entrada: '09:00' }, lun: { entrada: '09:00', salida: '18:00' } }, tolerancia_minutos: 10, calculation_contract_version: 1 };
  const b = { calculation_contract_version: 1, tolerancia_minutos: 10, dias_config: { lun: { salida: '18:00', entrada: '09:00' }, mar: { entrada: '09:00', salida: '18:00' } }, horario_activo: true };
  assert.equal(calculationHash(a), calculationHash(b));
});

test('Canonical calculation hash changes when a calculation-relevant value changes', () => {
  const a = { calculation_contract_version: 1, dias_config: { lun: { entrada: '09:00', salida: '18:00' } }, tolerancia_minutos: 10, horario_activo: true };
  const b = { ...a, tolerancia_minutos: 11 };
  assert.notEqual(calculationHash(a), calculationHash(b));
});

test('Used revisions are append-only and cannot be updated or deleted', () => {
  assert.match(phase56, /trg_prevent_schedule_revision_mutation/);
  assert.match(phase56, /BEFORE UPDATE OR DELETE ON public\.schedule_revisions/);
  assert.match(phase56, /SCHEDULE_REVISION_IMMUTABLE/);
});

test('An active assignment receives an existing revision or is rejected', () => {
  assert.match(phase56, /trg_attach_schedule_revision/);
  assert.match(phase56, /effective_from<=NEW\.fecha_inicio/);
  assert.match(phase56, /SCHEDULE_REVISION_REQUIRED_FOR_ACTIVE_ASSIGNMENT/);
  assert.match(phase56, /SCHEDULE_REVISION_ASSIGNMENT_MISMATCH/);
});

test('Mutable calculation fields are frozen once a schedule has a revision', () => {
  assert.match(phase56, /trg_prevent_mutable_schedule_calculation_update/);
  assert.match(phase56, /NEW\.dias_config IS DISTINCT FROM OLD\.dias_config/);
  assert.match(phase56, /SCHEDULE_MUTABLE_CALCULATION_UPDATE_FORBIDDEN/);
});

test('Schedule revisions grant no direct authenticated mutation capability', () => {
  assert.match(phase56, /REVOKE ALL ON public\.schedule_revisions FROM PUBLIC, anon, authenticated/);
  assert.match(phase56, /GRANT SELECT ON public\.schedule_revisions TO authenticated/);
  assert.match(phase56, /ENABLE ROW LEVEL SECURITY/);
  assert.match(phase56, /schedule_revisions: SELECT tenant active/);
  assert.match(phase56, /cliente_id=public\.auth_cliente_id\(\)/);
});

test('Phase56 captures and verifies that its own transaction did not change downstream rows', () => {
  for (const relation of ['registro_asistencia', 'workday_records', 'workday_record_history', 'incidencias']) assert.match(phase56, new RegExp(`public\\.${relation}`));
  assert.match(phase56, /SCHEDULE_REVISION_INSTALLATION_CHANGED_DOWNSTREAM_DATA/);
});

test('Phase57 is read-only, rebound to Phase55, and checks the immutable contract', () => {
  assert.match(phase57, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(phase57, /ROLLBACK;/);
  assert.match(phase57, /SCHEDULE_REVISION_POSTCHECK_REBIND_REQUIRED/);
  assert.match(phase57, /dad64dfa2920b3c00cb6aae75283a835/);
  for (const expected of ['expected_voided_assignment_count', 'expected_attendance_rows', 'pgcrypto_installed', 'calculation_hash_function_present', 'assignment_revision_fk_present', 'immutable_revision_trigger_present', 'active_assignment_revision_trigger_present', 'mutable_schedule_guard_present', 'revision_rls_enabled', 'revision_tenant_select_policy_present', 'revision_authenticated_mutation_revoked', 'revision_anon_read_revoked', 'lifecycle_rpc_present', 'direct_assignment_dml_revoked', 'postcheck_pass']) {
    assert.match(phase57, new RegExp(expected));
  }
});

test('Current HorariosPage direct mutations remain visible for a later revision-creation flow', () => {
  assert.match(schedulePage, /\.from\(['"]horarios['"]\)[\s\S]{0,250}\.update/);
  assert.match(schedulePage, /\.from\(['"]horarios['"]\)[\s\S]{0,250}\.insert/);
  assert.match(schedulePage, /\.from\(['"]horarios['"]\)[\s\S]{0,250}\.delete/);
});
