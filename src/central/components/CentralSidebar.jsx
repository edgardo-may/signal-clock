// src/central/components/CentralSidebar.jsx — Navegación Master de Signum-Clock Central
import { useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/useAuth'
import {
  LayoutDashboard,
  Building2,
  Users,
  Cpu,
  CreditCard,
  BarChart3,
  LogOut,
  ShieldCheck,
  X,
  ExternalLink,
  Layers,
  RefreshCw,
  KeyRound,
  Activity,
} from 'lucide-react'

export default function CentralSidebar({ sidebarOpen, setSidebarOpen }) {
  const location = useLocation()
  const sidebarRef = useRef(null)
  const { signOut, profile } = useAuth()

  const navItems = [
    {
      group: 'PANEL PRINCIPAL',
      items: [
        { label: 'Dashboard', to: '/central', icon: LayoutDashboard, exact: true },
        { label: 'Empresas', to: '/central/empresas', icon: Building2 },
      ],
    },
    {
      group: 'GESTIÓN GLOBAL',
      items: [
        { label: 'Usuarios Globales', to: '/central/usuarios', icon: Users },
        { label: 'Permisos por Módulo', to: '/central/permisos', icon: KeyRound },
        { label: 'Terminales ISUP', to: '/central/dispositivos', icon: Cpu },
        { label: 'Sincronización Global', to: '/central/sincronizacion', icon: RefreshCw },
        { label: 'Planes & Capacidades', to: '/central/planes', icon: CreditCard },
      ],
    },
    {
      group: 'SUPERVISIÓN',
      items: [
        { label: 'Resumen Biométrico', to: '/central/biometricos-resumen', icon: Activity },
        { label: 'Métricas Globales', to: '/central/estadisticas', icon: BarChart3 },
      ],
    },
    {
      group: 'SEGURIDAD',
      items: [
        { label: 'Auditoría', to: '/central/auditoria', icon: ShieldCheck },
      ],
    },
  ]

  // Cerrar drawer en móvil tras navegar
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024 && sidebarOpen && setSidebarOpen) {
      setSidebarOpen(false)
    }
  }, [location.pathname])
  return (
    <>
      {/* Backdrop móvil */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        style={{ backgroundColor: '#0F172A' }}
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col transition-all duration-300 ease-in-out lg:static ${
          sidebarOpen
            ? 'w-72 translate-x-0 shadow-2xl lg:shadow-none lg:w-72'
            : '-translate-x-full lg:translate-x-0 lg:w-20'
        }`}
      >
        {/* Brand Header */}
        <div
          className={`flex items-center transition-all duration-300 ${
            sidebarOpen ? 'justify-between px-6 py-4.5 lg:py-5' : 'justify-center py-4.5 lg:py-5'
          }`}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <NavLink to="/central" className="flex items-center gap-3 overflow-hidden group" title="Signum-Clock Central">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg shadow-md"
              style={{
                background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                boxShadow: '0 4px 12px rgba(37,99,235,0.30)',
              }}
            >
              <ShieldCheck className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>

            {sidebarOpen && (
              <div className="whitespace-nowrap transition-opacity duration-200">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-base font-bold tracking-wider text-white m-0" style={{ fontSize: '0.875rem' }}>
                    SIGNUM<span className="text-blue-500">·</span>CENTRAL
                  </h1>

                </div>
                <p className="text-[11px] font-medium mt-0 text-slate-400">
                  Control Center SaaS
                </p>
              </div>
            )}
          </NavLink>

          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Badge de SuperAdmin */}
        {sidebarOpen && (
          <div className="px-4 py-3 mx-4 mt-4 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
            <div className="overflow-hidden">
              <p className="text-[11px] font-bold text-white uppercase tracking-wider truncate">
                {profile?.nombre || 'SuperAdmin'}
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                Alcance Global (cliente_id: NULL)
              </p>
            </div>
          </div>
        )}

        {/* Navegación */}
        <div className="no-scrollbar flex flex-col overflow-y-auto duration-300 ease-linear flex-1 py-4 px-3 lg:px-4">
          <nav className="space-y-6">
            {navItems.map((group) => (
              <div key={group.group}>
                {sidebarOpen ? (
                  <h3 className="mb-2.5 ml-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">
                    {group.group}
                  </h3>
                ) : (
                  <div className="my-2 border-t border-slate-800" />
                )}
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = item.exact
                      ? location.pathname === item.to
                      : location.pathname.startsWith(item.to)

                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          title={!sidebarOpen ? item.label : undefined}
                          className={({ isActive }) =>
                            `group relative flex items-center gap-3.5 rounded-lg font-medium text-sm no-underline duration-200 ease-in-out transition-all ${
                              sidebarOpen ? 'px-3.5 py-2.5' : 'justify-center p-3'
                            } ${
                              isActive
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <Icon
                                className="w-5 h-5 flex-shrink-0 transition-colors duration-200"
                                strokeWidth={isActive ? 2.2 : 1.8}
                              />
                              {sidebarOpen && <span className="whitespace-nowrap truncate">{item.label}</span>}
                            </>
                          )}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Footer / Logout */}
        <div className="p-3 border-t border-slate-800 space-y-1">
          {/* Link a Signum-Clock Client para probar vista de tenant */}
          <NavLink
            to="/"
            title="Ir a Signum-Clock Client"
            className={`flex w-full items-center gap-3 rounded-lg text-sm font-medium no-underline duration-200 transition-colors text-slate-400 hover:bg-slate-800 hover:text-white ${
              sidebarOpen ? 'px-3.5 py-2.5' : 'justify-center p-3'
            }`}
          >
            <ExternalLink className="w-5 h-5 flex-shrink-0" strokeWidth={1.8} />
            {sidebarOpen && <span className="whitespace-nowrap">Vista Client Empresa</span>}
          </NavLink>

          <button
            onClick={() => signOut()}
            className={`flex w-full items-center gap-3 rounded-lg text-sm font-medium duration-200 transition-colors text-rose-400 hover:bg-rose-500/10 hover:text-rose-400 ${
              sidebarOpen ? 'px-3.5 py-2.5' : 'justify-center p-3'
            }`}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" strokeWidth={1.8} />
            {sidebarOpen && <span className="whitespace-nowrap">Cerrar Sesión</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
