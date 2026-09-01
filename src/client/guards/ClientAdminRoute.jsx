import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/useAuth'
import { isSuperAdmin, ROLE, normalizeRole } from '../../shared/auth/permissions'
import { ShieldOff } from 'lucide-react'

export default function ClientAdminRoute({ children }) {
  const { profile } = useAuth()
  const location = useLocation()

  const allowed = isSuperAdmin(profile) || normalizeRole(profile?.rol) === ROLE.ADMIN

  if (!allowed) {
    if (location.pathname === '/') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
          <div className="max-w-sm w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
              <ShieldOff className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Acceso restringido</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Esta sección es exclusiva para administradores de la empresa.
            </p>
          </div>
        </div>
      )
    }

    return <Navigate to="/" state={{ deniedPath: location.pathname }} replace />
  }

  return children
}
