// src/features/dashboard/pages/DashboardPage.jsx — Signum-Clock Dashboard con Paleta Oficial
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'

ChartJS.register(ArcElement, Tooltip, Legend)
import { Hash, Shuffle, ChevronLeft, ChevronRight } from 'lucide-react'
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

// ─── Configuración de Badges Semánticos ─────────────────────────
const TIPO_BADGE = {
  entrada:         { label: 'Entrada',    cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',  dot: 'bg-emerald-500' },
  salida:          { label: 'Salida',     cls: 'bg-rose-500/10    text-rose-600    dark:text-rose-400    border-rose-500/20',     dot: 'bg-rose-500'    },
  descanso_inicio: { label: 'Descanso ↓', cls: 'bg-amber-500/10   text-amber-600   dark:text-amber-400   border-amber-500/20',    dot: 'bg-amber-500'   },
  descanso_fin:    { label: 'Descanso ↑', cls: 'bg-sky-500/10     text-sky-600     dark:text-sky-400     border-sky-500/20',      dot: 'bg-sky-500'     },
  extra:           { label: 'Extra',      cls: 'bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20',   dot: 'bg-violet-500'  },
}

const METODO_CONFIG = {
  rostro:    { icon: ScanFaceIcon,    label: 'Rostro',    cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  huella:    { icon: FingerprintIcon, label: 'Huella',    cls: 'bg-blue-500/10    text-blue-600    dark:text-blue-400    border-blue-500/20'    },
  tarjeta:   { icon: CreditCardIcon,  label: 'Tarjeta',   cls: 'bg-amber-500/10   text-amber-600   dark:text-amber-400   border-amber-500/20'   },
  pin:       { icon: Hash,            label: 'PIN',        cls: 'bg-slate-100      text-slate-700   dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700' },
  combinado: { icon: Shuffle,         label: 'Combinado', cls: 'bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20'  },
}

// ─── Formateador de Hora ───────────────────────────────────────
function formatTime(ts) {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit',  month: 'short',
  }).format(new Date(ts))
}

