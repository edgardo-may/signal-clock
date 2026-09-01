// src/features/biometrics/components/BiometricsAssignmentsManager.jsx
import { useState } from 'react'
import {
  Users,
  Cpu,
  Search,
  CheckSquare,
  Square,
  RefreshCw,
  Activity,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react'
import toast from 'react-hot-toast'

export default function BiometricsAssignmentsManager({
  loading,
  syncData = { employees: [], assignments: [], devices: [] },
  onSaveAssignment,
  onDeactivateAssignment,
  onRefresh,
}) {
  const { employees = [], assignments = [], devices = [] } = syncData
  const [managerMode, setManagerMode] = useState('employee') // 'employee' | 'device'
  
  // States para "Por Colaborador"
  const [selectedEmpId, setSelectedEmpId] = useState(() => employees[0]?.id || '')
  const [empSearch, setEmpSearch] = useState('')
  const [deviceFilterText, setDeviceFilterText] = useState('')

  // States para "Por Biométrico"
  const [selectedDevId, setSelectedDevId] = useState(() => devices[0]?.id || '')
  const [devSearch, setDevSearch] = useState('')
  const [employeeFilterText, setEmployeeFilterText] = useState('')

  // Filtrar listas izquierdas
  const filteredEmployeesLeft = employees.filter((e) => {
    const name = `${e.nombre || ''} ${e.apellido || ''}`.toLowerCase()
    return (
      name.includes(empSearch.toLowerCase()) ||
      (e.clave_empleado || '').toLowerCase().includes(empSearch.toLowerCase())
    )
  })

  const filteredDevicesLeft = devices.filter((d) => {
    return (
      (d.name || '').toLowerCase().includes(devSearch.toLowerCase()) ||
      (d.serial_number || '').toLowerCase().includes(devSearch.toLowerCase())
    )
  })

  // Obtener colaborador seleccionado y dispositivo seleccionado
  const activeEmployee = employees.find((e) => e.id === selectedEmpId) || employees[0]
  const activeDevice = devices.find((d) => d.id === selectedDevId) || devices[0]

  // Cambiar de asignación (Checkbox trigger)
  const handleToggleAssignment = async (employee, device) => {
    const existing = assignments.find(
      (a) => a.employee_id === employee.id && a.device_id === device.id
    )

    try {
      if (existing) {
        if (existing.activo) {
          // Desaprovisionar (activo = false)
          await onDeactivateAssignment(existing.id)
          toast.success(`Desvinculación encolada para ${employee.nombre} en ${device.name || device.serial_number}`)
        } else {
          // Reactivar (activo = true)
          await onSaveAssignment({
            device_id: device.id,
            employee_id: employee.id,
            biometric_user_id: employee.clave_empleado || employee.id.substring(0,8),
            activo: true,
          })
          toast.success(`Aprovisionamiento encolado para ${employee.nombre} en ${device.name || device.serial_number}`)
        }
      } else {
        // Crear nueva asignación
        await onSaveAssignment({
          device_id: device.id,
          employee_id: employee.id,
          biometric_user_id: employee.clave_empleado || employee.id.substring(0,8),
          activo: true,
        })
        toast.success(`Aprovisionamiento encolado para ${employee.nombre} en ${device.name || device.serial_number}`)
      }
    } catch (err) {
      toast.error('Error al modificar la asignación: ' + err.message)
    }
  }

  // Filtrar dispositivos de la derecha (vista colaborador)
  const rightDevices = devices.filter(d => 
    (d.name || '').toLowerCase().includes(deviceFilterText.toLowerCase()) ||
    (d.serial_number || '').toLowerCase().includes(deviceFilterText.toLowerCase())
  )

  // Filtrar colaboradores de la derecha (vista dispositivo)
  const rightEmployees = employees.filter(e => 
    `${e.nombre || ''} ${e.apellido || ''}`.toLowerCase().includes(employeeFilterText.toLowerCase()) ||
    (e.clave_empleado || '').toLowerCase().includes(employeeFilterText.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {/* Selector de Modo */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
        <button
          onClick={() => setManagerMode('employee')}
          className={`py-3.5 px-6 border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            managerMode === 'employee'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Por Colaborador (1 Colaborador → Múltiples Biométricos)</span>
        </button>
        <button
          onClick={() => setManagerMode('device')}
          className={`py-3.5 px-6 border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            managerMode === 'device'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Por Biométrico (1 Biométrico → Múltiples Colaboradores)</span>
        </button>
      </div>

      {/* Panel Dual */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[500px]">
        {/* ── COLUMNA IZQUIERDA: LISTA DE SELECCIÓN ── */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm flex flex-col h-[500px] overflow-hidden">
          {managerMode === 'employee' ? (
            <>
              {/* Buscador de Colaboradores */}
              <div className="relative mb-3 flex-shrink-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Buscar colaborador..."
                  className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              {/* Lista */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/55 pr-1">
                {filteredEmployeesLeft.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-8">No hay colaboradores</p>
                ) : (
                  filteredEmployeesLeft.map((e) => {
                    const isSelected = selectedEmpId === e.id || (!selectedEmpId && employees[0]?.id === e.id)
                    const activeAssigns = assignments.filter((a) => a.employee_id === e.id && a.activo).length

                    return (
                      <button
                        key={e.id}
                        onClick={() => setSelectedEmpId(e.id)}
                        className={`w-full text-left p-3.5 rounded-xl transition-all flex items-center justify-between gap-3 border my-0.5 cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                            : 'bg-transparent text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-bold truncate max-w-[150px] sm:max-w-[200px]">
                            {e.nombre} {e.apellido}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">
                            Clave: {e.clave_empleado || '—'}
                          </p>
                        </div>

                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold ${
                          activeAssigns > 0
                            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                          {activeAssigns} asignado{activeAssigns !== 1 && 's'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {/* Buscador de Dispositivos */}
              <div className="relative mb-3 flex-shrink-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={devSearch}
                  onChange={(e) => setDevSearch(e.target.value)}
                  placeholder="Buscar terminal..."
                  className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              {/* Lista */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/55 pr-1">
                {filteredDevicesLeft.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-8">No hay dispositivos</p>
                ) : (
                  filteredDevicesLeft.map((d) => {
                    const isSelected = selectedDevId === d.id || (!selectedDevId && devices[0]?.id === d.id)
                    const activeAssigns = assignments.filter((a) => a.device_id === d.id && a.activo).length

                    return (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDevId(d.id)}
                        className={`w-full text-left p-3.5 rounded-xl transition-all flex items-center justify-between gap-3 border my-0.5 cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                            : 'bg-transparent text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-bold truncate max-w-[150px] sm:max-w-[200px]">
                            {d.name || d.serial_number}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">
                            SN: {d.serial_number}
                          </p>
                        </div>

                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold ${
                          activeAssigns > 0
                            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                          {activeAssigns} colaborador{activeAssigns !== 1 && 'es'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* ── COLUMNA DERECHA: PROVISIÓN / CHECKBOXES ── */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-sm flex flex-col h-[500px] overflow-hidden">
          {managerMode === 'employee' ? (
            activeEmployee ? (
              <>
                {/* Cabecera Colaborador */}
                <div className="mb-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between flex-shrink-0">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Asignar biométricos a: {activeEmployee.nombre} {activeEmployee.apellido}
                    </h4>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      Clave de Empleado: {activeEmployee.clave_empleado || '—'} · Departamento: {activeEmployee.departamento || 'General'}
                    </p>
                  </div>
                  <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
                    <Users className="w-5 h-5" />
                  </div>
                </div>

                {/* Filtro terminales */}
                <div className="relative mb-3 flex-shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={deviceFilterText}
                    onChange={(e) => setDeviceFilterText(e.target.value)}
                    placeholder="Filtrar dispositivos disponibles..."
                    className="w-full pl-9 pr-4 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                {/* Listado checkboxes */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 pr-1">
                  {rightDevices.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-10">No hay dispositivos disponibles</p>
                  ) : (
                    rightDevices.map((dev) => {
                      const assignment = assignments.find(
                        (a) => a.employee_id === activeEmployee.id && a.device_id === dev.id
                      )
                      const isAssigned = !!(assignment && assignment.activo)

                      return (
                        <div
                          key={dev.id}
                          className="py-3 flex items-center justify-between gap-4 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleToggleAssignment(activeEmployee, dev)}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                isAssigned
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-slate-300 dark:border-slate-700 text-slate-300 dark:text-slate-700 hover:border-blue-500'
                              }`}
                            >
                              {isAssigned ? (
                                <CheckSquare className="w-4 h-4" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>

                            <div>
                              <p className="font-bold text-slate-900 dark:text-white">
                                {dev.name || dev.serial_number}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400">
                                SN: {dev.serial_number} · IP: {dev.ip_address || 'DHCP'}
                              </p>
                            </div>
                          </div>

                          {assignment && (
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                assignment.sync_status === 'SYNCED'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                  : assignment.sync_status === 'ERROR'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              }`}>
                                {assignment.sync_status}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                <Users className="w-12 h-12 opacity-35 mb-2" />
                <p className="text-xs">Selecciona un colaborador a la izquierda para administrar sus terminales.</p>
              </div>
            )
          ) : (
            activeDevice ? (
              <>
                {/* Cabecera Dispositivo */}
                <div className="mb-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between flex-shrink-0">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Vincular colaboradores a: {activeDevice.name || activeDevice.serial_number}
                    </h4>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      Serial Number: {activeDevice.serial_number} · Zona Horaria: {activeDevice.timezone || 'N/A'}
                    </p>
                  </div>
                  <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
                    <Cpu className="w-5 h-5" />
                  </div>
                </div>

                {/* Filtro colaboradores */}
                <div className="relative mb-3 flex-shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={employeeFilterText}
                    onChange={(e) => setEmployeeFilterText(e.target.value)}
                    placeholder="Filtrar colaboradores por nombre o clave..."
                    className="w-full pl-9 pr-4 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                {/* Listado checkboxes */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 pr-1">
                  {rightEmployees.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-10">No hay colaboradores disponibles</p>
                  ) : (
                    rightEmployees.map((emp) => {
                      const assignment = assignments.find(
                        (a) => a.employee_id === emp.id && a.device_id === activeDevice.id
                      )
                      const isAssigned = !!(assignment && assignment.activo)

                      return (
                        <div
                          key={emp.id}
                          className="py-3 flex items-center justify-between gap-4 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleToggleAssignment(emp, activeDevice)}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                isAssigned
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-slate-300 dark:border-slate-700 text-slate-300 dark:text-slate-700 hover:border-blue-500'
                              }`}
                            >
                              {isAssigned ? (
                                <CheckSquare className="w-4 h-4" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>

                            <div>
                              <p className="font-bold text-slate-900 dark:text-white">
                                {emp.nombre} {emp.apellido}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400">
                                Clave: {emp.clave_empleado || '—'} · Depto: {emp.departamento || 'General'}
                              </p>
                            </div>
                          </div>

                          {assignment && (
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                assignment.sync_status === 'SYNCED'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                  : assignment.sync_status === 'ERROR'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              }`}>
                                {assignment.sync_status}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                <Cpu className="w-12 h-12 opacity-35 mb-2" />
                <p className="text-xs">Selecciona un biométrico a la izquierda para administrar sus colaboradores.</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
