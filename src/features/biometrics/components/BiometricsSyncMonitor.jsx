// src/features/biometrics/components/BiometricsSyncMonitor.jsx
import { useState } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Clock,
  Terminal,
  Settings,
  Users,
  AlertCircle,
} from 'lucide-react'
import DeviceCommandsList from './DeviceCommandsList'
import toast from 'react-hot-toast'

// Lenguaje visual unificado para estados de sincronización
const SYNC_STATUS = {
  SYNCED: {
    label: 'Sincronizado',
    badge: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    dot:   'bg-emerald-500',
  },
  SYNCING: {
    label: 'Sincronizando',
    badge: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
    dot:   'bg-blue-500 animate-pulse',
  },
  ERROR: {
    label: 'Error',
    badge: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20',
    dot:   'bg-rose-500',
  },
  PENDING: {
    label: 'Pendiente',
    badge: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    dot:   'bg-amber-400',
  },
}

function getSyncStatus(status) {
  return SYNC_STATUS[status] || SYNC_STATUS.PENDING
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-MX', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
  })
}

export default function BiometricsSyncMonitor({
  devices = [],
  stats,
  loading,
  policy = { biometric_sync_policy: 'PERSONALIZADA', id_empresa: null },
  onChangePolicy,
  syncData = { employees: [], assignments: [], devices: [] },
  commands = [],
  commandDeviceFilter,
  onCommandDeviceFilterChange,
  commandStatusFilter,
  onCommandStatusFilterChange,
  devicesCatalog = [],
  onToggleCommand,
  onDeleteCommand,
  onOpenSendCommand,
  onDeactivateAssignment,
  onSyncAssignmentNow,
  onRefresh,
}) {
  const { employees = [], assignments = [] } = syncData
  const [activeSubTab, setActiveSubTab] = useState('queue')
  const [savingPolicy, setSavingPolicy] = useState(false)

  const handlePolicyChange = async (newPolicy) => {
    setSavingPolicy(true)
    try {
      await onChangePolicy(newPolicy)
    } catch {
      toast.error('Error al cambiar la política.')
    } finally {
      setSavingPolicy(false)
    }
  }

  const errorCount   = assignments.filter(a => a.sync_status === 'ERROR').length
  const pendingCount = assignments.filter(a => a.sync_status === 'PENDING').length
  const syncedCount  = assignments.filter(a => a.sync_status === 'SYNCED').length

  return (
    <div className="space-y-5">

      {/* ── Política de sincronización ─────────────────────────────────────── */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <Settings className="w-4 h-4 text-slate-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Política de sincronización</h3>
            <p className="text-xs text-slate-400 mt-0.5">Alcance de aprovisionamiento de colaboradores hacia las terminales</p>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { value: 'GLOBAL',       label: 'Global',       desc: 'Todo el personal en todas las terminales.' },
            { value: 'EMPRESA',      label: 'Empresa',      desc: 'Sucursales de la misma empresa corporativa.' },
            { value: 'SUBEMPRESA',   label: 'Subempresa',   desc: 'Personal del tenant en sus propias terminales.' },
            { value: 'PERSONALIZADA',label: 'Personalizada',desc: 'Asignaciones manuales individuales.' },
          ].map((item) => {
            const isSelected = policy?.biometric_sync_policy === item.value
            return (
              <button
                key={item.value}
                onClick={() => handlePolicyChange(item.value)}
                disabled={savingPolicy}
                className={`p-3 rounded-lg border text-left transition-all text-xs ${
                  isSelected
                    ? 'bg-[#03363D] border-[#03363D] text-white'
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <span className="font-semibold block mb-0.5">{item.label}</span>
                <span className={`text-[10px] leading-tight block ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>{item.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Sub-Tabulador ────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'queue',    label: `Cola de sincronización (${assignments.length})`, icon: Users },
          { id: 'commands', label: `Comandos ADMS (${commands.length})`,             icon: Terminal },
        ].map(tab => {
          const Icon = tab.icon
          const isActive = activeSubTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                isActive
                  ? 'border-[#03363D] dark:border-teal-400 text-[#03363D] dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Cola de Sincronización ───────────────────────────────────────── */}
      {activeSubTab === 'queue' && (
        <div className="space-y-4">
          {/* Resumen de estado */}
          {assignments.length > 0 && (
            <div className="flex items-center gap-4 px-1 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {syncedCount} sincronizados
              </span>
              {pendingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {pendingCount} pendientes
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  {errorCount} con error
                </span>
              )}
              <button
                onClick={onRefresh}
                disabled={loading}
                className="ml-auto flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          )}

          {/* Tabla */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-100 dark:border-slate-800">
                  <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <th className="px-5 py-3.5">Colaborador</th>
                    <th className="px-5 py-3.5">Dispositivo</th>
                    <th className="px-5 py-3.5 text-center">PIN</th>
                    <th className="px-5 py-3.5 text-center">Estado</th>
                    <th className="px-5 py-3.5">Última actividad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                  {loading && assignments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">
                        Cargando...
                      </td>
                    </tr>
                  ) : assignments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-14 text-center">
                        <Users className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No hay empleados asignados</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Las asignaciones aparecerán aquí cuando se configuren</p>
                      </td>
                    </tr>
                  ) : (
                    assignments.map((a) => {
                      const emp    = employees.find(e => e.id === a.employee_id)
                      const dev    = devices.find(d => d.id === a.device_id)
                      const status = getSyncStatus(a.sync_status)
                      const isErr  = a.sync_status === 'ERROR'

                      return (
                        <tr key={a.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                          {/* Colaborador */}
                          <td className="px-5 py-3.5">
                            <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight">
                              {emp ? `${emp.nombre} ${emp.apellido}` : <span className="text-slate-400">—</span>}
                            </p>
                          </td>

                          {/* Dispositivo */}
                          <td className="px-5 py-3.5">
                            <p className="text-sm text-slate-700 dark:text-slate-300">{dev?.name || '—'}</p>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {dev?.serial_number || a.device_id}
                            </p>
                          </td>

                          {/* PIN */}
                          <td className="px-5 py-3.5 text-center">
                            <span className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {a.biometric_user_id}
                            </span>
                          </td>

                          {/* Estado */}
                          <td className="px-5 py-3.5 text-center">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${status.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.dot}`} />
                              {status.label}
                            </span>
                          </td>

                          {/* Última actividad / Error */}
                          <td className="px-5 py-3.5">
                            {isErr ? (
                              <div>
                                <p className="text-xs font-medium text-rose-600 dark:text-rose-400 truncate max-w-[220px]" title={a.last_error}>
                                  {a.last_error || 'Error desconocido'}
                                </p>
                                {a.retry_count > 0 && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">{a.retry_count} intento{a.retry_count !== 1 ? 's' : ''}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 font-mono">
                                {a.last_synced_at ? formatTime(a.last_synced_at) : a.last_attempt_at ? formatTime(a.last_attempt_at) : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Comandos ADMS ───────────────────────────────────────────────── */}
      {activeSubTab === 'commands' && (
        <DeviceCommandsList
          commands={commands}
          loading={loading}
          deviceFilter={commandDeviceFilter}
          onDeviceFilterChange={onCommandDeviceFilterChange}
          statusFilter={commandStatusFilter}
          onStatusFilterChange={onCommandStatusFilterChange}
          devicesCatalog={devicesCatalog}
          onOpenSendCommand={onOpenSendCommand}
          onToggleCommand={onToggleCommand}
          onDeleteCommand={onDeleteCommand}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