// ─── Custom Toast de Marcaje en Vivo ───────────────────────────
function fireMarkingToast(data) {
  const nombre   = data.empleados ? `${data.empleados.nombre} ${data.empleados.apellido}` : 'Empleado'
  const metodo   = data.metodo ?? 'desconocido'
  const tipo     = data.tipo_verificacion ?? 'entrada'
  const metCfg   = METODO_CONFIG[metodo]
  const MetIcon  = metCfg?.icon ?? ActivityIcon
  const tipoCfg  = TIPO_BADGE[tipo]

  toast.custom(
    (t) => (
      <div
        className={`flex items-start gap-3 px-4 py-3.5 rounded-xl pointer-events-auto bg-[#0f172a] text-white border border-slate-700 shadow-2xl transition-all duration-300 ${
          t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
        style={{ minWidth: '300px', maxWidth: '380px' }}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-600/20 border border-blue-500/30 text-blue-400">
          <MetIcon className="w-5 h-5" strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
            ¡Marcaje Biométrico!
          </p>
          <p className="text-sm font-semibold text-white truncate">{nombre}</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${tipoCfg?.cls ?? 'bg-slate-700 text-slate-300'}`}
            >
              <span className={`w-1 h-1 rounded-full ${tipoCfg?.dot ?? 'bg-slate-400'}`} />
              {tipoCfg?.label ?? tipo}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${metCfg?.cls ?? 'bg-slate-700 text-slate-300'}`}
            >
              {metCfg?.label ?? metodo}
            </span>
          </div>
        </div>

        <button
          onClick={() => toast.dismiss(t.id)}
          className="text-slate-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    ),
    { duration: 5000, position: 'top-right' }
  )
}

// ─── Stat Card ────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, trend, up, iconBg, iconColor }) {
  return (
    <div className="rounded-xl p-4 sm:p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon size={22} className={iconColor} />
        </div>

        {trend && (
          <span
            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${
              up === false
                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {up === false ? <ArrowDownIcon size={12} /> : <ArrowUpIcon size={12} />}
            {trend}
          </span>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white">
          {value ?? '—'}
        </h4>
        <span className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 mt-1 block">
          {label}
        </span>
      </div>

      {sub && (
        <p className="mt-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
          {sub}
        </p>
      )}
    </div>
  )
}

// ─── SVG Analytics Chart ──────────────────────────────────────
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function AnalyticsChart({ marcajes }) {
  const today = new Date()
  const dayOfWeek = today.getDay()

  const weekData = useMemo(() => {
    const counts = new Array(7).fill(0)
    const weekStart = new Date(today)
    const mondayOffset = (today.getDay() + 6) % 7
    weekStart.setDate(today.getDate() - mondayOffset)
    weekStart.setHours(0, 0, 0, 0)

    marcajes.forEach(m => {
      const d = new Date(m.verificado_at)
      const diff = Math.floor((d - weekStart) / 86400000)
      if (diff >= 0 && diff < 7) counts[diff]++
    })
    return counts
  }, [marcajes])

  const total    = weekData.reduce((a, b) => a + b, 0)
  const max      = Math.max(...weekData, 1)
  const W = 500, H = 140
  const padL = 0, padR = 0, padT = 12, padB = 0
  const chartW   = W - padL - padR
  const barW     = Math.floor(chartW / 7)
  const gap      = 10
  const todayIdx = (dayOfWeek + 6) % 7

  return (
    <div className="rounded-xl p-4 sm:p-6 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 mb-4 border-b border-slate-100 dark:border-slate-800 gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TrendingUpIcon size={16} className="text-blue-600 dark:text-blue-400" />
            Métricas de Asistencia Semanal
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Registro de marcajes por día en la semana en curso
          </p>
        </div>
        <span className="self-start sm:self-auto px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
          Terminales Hikvision ISUP 5.0
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="min-w-[400px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-36"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="barGradBlue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0.55" />
              </linearGradient>
              <linearGradient id="todayGradBlue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity="1" />
                <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.80" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1].map((pct, i) => {
              const y = padT + (H - padT - padB) * (1 - pct)
              return (
                <line
                  key={i}
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-200 dark:text-slate-800"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              )
            })}

            {/* Bars */}
            {weekData.map((count, i) => {
              const usableH = H - padT - padB - 24
              const barH    = count === 0 ? 3 : Math.max(6, Math.round((count / max) * usableH))
              const x       = padL + i * barW + gap / 2
              const y       = padT + usableH - barH
              const width   = barW - gap
              const isToday = i === todayIdx

              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={barH}
                    rx="5"
                    fill={isToday ? 'url(#todayGradBlue)' : 'url(#barGradBlue)'}
                    className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                  />
                  {count > 0 && (
                    <text
                      x={x + width / 2}
                      y={y - 4}
                      textAnchor="middle"
                      fill={isToday ? '#2563EB' : '#64748B'}
                      fontSize="9"
                      fontWeight="700"
                    >
                      {count}
                    </text>
                  )}
                  <text
                    x={x + width / 2}
                    y={H - 4}
                    textAnchor="middle"
                    fill={isToday ? '#2563EB' : '#94A3B8'}
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

      {/* Leyenda inferior */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-blue-600 opacity-70" />
          Días anteriores
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-blue-500 shadow-sm" />
          Hoy
        </span>
        <span className="ml-auto font-bold text-slate-800 dark:text-slate-200">
          Total: {total} marcajes
        </span>
      </div>
    </div>
  )
}

function MethodBadge({ metodo }) {
  const cfg = METODO_CONFIG[metodo] ?? {
    icon:  ActivityIcon,
    label: metodo ?? '—',
    cls:   'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  }
  const Icon = cfg.icon
  const isAnimated = cfg.icon === ScanFaceIcon || cfg.icon === FingerprintIcon || cfg.icon === CreditCardIcon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border ${cfg.cls}`}>
      {isAnimated
        ? <Icon size={12} className="flex-shrink-0" />
        : <Icon className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
      }
      <span>{cfg.label}</span>
    </span>
  )
}

// ─── Realtime Table con Paginación ────────────────────────────
const PER_PAGE = 5

