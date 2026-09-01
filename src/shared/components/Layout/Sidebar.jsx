// src/components/Sidebar.jsx — Signum-Clock v4 · Jet Stream + Blue Whale palette
import { useEffect, useRef, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../features/auth/hooks/useAuth'
import { hasPermission, isSuperAdmin, PERMISSION } from '../../auth/permissions'
import {
  LayoutDashboard,
  Users,
  Cpu,
  FileSpreadsheet,
  LogOut,
  Clock,
  Activity,
  X,
  CalendarDays,
  CalendarHeart,
  ClipboardCheck,
  Camera,
  UserCog,
  FileText,
  Building2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Radio,
  RefreshCw,
  Fingerprint,
  ShieldCheck,
} from 'lucide-react'

export default function Sidebar({ sidebarOpen, setSidebarOpen }) {
  const location = useLocation()
  const navigate = useNavigate()
  const sidebarRef = useRef(null)
  const { signOut, profile, modulePermissions } = useAuth()

  const hasCentralAccess = isSuperAdmin(profile)

  // Estado para controlar qué menús padre están desplegados
  const [openMenus, setOpenMenus] = useState(() => {
    const init = {}
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/biometricos')) {
      init['/biometricos'] = true
    }
    return init
  })

  // Mantener expandido automáticamente el menú si la ruta activa coincide
  useEffect(() => {
    if (location.pathname.startsWith('/biometricos')) {
      setOpenMenus((prev) => ({ ...prev, '/biometricos': true }))
    }
  }, [location.pathname])

  const toggleMenu = (menuKey, defaultPath) => {
    setOpenMenus((prev) => {
      const isCurrentlyOpen = !!prev[menuKey]
      if (!isCurrentlyOpen && defaultPath && !location.pathname.startsWith(menuKey)) {
        navigate(defaultPath)
      }
      return {
        ...prev,
        [menuKey]: !isCurrentlyOpen,
      }
    })
  }

  const menuGroups = useMemo(() => {
    const groups = [
      {
        name: 'MENÚ PRINCIPAL',
        items: [
          { label: 'Dashboard',           to: '/',                icon: LayoutDashboard, permission: PERMISSION.DASHBOARD },
          { label: 'Empleados',           to: '/empleados',       icon: Users, permission: PERMISSION.EMPLOYEES },
          { label: 'Integraciones',       to: '/sincronizacion',  icon: RefreshCw, permission: PERMISSION.SYNCHRONIZATION },
          { label: 'Enrolamiento',        to: '/enrolamiento',    icon: Fingerprint, permission: PERMISSION.ENROLLMENT },
          { label: 'Horarios & Turnos',   to: '/horarios',        icon: Clock, permission: PERMISSION.SCHEDULES },
          { label: 'Agenda de Turnos',    to: '/agenda-horarios', icon: CalendarDays, permission: PERMISSION.SCHEDULE_AGENDA },
          { label: 'Días Festivos',       to: '/festivos',        icon: CalendarHeart, permission: PERMISSION.HOLIDAYS },
          { label: 'Incidencias',         to: '/incidencias',     icon: FileText, permission: PERMISSION.ATTENDANCE_MANAGE },
          { label: 'Checadas Manuales',   to: '/checadas-manuales', icon: ClipboardCheck, permission: PERMISSION.ATTENDANCE_MANAGE },
          { label: 'Kiosco Checador Web', to: '/kiosko',          icon: Camera, permission: PERMISSION.ATTENDANCE_MANAGE },
          {
            label: 'Biométricos',
            to: '/biometricos',
            icon: Cpu,
            isParent: true,
            permission: PERMISSION.BIOMETRICS,
            children: hasCentralAccess ? [
              { label: 'Dashboard', to: '/biometricos/dashboard', icon: LayoutDashboard },
              { label: 'Dispositivos', to: '/biometricos/dispositivos', icon: Cpu },
              { label: 'Colaboradores', to: '/biometricos/colaboradores', icon: Users },
              { label: 'Asignaciones', to: '/biometricos/asignaciones', icon: CalendarDays },
              { label: 'Sincronización', to: '/biometricos/sincronizacion', icon: Radio },
              { label: 'Checadas', to: '/biometricos/historial', icon: Activity },
              { label: 'Comandos ADMS', to: '/biometricos/comandos', icon: Terminal },
            ] : [
              { label: 'Resumen', to: '/biometricos/resumen', icon: LayoutDashboard },
              { label: 'Dispositivos', to: '/biometricos/dispositivos', icon: Cpu },
              { label: 'Checadas', to: '/biometricos/historial', icon: Activity },
            ],
          },
        ],
      },
      ...(hasCentralAccess ? [
        {
          name: 'ADMINISTRACIÓN MASTER',
          items: [
            { label: 'Empresas & Tenants',  to: '/empresas',        icon: Building2       },
            { label: 'Usuarios & Accesos',  to: '/usuarios',        icon: UserCog, permission: PERMISSION.USERS },
            { label: 'Permisos de Módulos', to: '/permisos',        icon: ShieldCheck, permission: PERMISSION.PERMISSIONS },
          ],
        }
      ] : [
        {
          name: 'ADMINISTRACIÓN',
          items: [
            { label: 'Usuarios & Accesos',  to: '/usuarios',        icon: UserCog         },
            ...(profile?.rol === 'admin' ? [{ label: 'Auditoría', to: '/auditoria', icon: ShieldCheck }] : []),
          ],
        }
      ]),
      {
        name: 'SOPORTE & REPORTES',
        items: [
          {
            label: 'Reportes Biomédicos',
            to: '/visor-asistencias',
            icon: FileSpreadsheet,
            isParent: true,
            permission: PERMISSION.REPORTS,
            children: [
              { label: 'Visor de Checadas', to: '/visor-asistencias', exact: true, icon: FileSpreadsheet },
              { label: 'Reporte de Retardos', to: '/reporte-retardos', icon: Clock },
              { label: 'Matriz de Checadas', to: '/matriz-checadas', icon: CalendarDays },
              { label: 'Historial de Eventos', to: '/historial-eventos', icon: Activity },
              { label: 'Tarjeta de Fichaje', to: '/tarjeta-fichaje', icon: ClipboardCheck },
            ]
          },
          { label: 'Reportes de Nómina', to: '/reportes', icon: FileSpreadsheet, permission: PERMISSION.REPORTS },
        ],
      },
    ]

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || hasPermission(profile, item.permission, modulePermissions)),
      }))
      .filter((group) => group.items.length > 0)
  }, [hasCentralAccess, modulePermissions, profile])

  // Cerrar drawer en móvil tras navegar
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024 && sidebarOpen && setSidebarOpen) {
      setSidebarOpen(false)
    }
  }, [location.pathname])

  const handleLogout = async () => {
    await signOut()
  }

  return (
    <>
      {/* ── Backdrop oscuro en pantallas pequeñas ─────────────── */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar Container ─────────────────────────────────── */}
      <aside
        ref={sidebarRef}
        style={{ backgroundColor: '#0F172A' }}
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col transition-all duration-300 ease-in-out lg:static ${
          sidebarOpen
            ? 'w-72 translate-x-0 shadow-2xl lg:shadow-none lg:w-72'
            : '-translate-x-full lg:translate-x-0 lg:w-20'
        }`}
      >
        {/* ── Header / Brand ────────────────────────────────────── */}
        <div
          className={`flex items-center transition-all duration-300 ${
            sidebarOpen
              ? 'justify-between px-6 py-4.5 lg:py-5'
              : 'justify-center py-4.5 lg:py-5'
          }`}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <NavLink
            to="/"
            className="flex items-center gap-3 overflow-hidden group no-underline"
            title="Signum-Clock Dashboard"
          >
            {/* Logo Icon */}
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg shadow-md"
              style={{
                background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                boxShadow: '0 4px 12px rgba(37,99,235,0.30)',
              }}
            >
              <Clock className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>

            {/* Texto del logo: visible sólo cuando está abierto */}
            {sidebarOpen && (
              <div className="whitespace-nowrap transition-opacity duration-200">
                <h1 className="text-base font-bold tracking-wider text-white m-0" style={{ fontSize: '0.875rem' }}>
                  SIGNUM<span className="text-blue-500">·</span>CLOCK
                </h1>
                <p className="text-[11px] font-medium mt-0 text-slate-400">
                  Control de Asistencia
                </p>
              </div>
            )}
          </NavLink>

          {/* Botón de cierre en móviles */}
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Cerrar menú lateral"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* ── Navigation List ────────────────────────────────────── */}
        <div className="no-scrollbar flex flex-col overflow-y-auto duration-300 ease-linear flex-1 py-4 px-3 lg:px-4">
          <nav className="space-y-6">
            {menuGroups.map((group, groupIdx) => (
              <div key={groupIdx}>
                {/* Título de sección */}
                {sidebarOpen ? (
                  <h3 className="mb-2.5 ml-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">
                    {group.name}
                  </h3>
                ) : (
                  <div className="my-2 border-t border-slate-800" />
                )}

                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon

                    // Elemento padre con submenú
                    if (item.isParent && item.children) {
                      const isParentActive = location.pathname.startsWith(item.to)
                      const isMenuOpen = !!openMenus[item.to]

                      return (
                        <li key={item.to} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => toggleMenu(item.to, item.to)}
                            title={!sidebarOpen ? item.label : undefined}
                            className={`w-full group flex items-center justify-between rounded-lg px-3.5 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                              isParentActive
                                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                                : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            } ${!sidebarOpen ? 'justify-center px-0' : ''}`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className={`w-4 h-4 flex-shrink-0 ${isParentActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-white'}`} />
                              {sidebarOpen && <span>{item.label}</span>}
                            </div>

                            {sidebarOpen && (
                              <div className="text-slate-400 group-hover:text-white transition-transform">
                                {isMenuOpen ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </div>
                            )}
                          </button>

                          {/* Submenús desplegables */}
                          {sidebarOpen && isMenuOpen && (
                            <div className="pl-4 ml-3 border-l border-slate-700/60 space-y-1 pt-0.5 pb-1">
                              {item.children.map((child) => {
                                const ChildIcon = child.icon
                                const isChildActive = child.exact
                                  ? location.pathname === child.to || location.pathname === `${child.to}/dashboard`
                                  : location.pathname === child.to || location.pathname.startsWith(`${child.to}/`)

                                return (
                                  <NavLink
                                    key={child.to}
                                    to={child.to}
                                    className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-[11px] font-medium transition-all no-underline ${
                                      isChildActive
                                        ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/20'
                                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                    }`}
                                  >
                                    <ChildIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isChildActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`} />
                                    <span className="truncate">{child.label}</span>
                                  </NavLink>
                                )
                              })}
                            </div>
                          )}
                        </li>
                      )
                    }

                    // Elemento simple
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
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
                              {sidebarOpen && (
                                <span className="whitespace-nowrap truncate">{item.label}</span>
                              )}
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

          {/* ── Realtime Status ─────────────────────────────────── */}
          <div className="mt-auto pt-4">
            {sidebarOpen ? (
              <div className="rounded-lg p-3 bg-slate-800/80 border border-slate-700/60 shadow-sm">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 whitespace-nowrap">
                    <Activity className="w-3.5 h-3.5 text-blue-400" />
                    Terminales ISUP
                  </span>
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </div>
                <p className="text-[11px] leading-tight text-slate-400">
                  Escuchando eventos en tiempo real.
                </p>
              </div>
            ) : (
              <div className="flex justify-center" title="Receptor ISUP Activo">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer / Logout ────────────────────────────────────── */}
        <div
          className="p-3 lg:p-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            onClick={handleLogout}
            className={`group flex w-full items-center gap-3 rounded-lg text-sm font-medium transition-colors text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 ${
              sidebarOpen ? 'px-3.5 py-2.5' : 'justify-center p-3'
            }`}
            title={!sidebarOpen ? 'Cerrar Sesión' : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span className="whitespace-nowrap">Cerrar Sesión</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
