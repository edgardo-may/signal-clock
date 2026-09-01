// src/features/biometrics/components/BiometricsEmployeesList.jsx
import { useState } from 'react'
import {
  Users,
  Search,
  RefreshCw,
  Cpu,
  Trash2,
  AlertTriangle,
  Building,
  CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'

export default function BiometricsEmployeesList({
  loading,
  syncData = { employees: [], assignments: [], devices: [], tenants: [] },
  onSyncNow,
  onDeactivate,
  onRefresh
}) {
  const { employees = [], assignments = [], devices = [], tenants = [] } = syncData
  const [search, setSearch] = useState('')
  const [deletingAssignmentId, setDeletingAssignmentId] = useState(null)

  // Filtrar colaboradores por búsqueda
  const filteredEmployees = employees.filter((e) => {
    const fullName = `${e.nombre || ''} ${e.apellido || ''}`.toLowerCase()
    const q = search.toLowerCase()
    const matchBasic =
      fullName.includes(q) ||
      (e.clave_empleado || '').toLowerCase().includes(q) ||
      (e.departamento || '').toLowerCase().includes(q)

    // También buscar por dispositivo asignado
    const empAssignments = assignments.filter((a) => a.employee_id === e.id && a.activo)
    const matchDevice = empAssignments.some((a) => {
      const dev = devices.find((d) => d.id === a.device_id)
      return dev && (dev.name || dev.serial_number || '').toLowerCase().includes(q)
    })

    return matchBasic || matchDevice
  })

  // Obtener asignaciones activas de un colaborador
  const getEmployeeAssignments = (employeeId) => {
    return assignments.filter((a) => a.employee_id === employeeId && a.activo)
  }

  const handleSyncAllForEmployee = async (employeeId) => {
    const empAssigns = getEmployeeAssignments(employeeId)
    if (empAssigns.length === 0) {
      toast.error('Este colaborador no tiene biométricos asignados.')
      return
    }

    try {
      const promises = empAssigns.map((a) => onSyncNow(a.id))
      await Promise.all(promises)
      toast.success('Peticiones de sincronización encoladas para el colaborador.')
      onRefresh()
    } catch (err) {
      toast.error('Error al solicitar sincronización.')
    }
  }

  const formatTime = (ts) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
    })
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por colaborador, clave, departamento o terminal..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all cursor-pointer disabled:opacity-50 self-end sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refrescar</span>
        </button>
      </div>

      {/* ── Tabla de Colaboradores ── */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Colaborador</th>
                <th className="px-5 py-3.5">Clave Empleado</th>
                {tenants.length > 1 && <th className="px-5 py-3.5">Sucursal / Empresa</th>}
                <th className="px-5 py-3.5">Biométricos Asignados & Estados</th>
                <th className="px-5 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading && employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando padrón de colaboradores...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    <Users className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    No se encontraron colaboradores.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const empAssigns = getEmployeeAssignments(emp.id)
                  const tenant = tenants.find((t) => t.id === emp.cliente_id)

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Colaborador info */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {emp.avatar_url ? (
                            <img
                              src={emp.avatar_url}
                              alt={emp.nombre}
                              className="w-8 h-8 rounded-full border border-slate-200 object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                              {emp.nombre?.[0] || ''}
                              {emp.apellido?.[0] || ''}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white text-sm">
                              {emp.nombre} {emp.apellido}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              Depto: {emp.departamento || 'General'}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Clave */}
                      <td className="px-5 py-3.5 font-mono text-slate-700 dark:text-slate-300">
                        {emp.clave_empleado || '—'}
                      </td>

                      {/* Tenant (si hay más de 1 en el alcance de Empresa) */}
                      {tenants.length > 1 && (
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                            <Building className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span>{tenant?.nombre_empresa || 'Sucursal'}</span>
                          </div>
                        </td>
                      )}

                      {/* Biométricos asignados con badges */}
                      <td className="px-5 py-3.5">
                        {empAssigns.length === 0 ? (
                          <span className="text-slate-400 text-[11px] italic">Sin dispositivos vinculados</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {empAssigns.map((a) => {
                              const dev = devices.find((d) => d.id === a.device_id)
                              const devName = dev ? dev.name : a.biometric_user_id
                              
                              let badgeColor = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                              if (a.sync_status === 'SYNCED') {
                                badgeColor = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              } else if (a.sync_status === 'ERROR') {
                                badgeColor = 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 animate-pulse'
                              } else if (a.sync_status === 'SYNCING') {
                                badgeColor = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                              }

                              return (
                                <div
                                  key={a.id}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${badgeColor}`}
                                  title={`Estado: ${a.sync_status} ${a.last_error ? `\nError: ${a.last_error}` : ''}`}
                                >
                                  <Cpu className="w-3 h-3" />
                                  <span className="max-w-[100px] truncate">{devName}</span>
                                  
                                  {/* Botón para remover de este dispositivo */}
                                  <button
                                    onClick={() => setDeletingAssignmentId(a.id)}
                                    className="ml-1 p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-500 transition-colors"
                                    title="Quitar aprovisionamiento en este dispositivo"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => handleSyncAllForEmployee(emp.id)}
                          disabled={empAssigns.length === 0}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 transition-all cursor-pointer disabled:opacity-50"
                        >
                          Sincronizar Todo
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dialog Confirmar Quitar de Dispositivo ── */}
      {deletingAssignmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  ¿Quitar de Terminal?
                </h4>
                <p className="text-xs text-slate-500">
                  Sincronización de Baja en ADMS
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Esta acción encolará un comando <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">DATA DELETE USERINFO</code> en la cola del dispositivo. El colaborador será eliminado de la memoria de la terminal una vez que esta se conecte.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setDeletingAssignmentId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  await onDeactivate(deletingAssignmentId)
                  setDeletingAssignmentId(null)
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/25 transition-all"
              >
                Confirmar Baja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
