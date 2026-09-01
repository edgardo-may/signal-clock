// src/central/components/CentralHeader.jsx — Header Master de Signum-Clock Central con Paleta Oficial
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../features/auth/hooks/useAuth'
import {
  Menu,
  AlignCenter,
  Activity,
  LogOut,
  ChevronDown,
  User,
  Shield,
  Settings,
  Building2,
} from 'lucide-react'

export default function CentralHeader({ sidebarOpen, setSidebarOpen }) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { profile, signOut, user } = useAuth()
  const dropdownRef = useRef(null)

  const userEmail   = user?.email ?? 'superadmin@signum-clock.com'
  const nombre      = profile?.nombre ?? 'Super Admin'
  const rol         = 'SUPERADMIN'
  const empresa     = 'Signum-Clock Central'

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    setDropdownOpen(false)
    await signOut()
  }

  return (
    <header className="sticky top-0 z-30 flex w-full bg-white dark:bg-[#1e293b] border-b border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-200">
      <div className="flex flex-grow items-center justify-between px-4 py-3 md:px-6 2xl:px-11">
        {/* Izquierda: Botón Hamburguesa + Status */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            id="sidebar-toggle-btn"
            aria-label={sidebarOpen ? 'Mostrar solo iconos' : 'Mostrar menú completo'}
            title={sidebarOpen ? 'Modo solo iconos' : 'Expandir menú'}
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
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Plataforma Central
            </span>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
              <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
              Supabase DB En Línea
            </span>
          </div>
        </div>

        {/* Derecha: Sucursal, Notificaciones y Perfil */}
        <div className="flex items-center gap-3">
          {/* Badge de Plataforma */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/40 text-blue-600 dark:text-blue-400">
            <Building2 className="w-4 h-4" />
            <span className="text-xs font-semibold">
              {empresa}
            </span>
          </div>

          {/* Dropdown de Perfil */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
            >
              <div className="hidden text-right lg:block">
                <span className="block text-sm font-semibold leading-tight text-slate-900 dark:text-white">
                  {nombre}
                </span>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {rol}
                </span>
              </div>

              {/* Avatar con iniciales */}
              <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full font-bold shadow-md text-sm bg-blue-600 text-white">
                {nombre.charAt(0).toUpperCase()}
              </div>

              <ChevronDown
                className={`hidden lg:block w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-transform duration-200 ${
                  dropdownOpen ? 'rotate-180 text-blue-600 dark:text-blue-400' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div
                className="absolute right-0 mt-3 w-64 rounded-xl p-2 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-xl z-50 animate-slideDown text-slate-800 dark:text-slate-200"
              >
                {/* Header del dropdown */}
                <div className="px-3 py-2 mb-1 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-medium text-slate-400">Sesión activa como:</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {userEmail}
                  </p>
                </div>

                <ul className="flex flex-col gap-0.5 text-sm font-medium">
                  {[
                    { Icon: User,     label: 'Mi Perfil'          },
                    { Icon: Shield,   label: 'Control Global'     },
                    { Icon: Settings, label: 'Configuración'      },
                  ].map(({ Icon, label }) => (
                    <li key={label}>
                      <button
                        onClick={() => setDropdownOpen(false)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Icon className="w-4 h-4 text-slate-400" />
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Cerrar Sesión
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
