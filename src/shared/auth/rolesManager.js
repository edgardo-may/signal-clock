/**
 * rolesManager.js
 * Signum-Clock · Gestión de roles de tenant, temas de color y módulos permitidos por rol.
 */

import { PERMISSION, TENANT_MODULES } from './permissions'

// Temas visuales para las insignias de roles
export const ROLE_THEMES = {
  blue: {
    key: 'blue',
    label: 'Azul (Administración)',
    badgeCls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    dotCls: 'bg-blue-500',
    accentBorder: 'border-blue-500',
    accentBg: 'bg-blue-50 dark:bg-blue-950/40',
  },
  emerald: {
    key: 'emerald',
    label: 'Esmeralda (Operación / RH)',
    badgeCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    dotCls: 'bg-emerald-500',
    accentBorder: 'border-emerald-500',
    accentBg: 'bg-emerald-50 dark:bg-emerald-950/40',
  },
  violet: {
    key: 'violet',
    label: 'Violeta (Supervisión)',
    badgeCls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
    dotCls: 'bg-violet-500',
    accentBorder: 'border-violet-500',
    accentBg: 'bg-violet-50 dark:bg-violet-950/40',
  },
  amber: {
    key: 'amber',
    label: 'Ámbar (Operador / Enlace)',
    badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    dotCls: 'bg-amber-500',
    accentBorder: 'border-amber-500',
    accentBg: 'bg-amber-50 dark:bg-amber-950/40',
  },
  rose: {
    key: 'rose',
    label: 'Rosa / Coral (Restringido)',
    badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
    dotCls: 'bg-rose-500',
    accentBorder: 'border-rose-500',
    accentBg: 'bg-rose-50 dark:bg-rose-950/40',
  },
  sky: {
    key: 'sky',
    label: 'Cielo (Consulta)',
    badgeCls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
    dotCls: 'bg-sky-500',
    accentBorder: 'border-sky-500',
    accentBg: 'bg-sky-50 dark:bg-sky-950/40',
  },
  indigo: {
    key: 'indigo',
    label: 'Índigo (Seguridad / Especial)',
    badgeCls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    dotCls: 'bg-indigo-500',
    accentBorder: 'border-indigo-500',
    accentBg: 'bg-indigo-50 dark:bg-indigo-950/40',
  },
}

// Helper para obtener todos los módulos disponibles para tenant
export const getAllModuleKeys = () => (TENANT_MODULES || []).map((m) => m.key)

// Roles base del sistema (incorporan los roles predefinidos)
export const BASE_ROLES = [
  {
    key: 'ADMIN',
    label: 'Administrador',
    desc: 'Acceso total: Usuarios, biométricos, turnos, auditoría y configuración global.',
    theme: 'blue',
    isSystem: true,
    get defaultModules() {
      return getAllModuleKeys().filter((k) => k !== PERMISSION.PLATFORM_MANAGE)
    },
  },
  {
    key: 'AUDITOR',
    label: 'Consulta y Reportes',
    desc: 'Solo consulta de asistencia, paneles y reportes. No puede modificar información.',
    theme: 'sky',
    isSystem: true,
    defaultModules: [
      PERMISSION.DASHBOARD,
      PERMISSION.ATTENDANCE,
      PERMISSION.REPORTS,
    ],
  },
  {
    key: 'RH',
    label: 'Recursos Humanos',
    desc: 'Control de incidencias, colaboradores, días festivos y reportes de asistencia.',
    theme: 'emerald',
    isSystem: false,
    defaultModules: [
      PERMISSION.DASHBOARD,
      PERMISSION.EMPLOYEES,
      PERMISSION.HOLIDAYS,
      PERMISSION.ATTENDANCE,
      PERMISSION.ATTENDANCE_MANAGE,
      PERMISSION.REPORTS,
    ],
  },
  {
    key: 'SUPERVISOR',
    label: 'Supervisor de Turno',
    desc: 'Gestión de personal, asignación de horarios, turnos y checadas.',
    theme: 'violet',
    isSystem: false,
    defaultModules: [
      PERMISSION.DASHBOARD,
      PERMISSION.EMPLOYEES,
      PERMISSION.SCHEDULES,
      PERMISSION.SCHEDULE_AGENDA,
      PERMISSION.ATTENDANCE,
      PERMISSION.ATTENDANCE_MANAGE,
    ],
  },
  {
    key: 'COLABORADOR',
    label: 'Colaborador',
    desc: 'Acceso al portal colaborador y consulta personal de checadas.',
    theme: 'amber',
    isSystem: false,
    defaultModules: [
      PERMISSION.DASHBOARD,
      PERMISSION.ATTENDANCE,
    ],
  },
]

