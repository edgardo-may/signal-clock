// src/features/collaborator/guards/ColaboradorRoute.jsx
// Ruta protegida independiente exclusiva para el portal del colaborador.
// Redirige al login de colaboradores (/portal-colaborador/login) si no hay sesión activa.

import { Navigate, useLocation } from 'react-router-dom'
import { getCollaboratorSession } from '../services/collaboratorAuthService'
import { useAuth } from '../../auth/hooks/useAuth'

export default function ColaboradorRoute({ children }) {
  const location = useLocation()
  const collaboratorSession = getCollaboratorSession()
  const { status, profile } = useAuth()

  // 1. Si existe una sesión de colaborador activa mediante Clave + PIN
  if (collaboratorSession?.empleadoId) {
    return children
  }

  // 2. Si hay una sesión de Supabase Auth con rol colaborador o admin realizando pruebas
  if (status === 'authenticated' && profile) {
    return children
  }

  // 3. Si aún está determinando estado de Supabase Auth
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0F172A]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#03363D] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-500">Cargando portal de colaboradores...</p>
        </div>
      </div>
    )
  }

  // 4. Si no tiene sesión, redirige al login exclusivo de colaboradores
  return <Navigate to="/portal-colaborador/login" state={{ from: location }} replace />
}
