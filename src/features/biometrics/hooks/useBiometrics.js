// src/features/biometrics/hooks/useBiometrics.js
import { useState, useEffect, useCallback } from 'react'
import { biometricsService } from '../services/biometricsService'
import toast from 'react-hot-toast'

export function useBiometrics(currentTenantId) {
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' | 'devices' | 'colaboradores' | 'asignaciones' | 'sync' | 'logs' | 'commands'
  const [loading, setLoading] = useState(true)

  // Dashboard Stats
  const [stats, setStats] = useState({
    totalDevices: 0,
    activeDevices: 0,
    inactiveDevices: 0,
    onlineDevices: 0,
    offlineDevices: 0,
    totalLogsToday: 0,
    pendingCommands: 0,
    executedCommands: 0,
    latestActivity: null,
    devices: [],
    recentLogs: [],
    recentCommands: [],
    syncedAssignments: 0,
    pendingAssignments: 0,
    errorAssignments: 0,
    recentSyncs: [],
    recentErrors: []
  })

  // Devices State
  const [devices, setDevices] = useState([])
  const [deviceSearch, setDeviceSearch] = useState('')
  const [deviceFilterStatus, setDeviceFilterStatus] = useState('todos')
  const [deviceFilterType, setDeviceFilterType] = useState('todos')
  const [deviceModalForm, setDeviceModalForm] = useState(null) // null | 'nuevo' | DeviceObject
  const [deviceDetailModal, setDeviceDetailModal] = useState(null) // null | DeviceObject

  // Attendance Logs State
  const [logs, setLogs] = useState([])
  const [logsSearch, setLogsSearch] = useState('')
  const [logsDeviceFilter, setLogsDeviceFilter] = useState('todos')
  const [logsUserFilter, setLogsUserFilter] = useState('todos')
  const [logsDateFrom, setLogsDateFrom] = useState('')
  const [logsDateTo, setLogsDateTo] = useState('')
  const [devicesCatalog, setDevicesCatalog] = useState([])
  const [employeesCatalog, setEmployeesCatalog] = useState([])

  // Device Commands State
  const [commands, setCommands] = useState([])
  const [commandDeviceFilter, setCommandDeviceFilter] = useState('todos')
  const [commandStatusFilter, setCommandStatusFilter] = useState('todos')
  const [sendCommandModal, setSendCommandModal] = useState(null) // null | { device_serial?: string }

  // Sync Policy & Collaborators Provision State
  const [syncPolicy, setSyncPolicy] = useState(null) // { biometric_sync_policy, id_empresa }
  const [employeesSyncData, setEmployeesSyncData] = useState({ employees: [], assignments: [], devices: [], tenants: [] })
  const [loadingPolicy, setLoadingPolicy] = useState(false)
  const [loadingSyncData, setLoadingSyncData] = useState(false)

  // ── Cargar Datos según Tab ───────────────────────────────────────────────────

  const loadDashboardData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await biometricsService.getBiometricsStats(currentTenantId)
      setStats(data)
    } catch (err) {
      console.error('[useBiometrics] Error al cargar stats:', err)
      toast.error('Error al cargar métricas de biométricos')
    } finally {
      setLoading(false)
    }
  }, [currentTenantId])