const STORAGE_CUSTOM_ROLES_KEY = 'signum_custom_roles'
const STORAGE_ROLE_MODULES_KEY = 'signum_role_modules'

function getStorageKey(base, clienteId) {
  return clienteId ? `${base}_${clienteId}` : base
}

/**
 * Obtiene todos los roles disponibles para el tenant actual (Base + Personalizados)
 */
export function getTenantRoles(clienteId = null) {
  let custom = []
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(getStorageKey(STORAGE_CUSTOM_ROLES_KEY, clienteId))
      if (raw) {
        custom = JSON.parse(raw)
      }
    } catch (e) {
      console.error('Error al leer roles personalizados:', e)
    }
  }

  // Combinar roles base con personalizados (evitar duplicados por key normalizada)
  const baseMap = new Map(BASE_ROLES.map((r) => [r.key.toUpperCase(), { ...r }]))
  
  custom.forEach((cr) => {
    const keyUpper = String(cr.key || '').trim().toUpperCase()
    if (!keyUpper) return
    if (baseMap.has(keyUpper)) {
      // Si sobreescribe un rol base (excepto isSystem flag)
      const existing = baseMap.get(keyUpper)
      baseMap.set(keyUpper, { ...existing, ...cr, isSystem: existing.isSystem })
    } else {
      baseMap.set(keyUpper, {
        ...cr,
        key: keyUpper,
        isSystem: false,
        theme: cr.theme || 'indigo',
        defaultModules: cr.defaultModules || [PERMISSION.DASHBOARD],
      })
    }
  })

  return Array.from(baseMap.values())
}

/**
 * Guarda un rol nuevo o actualiza uno existente
 */
export function saveCustomRole(clienteId, roleData) {
  if (typeof window === 'undefined') return
  const cleanKey = String(roleData.key || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')

  if (!cleanKey) throw new Error('La clave del rol es requerida')

  const roles = getTenantRoles(clienteId)
  const isBaseSystem = BASE_ROLES.find((r) => r.key === cleanKey)?.isSystem

  // Guardar en la lista de personalizados
  const customKey = getStorageKey(STORAGE_CUSTOM_ROLES_KEY, clienteId)
  let customList = []
  try {
    const raw = localStorage.getItem(customKey)
    if (raw) customList = JSON.parse(raw)
  } catch (e) {
    customList = []
  }

  const existingIdx = customList.findIndex((r) => r.key.toUpperCase() === cleanKey)
  const newRoleObj = {
    key: cleanKey,
    label: roleData.label || cleanKey,
    desc: roleData.desc || '',
    theme: roleData.theme || 'indigo',
    isSystem: Boolean(isBaseSystem),
    defaultModules: roleData.defaultModules || [PERMISSION.DASHBOARD],
  }

  if (existingIdx >= 0) {
    customList[existingIdx] = newRoleObj
  } else {
    customList.push(newRoleObj)
  }

  localStorage.setItem(customKey, JSON.stringify(customList))

  // Si vienen módulos configurados, guardarlos también en el mapeo de módulos
  if (Array.isArray(roleData.defaultModules)) {
    saveRoleModulesSync(clienteId, cleanKey, roleData.defaultModules)
  }

  notifyRolesUpdated()
  return newRoleObj
}

/**
 * Elimina un rol personalizado
 */
export function deleteCustomRole(clienteId, roleKey) {
  if (typeof window === 'undefined') return
  const cleanKey = String(roleKey || '').trim().toUpperCase()

  const systemRole = BASE_ROLES.find((r) => r.key === cleanKey && r.isSystem)
  if (systemRole) {
    throw new Error(`El rol del sistema "${systemRole.label}" está protegido y no puede eliminarse.`)
  }

  const customKey = getStorageKey(STORAGE_CUSTOM_ROLES_KEY, clienteId)
  try {
    const raw = localStorage.getItem(customKey)
    if (raw) {
      let customList = JSON.parse(raw)
      customList = customList.filter((r) => r.key.toUpperCase() !== cleanKey)
      localStorage.setItem(customKey, JSON.stringify(customList))
    }
  } catch (e) {
    console.error('Error al eliminar rol:', e)
  }

  // Eliminar también su mapeo de módulos
  const modKey = getStorageKey(STORAGE_ROLE_MODULES_KEY, clienteId)
  try {
    const rawMod = localStorage.getItem(modKey)
    if (rawMod) {
      const modMap = JSON.parse(rawMod)
      delete modMap[cleanKey]
      localStorage.setItem(modKey, JSON.stringify(modMap))
    }
  } catch (e) {
    console.error('Error al limpiar módulos del rol:', e)
  }

  notifyRolesUpdated()
}

/**
 * Obtiene las claves de módulos asignados a un rol
 */
export function getRoleModuleKeys(roleKey, clienteId = null) {
  const cleanKey = String(roleKey || '').trim().toUpperCase()
  if (!cleanKey) return []

  // 1. Revisar si hay configuración personalizada de módulos en storage
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(getStorageKey(STORAGE_ROLE_MODULES_KEY, clienteId))
      if (raw) {
        const map = JSON.parse(raw)
        if (Array.isArray(map[cleanKey])) {
          return map[cleanKey]
        }
      }
    } catch (e) {
      // continuar a defaults
    }
  }

  // 2. Buscar en roles cargados (base o personalizados)
  const allRoles = getTenantRoles(clienteId)
  const found = allRoles.find((r) => r.key.toUpperCase() === cleanKey)
  if (found?.defaultModules) {
    return found.defaultModules
  }

  // 3. Fallback seguro por nombre común
  if (cleanKey === 'ADMIN' || cleanKey === 'SUPERADMIN') return ALL_MODULE_KEYS
  if (cleanKey === 'AUDITOR') return [PERMISSION.DASHBOARD, PERMISSION.ATTENDANCE, PERMISSION.REPORTS]
  
  return [PERMISSION.DASHBOARD, PERMISSION.ATTENDANCE]
}