function RealtimeTable({ marcajes, newFlash, loadingInit }) {
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [marcajes.length])

  const total = marcajes.length
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const rows  = marcajes.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-4 md:px-6 md:py-5 border-b border-slate-100 dark:border-slate-800 gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ActivityIcon size={16} className="text-emerald-500" />
            Últimos Marcajes en Tiempo Real
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Recepción instantánea de eventos ISUP 5.0 con notificación visual
          </p>
        </div>

        <span className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
          {total} eventos
        </span>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        {loadingInit ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-slate-500">
            <svg className="animate-spin w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Cargando marcajes...
          </div>
        ) : marcajes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <ActivityIcon size={40} className="opacity-30" />
            <p className="text-sm font-medium">Esperando marcajes en tiempo real...</p>
          </div>
        ) : (
          <table className="w-full table-auto">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                {['Empleado', 'Tipo de Marcaje', 'Método Biométrico', 'Ubicación / Terminal', 'Fecha y Hora'].map(h => (
                  <th
                    key={h}
                    className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((m) => {
                const badge   = TIPO_BADGE[m.tipo_verificacion] ?? { label: m.tipo_verificacion, cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' }
                const isNew   = m.id === newFlash
                const nombre  = m.empleados ? `${m.empleados.nombre} ${m.empleados.apellido}` : 'Desconocido'
                const avatar  = m.empleados?.avatar_url
                const initials = m.empleados ? `${m.empleados.nombre[0]}${m.empleados.apellido[0]}` : '?'

                return (
                  <tr
                    key={m.id}
                    className={`transition-colors duration-200 ${
                      isNew ? 'bg-blue-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    {/* Empleado */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={nombre}
                            className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shadow-sm bg-blue-600 text-white">
                            {initials}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            {nombre}
                            {isNew && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white animate-pulse">
                                NUEVO
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border ${badge.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </td>

                    {/* Método */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <MethodBadge metodo={m.metodo} />
                    </td>

                    {/* Ubicación */}
                    <td className="px-4 py-3.5 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {m.dispositivos?.nombre_ubicacion ? (
                        <span className="flex items-center gap-1.5">
                          <MapPinIcon size={16} className="text-blue-500 flex-shrink-0" />
                          {m.dispositivos.nombre_ubicacion}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="px-4 py-3.5 text-xs font-mono font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatTime(m.verificado_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginación */}
      {!loadingInit && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mostrando{' '}
            <span className="font-semibold text-slate-900 dark:text-white">
              {total === 0 ? 0 : (page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)}
            </span>
            {' '}de{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{total}</span>
            {' '}registros
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                  p === page
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {p}
              </button>
            ))}

            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Doughnut Charts ──────────────────────────────────────────
function DashboardDoughnuts({ stats }) {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '75%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '#64748B', usePointStyle: true, padding: 20, font: { family: 'Inter', size: 12 } } },
      tooltip: {
        backgroundColor: '#0F172A',
        titleFont: { family: 'Inter', size: 13 },
        bodyFont: { family: 'Inter', size: 13 },
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
      }
    }
  }

  const empleadosData = {
    labels: ['Activos', 'Inactivos'],
    datasets: [{
      data: [stats.empleados, stats.inactivos],
      backgroundColor: ['#3B82F6', '#94A3B8'],
      borderWidth: 0,
      hoverOffset: 4
    }]
  }

  const asistenciasData = {
    labels: ['Presentes', 'Ausentes (Est.)'],
    datasets: [{
      data: [stats.hoy, Math.max(0, stats.empleados - stats.hoy)],
      backgroundColor: ['#10B981', '#F43F5E'],
      borderWidth: 0,
      hoverOffset: 4
    }]
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mt-6">
      {/* Chart 1: Empleados */}
      <div className="rounded-xl p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white w-full text-center mb-4">
          Estado de Colaboradores
        </h3>
        <div className="relative w-full h-48">
          <Doughnut data={empleadosData} options={chartOptions} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-6">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.empleados + stats.inactivos}</span>
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total</span>
          </div>
        </div>
      </div>

      {/* Chart 2: Asistencias */}
      <div className="rounded-xl p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white w-full text-center mb-4">
          Asistencias del Día
        </h3>
        <div className="relative w-full h-48">
          <Doughnut data={asistenciasData} options={chartOptions} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-6">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.hoy}</span>
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Hoy</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: DASHBOARD
// ═══════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))

  const [stats, setStats]             = useState({ empleados: 0, inactivos: 0, dispositivos: 0, hoy: 0, incidencias: 0 })
  const [marcajes, setMarcajes]       = useState([])
  const [loadingInit, setLoadingInit] = useState(true)
  const [newFlash, setNewFlash]       = useState(null)

  // ── Cargar datos iniciales ────────────────────────────────────
  const loadData = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      { count: cEmpleadosActivos },
      { count: cEmpleadosInactivos },
      { count: cDispositivos },
      { count: cHoy },
      { count: cIncidencias },
      { data: recentData },
    ] = await Promise.all([
      supabase.from('empleados').select('*', { count: 'exact', head: true }).eq('activo', true),
      supabase.from('empleados').select('*', { count: 'exact', head: true }).eq('activo', false),
      supabase.from('dispositivos').select('*', { count: 'exact', head: true }).eq('estatus', 'activo'),
      supabase.from('registro_asistencia').select('*', { count: 'exact', head: true }).gte('verificado_at', today.toISOString()),
      supabase
        .from('registro_asistencia')
        .select('*', { count: 'exact', head: true })
        .gte('verificado_at', today.toISOString())
        .in('tipo_verificacion', ['extra', 'descanso_inicio', 'descanso_fin']),
      supabase
        .from('registro_asistencia')
        .select(`id, verificado_at, tipo_verificacion, metodo,
                 empleados(nombre, apellido, avatar_url),
                 dispositivos(nombre_ubicacion)`)
        .order('verificado_at', { ascending: false })
        .limit(50),
    ])

    setStats({
      empleados:    cEmpleadosActivos    ?? 0,
      inactivos:    cEmpleadosInactivos  ?? 0,
      dispositivos: cDispositivos        ?? 0,
      hoy:          cHoy                 ?? 0,
      incidencias:  cIncidencias         ?? 0,
    })
    setMarcajes(recentData ?? [])
    setLoadingInit(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Supabase Realtime ─────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('registro_asistencia-realtime-dashboard')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'registro_asistencia' },
        async (payload) => {
          const { data } = await supabase
            .from('registro_asistencia')
            .select(`id, verificado_at, tipo_verificacion, metodo,
                     empleados(nombre, apellido, avatar_url),
                     dispositivos(nombre_ubicacion)`)
            .eq('id', payload.new.id)
            .single()

          if (data) {
            setMarcajes(prev => [data, ...prev].slice(0, 50))
            setStats(prev => ({
              ...prev,
              hoy: prev.hoy + 1,
              incidencias: ['extra', 'descanso_inicio', 'descanso_fin'].includes(data.tipo_verificacion)
                ? prev.incidencias + 1
                : prev.incidencias,
            }))
            setNewFlash(data.id)
            setTimeout(() => setNewFlash(null), 2500)
            fireMarkingToast(data)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const fechaHoy = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc] dark:bg-[#0f172a] text-slate-800 dark:text-slate-100">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      {/* Sidebar */}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Content Area */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        {/* Main Content */}
        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

          {/* Page Title */}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Panel de Control
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
              Resumen de asistencia en tiempo real · {fechaHoy}
            </p>
          </div>

          {/* Stat Cards Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-4">
            {/* Empleados Activos */}
            <StatCard
              label="Empleados Activos"
              value={stats.empleados}
              sub="Habilitados en terminales Hikvision"
              icon={UsersIcon}
              trend="100%"
              up={true}
              iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
              iconColor="text-blue-600 dark:text-blue-400"
            />
            {/* Biométricos Conectados */}
            <StatCard
              label="Biométricos Conectados"
              value={stats.dispositivos}
              sub="Dispositivos ISUP 5.0 sincronizados"
              icon={CpuIcon}
              trend="Online"
              up={true}
              iconBg="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              iconColor="text-emerald-600 dark:text-emerald-400"
            />
            {/* Marcajes del Día */}
            <StatCard
              label="Marcajes del Día"
              value={stats.hoy}
              sub="Eventos procesados hoy en tiempo real"
              icon={ClockAnimIcon}
              trend="Hoy"
              up={true}
              iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
              iconColor="text-blue-600 dark:text-blue-400"
            />
            {/* Incidencias */}
            <StatCard
              label="Incidencias"
              value={stats.incidencias}
              sub="Eventos especiales registrados hoy"
              icon={ActivityIcon}
              trend={stats.incidencias > 0 ? `+${stats.incidencias}` : '0'}
              up={false}
              iconBg="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
              iconColor="text-rose-600 dark:text-rose-400"
            />
          </div>

          {/* Gráficos Doughnut */}
          <DashboardDoughnuts stats={stats} />

          {/* Analytics Chart */}
          <AnalyticsChart marcajes={marcajes} />

          {/* Realtime Table */}
          <RealtimeTable
            marcajes={marcajes}
            newFlash={newFlash}
            loadingInit={loadingInit}
          />

        </main>
      </div>
    </div>
  )
}
