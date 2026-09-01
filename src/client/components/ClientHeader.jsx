// src/client/components/ClientHeader.jsx — Header Corporativo para Signum-Clock Client
import { useAuth } from '../../features/auth/hooks/useAuth'
import { useTenant } from '../../shared/providers/TenantProvider'
import {
  Menu,
  AlignCenter,
  Building2,
  Users,
  LogOut,
  AlertTriangle,
} from 'lucide-react'

export default function ClientHeader({ sidebarOpen, setSidebarOpen }) {
  const { profile, signOut } = useAuth()
  const { tenant, empleadosActuales, limiteEmpleados, bloqueado, vencido } = useTenant()

  return (
    <header className="sticky top-0 z-30 flex w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] transition-colors shadow-sm duration-200">
      <div className="flex flex-grow items-center justify-between px-4 py-3 md:px-5 lg:px-6">
        {/* Botón menú y status */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            id="sidebar-toggle-btn"
            aria-label={sidebarOpen ? 'Mostrar solo iconos' : 'Mostrar menú completo'}
            title={sidebarOpen ? 'Modo solo iconos' : 'Alternar menú lateral'}
            onClick={(e) => {
              e.stopPropagation()
              setSidebarOpen(prev => !prev)
            }}
            className="flex items-center justify-center rounded-lg p-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 shadow-sm transition-all duration-200 active:scale-95 cursor-pointer"
          >
            {sidebarOpen ? (
              <Menu className="w-5 h-5 transition-transform duration-200" />
            ) : (
              <AlignCenter className="w-5 h-5 transition-transform duration-200" />
            )}
          </button>

        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs font-bold text-blue-700 dark:text-blue-300">
            <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>{tenant?.nombre_empresa || 'Cargando empresa...'}</span>
          </div>

          {bloqueado && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-2 py-0.5 rounded-md">
              <AlertTriangle className="w-3 h-3" />
              {vencido ? 'Suscripción Vencida' : 'Operación Suspendida'}
            </span>
          )}
        </div>
      </div>

      {/* Capacidad y Perfil */}
      <div className="flex items-center gap-4">
        {/* Capacidad */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 text-xs font-semibold">
          <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="text-slate-500 dark:text-slate-400">Capacidad:</span>
          <span className="font-mono font-bold text-slate-800 dark:text-white">
            {empleadosActuales} / {limiteEmpleados}
          </span>
        </div>

        {/* Perfil */}
        <div className="flex items-center gap-3 pl-3 border-l border-slate-200 dark:border-slate-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs shadow-md shadow-blue-500/20">
            {profile?.nombre?.[0]?.toUpperCase() || 'U'}
          </div>

          <div className="hidden md:block text-left">
            <p className="text-xs font-bold text-slate-900 dark:text-white leading-none">
              {profile?.nombre || 'Usuario'}
            </p>
            <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
              Rol: {profile?.rol || 'colaborador'}
            </p>
          </div>

          <button
            onClick={() => signOut()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      </div>
    </header>
  )
}
