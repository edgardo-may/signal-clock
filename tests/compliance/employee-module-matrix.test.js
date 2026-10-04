import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const precheckSql = read('database/live-schema/100_employee_security_and_audit_precheck.sql')
const changeSql = read('database/live-schema/101_employee_security_and_audit_change.sql')
const postcheckSql = read('database/live-schema/102_employee_security_and_audit_postcheck.sql')
const empleadosPage = read('src/features/employees/pages/EmpleadosPage.jsx')
const migration050 = read('supabase/migrations/050_employee_deactivation_device_removal.sql')
const migration048 = read('supabase/migrations/048_zkteco_tenant_identity_fingerprint_hardening.sql')
const migration017 = read('supabase/migrations/017_limites_tenant_real.sql')
const migration038 = read('supabase/migrations/038_employee_lifecycle_security.sql')

test('Scenario 1: Alta válida — campos obligatorios, tenant y asignación automática de ID biométrico', () => {
  assert.match(changeSql, /CREATE OR REPLACE FUNCTION public\.fn_auto_assign_biometric_id/)
  assert.match(changeSql, /COALESCE\(MAX\(NULLIF\(regexp_replace\(device_userid, '\\D', '', 'g'\), ''\)::INT\), 0\) \+ 1/)
  assert.match(empleadosPage, /const payload = \{[\s\S]*?nombre: String\(form\.nombre \|\| ''\)\.trim\(\)/)
  assert.match(empleadosPage, /apellido: String\(form\.apellido \|\| ''\)\.trim\(\)/)
})

test('Scenario 2: Alta cross-tenant rechazada por RLS estricto', () => {
  assert.match(changeSql, /CREATE POLICY role_insert ON public\.empleados/)
  assert.match(changeSql, /cliente_id = public\.auth_current_cliente_id\(\)/)
  assert.doesNotMatch(changeSql, /CREATE POLICY role_insert[\s\S]*?WITH CHECK \(TRUE\)/)
})

test('Scenario 3: Duplicados de clave laboral y device_userid rechazados con precheck obligatorio', () => {
  assert.match(precheckSql, /DUPLICATE_CLAVE_EMPLEADO_CHECK/)
  assert.match(changeSql, /IF v_dup_count > 0 THEN\s+RAISE EXCEPTION 'CHANGE ABORTED/)
  assert.match(changeSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_cliente_clave_empleado/)
  assert.match(migration048, /CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_cliente_device_userid/)
})

test('Scenario 4: Límite del tenant respetado por trigger defensivo', () => {
  assert.match(migration017, /CREATE OR REPLACE FUNCTION public\.fn_validar_limite_empleados_tenant/)
  assert.match(migration017, /v_conteo_actual >= v_cliente\.limite_empleados/)
  assert.match(migration017, /trg_validar_limite_empleados\s+BEFORE INSERT ON public\.empleados/)
})

test('Scenario 5: Edición válida de campos administrativos y personales', () => {
  assert.match(empleadosPage, /update\(\{[\s\S]*?clave_empleado: payload\.clave_empleado/)
  assert.match(empleadosPage, /departamento: payload\.departamento/)
  assert.match(empleadosPage, /puesto: payload\.puesto/)
  assert.match(empleadosPage, /pin: payload\.pin/)
  assert.match(empleadosPage, /tarjeta: payload\.tarjeta/)
})

test('Scenario 6: Edición cross-tenant y mutación de tenant rechazada', () => {
  assert.match(changeSql, /CREATE POLICY role_update ON public\.empleados/)
  assert.match(changeSql, /cliente_id = public\.auth_current_cliente_id\(\)/)
  assert.match(empleadosPage, /\.update\(\{[\s\S]*?\}\)\s*\.eq\('id', empleado\.id\)\s*\.eq\('cliente_id', finalClienteId\)/)
})

test('Scenario 7: Baja sin historial habilita CAN_DELETE o DEACTIVATE', () => {
  assert.match(changeSql, /IF v_has_attendance > 0 OR v_has_incidents > 0 THEN/)
  assert.match(changeSql, /RETURN jsonb_build_object\(\s*'status', 'CAN_DELETE'\s*\);/)
  assert.match(empleadosPage, /if \(status === 'CAN_DELETE'\)/)
})

test('Scenario 8: Baja con historial preserva asistencias, incidencias y plantillas', () => {
  assert.match(changeSql, /ELSIF v_has_attendance > 0 OR v_has_incidents > 0 THEN[\s\S]*?'status', 'CAN_DEACTIVATE'/)
  assert.match(changeSql, /attendance_count', v_has_attendance/)
  assert.match(changeSql, /incidents_count', v_has_incidents/)
  assert.match(changeSql, /trg_prevent_employee_deletion_with_history/)
  assert.match(changeSql, /RAISE EXCEPTION 'No se puede borrar físicamente el empleado/)
})

test('Scenario 9: Baja con turnos futuros bloqueada según contrato actual', () => {
  assert.match(changeSql, /SELECT COUNT\(\*\)\s+INTO v_has_active_shifts[\s\S]*?FROM public\.empleados_horarios[\s\S]*?AND activo = TRUE[\s\S]*?\(fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE\)/)
  assert.match(changeSql, /IF v_has_active_shifts > 0 THEN[\s\S]*?'status', 'HAS_ACTIVE_SHIFTS'/)
  assert.match(changeSql, /Cannot deactivate with active shifts/)
  assert.match(migration038, /trg_prevent_employee_deactivation_with_shifts/)
})

test('Scenario 10: Reactivación autoritativa (ACTIVATE) reanuda empleado', () => {
  assert.match(changeSql, /IF p_action = 'ACTIVATE' THEN/)
  assert.match(changeSql, /UPDATE public\.empleados\s+SET activo = TRUE/)
  assert.match(changeSql, /assignments_pending_sync', v_assignments_affected/)
  assert.match(changeSql, /'biometrics', 'RE_ENROLLMENT_REQUIRED'/)
  assert.match(empleadosPage, /p_action: 'ACTIVATE'/)
})

test('Scenario 11: Assignments de dispositivos suspendidos y reactivados selectivamente', () => {
  assert.match(migration050, /suspension_reason = 'EMPLOYEE_DEACTIVATED'/)
  assert.match(migration050, /WHERE employee_id = NEW\.id[\s\S]*?AND suspension_reason = 'EMPLOYEE_DEACTIVATED'/)
  assert.doesNotMatch(migration050, /suspension_reason = 'MANUAL_UNASSIGN'[\s\S]*?SET activo = TRUE/)
})

test('Scenario 12: Biometric templates permanecen intactos en base de datos', () => {
  assert.doesNotMatch(changeSql, /DELETE FROM public\.biometric_templates/)
  assert.doesNotMatch(migration050, /DELETE FROM public\.biometric_templates/)
  assert.match(changeSql, /biometrics', 'RE_ENROLLMENT_REQUIRED'/)
})

test('Scenario 13: Auditoría integral cubre CREATE, UPDATE, DEACTIVATE, REACTIVATE y DELETE', () => {
  assert.match(changeSql, /CREATE OR REPLACE FUNCTION public\.trg_audit_empleados\(\)/)
  assert.match(changeSql, /PERFORM public\.log_audit_event\([\s\S]*?'EMPLOYEE_CREATED'/)
  assert.match(changeSql, /'new_values', jsonb_build_object/)
  assert.match(changeSql, /'EMPLOYEE_UPDATED'/)
  assert.match(changeSql, /'old_values', v_old_values/)
  assert.match(changeSql, /'new_values', v_new_values/)
  assert.match(changeSql, /'changes', v_changes/)
  assert.match(changeSql, /'EMPLOYEE_DEACTIVATED'/)
  assert.match(changeSql, /'EMPLOYEE_REACTIVATED'/)
  assert.match(changeSql, /'EMPLOYEE_DELETED'/)
  assert.match(changeSql, /AFTER INSERT OR UPDATE OR DELETE ON public\.empleados/)
  assert.match(changeSql, /EXECUTE FUNCTION public\.trg_audit_empleados\(\)/)
  assert.doesNotMatch(changeSql, /hikvision_device_userid/)
  assert.doesNotMatch(changeSql, /fn_audit_empleados_changes/)
  assert.doesNotMatch(postcheckSql, /fn_audit_empleados_changes/)
  assert.match(postcheckSql, /'trg_audit_empleados'/)
  assert.match(precheckSql, /'trg_audit_empleados'/)
})

test('Scenario 14: RLS activado y 4 políticas explícitas en public.empleados', () => {
  assert.match(changeSql, /ALTER TABLE public\.empleados ENABLE ROW LEVEL SECURITY;/)
  assert.match(changeSql, /CREATE POLICY role_read ON public\.empleados/)
  assert.match(changeSql, /CREATE POLICY role_insert ON public\.empleados/)
  assert.match(changeSql, /CREATE POLICY role_update ON public\.empleados/)
  assert.match(changeSql, /CREATE POLICY role_delete ON public\.empleados/)
})

test('Scenario 15: Matriz de roles — mínimo privilegio (colaborador restringido)', () => {
  assert.match(changeSql, /public\.auth_current_role\(\) = 'colaborador'[\s\S]*?AND id = public\.auth_current_employee_id\(\)/)
  assert.match(changeSql, /public\.auth_current_role\(\) IN \('admin', 'rh'\)/)

  const insertPolicy = changeSql.slice(changeSql.indexOf('CREATE POLICY role_insert'), changeSql.indexOf('CREATE POLICY role_update'))
  const updatePolicy = changeSql.slice(changeSql.indexOf('CREATE POLICY role_update'), changeSql.indexOf('CREATE POLICY role_delete'))
  const deletePolicy = changeSql.slice(changeSql.indexOf('CREATE POLICY role_delete'), changeSql.indexOf('-- 4. HARDENING'))

  assert.doesNotMatch(insertPolicy, /\bcolaborador\b/)
  assert.doesNotMatch(updatePolicy, /\bcolaborador\b/)
  assert.doesNotMatch(deletePolicy, /\bcolaborador\b/)
})

test('Scenario 16: Concurrencia básica mediante advisory lock transaccional por tenant', () => {
  assert.match(changeSql, /PERFORM pg_advisory_xact_lock\(hashtext\('device_userid_' \|\| NEW\.cliente_id::text\)\);/)
  assert.match(migration048, /PERFORM pg_advisory_xact_lock\(hashtext\('device_userid_' \|\| NEW\.cliente_id::text\)\);/)
})

test('Scenario 17: Delimitación transaccional estricta y rollback en precheck/postcheck', () => {
  assert.match(precheckSql, /^BEGIN TRANSACTION READ ONLY;/m)
  assert.match(precheckSql, /ROLLBACK;$/m)
  assert.match(changeSql, /^BEGIN;/m)
  assert.match(changeSql, /COMMIT;$/m)
  assert.match(postcheckSql, /^BEGIN TRANSACTION READ ONLY;/m)
  assert.match(postcheckSql, /ROLLBACK;$/m)
})

test('Scenario 18: UI desacoplada de sincronización directa y sin Toaster duplicado', () => {
  assert.doesNotMatch(empleadosPage, /handleEmployeeDeactivation/)
  assert.doesNotMatch(empleadosPage, /handleEmployeeReactivation/)
  assert.doesNotMatch(empleadosPage, /<Toaster\b/)
  assert.doesNotMatch(empleadosPage, /import\s+.*\{[^}]*Toaster[^}]*\}\s+from\s+'react-hot-toast'/)
})

