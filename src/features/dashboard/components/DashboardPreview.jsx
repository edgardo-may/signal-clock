/**
 * DashboardPreview.jsx — Vista previa completa del Dashboard
 * Paleta: Emerald Ink (#2563EB) × Champagne (#E2E8F0)
 *
 * Componente 100% autosuficiente (sin Supabase / React Router).
 * Renderizable de inmediato en cualquier ruta o Storybook.
 */
import { useState, useMemo } from 'react'
import {
  LayoutDashboard, Users, Cpu, Clock, FileSpreadsheet, LogOut,
  CalendarDays, CalendarHeart, ClipboardCheck, Camera, UserCog,
  FileText, Activity, TrendingUp, Bell, Search, Building2,
  ChevronDown, Menu, X, ArrowUpRight, ArrowDownRight, Fingerprint,
  ScanFace, CreditCard, Hash, Shuffle, MapPin, Settings, Shield,
  User, ChevronLeft, ChevronRight,
} from 'lucide-react'
// Iconos oficiales de Lucide Animated (https://lucide-animated.com/)
import {
  ActivityIcon,
  UsersIcon,
  CpuIcon,
  ClockAnimIcon,
  TrendingUpIcon,
  MapPinIcon,
  FingerprintIcon,
  ScanFaceIcon,
  CreditCardIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from '../../../shared/components/icons/lucide-animated'

/* ─── Colores base (Paleta Oficial Steel Blue & Charcoal) ──────── */
const C = {
  emerald:        '#2563EB',
  emeraldHover:   '#1D4ED8',
  emeraldDark:    '#0F172A',
  emeraldLight:   '#3B82F6',
  emeraldMuted:   '#94A3B8',
  champagne:      '#E2E8F0',
  champagneLight: '#F8FAFC',
  champagneHover: '#CBD5E1',
  champagneDark:  '#94A3B8',
  champagneMuted: '#64748B',
}

/* ─── Datos de demo ──────────────────────────────────────────── */
const MENU_GROUPS = [
  {
    name: 'MENÚ',
    items: [
      { label: 'Dashboard',           icon: LayoutDashboard, active: true  },
      { label: 'Empleados',           icon: Users                           },
      { label: 'Horarios & Turnos',   icon: Clock                           },
      { label: 'Agenda de Turnos',    icon: CalendarDays                    },
      { label: 'Días Festivos',       icon: CalendarHeart                   },
      { label: 'Incidencias',         icon: FileText                        },
      { label: 'Checadas Manuales',   icon: ClipboardCheck                  },
      { label: 'Biométricos',         icon: Cpu                             },
      { label: 'Usuarios & Accesos',  icon: UserCog                         },
      { label: 'Kiosco Checador',     icon: Camera                          },
    ],
  },
  {
    name: 'SOPORTE & REPORTES',
    items: [
      { label: 'Reportes de Asistencia', icon: FileSpreadsheet },
    ],
  },
]

const KPI_DATA = [
  { label: 'Empleados',    value: '248',   trend: '+12%',   up: true,  iconBg: 'rgba(6,78,59,0.10)',  iconClr: '#2563EB', icon: UsersIcon    },
  { label: 'Biométricos',  value: '18',    trend: 'Online', up: true,  iconBg: 'rgba(6,78,59,0.10)',  iconClr: '#2563EB', icon: CpuIcon      },
  { label: 'Marcajes/Hoy', value: '1,204', trend: '+3.2%',  up: true,  iconBg: 'rgba(6,78,59,0.10)',  iconClr: '#2563EB', icon: ClockAnimIcon },
  { label: 'Incidencias',  value: '7',     trend: '+2',     up: false, iconBg: 'rgba(239,68,68,0.1)', iconClr: '#dc2626', icon: ActivityIcon  },
]

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const BAR_DATA = [87, 112, 98, 134, 120, 45, 22]

const TIPO_BADGE = {
  entrada:         { label: 'Entrada',    bg: '#2563EB', txt: '#2563EB', dot: '#059669' },
  salida:          { label: 'Salida',     bg: '#FEE2E2', txt: '#B91C1C', dot: '#DC2626' },
  descanso_inicio: { label: 'Descanso ↓', bg: '#FEF3C7', txt: '#92400E', dot: '#D97706' },
  descanso_fin:    { label: 'Descanso ↑', bg: '#E0F2FE', txt: '#0369A1', dot: '#0284C7' },
}

const METODO_CONFIG = {
  rostro:    { icon: ScanFaceIcon,    bg: '#2563EB', txt: '#2563EB', label: 'Rostro'    },
  huella:    { icon: FingerprintIcon, bg: '#DBEAFE', txt: '#1E40AF', label: 'Huella'    },
  tarjeta:   { icon: CreditCardIcon,  bg: '#FEF3C7', txt: '#92400E', label: 'Tarjeta'   },
  pin:       { icon: Hash,            bg: '#F8FAFC', txt: '#475569', label: 'PIN'        },
  combinado: { icon: Shuffle,         bg: '#EDE9FE', txt: '#5B21B6', label: 'Combinado' },
}

const TABLE_ROWS = [
  { id:1, name:'Ana García',      tipo:'entrada',  metodo:'rostro',  ubicacion:'Recepción Principal',     hora:'08:02', new: true  },
  { id:2, name:'Luis Martínez',   tipo:'entrada',  metodo:'huella',  ubicacion:'Almacén Bodega Norte',    hora:'08:07', new: false },
  { id:3, name:'Sofía Torres',    tipo:'descanso_inicio', metodo:'tarjeta', ubicacion:'Cafetería 2do Piso', hora:'10:30', new: false },
  { id:4, name:'Carlos Ríos',     tipo:'salida',   metodo:'rostro',  ubicacion:'Planta de Producción',   hora:'14:00', new: false },
  { id:5, name:'Mariana López',   tipo:'descanso_fin',    metodo:'pin',   ubicacion:'Oficinas Corporativas', hora:'11:01', new: false },
  { id:6, name:'Diego Herrera',   tipo:'entrada',  metodo:'combinado', ubicacion:'Entrada Lateral B',    hora:'07:58', new: false },
]

/* ─── Helpers ────────────────────────────────────────────────── */
function cls(...args) { return args.filter(Boolean).join(' ') }

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTES
═══════════════════════════════════════════════════════════════ */

/* Sidebar */
function PreviewSidebar({ open, onClose }) {
  return (
    <>
      {/* Backdrop móvil */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        style={{ backgroundColor: C.emerald }}
        className={cls(
          'fixed left-0 top-0 z-50 flex h-screen flex-col transition-all duration-300 ease-in-out lg:static',
          open
            ? 'w-72 translate-x-0 shadow-2xl lg:shadow-none'
            : '-translate-x-full lg:translate-x-0 lg:w-20',
        )}
      >
        {/* Brand */}
        <div
          className={cls(
            'flex items-center border-b transition-all duration-300',
            open ? 'justify-between px-5 py-4' : 'justify-center py-4',
          )}
          style={{ borderColor: 'rgba(248,231,201,0.12)' }}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            {/* Logo mark */}
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl shadow-md"
              style={{ backgroundColor: C.champagneDark }}
            >
              <ClockAnimIcon size={20} className="" style={{ color: C.emeraldDark }} />
            </div>

            {open && (
              <div className="whitespace-nowrap">
                <p className="text-sm font-bold tracking-widest" style={{ color: C.champagne }}>
                  SIGNUM<span style={{ color: C.champagneDark }}>·</span>CLOCK
                </p>
                <p className="text-[10px] font-medium" style={{ color: 'rgba(248,231,201,0.55)' }}>
                  Control de Asistencia
                </p>
              </div>
            )}
          </div>

          {open && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-lg transition-colors"
              style={{ color: 'rgba(248,231,201,0.55)' }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 no-scrollbar">
          {MENU_GROUPS.map((group, gi) => (
            <div key={gi}>
              {open ? (
                <p
                  className="mb-2 ml-2 text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: 'rgba(248,231,201,0.40)' }}
                >
                  {group.name}
                </p>
              ) : (
                <div className="my-2 border-t" style={{ borderColor: 'rgba(248,231,201,0.10)' }} />
              )}
              <ul className="space-y-1">
                {group.items.map(({ label, icon: Icon, active }) => (
                  <li key={label}>
                    <button
                      className={cls(
                        'group w-full flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-150',
                        open ? 'px-3.5 py-2.5' : 'justify-center p-3',
                      )}
                      style={
                        active
                          ? { backgroundColor: 'rgba(248,231,201,0.15)', color: C.champagne }
                          : { color: 'rgba(248,231,201,0.60)' }
                      }
                      onMouseEnter={e => {
                        if (!active) e.currentTarget.style.backgroundColor = 'rgba(248,231,201,0.08)'
                        if (!active) e.currentTarget.style.color = C.champagne
                      }}
                      onMouseLeave={e => {
                        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
                        if (!active) e.currentTarget.style.color = 'rgba(248,231,201,0.60)'
                      }}
                      title={!open ? label : undefined}
                    >
                      <Icon
                          className="w-5 h-5 flex-shrink-0"
                          style={{ color: active ? C.champagneDark : 'rgba(248,231,201,0.55)' }}
                          strokeWidth={active ? 2.2 : 1.8}
                        />
                      {open && <span className="truncate">{label}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Realtime indicator */}
        <div className="px-3 pb-2">
          {open ? (
            <div
              className="rounded-xl p-3"
              style={{ backgroundColor: 'rgba(248,231,201,0.07)', border: '1px solid rgba(248,231,201,0.10)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.champagne }}>
                  <ActivityIcon size={14} className="" style={{ color: C.emeraldMuted }} />
                  Terminales ISUP
                </span>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: C.emeraldMuted }} />
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: C.emeraldMuted }} />
                </span>
              </div>
              <p className="text-[10px]" style={{ color: 'rgba(248,231,201,0.45)' }}>
                Escuchando eventos en tiempo real.
              </p>
            </div>
          ) : (
            <div className="flex justify-center p-2 rounded-xl" style={{ backgroundColor: 'rgba(248,231,201,0.07)' }}>
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: C.emeraldMuted }} />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: C.emeraldMuted }} />
              </span>
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="border-t p-3" style={{ borderColor: 'rgba(248,231,201,0.10)' }}>
          <button
            className={cls(
              'flex w-full items-center gap-3 rounded-xl text-sm font-medium transition-all duration-150',
              open ? 'px-3.5 py-2.5' : 'justify-center p-3',
            )}
            style={{ color: 'rgba(248,231,201,0.55)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.10)'; e.currentTarget.style.color = '#fca5a5' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(248,231,201,0.55)' }}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" strokeWidth={1.8} />
            {open && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>
    </>
  )
}

/* Header */
function PreviewHeader({ sidebarOpen, onToggle }) {
  const [ddOpen, setDdOpen] = useState(false)

  return (
    <header
      className="sticky top-0 z-30 flex w-full border-b drop-shadow-sm"
      style={{ backgroundColor: C.champagneLight, borderColor: 'rgba(6,78,59,0.10)' }}
    >
      <div className="flex flex-grow items-center justify-between px-4 py-3 md:px-6">
        {/* Left */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className="flex items-center justify-center rounded-xl border p-2 transition-all duration-200 active:scale-95"
            style={{
              borderColor: 'rgba(6,78,59,0.15)',
              backgroundColor: C.champagne,
              color: C.emerald,
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = C.champagneDark; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = C.champagne; }}
            aria-label={sidebarOpen ? 'Colapsar menú' : 'Expandir menú'}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search */}
          <div className="hidden sm:flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(6,78,59,0.15)', backgroundColor: C.champagne }}>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(6,78,59,0.45)' }} />
            <input
              type="text"
              placeholder="Buscar marcajes, empleados..."
              className="bg-transparent text-sm focus:outline-none w-64"
              style={{ color: C.emerald }}
            />
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {/* Sucursal badge */}
          <div
            className="hidden md:flex items-center gap-2 rounded-xl border px-3 py-1.5"
            style={{ backgroundColor: C.champagne, borderColor: 'rgba(6,78,59,0.15)' }}
          >
            <Building2 className="w-4 h-4" style={{ color: C.emerald }} />
            <span className="text-xs font-semibold" style={{ color: C.emerald }}>
              Sucursal Principal
            </span>
          </div>

          {/* Bell */}
          <button
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors"
            style={{ backgroundColor: C.champagne, borderColor: 'rgba(6,78,59,0.15)', color: C.emerald }}
          >
            <Bell className="w-4 h-4" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full" style={{ backgroundColor: C.emeraldMuted }}>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: C.emeraldMuted }} />
            </span>
          </button>

          {/* User */}
          <div className="relative">
            <button
              onClick={() => setDdOpen(p => !p)}
              className="flex items-center gap-2.5"
            >
              <div className="hidden text-right lg:block">
                <p className="text-sm font-semibold" style={{ color: C.emeraldDark }}>Edgar Administrador</p>
                <p className="text-xs" style={{ color: 'rgba(6,78,59,0.55)' }}>ADMIN</p>
              </div>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold shadow-sm"
                style={{ backgroundColor: C.emerald, color: C.champagne }}
              >
                E
              </div>
              <ChevronDown className="hidden lg:block w-4 h-4 transition-transform" style={{ color: 'rgba(6,78,59,0.55)', transform: ddOpen ? 'rotate(180deg)' : '' }} />
            </button>

            {ddOpen && (
              <div
                className="absolute right-0 mt-2 w-56 rounded-2xl border p-2 shadow-xl z-50"
                style={{ backgroundColor: C.champagneLight, borderColor: 'rgba(6,78,59,0.12)' }}
              >
                <div className="px-3 py-2 border-b mb-1" style={{ borderColor: 'rgba(6,78,59,0.08)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(6,78,59,0.45)' }}>Sesión activa</p>
                  <p className="text-sm font-semibold truncate" style={{ color: C.emeraldDark }}>edgar@empresa.com</p>
                </div>
                {[{
                    icon: User,     label: 'Mi Perfil',
                  }, {
                    icon: Shield,   label: 'Control de Acceso',
                  }, {
                    icon: Settings, label: 'Configuración',
                  }].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
                    style={{ color: C.emerald }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = C.champagne}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                      <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
                <div className="mt-1 pt-1 border-t" style={{ borderColor: 'rgba(6,78,59,0.08)' }}>
                  <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors" onMouseEnter={e => e.currentTarget.style.backgroundColor = '#FEE2E2'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
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

/* KPI Card */
function KpiCard({ label, value, sub, icon: Icon, trend, up, iconBg, iconClr }) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 group"
      style={{
        backgroundColor: C.champagneLight,
        border: `1px solid rgba(6,78,59,0.10)`,
        boxShadow: '0 1px 3px rgba(6,78,59,0.06), 0 4px 16px -4px rgba(6,78,59,0.10)',
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ backgroundColor: iconBg }}
        >
          {/* Lucide Animated icon: usa size en px, color por CSS currentColor via style */}
          <Icon size={24} style={{ color: iconClr }} />
        </div>
        <span
          className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg"
          style={
            up
              ? { backgroundColor: '#2563EB', color: '#2563EB' }
              : { backgroundColor: '#FEE2E2', color: '#B91C1C' }
          }
        >
          {up
            ? <ArrowUpRight className="w-3.5 h-3.5" />
            : <ArrowDownRight className="w-3.5 h-3.5" />
          }
          {trend}
        </span>
      </div>

      <div className="mt-5">
        <p
          className="text-3xl font-extrabold tabular tracking-tight"
          style={{ color: C.emeraldDark, fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </p>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: C.emerald }}>
          {label}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'rgba(6,78,59,0.50)' }}>
          {sub}
        </p>
      </div>
    </div>
  )
}

/* Analytics Chart */
function AnalyticsChart() {
  const max = Math.max(...BAR_DATA)
  const W = 480, H = 140
  const barW = Math.floor(W / 7)
  const gap = 10
  const todayIdx = 4 // Viernes

  return (
    <div
      className="rounded-2xl p-5 sm:p-6"
      style={{
        backgroundColor: C.champagneLight,
        border: `1px solid rgba(6,78,59,0.10)`,
        boxShadow: '0 1px 3px rgba(6,78,59,0.06), 0 4px 16px -4px rgba(6,78,59,0.10)',
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 mb-4 border-b gap-2" style={{ borderColor: 'rgba(6,78,59,0.08)' }}>
        <div>
          <h3 className="text-base font-bold flex items-center gap-2" style={{ color: C.emeraldDark }}>
            <TrendingUpIcon size={16} style={{ color: C.emerald }} />
            Métricas de Asistencia Semanal
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(6,78,59,0.55)' }}>
            Registro de marcajes por día · Semana en curso
          </p>
        </div>
        <span
          className="self-start sm:self-auto px-2.5 py-1 rounded-lg text-xs font-semibold"
          style={{ backgroundColor: C.champagne, color: C.emerald, border: `1px solid ${C.champagneDark}` }}
        >
          Terminales ISUP 5.0
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="min-w-[400px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" style={{ overflow: 'visible' }}>
            <defs>
              <linearGradient id="barGradEmerald" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.emerald} stopOpacity="0.85" />
                <stop offset="100%" stopColor={C.emeraldDark} stopOpacity="0.50" />
              </linearGradient>
              <linearGradient id="todayGradChampagne" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.champagneDark} stopOpacity="1" />
                <stop offset="100%" stopColor="#C9A96E" stopOpacity="0.70" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75, 1].map((pct, i) => {
              const y = 12 + (H - 12) * (1 - pct)
              return (
                <line
                  key={i} x1={0} y1={y} x2={W} y2={y}
                  stroke="rgba(6,78,59,0.08)"
                  strokeWidth="1" strokeDasharray="4 4"
                />
              )
            })}

            {BAR_DATA.map((count, i) => {
              const usableH = H - 12 - 24
              const barH    = count === 0 ? 3 : Math.max(6, Math.round((count / max) * usableH))
              const x       = i * barW + gap / 2
              const y       = 12 + usableH - barH
              const width   = barW - gap
              const isToday = i === todayIdx

              return (
                <g key={i}>
                  <rect
                    x={x} y={y} width={width} height={barH} rx="5"
                    fill={isToday ? 'url(#todayGradChampagne)' : 'url(#barGradEmerald)'}
                    className="transition-all duration-300 hover:opacity-80"
                  />
                  <text
                    x={x + width / 2} y={y - 4}
                    textAnchor="middle"
                    fill={isToday ? C.champagneDark : C.emerald}
                    fontSize="9" fontWeight="700"
                  >
                    {count}
                  </text>
                  <text
                    x={x + width / 2} y={H - 4}
                    textAnchor="middle"
                    fill={isToday ? C.champagneDark : 'rgba(6,78,59,0.50)'}
                    fontSize="11"
                    fontWeight={isToday ? '700' : '500'}
                  >
                    {DAYS[i]}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs" style={{ color: 'rgba(6,78,59,0.60)' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: C.emerald }} />
          Días anteriores
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: C.champagneDark }} />
          Hoy (Viernes)
        </span>
        <span className="ml-auto font-semibold" style={{ color: C.emerald }}>
          Total: 618 marcajes
        </span>
      </div>
    </div>
  )
}

/* Realtime Table */
function RealtimeTable() {
  const [page, setPage] = useState(1)
  const perPage = 5
  const total   = TABLE_ROWS.length
  const pages   = Math.ceil(total / perPage)
  const rows    = TABLE_ROWS.slice((page - 1) * perPage, page * perPage)

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: C.champagneLight,
        border: `1px solid rgba(6,78,59,0.10)`,
        boxShadow: '0 1px 3px rgba(6,78,59,0.06), 0 4px 16px -4px rgba(6,78,59,0.10)',
      }}
    >
      {/* Header */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-b gap-3"
        style={{ borderColor: 'rgba(6,78,59,0.08)' }}
      >
        <div>
          <h2 className="text-base font-bold flex items-center gap-2" style={{ color: C.emeraldDark }}>
            <ActivityIcon size={16} style={{ color: C.emeraldMuted }} />
            Últimos Marcajes en Tiempo Real
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(6,78,59,0.55)' }}>
            Recepción instantánea · ISUP 5.0
          </p>
        </div>
        <span
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold"
          style={{ backgroundColor: '#2563EB', color: C.emeraldHover, border: `1px solid rgba(6,78,59,0.15)` }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: C.emeraldMuted }} />
          {TABLE_ROWS.length} eventos
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-auto">
          <thead>
            <tr style={{ backgroundColor: 'rgba(248,231,201,0.40)', borderBottom: `1px solid rgba(6,78,59,0.08)` }}>
              {['Empleado','Tipo de Marcaje','Método','Ubicación / Terminal','Hora'].map(h => (
                <th
                  key={h}
                  className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: 'rgba(6,78,59,0.60)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const tipoCfg  = TIPO_BADGE[row.tipo]   ?? { label: row.tipo,   bg: '#F3F4F6', txt: '#374151', dot: '#9CA3AF' }
              const metodoCfg = METODO_CONFIG[row.metodo] ?? { icon: Activity, label: row.metodo, bg: '#F3F4F6', txt: '#374151' }
              const MetIcon  = metodoCfg.icon
              const initials = row.name.split(' ').map(n => n[0]).join('').slice(0, 2)

              return (
                <tr
                  key={row.id}
                  className="transition-colors duration-150"
                  style={{
                    backgroundColor: row.new
                      ? 'rgba(209,250,229,0.35)'
                      : i % 2 === 0 ? 'transparent' : 'rgba(248,231,201,0.20)',
                    borderBottom: `1px solid rgba(6,78,59,0.06)`,
                  }}
                  onMouseEnter={e => { if (!row.new) e.currentTarget.style.backgroundColor = 'rgba(248,231,201,0.35)' }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = row.new ? 'rgba(209,250,229,0.35)' : i % 2 === 0 ? 'transparent' : 'rgba(248,231,201,0.20)' }}
                >
                  {/* Empleado */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm"
                        style={{ backgroundColor: C.emerald, color: C.champagne }}
                      >
                        {initials}
                      </div>
                      <div>
                        <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: C.emeraldDark }}>
                          {row.name}
                          {row.new && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md animate-pulse" style={{ backgroundColor: C.emeraldMuted, color: C.emeraldDark }}>
                              NUEVO
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Tipo */}
                  <td className="px-5 py-3.5">
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                      style={{ backgroundColor: tipoCfg.bg, color: tipoCfg.txt }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tipoCfg.dot }} />
                      {tipoCfg.label}
                    </span>
                  </td>

                  {/* Método */}
                  <td className="px-5 py-3.5">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                        style={{ backgroundColor: metodoCfg.bg, color: metodoCfg.txt }}
                      >
                        {/* Animated icons use size prop; lucide-react fallbacks use className */}
                        {metodoCfg.icon === ScanFaceIcon || metodoCfg.icon === FingerprintIcon || metodoCfg.icon === CreditCardIcon
                          ? <MetIcon size={12} className="flex-shrink-0" />
                          : <MetIcon className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                        }
                        <span>{metodoCfg.label}</span>
                      </span>
                  </td>

                  {/* Ubicación */}
                  <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-sm" style={{ color: 'rgba(6,78,59,0.70)' }}>
                        <MapPinIcon size={14} style={{ color: 'rgba(6,78,59,0.40)', flexShrink: 0 }} />
                        {row.ubicacion}
                      </span>
                  </td>

                  {/* Hora */}
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-mono font-semibold" style={{ color: C.emerald }}>
                      {row.hora}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="flex items-center justify-between px-5 py-3 border-t"
        style={{ borderColor: 'rgba(6,78,59,0.08)' }}
      >
        <p className="text-xs" style={{ color: 'rgba(6,78,59,0.55)' }}>
          Mostrando <span className="font-semibold" style={{ color: C.emerald }}>
            {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)}
          </span> de <span className="font-semibold" style={{ color: C.emerald }}>{total}</span> registros
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center justify-center w-8 h-8 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'rgba(6,78,59,0.15)', color: C.emerald, backgroundColor: C.champagne }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className="flex items-center justify-center w-8 h-8 rounded-lg border text-xs font-semibold transition-all"
              style={
                p === page
                  ? { backgroundColor: C.emerald, color: C.champagne, borderColor: C.emerald }
                  : { backgroundColor: C.champagne, color: C.emerald, borderColor: 'rgba(6,78,59,0.15)' }
              }
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="flex items-center justify-center w-8 h-8 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'rgba(6,78,59,0.15)', color: C.emerald, backgroundColor: C.champagne }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL EXPORTADO
═══════════════════════════════════════════════════════════════ */
export default function DashboardPreview() {
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  )

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: C.champagne, color: C.emerald }}
    >
      {/* Sidebar */}
      <PreviewSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Content */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <PreviewHeader sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(p => !p)} />

        {/* Main */}
        <main className="mx-auto max-w-screen-2xl w-full p-4 md:p-6 2xl:p-8 space-y-6">

          {/* Page title */}
          <div>
            <h1
              className="text-xl font-extrabold tracking-tight"
              style={{ color: C.emeraldDark, fontSize: 'clamp(1.1rem, 2vw, 1.4rem)' }}
            >
              Panel de Control
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(6,78,59,0.55)' }}>
              Resumen de asistencia en tiempo real · {new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
            </p>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-5">
            {KPI_DATA.map(kpi => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>

          {/* Chart */}
          <AnalyticsChart />

          {/* Table */}
          <RealtimeTable />

        </main>
      </div>
    </div>
  )
}





