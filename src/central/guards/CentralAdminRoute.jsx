// src/central/guards/CentralAdminRoute.jsx — Guard estricto para Signum-Clock Central (Master)
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/useAuth'
import { isSuperAdmin } from '../../shared/auth/permissions'
import { ShieldCheck } from 'lucide-react'

export default function CentralAdminRoute({ children }) {
  const { status, profile } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B132B] text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-500/30 animate-pulse">
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Iniciando Signum-Clock Central...
        </p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/central/login" state={{ from: location }} replace />
  }

  const hasCentralAccess = isSuperAdmin(profile)

  // Si no es SuperAdmin, redirigir a la aplicación de cliente
  if (!hasCentralAccess) {
    return <Navigate to="/" replace />
  }

  return children
}
