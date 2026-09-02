import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const { Client } = pg

function hostname(value) {
  try { return value ? new URL(value).hostname.toLowerCase() : '' } catch { return '' }
}

export function isSafeAuditTarget({ url, dbUrl, label }) {
  const apiHost = hostname(url)
  const databaseHost = hostname(dbUrl)
  const configuredProductionHost = (process.env.PHASE2_PRODUCTION_HOST || '').toLowerCase()
  const looksProduction = host => /(^|[.-])(prod|production)([.-]|$)/i.test(host) || (configuredProductionHost && host === configuredProductionHost)
  return /^(local|test|staging)$/i.test(label || '') && !looksProduction(apiHost) && !looksProduction(databaseHost)
}

export function auditConfig() {
  const url = process.env.SUPABASE_TEST_URL
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  const dbUrl = process.env.PHASE2_AUDIT_DATABASE_URL
  const label = process.env.PHASE2_AUDIT_DB_LABEL
  const allowed = process.env.ALLOW_DESTRUCTIVE_TEST_DB === 'true'
  const safe = isSafeAuditTarget({ url, dbUrl, label })
  const missing = [
    !url && 'SUPABASE_TEST_URL',
    !anonKey && 'SUPABASE_TEST_ANON_KEY',
    !serviceKey && 'SUPABASE_TEST_SERVICE_ROLE_KEY',
    !dbUrl && 'PHASE2_AUDIT_DATABASE_URL',
    !label && 'PHASE2_AUDIT_DB_LABEL',
    !allowed && 'ALLOW_DESTRUCTIVE_TEST_DB=true'
  ].filter(Boolean)
  return { url, anonKey, serviceKey, dbUrl, label, allowed, safe, missing, ready: Boolean(url && anonKey && serviceKey && dbUrl && allowed && safe) }
}

/** Direct SQL is used only by DBREAL test setup/verification against the guarded audit DB. */
export async function postgresAdminClient(config) {
  if (!config.ready) throw new Error('Refusing direct PostgreSQL client without a guarded DBREAL configuration.')
  const client = new Client({ connectionString: config.dbUrl })
  await client.connect()
  return client
}

export async function createFixture(config) {
  const service = createClient(config.url, config.serviceKey, { auth: { persistSession: false } })
  const suffix = randomUUID().slice(0, 8)
  const insert = async (table, row) => { const { data, error } = await service.from(table).insert(row).select().single(); if (error) throw error; return data }
  const tenantA = await insert('clientes', { nombre_empresa: `DBREAL A ${suffix}`, timezone: 'America/Merida' })
  const tenantB = await insert('clientes', { nombre_empresa: `DBREAL B ${suffix}`, timezone: 'America/Merida' })
  const makeUser = async (tenant, role, name) => {
    const email = `${name}.${suffix}@dbreal.invalid`
    const { data, error } = await service.auth.admin.createUser({ email, password: `Test-${suffix}-Password!`, email_confirm: true, user_metadata: { cliente_id: tenant.id, nombre: name, rol: role } })
    if (error) throw error
    // Existing auth trigger is intentionally the source of the profile. Ensure role matches current schema.
    const { error: profileError } = await service.from('usuarios_perfiles').update({ rol: role }).eq('id', data.user.id)
    if (profileError) throw profileError
    return { id: data.user.id, email, password: `Test-${suffix}-Password!` }
  }
  const adminA = await makeUser(tenantA, 'admin', 'admin-a')
  const adminB = await makeUser(tenantB, 'admin', 'admin-b')
  const employeeUserA1 = await makeUser(tenantA, 'operador', 'employee-a1')
  const employeeUserA2 = await makeUser(tenantA, 'operador', 'employee-a2')
  const employeeUserB1 = await makeUser(tenantB, 'operador', 'employee-b1')
  const employeeA1 = await insert('empleados', { cliente_id: tenantA.id, hikvision_device_userid: `a1-${suffix}`, nombre: 'A1', apellido: 'Test' })
  const employeeA2 = await insert('empleados', { cliente_id: tenantA.id, hikvision_device_userid: `a2-${suffix}`, nombre: 'A2', apellido: 'Test' })
  const employeeB1 = await insert('empleados', { cliente_id: tenantB.id, hikvision_device_userid: `b1-${suffix}`, nombre: 'B1', apellido: 'Test' })
  for (const [employee, user, tenant] of [[employeeA1, employeeUserA1, tenantA], [employeeA2, employeeUserA2, tenantA], [employeeB1, employeeUserB1, tenantB]]) await insert('employee_user_links', { cliente_id: tenant.id, empleado_id: employee.id, auth_user_id: user.id })
  const activeNight = { activo: true, entrada: '22:00', salida: '06:00' }
  const schedule = await insert('horarios', {
    cliente_id: tenantA.id,
    nombre: `Noche ${suffix}`,
    dias_config: { dom: activeNight, lun: activeNight, mar: activeNight, mie: activeNight, jue: activeNight, vie: activeNight, sab: activeNight }
  })
  const assignment = await insert('empleados_horarios', { cliente_id: tenantA.id, empleado_id: employeeA1.id, horario_id: schedule.id, fecha_inicio: '2026-09-01', activo: true })
  await insert('tenant_features', { cliente_id: tenantA.id, feature_key: 'attendance_engine_v2', state: 'SHADOW' })
  await insert('tenant_features', { cliente_id: tenantA.id, feature_key: 'electronic_workday_record', state: 'SHADOW' })
  const log = await insert('attendance_logs', { cliente_id: tenantA.id, numero_serie: `device-${suffix}`, biometric_user_id: employeeA1.hikvision_device_userid, timestamp: '2026-09-01T22:00:00.000Z' })
  const login = async user => { const c = createClient(config.url, config.anonKey, { auth: { persistSession: false } }); const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password }); if (error) throw error; return c }
  return { service, tenantA, tenantB, adminA, adminB, employeeUserA1, employeeUserA2, employeeUserB1, employeeA1, employeeA2, employeeB1, schedule, assignment, log, login, suffix }
}

export function payload(fixture, overrides = {}) {
  return { cliente_id: fixture.tenantA.id, empleado_id: fixture.employeeA1.id, schedule_assignment_id: fixture.assignment.id, workday_date: '2026-09-01', timezone: 'America/Merida', scheduled_start: '2026-09-01T22:00:00.000Z', scheduled_end: '2026-09-02T06:00:00.000Z', actual_start: '2026-09-01T22:00:00.000Z', actual_end: '2026-09-02T06:00:00.000Z', worked_minutes: 480, break_minutes: 0, effective_minutes: 480, late_minutes: 0, early_leave_minutes: 0, ordinary_minutes: 480, overtime_minutes: 0, workday_state: 'COMPLETE', calculation_version: '2.3', integrity_hash: randomUUID(), source_log_ids: [fixture.log.id], source_window_start_utc: '2026-09-01T20:00:00.000Z', source_window_end_utc: '2026-09-02T08:00:00.000Z', punch_dispositions: [], incidents: [], warnings: [], ...overrides }
}

export async function cleanupFixture(fixture) {
  if (!fixture) return
  await fixture.service.from('clientes').delete().in('id', [fixture.tenantA.id, fixture.tenantB.id])
  for (const user of [fixture.adminA, fixture.adminB, fixture.employeeUserA1, fixture.employeeUserA2, fixture.employeeUserB1]) await fixture.service.auth.admin.deleteUser(user.id)
}
