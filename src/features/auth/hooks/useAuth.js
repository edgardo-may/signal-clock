/**
 * useAuth.js — Hook de acceso al contexto de autenticación
 * Signum-Clock v4
 *
 * Uso:
 *   const { status, session, user, profile, modulePermissions, signOut } = useAuth()
 *
 * status:
 *   'loading'        → sesión aún no determinada (mostrar spinner)
 *   'authenticated'  → sesión válida activa
 *   'unauthenticated'→ sin sesión
 *
 * modulePermissions:
 *   Mapa { [module_key]: boolean } con las excepciones explícitas del usuario.
 *   Si una clave no existe, se aplica el acceso predeterminado del rol.
 *   Fuente: tabla user_module_permissions de Supabase.
 *
 * signOut:
 *   Cerrar sesión de forma centralizada — no importar supabase directamente.
 *   await signOut()
 */

import { useAuthContext } from '../../../app/providers/AuthProvider'

/**
 * @returns {{\
 *   status: 'loading' | 'authenticated' | 'unauthenticated',
 *   session: import('@supabase/supabase-js').Session | null,
 *   user: import('@supabase/supabase-js').User | null,
 *   profile: { nombre: string, rol: string, estatus_cuenta: string, cliente_id: string, clientes: { nombre_empresa: string } } | null,
 *   modulePermissions: Record<string, boolean>,
 *   signOut: (opts?: { reason?: string }) => Promise<void>,
 * }}
 */
export function useAuth() {
  const { status, session, user, profile, modulePermissions, signOut } = useAuthContext()
  return { status, session, user, profile, modulePermissions, signOut }
}

