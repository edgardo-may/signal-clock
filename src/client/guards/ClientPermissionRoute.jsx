/**
 * ClientPermissionRoute.jsx — Guard de acceso por módulo
 * Signum-Clock v4 · Vista Cliente
 *
 * Comprueba si el usuario autenticado tiene acceso al módulo solicitado.
 * Fuente de verdad: Supabase RLS + user_module_permissions + cliente_modulos.
 * El estado modulePermissions ya incorpora la jerarquía completa:
 *   - módulos habilitados para el tenant (de cliente_modulos)
 *   - excepciones individuales del usuario (de user_module_permissions)
 *
 * Comportamiento en caso de acceso denegado:
 *   - Si la ruta actual NO es "/" → redirige a "/" con estado deniedPath.
 *   - Si la ruta actual ES "/" (dashboard sin permiso) → muestra pantalla de
 *     acceso denegado para evitar un redirect loop infinito.
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/useAuth'
import { hasPermission, PERMISSION } from '../../shared/auth/permissions'
import { ShieldOff } from 'lucide-react'

export default function ClientPermissionRoute({ permission, children }) {
  const { profile, modulePermissions } = useAuth()
  const location = useLocation()

  const allowed = hasPermission(profile, permission, modulePermissions)

  if (!allowed) {
    // Evitar redirect loop cuando el dashboard tampoco está disponible
    if (location.pathname === '/') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
          <div className="max-w-sm w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
              <ShieldOff className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Acceso restringido</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No tienes módulos habilitados en tu cuenta. Contacta al administrador de tu empresa para que te asigne los módulos correspondientes.
            </p>
          </div>
        </div>
      )
    }

    return <Navigate to="/" state={{ deniedPath: location.pathname }} replace />
  }

  return children
}