function saveRoleModulesSync(clienteId, roleKey, moduleKeys) {
  if (typeof window === 'undefined') return
  const cleanKey = String(roleKey || '').trim().toUpperCase()
  const modKey = getStorageKey(STORAGE_ROLE_MODULES_KEY, clienteId)

  let map = {}
  try {
    const raw = localStorage.getItem(modKey)
    if (raw) map = JSON.parse(raw)
  } catch (e) {
    map = {}
  }

  map[cleanKey] = Array.isArray(moduleKeys) ? moduleKeys : []
  localStorage.setItem(modKey, JSON.stringify(map))
}

/**
 * Guarda los módulos visualizables de un rol y sincroniza en segundo plano con los usuarios
 */
export async function saveRoleModules(clienteId, roleKey, moduleKeys, supabaseClient = null) {
  const cleanKey = String(roleKey || '').trim().toUpperCase()
  saveRoleModulesSync(clienteId, cleanKey, moduleKeys)
  notifyRolesUpdated()

  // Sincronizar en BD para todos los usuarios con este rol si Supabase está disponible
  if (supabaseClient && clienteId) {
    try {
      const { data: usersWithRole, error: usersErr } = await supabaseClient
        .from('usuarios_perfiles')
        .select('id')
        .eq('cliente_id', clienteId)
        .ilike('rol', cleanKey)

      if (!usersErr && usersWithRole?.length > 0) {
        const allowedSet = new Set(moduleKeys)
        const recordsToUpsert = []

        for (const user of usersWithRole) {
          for (const mod of TENANT_MODULES) {
            recordsToUpsert.push({
              user_id: user.id,
              cliente_id: clienteId,
              module_key: mod.key,
              allowed: allowedSet.has(mod.key),
            })
          }
        }

        if (recordsToUpsert.length > 0) {
          await supabaseClient
            .from('user_module_permissions')
            .upsert(recordsToUpsert, { onConflict: 'user_id,module_key' })
        }
      }
    } catch (err) {
      console.warn('[rolesManager] Sincronización de user_module_permissions omitida o fallida:', err.message)
    }
  }
}

/**
 * Notifica a los componentes y ventanas que la configuración de roles se actualizó
 */
function notifyRolesUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('signum:roles-updated'))
    try {
      const bc = new BroadcastChannel('signum:roles_channel')
      bc.postMessage({ type: 'ROLES_UPDATED', timestamp: Date.now() })
      bc.close()
    } catch (e) {
      // BroadcastChannel opcional
    }
  }
}
