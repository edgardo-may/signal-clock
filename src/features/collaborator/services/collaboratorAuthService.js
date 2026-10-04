// src/features/collaborator/services/collaboratorAuthService.js
// Servicio de autenticación exclusivo para colaboradores mediante Clave + PIN

import { supabase } from '../../../lib/supabase'
import { signInCollaborator } from '../../auth/services/authService'
import { resolveLocationTimezone } from './serverTimeService'

const STORAGE_KEY = 'sc_colaborador_session'
const LAST_TENANT_KEY = 'sc_last_tenant_id'

/**
 * Obtiene la lista de empresas activas para selección en el login de colaboradores.
 * Utiliza el RPC de tenants globales autorizado para evitar errores de RLS o columnas inexistentes.
 */
export async function getEmpresasDisponibles() {
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_resumen_global_tenants')
    if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
      return rpcData
        .filter((t) => t.estatus === 'activo')
        .map((t) => ({
          id: t.id,
          nombre_empresa: t.nombre_empresa,
          id_empresa: t.id_empresa,
          estatus: t.estatus,
          estado: t.estado,
          ciudad: t.ciudad,
          timezone: resolveLocationTimezone({ tenantState: t.estado, tenantCity: t.ciudad }),
        }))
        .sort((a, b) => (a.nombre_empresa || '').localeCompare(b.nombre_empresa || ''))
    }

    // Fallback seguro a clientes sin la columna timezone
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre_empresa, estatus')
      .eq('estatus', 'activo')
      .order('nombre_empresa', { ascending: true })

    if (error) return []
    return (data || []).map((t) => ({
      ...t,
      timezone: resolveLocationTimezone({ tenantState: t.estado, tenantCity: t.ciudad }),
    }))
  } catch (_) {
    return []
  }
}

/**
 * Inicia sesión para un colaborador usando su Empresa, Clave de Colaborador y PIN.
 */
export async function loginColaborador({ clienteId, clave, pin }) {
  const cleanClave = (clave || '').trim()
  const cleanPin = (pin || '').trim()

  if (!cleanClave) {
    return { success: false, error: 'Por favor ingresa tu Clave o Número de Colaborador.' }
  }
  if (!cleanPin) {
    return { success: false, error: 'Por favor ingresa tu PIN de acceso.' }
  }
  if (!clienteId) {
    return { success: false, error: 'Por favor selecciona la empresa a la que perteneces.' }
  }

  try {
    // 1. Intentar autenticación segura mediante RPC en Base de Datos (bypassea RLS anónimo de forma controlada)
    let authSucceeded = false
    let authUser = null
    let emp = null

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('fn_login_colaborador', {
        p_cliente_id: clienteId,
        p_clave: cleanClave,
        p_pin: cleanPin,
      })

      if (!rpcErr && rpcRes) {
        if (!rpcRes.success) {
          return {
            success: false,
            error: rpcRes.error || 'Credenciales de acceso incorrectas.',
          }
        }
        if (rpcRes.empleado) {
          emp = rpcRes.empleado
          authSucceeded = true
        }
      }
    } catch (_) {}

    // 2. Si no se usó RPC, intentar autenticación mediante cuenta virtual de Supabase Auth
    if (!authSucceeded) {
      try {
        const authRes = await signInCollaborator({
          empresaId: clienteId,
          claveEmpleado: cleanClave,
          password: cleanPin,
        })
        if (!authRes.error && authRes.data?.user) {
          authSucceeded = true
          authUser = authRes.data.user
        }
      } catch (_) {}
    }

    // 3. Obtener datos de la empresa seleccionada de manera segura
    let tenantName = 'Empresa'
    const empresas = await getEmpresasDisponibles()
    const matchingTenant = empresas.find((e) => e.id === clienteId)
    if (matchingTenant) {
      tenantName = matchingTenant.nombre_empresa
    }

    // 4. Si aún no tenemos datos de emp, intentar búsqueda directa
    if (!emp) {
      const { data: empData, error: empErr } = await supabase
        .from('empleados')
        .select('id, cliente_id, nombre, apellido, clave_empleado, pin, departamento, puesto, device_userid, avatar_url, activo')
        .eq('cliente_id', clienteId)
        .or(`clave_empleado.ilike.${cleanClave},device_userid.eq.${cleanClave}`)
        .maybeSingle()

      if (!empErr && empData) {
        emp = empData
      }
    }

    // Si falló Supabase Auth y no hay empleado encontrado
    if (!authSucceeded && !emp) {
      return {
        success: false,
        error: 'Colaborador no encontrado. Verifica tu Clave o consulta con Recursos Humanos.',
      }
    }

    // Validar estado del empleado si se encontró registro
    if (emp && emp.activo === false) {
      return {
        success: false,
        error: 'Tu perfil de colaborador se encuentra inactivo. Contacta al Administrador.',
      }
    }

    // Si no hubo login de Supabase Auth, validar contra el PIN guardado en la tabla empleados
    if (!authSucceeded && emp) {
      if (!emp.pin || !emp.pin.trim()) {
        return {
          success: false,
          error: 'Aún no tienes un PIN asignado. Solicita a Recursos Humanos que configure tu PIN.',
        }
      }
      if (emp.pin.trim() !== cleanPin) {
        return {
          success: false,
          error: 'PIN de acceso incorrecto. Verifica los dígitos e intenta nuevamente.',
        }
      }
    }

    const sessionData = {
      empleadoId: emp ? emp.id : (authUser?.id || cleanClave),
      clienteId: clienteId,
      nombre: emp ? emp.nombre : (authUser?.user_metadata?.nombre || cleanClave),
      apellido: emp?.apellido || '',
      nombreCompleto: emp ? `${emp.nombre} ${emp.apellido || ''}`.trim() : (authUser?.user_metadata?.nombre || cleanClave),
      claveEmpleado: emp?.clave_empleado || emp?.device_userid || cleanClave,
      departamento: emp?.departamento || 'General',
      puesto: emp?.puesto || 'Colaborador',
      avatarUrl: emp?.avatar_url || null,
      nombreEmpresa: tenantName,
      timezone: resolveLocationTimezone({
        tenantState: matchingTenant?.estado,
        tenantCity: matchingTenant?.ciudad,
      }),
      pin: cleanPin,
      loginTimestamp: Date.now(),
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData))
      localStorage.setItem(LAST_TENANT_KEY, clienteId)
    } catch (_) {}

    return { success: true, session: sessionData }
  } catch (err) {
    return {
      success: false,
      error: 'Error de conexión: ' + (err.message || 'Intente de nuevo.'),
    }
  }
}

/**
 * Obtiene la sesión activa del colaborador desde localStorage.
 */
export function getCollaboratorSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

/**
 * Obtiene el ID del último tenant seleccionado en este dispositivo.
 */
export function getLastTenantId() {
  try {
    return localStorage.getItem(LAST_TENANT_KEY) || null
  } catch (_) {
    return null
  }
}

/**
 * Cierra la sesión activa del colaborador.
 */
export function logoutColaborador() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (_) {}
}

/**
 * Verifica si hay una sesión válida activa.
 */
export function hasActiveCollaboratorSession() {
  const session = getCollaboratorSession()
  return Boolean(session && session.empleadoId && session.clienteId)
}
