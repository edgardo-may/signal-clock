/**
 * AuthProvider.jsx — Proveedor centralizado de autenticación v4
 * Signum-Clock · Supabase Auth
 *
 * Estado expuesto:
 *  status:    'loading' | 'authenticated' | 'unauthenticated'
 *  session:   Session | null
 *  user:      User | null
 *  profile:   UserProfile | null
 *  signOut:   () => Promise<void>
 *
 * Características:
 *  ✅ Estado LOADING explícito → previene FOCP (Flash of Cleared Protected Content)
 *  ✅ Escucha onAuthStateChange con todos los eventos (SIGNED_IN/OUT, TOKEN_REFRESHED)
 *  ✅ Inactividad de 30 minutos → auto-logout con mensaje al usuario
 *  ✅ Sincronización multi-pestaña via BroadcastChannel
 *  ✅ signOut centralizado — páginas no necesitan importar supabase directamente
 *  ✅ Profile cargado en el contexto — disponible en toda la app
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getProfile, signOut as authSignOut, subscribeToAuthBroadcast } from '../../features/auth/services/authService'
import { useInactivity } from '../../features/auth/hooks/useInactivity'

// ─── Contexto ──────────────────────────────────────────────────
export const AuthContext = createContext({
  status:  'loading',
  session: null,
  user:    null,
  profile: null,
  modulePermissions: {},
  signOut: async () => {},
})

// ─── Proveedor ─────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [status,  setStatus]  = useState('loading')
  const [session, setSession] = useState(null)
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [modulePermissions, setModulePermissions] = useState({})

  // Ref para el navigate — se usa en signOut (necesitamos acceso al router)
  // Pero AuthProvider envuelve al BrowserRouter, así que no podemos usar useNavigate aquí.
  // En cambio, disparamos un evento custom que el router puede escuchar.
  const inactiveLogoutRef = useRef(false)

  // ── Función centralizada de limpieza de estado ──────────────
  const clearAuthState = useCallback(() => {
    setStatus('unauthenticated')
    setSession(null)
    setUser(null)
    setProfile(null)
    setModulePermissions({})
  }, [])

  // ── signOut centralizado ────────────────────────────────────
  const signOut = useCallback(async ({ reason } = {}) => {
    await authSignOut({ broadcast: true })
    clearAuthState()

    // El router escucha onAuthStateChange → navegará a /login automáticamente
    // pero guardamos el motivo para mostrarlo en la UI
    if (reason === 'inactivity') {
      inactiveLogoutRef.current = true
      // Disparar evento custom para que el router/PrivateRoute pueda leer el motivo
      window.dispatchEvent(new CustomEvent('signum:logout', { detail: { reason } }))
    } else {
      window.dispatchEvent(new CustomEvent('signum:logout', { detail: { reason: 'manual' } }))
    }
  }, [clearAuthState])

  // ── Inactividad de 30 minutos ────────────────────────────────
  useInactivity({
    enabled: status === 'authenticated',
    onInactive: async () => {
      await signOut({ reason: 'inactivity' })
    },
  })

  const loadModulePermissions = useCallback(async (userId, userProfile) => {
    if (!userId) {
      setModulePermissions({})
      return
    }

    try {
      // superadmin no está restringido por tenant — solo carga sus overrides directos
      const isSuperadmin = String(userProfile?.rol || '').toLowerCase() === 'superadmin'

      if (isSuperadmin) {
        const { data: perms, error } = await supabase
          .from('user_module_permissions')
          .select('module_key, allowed')
          .eq('user_id', userId)

        if (error) throw error
        setModulePermissions(
          Object.fromEntries((perms || []).map(({ module_key, allowed }) => [module_key, allowed]))
        )
        return
      }

      // Para admin / auditor / operador: combinar módulos habilitados del tenant
      // con los overrides explícitos del usuario.
      const clienteId = userProfile?.cliente_id
      if (!clienteId) {
        setModulePermissions({})
        return
      }

      const [{ data: tenantModules }, { data: userPerms }] = await Promise.all([
        // Módulos habilitados para este tenant desde Central
        supabase
          .from('cliente_modulos')
          .select('module_key, habilitado')
          .eq('cliente_id', clienteId),
        // Excepciones explícitas del usuario
        supabase
          .from('user_module_permissions')
          .select('module_key, allowed')
          .eq('user_id', userId),
      ])

      // Mapa de módulos habilitados para el tenant: { module_key → true/false }
      const tenantEnabled = Object.fromEntries(
        (tenantModules || []).map(({ module_key, habilitado }) => [module_key, habilitado])
      )

      // Mapa de overrides del usuario: { module_key → true/false }
      const userOverrides = Object.fromEntries(
        (userPerms || []).map(({ module_key, allowed }) => [module_key, allowed])
      )

      // Permiso efectivo: módulo debe estar habilitado para el tenant
      // Y, si existe override del usuario, respetar ese valor.
      // Si el tenant no lo tiene en cliente_modulos → se desconoce → usar override del usuario si existe.
      const effective = {}

      // Incorporar todos los módulos conocidos por el tenant
      for (const [key, enabled] of Object.entries(tenantEnabled)) {
        if (!enabled) {
          // Tenant no tiene el módulo → forzar false sin importar override
          effective[key] = false
        } else if (Object.prototype.hasOwnProperty.call(userOverrides, key)) {
          // Tenant sí lo tiene y hay un override explícito del usuario
          effective[key] = userOverrides[key]
        }
        // Si el tenant lo tiene pero no hay override, se deja a los defaults del rol
      }

      // Incluir también overrides del usuario para módulos no registrados en cliente_modulos
      // (módulos nuevos que aún no se han asignado al tenant pero tienen override histórico)
      for (const [key, allowed] of Object.entries(userOverrides)) {
        if (!Object.prototype.hasOwnProperty.call(effective, key)) {
          // Solo aplicar si el tenant tiene ese módulo o si no existe registro alguno
          const tenantHasModule = Object.prototype.hasOwnProperty.call(tenantEnabled, key)
          if (!tenantHasModule || tenantEnabled[key]) {
            effective[key] = allowed
          }
        }
      }

      setModulePermissions(effective)
    } catch {
      // Mantener defaults del rol si falla la carga
      setModulePermissions({})
    }
  }, [])


  // ── Cargar perfil del usuario autenticado ──────────────────
  async function loadProfile(userId) {
    try {
      const perfil = await getProfile(userId)
      setProfile(perfil)
      // Pasar el perfil para que loadModulePermissions pueda distinguir
      // superadmin (sin restricción de tenant) de usuarios regulares.
      await loadModulePermissions(userId, perfil)
    } catch {
      setProfile(null)
      setModulePermissions({})
    }
  }

  // ── Supabase Auth State Changes ────────────────────────────
  useEffect(() => {
    let mounted = true

    // 1. Obtener sesión inicial (sincrónica desde storage)
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return

      if (initialSession) {
        setSession(initialSession)
        setUser(initialSession.user)
        setStatus('authenticated')
        loadProfile(initialSession.user.id)
      } else {
        setStatus('unauthenticated')
      }
    })

    // 2. Escuchar cambios de estado en tiempo real
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return

        switch (event) {
          case 'SIGNED_IN':
            setSession(newSession)
            setUser(newSession.user)
            setStatus('authenticated')
            await loadProfile(newSession.user.id)
            break

          case 'SIGNED_OUT':
            clearAuthState()
            break

          case 'TOKEN_REFRESHED':
            // Token renovado automáticamente — actualizar sesión sin cambiar status
            setSession(newSession)
            setUser(newSession?.user ?? null)
            if (!newSession) {
              // Refresh falló — cerrar sesión
              clearAuthState()
              window.dispatchEvent(new CustomEvent('signum:logout', {
                detail: { reason: 'token_expired' },
              }))
            }
            break

          case 'USER_UPDATED':
            setUser(newSession?.user ?? null)
            if (newSession?.user) await loadProfile(newSession.user.id)
            break

          default:
            break
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [clearAuthState])

  // A change made from Central must reach the affected user without requiring
  // a new login or a manual page refresh.
  // También escuchamos cliente_modulos para el Caso G:
  // si Central deshabilita un módulo del tenant, el usuario pierde acceso inmediato.
  useEffect(() => {
    if (!user?.id) return undefined

    const clienteId = profile?.cliente_id

    // Canal 1: cambios en permisos individuales del usuario
    const permChannel = supabase
      .channel(`module-permissions:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_module_permissions',
          filter: `user_id=eq.${user.id}`,
        },
        () => loadModulePermissions(user.id, profile)
      )
      .subscribe()

    // Canal 2: cambios en módulos habilitados del tenant (solo usuarios con tenant)
    let tenantChannel = null
    if (clienteId) {
      tenantChannel = supabase
        .channel(`tenant-modules:${clienteId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'cliente_modulos',
            filter: `cliente_id=eq.${clienteId}`,
          },
          () => loadModulePermissions(user.id, profile)
        )
        .subscribe()
    }

    const onWindowFocus = () => loadModulePermissions(user.id, profile)
    window.addEventListener('focus', onWindowFocus)

    return () => {
      window.removeEventListener('focus', onWindowFocus)
      supabase.removeChannel(permChannel)
      if (tenantChannel) supabase.removeChannel(tenantChannel)
    }
  }, [loadModulePermissions, user?.id, profile])

  // ── Sincronización multi-pestaña ──────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToAuthBroadcast({
      onLogout: () => {
        // Otra pestaña hizo logout → limpiar esta también
        clearAuthState()
        window.dispatchEvent(new CustomEvent('signum:logout', {
          detail: { reason: 'other_tab' },
        }))
      },
    })
    return unsubscribe
  }, [clearAuthState])

  return (
    <AuthContext.Provider value={{ status, session, user, profile, modulePermissions, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook de consumo ───────────────────────────────────────────
export function useAuthContext() {
  return useContext(AuthContext)
}





