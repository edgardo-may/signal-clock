// src/features/biometrics/components/DeviceCommandsList.jsx
import {
  Terminal,
  Search,
  Filter,
  Plus,
  Send,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Clock,
  Cpu,
} from 'lucide-react'

export default function DeviceCommandsList({
  commands,
  loading,
  deviceFilter,
  onDeviceFilterChange,
  statusFilter,
  onStatusFilterChange,
  devicesCatalog,
  onOpenSendCommand,
  onToggleCommand,
  onDeleteCommand,
  onRefresh,
}) {
  const formatTime = (ts) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar: Filtros y Botón Emitir ──────────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Filtro Dispositivo */}
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={deviceFilter}
              onChange={(e) => onDeviceFilterChange(e.target.value)}
              className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="todos">Todos los Dispositivos</option>
              {devicesCatalog.map((d) => (
                <option key={d.serial_number} value={d.serial_number}>
                  {d.name || d.serial_number} ({d.serial_number})
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Estado */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="todos">Todos los Estados</option>
              <option value="pending">Pendientes de Ejecución</option>
              <option value="executed">Ejecutados</option>
            </select>
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refrescar</span>
          </button>
        </div>

        <button
          onClick={() => onOpenSendCommand({})}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all cursor-pointer whitespace-nowrap"
        >
          <Send className="w-4 h-4" />
          <span>Emitir Nuevo Comando</span>
        </button>
      </div>

      {/* ── Tabla de Comandos ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Dispositivo Destino</th>
                <th className="px-5 py-3.5">Instrucción / Comando</th>
                <th className="px-5 py-3.5">Fecha de Emisión</th>
                <th className="px-5 py-3.5">Estado de Ejecución</th>
                <th className="px-5 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando cola de comandos...
                  </td>
                </tr>
              ) : commands.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    <Terminal className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    No hay comandos en la cola para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                commands.map((cmd) => (
                  <tr key={cmd.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    {/* Dispositivo */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs">
                          <Cpu className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">
                            {cmd.dispositivo?.name || cmd.device_serial}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">
                            SN: {cmd.device_serial}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Comando String */}
                    <td className="px-5 py-3.5 font-mono text-slate-900 dark:text-slate-100 font-bold">
                      <span className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {cmd.command_string}
                      </span>
                    </td>

                    {/* Fecha de Creación */}
                    <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                      {formatTime(cmd.created_at)}
                    </td>

                    {/* Estado */}
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => onToggleCommand(cmd.id, cmd.is_executed)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${
                          cmd.is_executed
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'
                        }`}
                        title="Hacer clic para alternar estado"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{cmd.is_executed ? 'Ejecutado' : 'Pendiente'}</span>
                      </button>
                    </td>

                    {/* Acciones */}
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => onDeleteCommand(cmd.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                        title="Eliminar comando de la cola"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
