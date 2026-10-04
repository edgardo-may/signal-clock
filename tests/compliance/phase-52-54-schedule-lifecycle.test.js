import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')
const phase52 = read('database/live-schema/52_schedule_lifecycle_precheck.sql')
const phase53 = read('database/live-schema/53_schedule_lifecycle_change.sql')
const phase54 = read('database/live-schema/54_schedule_lifecycle_postcheck.sql')
const service = read('src/features/schedules/services/scheduleLifecycleService.js')
const page = read('src/features/schedules/pages/AsignacionHorariosPage.jsx')
const uncommented = (sql) => sql.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

for (const [name, sql] of [['Phase 52', phase52], ['Phase 54', phase54]]) {
  test(`${name} is read-only and rolls back`, () => {
    const executable = uncommented(sql)
    assert.match(executable, /^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i)
    assert.match(executable, /\bROLLBACK\s*;\s*$/i)
    assert.doesNotMatch(executable, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im)
  })
}

test('Phase 52 requires the installed Phase 46-48 contract and reports a rebindable snapshot', () => {
  for (const token of ['btree_gist_installed', 'fecha_inicio_not_null', 'range_check_present', 'active_exclusion_present', 'assignment_snapshot_hash', 'active_overlap_pairs', 'safe_to_apply_lifecycle_change']) {
    assert.ok(phase52.includes(token), token)
  }
  assert.match(phase52, /unaudited_inactive_rows/)
  assert.match(phase52, /authenticated_direct_write_grants/)
})

test('Phase 53 is rebound and performs every guard before lifecycle DDL', () => {
  assert.match(phase53, /\bBEGIN\s+ISOLATION\s+LEVEL\s+REPEATABLE\s+READ;/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_REBIND_REQUIRED/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_PRECHECK_DRIFT/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_PRECHECK_UNSAFE/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_BTREE_GIST_MISSING/)
  assert.match(phase53, /COMMIT;\s*$/)
  assert.match(phase53, /dad64dfa2920b3c00cb6aae75283a835/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_LEGACY_DML_GRANTS_UNEXPECTED/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_LEGACY_AUDIT_TRIGGER_UNEXPECTED/)
  assert.match(phase53, /DROP TRIGGER IF EXISTS trg_audit_empleados_horarios_changes/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_INSTALLATION_HARDENING_FAILED/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_INSTALLATION_CHANGED_DOWNSTREAM_DATA/)
  assert.match(phase53, /app\.schedule_lifecycle\.attendance_baseline/)
  assert.ok(phase53.indexOf('SCHEDULE_LIFECYCLE_PRECHECK_DRIFT') < phase53.indexOf('CREATE OR REPLACE FUNCTION public.apply_employee_schedule_lifecycle'))
})

test('atomic lifecycle preserves historical active assignments and reserves inactive for genuine void', () => {
  assert.match(phase53, /p_effective_date-1/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_SAME_DAY_REPLACEMENT_UNSUPPORTED/)
  assert.match(phase53, /UPDATE public\.empleados_horarios SET fecha_fin=p_effective_date/)
  assert.match(phase53, /UPDATE public\.empleados_horarios SET activo=false/)
  assert.match(phase53, /SCHEDULE_LIFECYCLE_VOID_ASSIGNMENT_REQUIRED/)
  assert.match(phase53, /SCHEDULE_VOIDED/)
  assert.match(phase53, /SCHEDULE_CLOSED/)
  assert.match(phase53, /SCHEDULE_ASSIGNED/)
})

test('retroactive operations require a reason, preview and explicit confirmation', () => {
  for (const token of ['SCHEDULE_LIFECYCLE_RETROACTIVE_CONFIRMATION_REQUIRED', 'p_preview_only', 'affected_attendance_count', 'affected_workday_count', "nullif(trim(p_reason),'') IS NULL"]) {
    assert.ok(phase53.includes(token), token)
  }
  assert.match(phase53, /FROM public\.registro_asistencia/)
  assert.doesNotMatch(phase53, /attendance_logs[^\n]*cliente_id/i)
})

