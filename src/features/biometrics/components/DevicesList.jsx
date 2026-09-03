// src/features/biometrics/components/DevicesList.jsx
import {
  Cpu,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Edit3,
  Trash2,
  Eye,
  Send,
  MapPin,
  Clock,
  HardDrive,
  Globe,
  Network,
  ArrowRightLeft,
  LogIn,
  LogOut,
  Utensils,
  UserCheck,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react'

const TYPE_CONFIG = {
  general:  { label: 'Entradas y Salidas', icon: ArrowRightLeft, badge: 'bg-[#BDD9D7]/30 text-[#03363D] dark:text-teal-300 border-[#BDD9D7]/50' },
  entrada:  { label: 'Solo Entradas',      icon: LogIn,          badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  salida:   { label: 'Solo Salidas',       icon: LogOut,         badge: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20' },
  comedor:  { label: 'Comedor',            icon: Utensils,       badge: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20' },
  rh:       { label: 'RH / Enrolamiento', icon: UserCheck,      badge: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20' },
  acceso:   { label: 'Control de Acceso', icon: ShieldCheck,    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
}

const STATUS_CONFIG = {
  online:     { label: 'Online',           dot: 'bg-emerald-500 animate-pulse', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  offline:    { label: 'Offline',          dot: 'bg-rose-500',                  badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  pending:    { label: 'Nunca conectado',  dot: 'bg-amber-400',                 badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  disabled:   { label: 'Deshabilitado',   dot: 'bg-slate-400',                 badge: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700' },
}

function getDeviceStatus(d) {
  if (!d.is_active) return 'disabled'
  if (!d.last_activity) return 'pending'
  if (new Date() - new Date(d.last_activity) < 5 * 60 * 1000) return 'online'
  return 'offline'
}

function formatActivity(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-MX', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
  })
}

export default function DevicesList({
  devices,
  loading,
  search,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
  filterType = 'todos',
  onFilterTypeChange,
  onOpenNewDevice,
  onOpenEditDevice,
  onOpenDeviceDetail,
  onOpenSendCommand,
  onDeleteDevice,
  onRefresh,
  onSyncEmployees,
  onSyncTime,
}) {
  return (
    <div className="space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nombre o SN..."
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onFilterTypeChange && (
            <select
              value={filterType}
              onChange={(e) => onFilterTypeChange(e.target.value)}
              className="py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 outline-none focus:border-[#03363D] cursor-pointer"
            >
              <option value="todos">Todos los tipos</option>
              <option value="general">Entradas y Salidas</option>
              <option value="entrada">Solo Entradas</option>
              <option value="salida">Solo Salidas</option>
              <option value="comedor">Comedor</option>
              <option value="rh">RH / Enrolamiento</option>
              <option value="acceso">Control de Acceso</option>
            </select>
          )}

          <select
            value={filterStatus}
            onChange={(e) => onFilterStatusChange(e.target.value)}
            className="py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 outline-none focus:border-[#03363D] cursor-pointer"
          >
            <option value="todos">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* ── Tabla Desktop/Tablet ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hidden md:block">
        <table className="w-full text-left">
          <thead className="border-b border-slate-100 dark:border-slate-800">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <th className="px-5 py-3.5">Terminal</th>
              <th className="px-5 py-3.5">Tipo</th>
              <th className="px-5 py-3.5">Colaboradores</th>
              <th className="px-5 py-3.5">Ubicación</th>
              <th className="px-5 py-3.5">Última actividad</th>
              <th className="px-5 py-3.5">Estado</th>
              <th className="px-5 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                  <span className="text-sm text-slate-400">Cargando terminales...</span>
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center">
                  <HardDrive className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Aún no tienes dispositivos registrados</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Agrega tu primer biométrico para comenzar</p>
                </td>
              </tr>
            ) : (
              devices.map((d) => {
                const statusKey = getDeviceStatus(d)
                const status = STATUS_CONFIG[statusKey]
                const typeInfo = TYPE_CONFIG[d.device_type] || TYPE_CONFIG.general
                const TypeIcon = typeInfo.icon

                return (
                  <tr key={d.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors group">
                    {/* Terminal */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${status.badge} border`}>
                          <Cpu className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                            {d.name || 'Terminal sin nombre'}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                            {d.serial_number}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border ${typeInfo.badge}`}>
                        <TypeIcon className="w-3 h-3" />
                        {typeInfo.label}
                      </span>
                    </td>

                    {/* Colaboradores / Sincronización */}
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          <UserCheck className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          <span>{d.syncStats?.total || 0} asignados</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-medium flex-wrap">
                          <span className="text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold" title="Sincronizados">
                            ✓ {d.syncStats?.synced || 0} sync
                          </span>
                          {(d.syncStats?.pending > 0) && (
                            <span className="text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold" title="Pendientes">
                              ⏳ {d.syncStats.pending} pend
                            </span>
                          )}
                          {(d.syncStats?.error > 0) && (
                            <span className="text-rose-700 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded font-bold" title="Errores">
                              ⚠ {d.syncStats.error} err
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Ubicación */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                        <MapPin className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 flex-shrink-0" />
                        <span className="truncate max-w-[140px]">{d.location || '—'}</span>
                      </div>
                      {d.timezone && (
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-400">
                          <Globe className="w-3 h-3" />
                          {d.timezone.replace('America/', '')}
                        </div>
                      )}
                    </td>

                    {/* Última actividad */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <Clock className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
                        {formatActivity(d.last_activity)}
                      </div>
                    </td>

                    {/* Estado */}
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${status.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot} flex-shrink-0`} />
                        {status.label}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onSyncEmployees && onSyncEmployees(d)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          title="Sincronizar colaboradores a esta terminal"
                        >
                          <UserCheck className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onSyncTime && onSyncTime(d)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                          title="Sincronizar fecha y hora física del checador"
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onOpenSendCommand({ device_serial: d.serial_number })}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Enviar comando"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onOpenDeviceDetail(d)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Ver detalle"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onOpenEditDevice(d)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Editar"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteDevice(d)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Cards Mobile ─────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto text-slate-300 mb-3" />
            <span className="text-sm text-slate-400">Cargando terminales...</span>
          </div>
        ) : devices.length === 0 ? (
          <div className="py-12 text-center">
            <HardDrive className="w-8 h-8 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-600">Aún no tienes dispositivos registrados</p>
            <p className="text-xs text-slate-400 mt-1">Agrega tu primer biométrico para comenzar</p>
          </div>
        ) : (
          devices.map((d) => {
            const statusKey = getDeviceStatus(d)
            const status = STATUS_CONFIG[statusKey]
            const typeInfo = TYPE_CONFIG[d.device_type] || TYPE_CONFIG.general
            const TypeIcon = typeInfo.icon

            return (
              <div key={d.id} className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Header card */}
                <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${status.badge} border`}>
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {d.name || 'Terminal sin nombre'}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">{d.serial_number}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border flex-shrink-0 ${status.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                </div>

                {/* Meta row */}
                <div className="px-4 pb-3 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${typeInfo.badge}`}>
                    <TypeIcon className="w-3 h-3" />
                    {typeInfo.label}
                  </span>
                  {d.location && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 text-slate-300 flex-shrink-0" />
                      {d.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1 ml-auto flex-shrink-0">
                    <Clock className="w-3 h-3 text-slate-300" />
                    {formatActivity(d.last_activity)}
                  </span>
                </div>

                {/* Colaboradores Mobile */}
                <div className="px-4 pb-3 flex items-center justify-between gap-2 text-xs border-t border-slate-50 dark:border-slate-800/60 pt-2.5">
                  <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                    <UserCheck className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span>{d.syncStats?.total || 0} asignados</span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {d.syncStats?.synced || 0} sync
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onSyncEmployees && onSyncEmployees(d)}
                      className="px-2 py-1 rounded-md text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Sync
                    </button>
                    <button
                      onClick={() => onSyncTime && onSyncTime(d)}
                      className="px-2 py-1 rounded-md text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-1"
                      title="Sincronizar hora"
                    >
                      <Clock className="w-3 h-3" />
                      Hora
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 flex items-center justify-end gap-1">
                  <button
                    onClick={() => onOpenSendCommand({ device_serial: d.serial_number })}
                    className="p-2 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Enviar comando"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onOpenDeviceDetail(d)}
                    className="p-2 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Ver detalle"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onOpenEditDevice(d)}
                    className="p-2 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Editar"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDeleteDevice(d)}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
