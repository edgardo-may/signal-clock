import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../../supabase/migrations/050_employee_deactivation_device_removal.sql', import.meta.url), 'utf8')
const employeePage = readFileSync(new URL('../../src/features/employees/pages/EmpleadosPage.jsx', import.meta.url), 'utf8')
const syncService = readFileSync(new URL('../../src/features/biometrics/services/syncService.js', import.meta.url), 'utf8')
const connector = readFileSync(new URL('../../zkteco-push-ta/src/server.ts', import.meta.url), 'utf8')

test('A: one active assignment is suspended and queues a DELETE through the assignment producer', () => {
  assert.match(migration, /WHERE employee_id = NEW\.id[\s\S]*?AND activo = TRUE/)
  assert.match(migration, /suspension_reason = 'EMPLOYEE_DEACTIVATED'/)
  assert.match(migration, /DATA DELETE USERINFO PIN=' \|\| var_pin/)
  assert.ok(migration.includes("IF var_pin IS NULL OR var_pin !~ '^[0-9]+$' THEN"))
})

test('production trigger only runs for desired-state changes, never ACK state fields', () => {
  assert.match(migration, /CREATE TRIGGER trg_sync_employee_assignment\s+BEFORE INSERT OR UPDATE OF activo, biometric_user_id\s+ON public\.device_employee_assignments/s)
  assert.doesNotMatch(migration, /UPDATE OF sync_status/)
})

test('B: lifecycle updates every tenant-owned active assignment, not a first device', () => {
  assert.doesNotMatch(migration, /LIMIT 1[\s\S]{0,300}device_employee_assignments/)
  assert.match(migration, /UPDATE public\.device_employee_assignments[\s\S]*?WHERE employee_id = NEW\.id/)
})

test('C: offline terminals retain the pending DELETE until /getrequest polls', () => {
  assert.match(migration, /is_executed\s*\) VALUES[\s\S]*?FALSE/)
  assert.match(connector, /\.eq\('is_executed', false\)/)
})

test('D and E: ACK Return controls assignment success/error rather than is_executed alone', () => {
  assert.match(connector, /if \(returnCode === 0\)/)
  assert.match(connector, /sync_status: 'SYNCED'/)
  assert.match(connector, /sync_status: 'ERROR'/)
  assert.match(connector, /`Terminal Return=\$\{returnCode\}`/)
  assert.match(connector, /is_executed: true/)
})

test('F: duplicate pending commands are deduplicated by exact parsed PIN', () => {
  assert.match(migration, /\^DATA DELETE USERINFO PIN=\(\[0-9\]\+\)\$/)
  assert.doesNotMatch(migration, /LIKE 'DATA DELETE USERINFO/)
  assert.doesNotMatch(migration, /DATA DELETE USERINFO Pin=/)
})

test('unsafe DELETE USERINFO commands fail closed before dispatch', () => {
  assert.match(connector, /function isSafeDeleteUserInfoCommand[\s\S]*?\^DATA DELETE USERINFO PIN=\[0-9\]\+\$/)
  assert.match(connector, /COMMAND BLOCKED[\s\S]*?Unsafe DELETE USERINFO command/)
  assert.match(connector, /is_executed: true[\s\S]*?updated_at:/)
})

test('G: deactivation is logical and does not delete history or templates', () => {
  assert.doesNotMatch(migration, /DELETE FROM public\.(registro_asistencia|attendance_logs|incidencias|biometric_templates)/)
  assert.match(migration, /SET activo = FALSE/)
})

test('H and I: reactivation is limited to EMPLOYEE_DEACTIVATED, never MANUAL_UNASSIGN', () => {
  assert.match(migration, /AND suspension_reason = 'EMPLOYEE_DEACTIVATED'/)
  assert.doesNotMatch(migration, /suspension_reason = 'MANUAL_UNASSIGN'/)
})

test('J: real post-049 device_commands schema is used without a tenant column', () => {
  assert.doesNotMatch(migration, /device_commands[\s\S]{0,400}cliente_id/)
  assert.doesNotMatch(migration, /numero_serie/)
  assert.doesNotMatch(connector, /\.from\('device_commands'\)[\s\S]{0,300}\.eq\('cliente_id', clienteId\)/)
  assert.doesNotMatch(connector, /executed_at:|return_code:/)
  assert.match(connector, /\.eq\('device_id', device\.id\)\s+\.eq\('cliente_id', clienteId\)/)
})

test('frontend delegates employee deactivation/reactivation to the RPC only', () => {
  assert.doesNotMatch(employeePage, /handleEmployeeDeactivation/)
  assert.doesNotMatch(employeePage, /handleEmployeeReactivation/)
  assert.match(employeePage, /p_action: 'DEACTIVATE'/)
  assert.match(employeePage, /p_action: 'ACTIVATE'/)
})

test('the frontend sync service does not create USERINFO or DELETE USERINFO commands', () => {
  assert.doesNotMatch(syncService, /DATA (?:UPDATE |DELETE )?USERINFO/)
  assert.doesNotMatch(syncService, /handleEmployee(?:Deactivation|Reactivation)/)
})
