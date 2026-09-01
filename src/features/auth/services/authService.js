/**
 * authService.js — Servicio centralizado de autenticación
 * Signum-Clock v4 · Supabase Auth
 *
 * Responsabilidades:
 *  - signIn: limpia sesión previa → autentica → carga perfil
 *  - signOut: invalida sesión en Supabase → limpia estado → broadcast
 *  - getProfile: carga datos de perfil desde usuarios_perfiles
 *  - broadcastLogout: notifica a otras pestañas
 *
 * IMPORTANTE — Seguridad:
 *  La invalidación real de tokens ocurre en Supabase (backend).
 *  `supabase.auth.signOut()` revoca el refresh token en el servidor
 *  y elimina los tokens del almacenamiento local automáticamente.
 *  NO manipulamos JWTs manualmente.
 */

import { supabase } from '../../../lib/supabase'

// Canal BroadcastChannel para sincronización entre pestañas
const CHANNEL_NAME = 'signum-clock-auth'
const MSG_LOGOUT   = 'LOGOUT'
const MSG_LOGIN    = 'LOGIN'

let _broadcastChannel = null

function getBroadcastChannel() {
  if (!_broadcastChannel && typeof BroadcastChannel !== 'undefined') {
    try {
      _broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      // BroadcastChannel no disponible en este entorno
    }
  }
  return _broadcastChannel
}

/**
 * signIn — Autenticación completa con limpieza de sesión previa.
 *
 * Flujo:
 *  1. Cierra cualquier sesión activa primero (sin broadcast — es local)
 *  2. Autentica con email/password
 *  3. Verifica estado de cuenta en usuarios_perfiles
 *  4. Registra último acceso (fire-and-forget)
 *  5. Retorna { data, profile, error }
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ data: object|null, profile: object|null, error: Error|null }>}
 */
export async function signIn(emailOrCredentials, maybePassword) {
  let email = ''
  let password = ''

  if (typeof emailOrCredentials === 'object' && emailOrCredentials !== null) {
    email = emailOrCredentials.email || ''
    password = emailOrCredentials.password || ''
  } else {
    email = emailOrCredentials || ''
    password = maybePassword || ''
  }

  // 1. Limpiar sesión anterior sin notificar a otras pestañas
  //    (es una limpieza local antes de la nueva autenticación)
  try {
    const { data: existing } = await supabase.auth.getSession()
    if (existing?.session) {
      // signOut con scope 'local' para no revocar token en otras pestañas
      // solo eliminamos el estado local para iniciar sesión limpia
      await supabase.auth.signOut({ scope: 'local' })
    }
  } catch {
    // Ignorar errores de limpieza — continuar con el login
  }

  const cleanEmail = String(email).trim().toLowerCase()

  // 1.5 Verificar límites de intentos de login (brute force)
  try {
    const { data: limitCheck } = await supabase.rpc('security_check_login_limit', { p_email: cleanEmail })
    if (limitCheck?.blocked) {
      const mins = Math.ceil(limitCheck.remaining_seconds / 60)
      return {
        data: null,
        profile: null,
        error: new Error(`Demasiados intentos de acceso. Espera ${mins} minuto(s) antes de volver a intentarlo.`)
      }
    }
  } catch (err) {
    console.error('[authService] Error al verificar límite de login:', err)
  }

  // 2. Autenticar
  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email:    cleanEmail,
    password: String(password),
  })

  if (authError) {
    // Registrar intento fallido
    await supabase.rpc('security_register_login_attempt', { p_email: cleanEmail, p_success: false }).catch(() => {})
    
    // Unificar mensaje de error de credenciales inválidas para evitar enumeración de usuarios
    const unifiedError = new Error('Correo o contraseña incorrectos.')
    return { data: null, profile: null, error: unifiedError }
  }

  // Registrar login exitoso
  await supabase.rpc('security_register_login_attempt', { p_email: cleanEmail, p_success: true }).catch(() => {})

  // 3. Verificar estado de cuenta
  let profile = null
  if (data?.user) {
    const { data: perfil, error: perfilError } = await supabase
      .from('usuarios_perfiles')
      .select('id, nombre, rol, estatus_cuenta, cliente_id, clientes(id, nombre_empresa, plan_suscripcion, limite_empleados, limite_dispositivos, estatus, fecha_vencimiento)')
      .eq('id', data.user.id)
      .maybeSingle()

    if (!perfilError && perfil) {
      // Cuenta suspendida → cerrar sesión inmediatamente
      if (perfil.estatus_cuenta === 'suspendido' || perfil.clientes?.estatus === 'suspendido' || perfil.clientes?.estatus === 'cancelado') {
        await supabase.auth.signOut()
        return {
          data:    null,
          profile: null,
          error:   Object.assign(new Error('account suspended'), { code: 'ACCOUNT_SUSPENDED' }),
        }
      }
      profile = perfil
    }

    // 4. Registrar último acceso (fire-and-forget, no bloquea el flujo)
    supabase.rpc('fn_registrar_ultimo_acceso').catch(() => {})

    // 5. Notificar a otras pestañas del login
    try {
      getBroadcastChannel()?.postMessage({ type: MSG_LOGIN, userId: data.user.id })
    } catch {}
  }

  return { data, profile, error: null }
}

/**
 * signOut — Cierre de sesión completo.
 *
 * Flujo:
 *  1. Llama supabase.auth.signOut() → revoca refresh token en servidor
 *  2. Supabase limpia automáticamente localStorage
 *  3. Notifica a otras pestañas
 *  4. onAuthStateChange dispara SIGNED_OUT → AuthProvider limpia estado
 *
 * @param {{ broadcast?: boolean }} options
 */
export async function signOut({ broadcast = true } = {}) {
  try {
    // scope: 'global' revoca TODOS los tokens del usuario en todos los dispositivos
    // scope: 'local' solo limpia este cliente (por defecto en Supabase v2)
    // Usamos 'local' para no forzar logout en otros dispositivos del mismo usuario
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Aunque falle la llamada al servidor, limpiamos estado local
  }

  // Notificar a otras pestañas del mismo navegador
  if (broadcast) {
    try {
      getBroadcastChannel()?.postMessage({ type: MSG_LOGOUT })
    } catch {}
  }
}

/**
 * getProfile — Carga datos extendidos del perfil de usuario.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getProfile(userId) {
  if (!userId) return null

  const { data, error } = await supabase
    .from('usuarios_perfiles')
    .select('id, nombre, rol, estatus_cuenta, cliente_id, clientes(id, nombre_empresa, plan_suscripcion, limite_empleados, limite_dispositivos, estatus, fecha_vencimiento)')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) return null
  return data
}

/**
 * subscribeToAuthBroadcast — Escucha eventos de otras pestañas.
 *
 * @param {{ onLogout: () => void, onLogin?: () => void }} handlers
 * @returns {() => void} unsubscribe
 */
export function subscribeToAuthBroadcast({ onLogout, onLogin }) {
  const channel = getBroadcastChannel()
  if (!channel) return () => {}

  function handler(event) {
    const { type } = event.data ?? {}
    if (type === MSG_LOGOUT) onLogout?.()
    if (type === MSG_LOGIN)  onLogin?.()
  }

  channel.addEventListener('message', handler)
  return () => channel.removeEventListener('message', handler)
}
