// src/client/components/ClientSidebar.jsx — Navegación Corporativa para Signum-Clock Client
import { useState, useRef, useEffect, useMemo } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/useAuth'
import { useTenant } from '../../shared/providers/TenantProvider'
import { hasPermission, PERMISSION } from '../../shared/auth/permissions'
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarDays,
  CalendarHeart,
  FileText,
  ClipboardCheck,
  Cpu,
  Camera,
  UserCog,
  FileSpreadsheet,
  LogOut,
  Building2,
  X,
  ChevronDown,
  ChevronRight,
  Activity,
  Terminal,
  Radio,
  ShieldCheck,
  RefreshCw,
  Fingerprint,
} from 'lucide-react'

export default function ClientSidebar({ sidebarOpen, setSidebarOpen }) {
  const location = useLocation()
  const navigate = useNavigate()
  const sidebarRef = useRef(null)
  const { signOut, profile, modulePermissions } = useAuth()
  const { tenant, empleadosActuales, limiteEmpleados } = useTenant()

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
      // Si se abre y no estamos en una subruta de biometricos, navegar a la ruta por defecto
      if (!isCurrentlyOpen && defaultPath && !location.pathname.startsWith(menuKey)) {
        navigate(defaultPath)
      }
      return {
        ...prev,
        [menuKey]: !isCurrentlyOpen,
      }
    })
  }

  const menuGroups = useMemo(() => [
    {
      name: 'OPERACIÓN DE ASISTENCIA',
      items: [
        { label: 'Dashboard', to: '/', icon: LayoutDashboard, exact: true, permission: PERMISSION.DASHBOARD },
        { label: 'Colaboradores', to: '/empleados', icon: Users, permission: PERMISSION.EMPLOYEES },
        { label: 'Integraciones', to: '/sincronizacion', icon: RefreshCw, permission: PERMISSION.SYNCHRONIZATION },
        { label: 'Enrolamiento', to: '/enrolamiento', icon: Fingerprint, permission: PERMISSION.ENROLLMENT },
        { label: 'Horarios & Turnos', to: '/horarios', icon: Clock, permission: PERMISSION.SCHEDULES },
        { label: 'Agenda de Turnos', to: '/agenda-horarios', icon: CalendarDays, permission: PERMISSION.SCHEDULE_AGENDA },
        { label: 'Días Festivos', to: '/festivos', icon: CalendarHeart, permission: PERMISSION.HOLIDAYS },
        { label: 'Incidencias & Permisos', to: '/incidencias', icon: FileText, permission: PERMISSION.ATTENDANCE_MANAGE },
        { label: 'Checadas Manuales', to: '/checadas-manuales', icon: ClipboardCheck, permission: PERMISSION.ATTENDANCE_MANAGE },
        {
          label: 'Biométricos',
          icon: Cpu,
          to: '/biometricos',
          isParent: true,
          permission: PERMISSION.BIOMETRICS,
            children: [
              { label: 'Resumen', to: '/biometricos/resumen', icon: LayoutDashboard, permission: PERMISSION.BIOMETRICS },
              { label: 'Dispositivos', to: '/biometricos/dispositivos', icon: Cpu, permission: PERMISSION.BIOMETRICS },
              { label: 'Checadas', to: '/biometricos/historial', icon: Activity, permission: PERMISSION.BIOMETRICS },
            ],
        },
        { label: 'Kiosco Checador Web', to: '/kiosko', icon: Camera, permission: PERMISSION.ATTENDANCE_MANAGE },
      ],
    },
    {
      name: 'ADMINISTRACIÓN DE EMPRESA',
      items: [
        { label: 'Usuarios del Tenant', to: '/usuarios', icon: UserCog, permission: PERMISSION.USERS },
        { label: 'Permisos de módulos', to: '/permisos', icon: ShieldCheck, permission: PERMISSION.PERMISSIONS },
      ],
    },
    {
      name: 'NÓMINA & REPORTES',
      items: [
        { label: 'Reportes de Asistencia', to: '/reportes', icon: FileSpreadsheet, permission: PERMISSION.REPORTS },
      ],
    },
  ].map((group) => ({
    ...group,
    items: group.items
      .map((item) => ({
        ...item,
        children: item.children?.filter((child) => !child.permission || hasPermission(profile, child.permission, modulePermissions)),
      }))
      .filter((item) => !item.permission || hasPermission(profile, item.permission, modulePermissions)),
  })).filter((group) => group.items.length > 0), [modulePermissions, profile])

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
            sidebarOpen ? 'justify-between px-6 py-5' : 'justify-center py-5'
          }`}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <NavLink to="/" className="flex items-center gap-3 overflow-hidden group">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-blue-600/30">
              <Clock className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>

            {sidebarOpen && (
              <div className="whitespace-nowrap transition-opacity duration-200">
                <h1 className="text-base font-bold tracking-wider text-white m-0">
                  SIGNUM<span className="text-blue-500">·</span>CLOCK
                </h1>
                <p className="text-[11px] font-medium text-slate-400 truncate max-w-[150px]">
                  {tenant?.nombre_empresa || 'Control de Asistencia'}
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

        {/* Badge de Empresa y Capacidad */}
        {sidebarOpen && (
          <div className="px-4 py-3 mx-4 mt-4 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="overflow-hidden flex-1">
              <p className="text-xs font-bold text-white truncate">
                {tenant?.nombre_empresa || 'Empresa'}
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                {empleadosActuales} / {limiteEmpleados} colaboradores
              </p>
            </div>
          </div>
        )}

        {/* Navegación */}
        <div className="flex flex-1 flex-col overflow-y-auto duration-300 ease-linear px-3 py-4 space-y-6 no-scrollbar">
          {menuGroups.map((group) => (
            <div key={group.name}>
              {sidebarOpen && (
                <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {group.name}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon

                  // Manejo de elemento Padre con submenús
                  if (item.isParent && item.children) {
                    const isParentActive = location.pathname.startsWith(item.to)
                    const isMenuOpen = !!openMenus[item.to]

                    return (
                      <div key={item.to} className="space-y-1">
                        {/* Botón Padre */}
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
                      </div>
                    )
                  }

                  // Manejo de elemento simple (sin submenú)
                  const isActive = item.exact
                    ? location.pathname === item.to
                    : location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to))

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={!sidebarOpen ? item.label : undefined}
                      className={`group flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      } ${!sidebarOpen ? 'justify-center px-0' : ''}`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
                      {sidebarOpen && <span>{item.label}</span>}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer / Logout */}
        <div className="p-3 border-t border-slate-800 space-y-1">
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
