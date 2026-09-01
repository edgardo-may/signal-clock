// src/shared/components/layout/Header.jsx — Signum-Clock Header con Paleta Oficial
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../../features/auth/hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import {
  Menu,
  AlignCenter,
  Search,
  Building2,
  Bell,
  User,
  LogOut,
  Settings,
  Shield,
  ChevronDown,
} from 'lucide-react'

export default function Header({ sidebarOpen, setSidebarOpen }) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { user, profile, signOut: authSignOut } = useAuth()

  const dropdownRef = useRef(null)

  const userEmail   = user?.email ?? ''
  const nombre      = profile?.nombre ?? user?.user_metadata?.nombre ?? userEmail.split('@')[0] ?? 'Administrador'
  const rol         = (profile?.rol ?? 'admin').toUpperCase()
  const empresa     = profile?.clientes?.nombre_empresa ?? 'Signum-Clock Central'
  const userProfile = { nombre, email: userEmail, rol, empresa }

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
    await authSignOut()
  }

  return (
    <header className="sticky top-0 z-30 flex w-full bg-white dark:bg-[#1e293b] border-b border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-200">
      <div className="flex flex-grow items-center justify-between px-4 py-3 md:px-6 2xl:px-11">
        {/* ── Izquierda: Botón Hamburguesa + Buscador ──── */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Botón Toggle */}
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

          {/* Buscador global */}
          <div className="hidden sm:block">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Buscar marcajes, empleados, terminales..."
                className="w-full bg-transparent pl-9 pr-4 py-1.5 text-xs md:text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none xl:w-96"
              />
            </div>
          </div>
        </div>

        {/* ── Derecha: Sucursal, Notificaciones y Perfil ── */}
        <div className="flex items-center gap-3 2xl:gap-7">
          {/* Badge de Sucursal */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/40 text-blue-600 dark:text-blue-400">
            <Building2 className="w-4 h-4" />
            <span className="text-xs font-semibold">
              {userProfile.empresa}
            </span>
          </div>

          {/* Icono de Notificaciones */}
          <div className="relative">
            <button
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute -top-0.5 -right-0.5 z-10 h-2 w-2 rounded-full bg-emerald-500">
                <span className="absolute -z-10 inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              </span>
            </button>
          </div>

          {/* ── Dropdown de Perfil ──────────────────────────── */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
            >
              <div className="hidden text-right lg:block">
                <span className="block text-sm font-semibold leading-tight text-slate-900 dark:text-white">
                  {userProfile.nombre}
                </span>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {userProfile.rol}
                </span>
              </div>

              {/* Avatar con iniciales */}
              <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full font-bold shadow-md text-sm bg-blue-600 text-white">
                {userProfile.nombre.charAt(0).toUpperCase()}
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
                className="absolute right-0 mt-3 w-64 rounded-xl p-2 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-xl z-50 animate-slideDown"
              >
                {/* Header del dropdown */}
                <div className="px-3 py-2 mb-1 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-medium text-slate-400">Sesión activa como:</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {userProfile.email}
                  </p>
                </div>

                <ul className="flex flex-col gap-0.5 text-sm font-medium">
                  {[
                    { Icon: User,     label: 'Mi Perfil'          },
                    { Icon: Shield,   label: 'Control de Acceso'  },
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
