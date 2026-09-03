// src/features/biometrics/components/DeviceDetailModal.jsx
import { useState } from 'react'
import {
  X,
  Cpu,
  MapPin,
  Barcode,
  Clock,
  Send,
  Activity,
  Terminal,
  Network,
  Globe,
  Tag,
  ArrowRightLeft,
  LogIn,
  LogOut,
  Utensils,
  UserCheck,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'

const TYPE_CONFIG = {
  general: { label: 'Entradas y Salidas', icon: ArrowRightLeft, badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  entrada: { label: 'Solo Entradas', icon: LogIn, badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  salida: { label: 'Solo Salidas', icon: LogOut, badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  comedor: { label: 'Comedor', icon: Utensils, badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
  rh: { label: 'RH / Enrolamiento', icon: UserCheck, badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  acceso: { label: 'Control de Acceso', icon: ShieldCheck, badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
}

export default function DeviceDetailModal({ device, onClose, onOpenSendCommand, onSyncEmployees, onSyncTime }) {
  const [activeTab, setActiveTab] = useState('info') // 'info' | 'colaboradores' | 'commands' | 'logs'

  if (!device) return null

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

  const online = device.is_active && device.last_activity && (new Date() - new Date(device.last_activity) < 5 * 60 * 1000)

  const typeInfo = TYPE_CONFIG[device.device_type] || TYPE_CONFIG.general
  const TypeIcon = typeInfo.icon

  const targetTz = device.timezone || 'America/Cancun'
  let expectedTimeFormatted = '—'
  try {
    expectedTimeFormatted = new Intl.DateTimeFormat('es-MX', {
      timeZone: targetTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date())
  } catch {
    expectedTimeFormatted = '—'
  }

  const syncStats = device.syncStats || {
    total: device.assignedEmployees?.length || 0,
    synced: (device.assignedEmployees || []).filter(a => a.sync_status === 'SYNCED').length,
    pending: (device.assignedEmployees || []).filter(a => a.sync_status === 'PENDING' || a.sync_status === 'SYNCING').length,
    error: (device.assignedEmployees || []).filter(a => a.sync_status === 'ERROR').length
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {device.name || 'Terminal Biométrica'}
                </h3>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                  online
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                }`}>
                  {online ? 'Online' : 'Offline'}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                  device.is_active
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500 border-slate-300'
                }`}>
                  {device.is_active ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono">
                Serial Number: {device.serial_number}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenSendCommand({ device_serial: device.serial_number })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-amber-400" />
              <span>Emitir Comando</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs de Detalle */}
        <div className="px-6 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('info')}
            className={`py-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'info'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Ficha Técnica & Red
          </button>
          <button
            onClick={() => setActiveTab('colaboradores')}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'colaboradores'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Colaboradores ({device.assignedEmployees?.length || 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('commands')}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'commands'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Comandos ({device.commands?.length || 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Últimos Marcajes ({device.logs?.length || 0})</span>
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6">
          {activeTab === 'info' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                    <Barcode className="w-3.5 h-3.5 text-blue-500" />
                    Número de Serie (SN)
                  </span>
                  <p className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                    {device.serial_number}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-blue-500" />
                    Propósito Operativo
                  </span>
                  <div className="pt-0.5">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${typeInfo.badge}`}>
                      <TypeIcon className="w-3.5 h-3.5" />
                      <span>{typeInfo.label}</span>
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                    <Network className="w-3.5 h-3.5 text-blue-500" />
                    Conectividad IP & Puerto
                  </span>
                  <p className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                    {device.ip_address ? `${device.ip_address}:${device.port || 7660}` : `Puerto ${device.port || 7660} (ISUP)`}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-blue-500" />
                      Zona Horaria & Hora
                    </span>
                    {onSyncTime && (
                      <button
                        onClick={() => onSyncTime(device)}
                        className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                        title="Emitir comando SET OPTIONS DateTime/TimeZone al ZKTeco"
                      >
                        <Clock className="w-3 h-3" />
                        Sincronizar hora
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {targetTz}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Hora esperada: <strong className="text-slate-800 dark:text-slate-200 font-mono">{expectedTimeFormatted}</strong>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-500" />
                    Ubicación Física
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {device.location || 'Sin ubicación especificada'}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-500" />
                    Última Actividad Registrada
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {formatTime(device.last_activity)}
                  </p>
                </div>
              </div>

              {/* Guía de Configuración ADMS / TA Push (ZKTeco) */}
              <div className="p-4 rounded-xl bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/25 space-y-2 mt-4">
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase flex items-center gap-1.5">
                  <Globe className="w-4 h-4" />
                  Parámetros de Configuración ADMS / TA Push (ZKTeco)
                </span>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Para conectar un dispositivo biométrico ZKTeco SpeedFace o SenseFace a esta terminal, configure los siguientes parámetros en la sección de <strong>Configuración de Servidor ADMS / Servidor Cloud</strong> en el menú del dispositivo:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1.5 font-mono">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Dirección del Servidor</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {window.location.hostname || 'TU-DOMINIO.com'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Puerto del Servidor</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Ruta / Server Path</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">/iclock</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60">
                    <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Habilitar Servidor Cloud (Push)</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">Sí / Activo</span>
                  </div>
                </div>
                <div className="p-2 text-[10px] text-slate-500 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-800/60">
                  <strong>Nota:</strong> Si está en desarrollo local, utilice la URL HTTPS provista por ngrok o Cloudflare Tunnel. La comunicación se realiza mediante peticiones HTTP/HTTPS estándar.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'colaboradores' && (
            <div className="space-y-4">
              {/* Resumen de Sincronización y Acción */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center w-full sm:w-auto">
                  <div className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Total</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{syncStats.total}</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40">
                    <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block">Sync</span>
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{syncStats.synced}</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40">
                    <span className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400 block">Pendiente</span>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{syncStats.pending}</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40">
                    <span className="text-[10px] uppercase font-bold text-rose-600 dark:text-rose-400 block">Error</span>
                    <span className="text-sm font-bold text-rose-700 dark:text-rose-300">{syncStats.error}</span>
                  </div>
                </div>

                {onSyncEmployees && (
                  <button
                    onClick={() => onSyncEmployees(device)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Sincronizar colaboradores
                  </button>
                )}
              </div>

              {(!device.assignedEmployees || device.assignedEmployees.length === 0) ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No hay colaboradores asignados a esta terminal.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="px-5 py-3">Colaborador</th>
                          <th className="px-5 py-3 text-center">ID Biométrico (Pin)</th>
                          <th className="px-5 py-3 text-center">Estado Sincronización</th>
                          <th className="px-5 py-3 text-right">Último Intento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {device.assignedEmployees.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">
                              {a.empleado}
                            </td>
                            <td className="px-5 py-3 text-center font-mono text-slate-700 dark:text-slate-300">
                              {a.biometric_user_id}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                a.sync_status === 'SYNCED'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                  : a.sync_status === 'ERROR'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              }`}>
                                {a.sync_status}
                              </span>
                              {a.last_error && a.sync_status === 'ERROR' && (
                                <p className="text-[10px] text-rose-500 mt-1 max-w-[200px] mx-auto truncate" title={a.last_error}>
                                  {a.last_error}
                                </p>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-[10px] text-slate-500">
                              {a.last_synced_at ? formatTime(a.last_synced_at) : (a.last_attempt_at ? formatTime(a.last_attempt_at) : 'Pendiente')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'commands' && (
            <div className="space-y-3">
              {(!device.commands || device.commands.length === 0) ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No hay comandos enviados recientemente a esta terminal.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  {device.commands.map((cmd) => (
                    <div key={cmd.id} className="p-3 text-xs flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono font-bold text-slate-900 dark:text-white">
                          {cmd.command_string}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {formatTime(cmd.created_at)}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        cmd.is_executed
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      }`}>
                        {cmd.is_executed ? 'Ejecutado' : 'Pendiente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-3">
              {(!device.logs || device.logs.length === 0) ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No hay marcajes recientes registrados por esta terminal.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  {device.logs.map((log) => (
                    <div key={log.id} className="p-3 text-xs flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">
                          Usuario ID: <span className="font-mono">{log.user_id}</span>
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {formatTime(log.timestamp)}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                        {log.status || 'OK'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
