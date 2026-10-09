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
  LogOut,
  ShieldCheck,
  X,
  ExternalLink,
  ClipboardList,
  ShieldAlert,
  KeyRound,
  Activity,
  CalendarDays,
  Radio,
  Terminal,
  FileSpreadsheet,
} from 'lucide-react'

const NAV_STRUCTURE = [
  {
    group: 'Resumen',
    items: [
      { label: 'Dashboard', to: '/central', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    group: 'Empresas',
    items: [
      { label: 'Empresas',    to: '/central/empresas',   icon: Building2 },
      { label: 'Usuarios',    to: '/central/usuarios',   icon: Users },
    ],
  },
  {
    group: 'Biométricos (ADMS)',
    items: [
      { label: 'Resumen Biométrico',  to: '/central/biometricos-resumen', icon: Activity },
      { label: 'Dispositivos',        to: '/central/dispositivos',        icon: Cpu },
      { label: 'Solicitudes de biométricos', to: '/central/biometricos/solicitudes', icon: ShieldCheck },
      { label: 'Colaboradores',       to: '/central/biometricos/colaboradores', icon: Users },
      { label: 'Asignaciones',        to: '/central/biometricos/asignaciones',  icon: CalendarDays },
      { label: 'Checadas (Logs)',     to: '/central/biometricos/historial',     icon: FileSpreadsheet },
      { label: 'Comandos ADMS',       to: '/central/biometricos/comandos',      icon: Terminal },
      { label: 'Sincronización ADMS', to: '/central/biometricos/sincronizacion', icon: Radio },
    ],
  },
  {
    group: 'Configuración',
    items: [
      { label: 'Políticas de Asistencia', to: '/central/politicas-asistencia', icon: ClipboardList },
      { label: 'Permisos',               to: '/central/permisos',             icon: KeyRound },
      { label: 'Planes y Capacidades',   to: '/central/planes',               icon: CreditCard },
    ],
  },
  {
    group: 'Supervisión',
    items: [
      { label: 'Auditoría',            to: '/central/auditoria',           icon: ShieldAlert },
    ],
  },
]

export default function CentralSidebar({ sidebarOpen, setSidebarOpen }) {
  const location  = useLocation()
  const sidebarRef = useRef(null)
  const { signOut, profile } = useAuth()

  // Cerrar drawer móvil al navegar
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
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        ref={sidebarRef}
        className={`
          fixed left-0 top-0 z-50 flex h-screen flex-col
          bg-[#0F172A] border-r border-white/[0.06]
          transition-all duration-300 ease-in-out lg:static
          ${sidebarOpen
            ? 'w-60 translate-x-0 shadow-2xl lg:shadow-none'
            : '-translate-x-full lg:translate-x-0 lg:w-[60px]'
          }
        `}
      >
        {/* ── Brand ─────────────────────────────────────── */}
        <div className={`flex items-center h-14 border-b border-white/[0.06] flex-shrink-0 ${sidebarOpen ? 'px-4 gap-3' : 'justify-center'}`}>
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
            style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', boxShadow: '0 2px 8px rgba(37,99,235,.35)' }}
          >
            <ShieldCheck className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>

          {sidebarOpen && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold tracking-wide text-white leading-none">
                SIGNUM<span className="text-blue-500">·</span>CENTRAL
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-none">Control Center</p>
            </div>
          )}

          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── SuperAdmin badge (solo expandido) ─────────── */}
        {sidebarOpen && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-white truncate leading-none">
                {profile?.nombre || 'SuperAdmin'}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-none">Acceso global</p>
            </div>
          </div>
        )}

        {/* ── Nav ───────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4 no-scrollbar">
          {NAV_STRUCTURE.map((section) => (
            <div key={section.group}>
              {/* Group label */}
              {sidebarOpen
                ? <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{section.group}</p>
                : <div className="my-1 border-t border-white/[0.06]" />
              }
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.exact}
                        title={!sidebarOpen ? item.label : undefined}
                        className={({ isActive }) =>
                          `flex items-center rounded-md text-[13px] font-medium transition-colors duration-150 no-underline
                          ${sidebarOpen ? 'gap-2.5 px-2.5 py-2' : 'justify-center p-2.5'}
                          ${isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                            {sidebarOpen && <span className="truncate">{item.label}</span>}
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

        {/* ── Footer ────────────────────────────────────── */}
        <div className={`border-t border-white/[0.06] py-2 px-2 space-y-0.5 flex-shrink-0`}>
          <NavLink
            to="/"
            className={`flex items-center rounded-md text-[13px] font-medium text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors no-underline
              ${sidebarOpen ? 'gap-2.5 px-2.5 py-2' : 'justify-center p-2.5'}`}
            title={!sidebarOpen ? 'Vista Empresa' : undefined}
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
            {sidebarOpen && <span>Vista Empresa</span>}
          </NavLink>

          <button
            onClick={() => signOut()}
            className={`w-full flex items-center rounded-md text-[13px] font-medium text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors
              ${sidebarOpen ? 'gap-2.5 px-2.5 py-2' : 'justify-center p-2.5'}`}
            title={!sidebarOpen ? 'Cerrar Sesión' : undefined}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
            {sidebarOpen && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
