// Shared role capabilities. UI guards improve the experience; Supabase RLS
// remains the source of truth for authorization.
export const ROLE = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  AUDITOR: 'auditor',
})

export const PERMISSION = Object.freeze({
  PLATFORM_MANAGE: 'platform.manage',
  DASHBOARD: 'dashboard',
  EMPLOYEES: 'employees',
  SCHEDULES: 'schedules',
  SCHEDULE_AGENDA: 'schedule_agenda',
  HOLIDAYS: 'holidays',
  ATTENDANCE: 'attendance',
  ATTENDANCE_MANAGE: 'attendance_manage',
  REPORTS: 'reports',
  BIOMETRICS: 'biometrics',
  USERS: 'users',
  SYNCHRONIZATION: 'synchronization',
  PERMISSIONS: 'permissions',
  ENROLLMENT: 'enrollment',
})

export const TENANT_MODULES = Object.freeze([
  { key: PERMISSION.DASHBOARD, label: 'Dashboard', description: 'Indicadores generales de asistencia.', group: 'Consulta' },
  { key: PERMISSION.EMPLOYEES, label: 'Colaboradores', description: 'Directorio y administración de personal.', group: 'Operación' },
  { key: PERMISSION.SCHEDULES, label: 'Horarios y turnos', description: 'Creación y edición de horarios.', group: 'Operación' },
  { key: PERMISSION.SCHEDULE_AGENDA, label: 'Agenda de turnos', description: 'Asignación de horarios a colaboradores.', group: 'Operación' },
  { key: PERMISSION.HOLIDAYS, label: 'Días festivos', description: 'Configuración de asuetos y días no laborables.', group: 'Operación' },
  { key: PERMISSION.ATTENDANCE, label: 'Asistencia', description: 'Checadas, incidencias y kiosco.', group: 'Operación' },
  { key: PERMISSION.ATTENDANCE_MANAGE, label: 'Operación de asistencia', description: 'Captura manual, incidencias y kiosco de checado.', group: 'Operación' },
  { key: PERMISSION.REPORTS, label: 'Reportes', description: 'Reportes, matriz, retardos e historial.', group: 'Consulta' },
  { key: PERMISSION.BIOMETRICS, label: 'Biométricos', description: 'Dispositivos, asignaciones y enrolamiento.', group: 'Dispositivos' },
  { key: PERMISSION.SYNCHRONIZATION, label: 'Sincronización', description: 'Importación y sincronización de colaboradores.', group: 'Administración' },
  { key: PERMISSION.USERS, label: 'Usuarios', description: 'Administración de usuarios de la empresa.', group: 'Administración' },
  { key: PERMISSION.PERMISSIONS, label: 'Permisos de módulos', description: 'Asignación de accesos por usuario.', group: 'Administración' },
  { key: PERMISSION.ENROLLMENT, label: 'Enrolamiento', description: 'Registro biométrico de rostros y huellas.', group: 'Dispositivos' },
])

const AUDITOR_DEFAULT_MODULES = new Set([
  PERMISSION.DASHBOARD,
  PERMISSION.ATTENDANCE,
  PERMISSION.REPORTS,
])

export function normalizeRole(role) {
  return String(role || '').trim().toLowerCase()
}

export function isSuperAdmin(profile) {
  return normalizeRole(profile?.rol) === ROLE.SUPERADMIN
}

export function isAuditor(profile) {
  return normalizeRole(profile?.rol) === ROLE.AUDITOR
}

export function getDefaultModuleAccess(profile, permission) {
  const role = normalizeRole(profile?.rol)

  if (role === ROLE.SUPERADMIN) return permission === PERMISSION.PLATFORM_MANAGE
  if (role === ROLE.ADMIN) return permission !== PERMISSION.PLATFORM_MANAGE
  if (role === ROLE.AUDITOR) return AUDITOR_DEFAULT_MODULES.has(permission)

  // Existing roles are intentionally left unchanged until their own permission
  // model is implemented.
  return true
}

export function hasPermission(profile, permission, modulePermissions = {}) {
  if (Object.prototype.hasOwnProperty.call(modulePermissions, permission)) {
    return modulePermissions[permission] === true
  }

  return getDefaultModuleAccess(profile, permission)
}
