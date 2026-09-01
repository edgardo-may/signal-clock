// src/features/biometrics/components/AttendanceLogsList.jsx
import {
  Activity,
  Search,
  Download,
  RefreshCw,
  Cpu,
  User,
} from 'lucide-react'

// Status ATTLOG según protocolo ZKTeco (verificado en parser)
const ATTLOG_STATUS = {
  '0': { label: 'Entrada',          style: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  '1': { label: 'Salida',           style: 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600' },
  '2': { label: 'Salida a comer',   style: 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20' },
  '3': { label: 'Regreso de comer', style: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
  '4': { label: 'Entrada extra',    style: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' },
  '5': { label: 'Salida extra',     style: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/20' },
}

function getAttlogStatus(status) {
  return ATTLOG_STATUS[String(status)] || { label: `Estado: ${status ?? '—'}`, style: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700' }
}

function formatTimestamp(ts) {
  if (!ts) return { date: '—', time: '' }
  const d = new Date(ts)
  return {
    date: d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

const inputClass = 'py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 outline-none focus:border-[#03363D] transition-all'

export default function AttendanceLogsList({
  logs,
  loading,
  search,
  onSearchChange,
  deviceFilter,
  onDeviceFilterChange,
  userFilter,
  onUserFilterChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  devicesCatalog,
  employeesCatalog,
  onRefresh,
}) {
  const exportToCsv = () => {
    if (!logs.length) return
    const headers = ['ID', 'Device Serial', 'Dispositivo', 'User ID', 'Empleado', 'Timestamp', 'Status']
    const rows = logs.map((l) => [
      l.id,
      l.device_serial,
      l.dispositivo?.nombre || '',
      l.user_id,
      l.empleado?.nombreCompleto || '',
      l.timestamp,
      l.status || 'OK',
    ])
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n')
    const link = document.createElement('a')
    link.setAttribute('href', encodeURI(csvContent))
    link.setAttribute('download', `attendance_logs_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Search row */}
        <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-100 dark:border-slate-800">
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
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
            <button
              onClick={exportToCsv}
              disabled={!logs.length}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-[#03363D] hover:bg-[#03363D]/90 transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="px-4 py-3 flex flex-wrap gap-3 bg-slate-50/50 dark:bg-slate-800/20">
          <select value={deviceFilter} onChange={(e) => onDeviceFilterChange(e.target.value)} className={inputClass}>
            <option value="todos">Todos los dispositivos</option>
            {devicesCatalog.map((d) => (
              <option key={d.serial_number} value={d.serial_number}>
                {d.name || d.serial_number}
              </option>
            ))}
          </select>

          <select value={userFilter} onChange={(e) => onUserFilterChange(e.target.value)} className={inputClass}>
            <option value="todos">Todos los colaboradores</option>
            {employeesCatalog.map((emp) => (
              <option key={emp.id} value={emp.hikvision_device_userid || emp.clave_empleado || emp.id}>
                {emp.nombre} {emp.apellido}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Desde</span>
            <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} className={inputClass} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Hasta</span>
            <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* ── Tabla ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {/* Desktop table */}
        <div className="overflow-x-auto hidden sm:block">
          <table className="w-full text-left">
            <thead className="border-b border-slate-100 dark:border-slate-800">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <th className="px-5 py-3.5">Colaborador</th>
                <th className="px-5 py-3.5">Fecha y hora</th>
                <th className="px-5 py-3.5">Estado</th>
                <th className="px-5 py-3.5">Dispositivo</th>
                <th className="px-5 py-3.5 text-right">Registrado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                    <span className="text-sm text-slate-400">Consultando registros...</span>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <Activity className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Todavía no se han recibido checadas</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Los registros aparecerán aquí cuando los dispositivos envíen datos</p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const { date, time } = formatTimestamp(log.timestamp)
                  const status = getAttlogStatus(log.status)

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                      {/* Colaborador */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight">
                          {log.empleado?.nombreCompleto || <span className="text-slate-400 font-normal">Sin vincular</span>}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                          ID: {log.user_id}
                          {log.empleado?.clave && ` · ${log.empleado.clave}`}
                        </p>
                      </td>

                      {/* Fecha y hora */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-slate-800 dark:text-slate-200">{date}</p>
                        <p className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 mt-0.5">{time}</p>
                      </td>

                      {/* Estado */}
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium border ${status.style}`}
                          title="Estado reportado por la terminal"
                        >
                          {status.label}
                        </span>
                      </td>

                      {/* Dispositivo */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {log.dispositivo?.nombre || log.device_serial}
                        </p>
                        {log.dispositivo?.nombre && (
                          <p className="text-[11px] font-mono text-slate-400 mt-0.5">{log.device_serial}</p>
                        )}
                      </td>

                      {/* Registrado en BD */}
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-xs text-slate-400 tabular-nums">
                          {log.created_at ? new Date(log.created_at).toLocaleString('es-MX', {
                            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                          }) : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto text-slate-300 mb-3" />
              <span className="text-sm text-slate-400">Consultando registros...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center px-6">
              <Activity className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-500">Todavía no se han recibido checadas</p>
            </div>
          ) : (
            logs.map((log) => {
              const { date, time } = formatTimestamp(log.timestamp)
              const status = getAttlogStatus(log.status)
              return (
                <div key={log.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {log.empleado?.nombreCompleto || <span className="text-slate-400 font-normal text-xs">Sin vincular</span>}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">ID: {log.user_id}</p>
                    </div>
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium border flex-shrink-0 ${status.style}`}
                      title="Estado reportado por la terminal"
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>{date} · <span className="font-mono font-semibold">{time}</span></span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="truncate">{log.dispositivo?.nombre || log.device_serial}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
