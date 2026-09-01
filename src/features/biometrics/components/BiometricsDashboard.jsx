// src/features/biometrics/components/BiometricsDashboard.jsx
import {
  Cpu,
  CheckCircle2,
  Activity,
  Terminal,
  Clock,
  ArrowRight,
  RefreshCw,
  Plus,
  Send,
  Zap,
  Users,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react'

// Shared status label — same source of truth used in AttendanceLogsList
const ATTLOG_STATUS = {
  '0': 'Entrada',
  '1': 'Salida',
  '2': 'Salida a comer',
  '3': 'Regreso de comer',
  '4': 'Entrada extra',
  '5': 'Salida extra',
}

function getStatusLabel(status) {
  return ATTLOG_STATUS[String(status)] ?? (status ? `Estado: ${status}` : 'OK')
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-MX', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
  })
}

// Device connectivity status
function getDeviceStatus(d) {
  if (!d.is_active) return { label: 'Deshabilitado', dot: 'bg-slate-400' }
  if (!d.last_activity) return { label: 'Nunca conectado', dot: 'bg-amber-400' }
  if (new Date() - new Date(d.last_activity) < 5 * 60 * 1000) return { label: 'Online', dot: 'bg-emerald-500 animate-pulse' }
  return { label: 'Offline', dot: 'bg-rose-500' }
}

export default function BiometricsDashboard({
  stats,
  loading,
  onNavigateTab,
  onOpenNewDevice,
  onOpenSendCommand,
  onRefresh,
}) {
  const {
    totalDevices      = 0,
    onlineDevices     = 0,
    offlineDevices    = 0,
    totalLogsToday    = 0,
    pendingCommands   = 0,
    executedCommands  = 0,
    latestActivity    = null,
    devices           = [],
    recentLogs        = [],
    syncedAssignments = 0,
    pendingAssignments = 0,
    errorAssignments  = 0,
    recentSyncs       = [],
    recentErrors      = [],
  } = stats

  return (
    <div className="space-y-6">

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Terminales */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Terminales</span>
            <div className="w-7 h-7 rounded-lg bg-[#BDD9D7]/30 flex items-center justify-center">
              <Cpu className="w-3.5 h-3.5 text-[#03363D] dark:text-teal-400" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">{totalDevices}</p>
          <div className="flex items-center gap-3 mt-2 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {onlineDevices} online
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="flex items-center gap-1 text-rose-500 dark:text-rose-400">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              {offlineDevices} offline
            </span>
          </div>
        </div>

        {/* Personal sincronizado */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Personal</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">{syncedAssignments}</p>
          <div className="flex items-center gap-2 mt-2 text-xs">
            {pendingAssignments > 0 && (
              <span className="text-amber-600 dark:text-amber-400">{pendingAssignments} pendientes</span>
            )}
            {errorAssignments > 0 ? (
              <span className="flex items-center gap-1 text-rose-500 dark:text-rose-400">
                <AlertTriangle className="w-3 h-3" />
                {errorAssignments} con error
              </span>
            ) : (
              <span className="text-slate-400">Todo al día</span>
            )}
          </div>
        </div>

        {/* Último heartbeat */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Heartbeat</span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-tight">
            {latestActivity ? formatTime(latestActivity) : <span className="text-slate-400 font-normal">Sin actividad</span>}
          </p>
          <p className="text-xs text-slate-400 mt-2">Última señal de terminales</p>
        </div>
      </div>

      {/* ── Estado y acciones rápidas ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <Zap className="w-3.5 h-3.5 text-[#03363D] dark:text-teal-400" />
          <span className="font-medium">ADMS activo</span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span>Monitoreo en tiempo real</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* ── Terminales + Últimas checadas ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Terminales */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Terminales</h4>
            </div>
            <button
              onClick={() => onNavigateTab('devices')}
              className="text-xs text-[#03363D] dark:text-teal-400 hover:underline flex items-center gap-1"
            >
              Ver todas
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-50 dark:divide-slate-800/50 max-h-72 overflow-y-auto">
            {devices.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-slate-400">No hay dispositivos registrados</p>
              </div>
            ) : (
              devices.slice(0, 5).map((d) => {
                const s = getDeviceStatus(d)
                return (
                  <div key={d.id} className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{d.name || d.serial_number}</p>
                        <p className="text-[11px] font-mono text-slate-400 truncate">{d.serial_number} · {d.location || 'Sin ubicación'}</p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">{s.label}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Últimas checadas */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Últimas checadas</h4>
            </div>
            <button
              onClick={() => onNavigateTab('logs')}
              className="text-xs text-[#03363D] dark:text-teal-400 hover:underline flex items-center gap-1"
            >
              Ver todas
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-50 dark:divide-slate-800/50 max-h-72 overflow-y-auto">
            {recentLogs.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-slate-400">No hay checadas recientes</p>
              </div>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {log.empleado?.nombreCompleto || <span className="text-slate-400 font-normal text-xs">ID: {log.user_id}</span>}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{formatTime(log.timestamp)} · {log.device_serial}</p>
                  </div>
                  <span
                    className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex-shrink-0"
                    title="Estado reportado por la terminal"
                  >
                    {getStatusLabel(log.status)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Sincronizaciones recientes y errores ─────────────────────── */}
      {(recentSyncs.length > 0 || recentErrors.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Sincronizaciones OK */}
          {recentSyncs.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Sincronizaciones recientes</h4>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-slate-800/50 max-h-56 overflow-y-auto">
                {recentSyncs.map((sync, idx) => (
                  <div key={idx} className="px-5 py-3 flex items-center justify-between text-xs hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <div>
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">PIN {sync.biometric_user_id}</span>
                      <p className="text-[10px] text-slate-400 mt-0.5">{formatTime(sync.actualizado_at)}</p>
                    </div>
                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Sincronizado</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errores */}
          {recentErrors.length > 0 && (
            <div className="rounded-xl border border-rose-100 dark:border-rose-500/20 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-rose-100 dark:border-rose-500/20 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Errores de sincronización</h4>
              </div>
              <div className="divide-y divide-rose-50 dark:divide-rose-500/10 max-h-56 overflow-y-auto">
                {recentErrors.map((sync, idx) => (
                  <div key={idx} className="px-5 py-3 hover:bg-rose-50/50 dark:hover:bg-rose-500/5 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">PIN {sync.biometric_user_id}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums">{sync.retry_count || 0} intento{sync.retry_count !== 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5 truncate">{sync.last_error || 'Error desconocido'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
