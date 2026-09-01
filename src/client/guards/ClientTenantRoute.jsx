// src/client/guards/ClientTenantRoute.jsx — Guard para Signum-Clock Client (Tenant)
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/useAuth'
import { TenantProvider } from '../../shared/providers/TenantProvider'
import { isSuperAdmin } from '../../shared/auth/permissions'
import { Clock, AlertTriangle } from 'lucide-react'

export default function ClientTenantRoute({ children }) {
  const { status, profile, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-[#0B132B]">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 shadow-md shadow-blue-500/25 animate-spin" style={{ animationDuration: '3s' }}>
          <Clock className="w-6 h-6 text-white" />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Cargando entorno empresarial...
        </p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const hasCentralAccess = isSuperAdmin(profile)

  // Si un SuperAdmin entra a Client, redirigir automáticamente a Central
  if (hasCentralAccess) {
    return <Navigate to="/central" replace />
  }

  const clienteId =
    profile?.cliente_id ||
    user?.app_metadata?.cliente_id ||
    user?.user_metadata?.cliente_id

  // Si un usuario regular no tiene cliente_id asignado
  if (!clienteId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900 p-4">
        <div className="max-w-md w-full p-6 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Cuenta sin Empresa Asignada
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Tu usuario no tiene un <strong>cliente_id</strong> asignado. Contacta al Administrador de tu empresa o al SuperAdmin para vincularte a tu centro de trabajo.
          </p>
        </div>
      </div>
    )
  }

  return (
    <TenantProvider>
      {children}
    </TenantProvider>
  )
}