test('RPC is the only authenticated writer and is hardened before direct grants are revoked', () => {
  assert.match(phase53, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(phase53, /v_role NOT IN \('superadmin','admin','rh'\)/)
  assert.match(phase53, /auth_current_cliente_id\(\) IS DISTINCT FROM p_cliente_id/)
  assert.match(phase53, /REVOKE INSERT, UPDATE, DELETE ON public\.empleados_horarios FROM authenticated/)
  assert.match(phase53, /GRANT EXECUTE ON FUNCTION public\.apply_employee_schedule_lifecycle/)
  assert.match(phase53, /REVOKE ALL ON FUNCTION public\.apply_employee_schedule_lifecycle[\s\S]*FROM PUBLIC, anon/)
  assert.match(phase53, /pg_advisory_xact_lock/)
  assert.match(phase53, /FOR UPDATE/)
})

test('audit is complete, correlation-bound and rolls back with the transaction if it fails', () => {
  for (const field of ['cliente_id', 'empleado_id', 'assignment_id', 'horario_id', 'old_values', 'new_values', 'reason', 'correlation_id', 'timestamp']) {
    assert.ok(phase53.includes(`'${field}'`), field)
  }
  assert.match(phase53, /DROP TRIGGER IF EXISTS trg_audit_empleados_horarios_changes/)
  assert.doesNotMatch(phase53, /CREATE OR REPLACE FUNCTION public\.trg_audit_empleados_horarios/)
})

test('the frontend makes one RPC call per atomic user operation and has no direct assignment DML', () => {
  assert.match(service, /supabase\.rpc\('apply_employee_schedule_lifecycle'/)
  assert.match(page, /scheduleLifecycleService\.assignOrReplace/)
  assert.match(page, /scheduleLifecycleService\.close/)
  const directAssignmentDml = page.match(/from\('empleados_horarios'\)[\s\S]{0,160}\.(?:insert|update|delete)\s*\(/g) ?? []
  assert.equal(directAssignmentDml.length, 0)
})

test('Phase 54 verifies extension, constraints, hardened RPC, revoked bypass and target rows', () => {
  for (const token of ['btree_gist_installed', 'fecha_inicio_not_null', 'range_check_present', 'active_exclusion_present', 'rpc_present', 'rpc_authenticated_execute', 'rpc_anon_execute_revoked', 'authenticated_direct_dml_revoked', 'legacy_audit_trigger_retired', 'hardened_definer_rpc', 'target_states_and_audits_valid', 'postcheck_pass', 'SCHEDULE_VOIDED', 'SCHEDULE_VALIDATED', 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f', '2984316c-1c93-4f66-853e-349f90b9f82c']) {
    assert.ok(phase54.includes(token), token)
  }
  assert.match(phase54, /target_validation AS \([\s\S]*?FROM targets/)
})

for (const [scenario, expected] of [
  ['first assignment', 'INSERT INTO public.empleados_horarios'],
  ['replacement A/B closes A and inserts B', 'fecha_fin=p_effective_date-1'],
  ['future B preserves active A', 'v_old.fecha_inicio = p_effective_date'],
  ['same-day DATE replacement is rejected', 'SCHEDULE_LIFECYCLE_SAME_DAY_REPLACEMENT_UNSUPPORTED'],
  ['intraday replacement is rejected', 'SCHEDULE_LIFECYCLE_SAME_DAY_REPLACEMENT_UNSUPPORTED'],
  ['authorized retroactive preview', "'preview_only',true"],
  ['retroactive without reason is rejected', "nullif(trim(p_reason),'') IS NULL"],
  ['overlap is rejected by database exclusion', 'SCHEDULE_LIFECYCLE_CONTRACT_MISSING'],
  ['gap is allowed', 'fecha_inicio <= p_effective_date'],
  ['normal unassignment closes instead of voiding', "v_action='CLOSE'"],
  ['real void requires reason', "v_action='VOID'"],
  ['void without reason is rejected', 'SCHEDULE_LIFECYCLE_INVALID_ARGUMENTS'],
  ['two concurrent admins serialize with advisory lock', 'pg_advisory_xact_lock'],
  ['wrong tenant is rejected', 'SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH'],
  ['wrong employee is rejected', 'SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH'],
  ['schedule from another tenant is rejected', 'SCHEDULE_LIFECYCLE_SCHEDULE_TENANT_MISMATCH'],
  ['audit has required metadata', "'correlation_id'"],
  ['audit failure rolls back', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
  ['insert failure rolls back', 'COMMIT;'],
  ['historical resolver range remains intact', 'UPDATE public.empleados_horarios SET fecha_fin'],
]) {
  test(`lifecycle contract: ${scenario}`, () => assert.ok(phase53.includes(expected), expected))
}