const loadDevices = useCallback(async () => {
  if (!currentTenantId) {
    setDevices([])
    setLoading(false)
    return
  }

  setLoading(true)

  try {
    const list = await biometricsService.getDevices({
      clienteId: currentTenantId,
      search: deviceSearch,
      status: deviceFilterStatus,
      type: deviceFilterType,
    })

    setDevices(list)
  } catch (err) {
    console.error('[useBiometrics] Error al cargar dispositivos:', err)
    toast.error('Error al cargar lista de dispositivos')
  } finally {
    setLoading(false)
  }
}, [
  currentTenantId,
  deviceSearch,
  deviceFilterStatus,
  deviceFilterType
])


  const loadAttendanceLogs = useCallback(async () => {
    setLoading(true)
    try {
      const { logs: logList, devices: devs, employees: emps } = await biometricsService.getAttendanceLogs({
        clienteId: currentTenantId,
        search: logsSearch,
        deviceSerial: logsDeviceFilter,
        userId: logsUserFilter,
        dateFrom: logsDateFrom,
        dateTo: logsDateTo,
        limit: 300,
      })
      setLogs(logList)
      setDevicesCatalog(devs)
      setEmployeesCatalog(emps)
    } catch (err) {
      console.error('[useBiometrics] Error al cargar logs:', err)
      toast.error('Error al cargar registros de asistencia')
    } finally {
      setLoading(false)
    }
  }, [logsSearch, logsDeviceFilter, logsUserFilter, logsDateFrom, logsDateTo])

  const loadCommands = useCallback(async () => {
    setLoading(true)
    try {
      const { commands: cmdList, devices: devs } = await biometricsService.getDeviceCommands({
        clienteId: currentTenantId,
        deviceSerial: commandDeviceFilter,
        status: commandStatusFilter,
      })
      setCommands(cmdList)
      setDevicesCatalog(devs)
    } catch (err) {
      console.error('[useBiometrics] Error al cargar comandos:', err)
      toast.error('Error al cargar cola de comandos')
    } finally {
      setLoading(false)
    }
  }, [commandDeviceFilter, commandStatusFilter])

  const loadSyncPolicy = useCallback(async () => {
    if (!currentTenantId) return
    setLoadingPolicy(true)
    try {
      const data = await biometricsService.getSyncPolicy(currentTenantId)
      setSyncPolicy(data)
    } catch (err) {
      console.error('[useBiometrics] Error al cargar política:', err)
    } finally {
      setLoadingPolicy(false)
    }
  }, [currentTenantId])

  const changeSyncPolicy = async (policy) => {
    if (!currentTenantId) return
    try {
      await biometricsService.updateSyncPolicy(currentTenantId, policy)
      toast.success(`Política cambiada a ${policy}`)
      loadSyncPolicy()
      loadEmployeesSync()
      loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al actualizar política:', err)
      toast.error('Error al guardar política: ' + err.message)
    }
  }

  const loadEmployeesSync = useCallback(async () => {
    if (!currentTenantId) return
    setLoadingSyncData(true)
    try {
      const data = await biometricsService.getEmployeesSync(currentTenantId)
      setEmployeesSyncData(data)
    } catch (err) {
      console.error('[useBiometrics] Error al cargar datos de sincronización:', err)
    } finally {
      setLoadingSyncData(false)
    }
  }, [currentTenantId])

  const refreshCurrentTab = useCallback(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData()
    } else if (activeTab === 'devices') {
      loadDevices()
    } else if (activeTab === 'logs') {
      loadAttendanceLogs()
    } else if (activeTab === 'commands') {
      loadCommands()
    } else if (activeTab === 'sync') {
      loadDashboardData()
      loadSyncPolicy()
      loadEmployeesSync()
      loadCommands()
    } else if (activeTab === 'colaboradores' || activeTab === 'asignaciones') {
      loadEmployeesSync()
    }
  }, [activeTab, loadDashboardData, loadDevices, loadAttendanceLogs, loadCommands, loadSyncPolicy, loadEmployeesSync])

  useEffect(() => {
    refreshCurrentTab()
  }, [activeTab, refreshCurrentTab])

  // Refrescar automáticamente al cambiar de Tenant
  useEffect(() => {
    if (currentTenantId) {
      refreshCurrentTab()
    }
  }, [currentTenantId, refreshCurrentTab])

  // ── Mutaciones de Dispositivos ───────────────────────────────────────────────

  const handleSaveDevice = async (deviceData) => {
    try {
      if (deviceData.id) {
        await biometricsService.updateDevice(deviceData.id, deviceData)
        toast.success(`Dispositivo "${deviceData.name}" actualizado`)
      } else {
        await biometricsService.createDevice({ ...deviceData, cliente_id: currentTenantId })
        toast.success(`Dispositivo "${deviceData.name}" registrado`)
      }
      setDeviceModalForm(null)
      loadDevices()
      loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al guardar dispositivo:', err)
      toast.error('Error al guardar dispositivo: ' + err.message)
    }
  }

  const handleDeleteDevice = async (id, name) => {
    try {
      await biometricsService.deleteDevice(id)
      toast.success(`Dispositivo "${name}" eliminado`)
      loadDevices()
      loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al eliminar dispositivo:', err)
      toast.error('No se pudo eliminar el dispositivo: ' + err.message)
    }
  }

  const handleOpenDeviceDetail = async (device) => {
    try {
      const fullDetail = await biometricsService.getDeviceById(device.id)
      // Cargar también asignados al dispositivo
      const assignResponse = await biometricsService.getEmployeesSync(currentTenantId)
      const assigned = assignResponse.assignments
        .filter(a => a.device_id === device.id && a.activo)
        .map(a => {
          const emp = assignResponse.employees.find(e => e.id === a.employee_id)
          return {
            ...a,
            empleado: emp ? `${emp.nombre} ${emp.apellido}` : 'Desconocido',
            clave: emp?.clave_empleado || '—'
          }
        })

      setDeviceDetailModal({
        ...fullDetail,
        assignedEmployees: assigned
      })
    } catch (err) {
      setDeviceDetailModal(device)
    }
  }

  // ── Mutaciones de Comandos ──────────────────────────────────────────────────

  const handleSendCommand = async ({ device_serial, command_string }) => {
    try {
      await biometricsService.sendCommand({ clienteId: currentTenantId, device_serial, command_string })
      toast.success(`Comando enviado al dispositivo ${device_serial}`)
      setSendCommandModal(null)
      if (activeTab === 'commands') loadCommands()
      else loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al enviar comando:', err)
      toast.error('Error al emitir comando: ' + err.message)
    }
  }

  const handleToggleCommand = async (id, currentStatus) => {
    try {
      await biometricsService.toggleCommandExecuted(id, !currentStatus)
      toast.success(!currentStatus ? 'Comando marcado como ejecutado' : 'Comando marcado como pendiente')
      loadCommands()
    } catch (err) {
      toast.error('Error al cambiar estado del comando')
    }
  }

  const handleDeleteCommand = async (id) => {
    try {
      await biometricsService.deleteCommand(id)
      toast.success('Comando eliminado de la cola')
      loadCommands()
    } catch (err) {
      toast.error('Error al eliminar comando')
    }
  }

  // ── Mutaciones de Asignaciones ───────────────────────────────────────────────

  const handleSaveAssignment = async ({ device_id, employee_id, biometric_user_id, activo }) => {
    try {
      await biometricsService.saveAssignment({
        cliente_id: currentTenantId,
        device_id,
        employee_id,
        biometric_user_id,
        activo
      })
      loadEmployeesSync()
      loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al guardar asignación:', err)
      throw err
    }
  }

  const handleDeactivateAssignment = async (assignmentId) => {
    try {
      await biometricsService.deactivateAssignment(assignmentId)
      toast.success('Desvinculación encolada para el biométrico')
      loadEmployeesSync()
      loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al desactivar asignación:', err)
      toast.error('Error al quitar de terminal: ' + err.message)
    }
  }

  const handleSyncAssignmentNow = async (assignmentId) => {
    try {
      await biometricsService.syncAssignmentNow(assignmentId)
      toast.success('Sincronización forzada encolada')
      loadEmployeesSync()
      loadDashboardData()
    } catch (err) {
      console.error('[useBiometrics] Error al forzar sincronización:', err)
      toast.error('Error al sincronizar ahora: ' + err.message)
    }
  }

  return {
    activeTab,
    setActiveTab,
    loading: loading || loadingSyncData || loadingPolicy,
    refreshCurrentTab,

    // Dashboard
    stats,
    loadDashboardData,

    // Devices
    devices,
    deviceSearch,
    setDeviceSearch,
    deviceFilterStatus,
    setDeviceFilterStatus,
    deviceFilterType,
    setDeviceFilterType,
    deviceModalForm,
    setDeviceModalForm,
    deviceDetailModal,
    setDeviceDetailModal,
    handleSaveDevice,
    handleDeleteDevice,
    handleOpenDeviceDetail,
    loadDevices,

    // Attendance Logs
    logs,
    logsSearch,
    setLogsSearch,
    logsDeviceFilter,
    setLogsDeviceFilter,
    logsUserFilter,
    setLogsUserFilter,
    logsDateFrom,
    setLogsDateFrom,
    logsDateTo,
    setLogsDateTo,
    devicesCatalog,
    employeesCatalog,
    loadAttendanceLogs,

    // Commands
    commands,
    commandDeviceFilter,
    setCommandDeviceFilter,
    commandStatusFilter,
    setCommandStatusFilter,
    sendCommandModal,
    setSendCommandModal,
    handleSendCommand,
    handleToggleCommand,
    handleDeleteCommand,
    loadCommands,

    // Sync Policy & Provisioning
    syncPolicy,
    changeSyncPolicy,
    loadSyncPolicy,
    employeesSyncData,
    loadEmployeesSync,
    handleSaveAssignment,
    handleDeactivateAssignment,
    handleSyncAssignmentNow
  }
}
