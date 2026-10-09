import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBiometrics } from '../hooks/useBiometrics'
import { useAuth } from '../../auth/hooks/useAuth'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { syncService } from '../services/syncService'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import CentralLayout from '../../../central/components/CentralLayout'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import toast from 'react-hot-toast'
import BiometricsDashboard from '../components/BiometricsDashboard'
import DevicesList from '../components/DevicesList'
import DeviceDetailModal from '../components/DeviceDetailModal'
import DeviceFormModal from '../components/DeviceFormModal'
import DeviceRegistrationRequests from '../components/DeviceRegistrationRequests'
import AttendanceLogsList from '../components/AttendanceLogsList'
import DeviceCommandsList from '../components/DeviceCommandsList'
import BiometricsSyncMonitor from '../components/BiometricsSyncMonitor'
import SendCommandModal from '../components/SendCommandModal'
import BiometricsEmployeesList from '../components/BiometricsEmployeesList'
import BiometricsAssignmentsManager from '../components/BiometricsAssignmentsManager'
import {
  Cpu,
  Plus,
  Send,
  AlertTriangle,
  RefreshCw,
  LayoutDashboard,
  Users,
  CalendarDays,
  Activity,
  Terminal,
  Radio,
} from 'lucide-react'

export default function BiometricosPage({ forcedSubview, layout = 'client' }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const {
    isSuperAdmin,
    currentTenant,
    tenants,
    currentTenantId,
    setSelectedTenantId,
    loadingTenants,
    requiresTenantAssignment,
  } = useCurrentTenant()

  const isCentral = layout === 'central' || location.pathname.startsWith('/central')
  const basePath = isCentral ? '/central/biometricos' : '/biometricos'

  const canDeleteDevice = isCentral && (isSuperAdmin || profile?.rol?.toLowerCase() === 'superadmin')
  const canRequestDevice = isSuperAdmin || profile?.rol?.toLowerCase() === 'admin'
  const [openDeviceRequest, setOpenDeviceRequest] = useState(false)
  const openNewDeviceRequest = () => {
    setOpenDeviceRequest(true)
    navigate(isCentral ? '/central/biometricos/solicitudes' : '/biometricos/dispositivos')
  }

  // Determinar subvista activa a partir de la URL
  const determineSubview = () => {
    if (forcedSubview) return forcedSubview
    const p = location.pathname
    if (p.includes('/solicitudes')) return 'requests'
    if (p.includes('/dispositivos')) return 'devices'
    if (p.includes('/colaboradores')) return 'colaboradores'
    if (p.includes('/asignaciones')) return 'asignaciones'
    if (p.includes('/asistencias') || p.includes('/logs') || p.includes('/historial')) return 'logs'
    if (isCentral && p.includes('/comandos')) return 'commands'
    if (isCentral && p.includes('/sincronizacion')) return 'sync'
    if (p.includes('/dashboard') || p.includes('/resumen')) return 'dashboard'
    return 'dashboard'
  }

  const [subview, setSubview] = useState(determineSubview)

  const {
    loading,
    refreshCurrentTab,
    activeTab,
    setActiveTab,

    // Dashboard
    stats,

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
    handleToggleDeviceActive,
    handleOpenDeviceDetail,

    // Logs
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

    // Sync Policy & Provisioning
    syncPolicy,
    changeSyncPolicy,
    employeesSyncData,
    handleSaveAssignment,
    handleDeactivateAssignment,
    handleSyncAssignmentNow
  } = useBiometrics(currentTenantId)

  // ── Sincronización de Terminales ZKTeco (Colaboradores y Hora) ────────────

  const handleSyncEmployeesForDevice = async (device) => {
    if (!device?.serial_number || !device?.id) return
    try {
      toast.loading('Sincronizando colaboradores con la terminal...', { id: 'sync-emp' })
      const res = await syncService.syncAllEmployeesToDevice({
        clienteId: currentTenantId,
        deviceSerial: device.serial_number,
        deviceId: device.id
      })
      toast.success(`Se encolaron ${res.total} colaboradores para sincronizar con ${device.name || device.serial_number}`, { id: 'sync-emp' })
      refreshCurrentTab()
    } catch (err) {
      console.error('[BiometricosPage] Error sincronizando colaboradores:', err)
      toast.error('Error al sincronizar colaboradores: ' + err.message, { id: 'sync-emp' })
    }
  }

  const handleSyncTimeForDevice = async (device) => {
    if (!device?.serial_number) return
    const targetTz = device.timezone || currentTenant?.timezone || 'America/Cancun'
    try {
      toast.loading('Sincronizando fecha y hora física con la terminal...', { id: 'sync-time' })
      const res = await syncService.syncDeviceTime({
        deviceSerial: device.serial_number,
        timezone: targetTz
      })
      toast.success(`Comando de sincronización de hora encolado (Zona: ${targetTz}, Offset: ${res.tzOffset}h)`, { id: 'sync-time' })
      refreshCurrentTab()
    } catch (err) {
      console.error('[BiometricosPage] Error sincronizando hora:', err)
      toast.error('Error al sincronizar hora: ' + err.message, { id: 'sync-time' })
    }
  }

  const [deviceToDelete, setDeviceToDelete] = useState(null)

  const confirmDeleteDevice = async () => {
    if (!deviceToDelete) return
    if (!canDeleteDevice) {
      toast.error('Acceso denegado: Solo el usuario Superadmin desde la consola Central puede eliminar terminales biométricas.')
      setDeviceToDelete(null)
      return
    }
    try {
      await handleDeleteDevice(deviceToDelete.id, deviceToDelete.name || deviceToDelete.serial_number)
    } finally {
      setDeviceToDelete(null)
    }
  }

  useEffect(() => {
    const nextView = determineSubview()
    setSubview(nextView)
    setActiveTab(nextView)
  }, [location.pathname, forcedSubview])

  const SUBVIEW_TITLES = {
    requests: { title: 'Solicitudes de biométricos', subtitle: 'Autorización de asociaciones por empresa' },
    dashboard: {
      title: 'Resumen Biométrico',
      subtitle: 'Indicadores generales del sistema de asistencia y terminales',
    },
    devices: {
      title: 'Dispositivos Biométricos',
      subtitle: isCentral
        ? 'Administración técnica de terminales y su estado de conexión ADMS'
        : 'Gestión y monitoreo de terminales de checado en tiempo real',
    },
    colaboradores: {
      title: 'Colaboradores & Provisión Biométrica',
      subtitle: 'Administración de usuarios enrolados en dispositivos biométricos',
    },
    asignaciones: {
      title: 'Asignaciones de Acceso Biométrico',
      subtitle: 'Panel de enrolamiento y vinculación (Colaborador ↔ Biométrico)',
    },
    logs: {
      title: 'Historial de Marcajes Biométricos',
      subtitle: 'Visor de checadas en tiempo real y logs consolidados de asistencia',
    },
    commands: {
      title: 'Cola de Comandos ADMS',
      subtitle: 'Instrucciones remotas pendientes de envío o confirmación de terminales',
    },
    sync: {
      title: 'Sincronización & Estado ADMS',
      subtitle: 'Monitoreo de políticas, reintentos y cola de aprovisionamiento',
    },
  }

  const [syncingAll, setSyncingAll] = useState(false)

  const handleSyncAllEmployees = async () => {
    if (!currentTenantId) {
      toast.error('Selecciona una empresa/cliente primero.')
      return
    }

    if (!devices || devices.length === 0) {
      toast.error('No hay checadores activos registrados para sincronizar.')
      return
    }

    setSyncingAll(true)
    const toastId = toast.loading('Encolando colaboradores a los checadores...')

    try {
      let totalEnqueued = 0

      // Encolar a todos los dispositivos activos del tenant
      for (const dev of devices) {
        if (!dev.is_active && dev.is_active !== undefined) continue
        
        const res = await syncService.syncAllEmployeesToDevice({
          clienteId: currentTenantId,
          deviceSerial: dev.serial_number,
          deviceId: dev.id
        })
        totalEnqueued += res.total || 0
      }

      toast.success(
        `¡Listo! Se encolaron ${totalEnqueued} comandos. Los checadores los descargarán progresivamente.`,
        { id: toastId }
      )
      refreshCurrentTab()
    } catch (err) {
      console.error(err)
      toast.error(`Error al sincronizar: ${err.message}`, { id: toastId })
    } finally {
      setSyncingAll(false)
    }
  }

  const ALL_SUBVIEW_TABS = [
    { key: 'dashboard', label: 'Resumen', path: 'dashboard', icon: LayoutDashboard },
    { key: 'devices', label: 'Dispositivos', path: 'dispositivos', icon: Cpu },
    { key: 'colaboradores', label: 'Colaboradores', path: 'colaboradores', icon: Users },
    { key: 'asignaciones', label: 'Asignaciones', path: 'asignaciones', icon: CalendarDays },
    { key: 'logs', label: 'Checadas', path: 'historial', icon: Activity },
    { key: 'commands', label: 'Comandos ADMS', path: 'comandos', icon: Terminal },
    { key: 'sync', label: 'Sincronización', path: 'sincronizacion', icon: Radio },
  ]

  // En vista cliente se ocultan las herramientas técnicas ADMS de servidor
  const SUBVIEW_TABS = isCentral
    ? ALL_SUBVIEW_TABS
    : ALL_SUBVIEW_TABS.filter((tab) => !['commands', 'sync'].includes(tab.key))

  const handleTabClick = (tabKey, tabPath) => {
    setSubview(tabKey)
    setActiveTab(tabKey)
    if (tabPath) {
      navigate(`${basePath}/${tabPath}`)
    }
  }

  const currentInfo = SUBVIEW_TITLES[subview] || SUBVIEW_TITLES.devices

  const pageContent = (
    <div className="space-y-6">
      {/* Banner de Asignación de Tenant (solo si aplica) */}
      {requiresTenantAssignment && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs sm:text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
        </div>
      )}

      {/* ── Barra Superior del Módulo ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#BDD9D7]/25 dark:bg-[#03363D]/30 border border-[#BDD9D7]/40 dark:border-[#03363D]/50 flex items-center justify-center text-[#03363D] dark:text-[#BDD9D7] flex-shrink-0 shadow-xs">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                {currentInfo.title}
              </h2>
              {isSuperAdmin && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  SuperAdmin
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {currentInfo.subtitle} {currentTenant?.nombre_empresa ? `— ${currentTenant.nombre_empresa}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isSuperAdmin && (
            <TenantSelector
              tenants={tenants}
              currentTenantId={currentTenantId}
              onSelectTenant={setSelectedTenantId}
              loading={loadingTenants}
            />
          )}

          {/* Botón Agregar Dispositivo (Estilo Signum Brand) */}
          {canRequestDevice && ['devices', 'requests'].includes(subview) && (
            <button
              onClick={openNewDeviceRequest}
              disabled={!currentTenantId}
              className="h-10 flex items-center gap-2 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-[#03363D] hover:bg-[#02252a] shadow-sm hover:shadow transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Agregar Dispositivo</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Barra de Pestañas (Solo en Consola Central si aplica) ── */}
      {isCentral && (
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/70 dark:bg-slate-800/40 rounded-2xl w-fit border border-slate-200/60 dark:border-slate-800 overflow-x-auto max-w-full no-scrollbar">
          {SUBVIEW_TABS.map((tab) => {
            const TabIcon = tab.icon
            const isActive = subview === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabClick(tab.key, tab.path)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#03363D] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-slate-700/50'
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Contenido de la Subvista Activa ──────────────────────────────── */}
      <div>
        {(subview === 'requests' || (!isCentral && subview === 'devices')) && (
          <div className="mb-6"><DeviceRegistrationRequests central={isCentral && isSuperAdmin}
            tenantId={currentTenantId} canRequest={canRequestDevice} openRequest={openDeviceRequest}
            onRequestOpened={() => setOpenDeviceRequest(false)} /></div>
        )}
        {subview === 'dashboard' && (
          <BiometricsDashboard
            stats={stats}
            loading={loading}
            onNavigateTab={(tab) => handleTabClick(tab, tab === 'logs' ? 'historial' : tab)}
            onOpenNewDevice={openNewDeviceRequest}
            onOpenSendCommand={(data) => setSendCommandModal(data || {})}
            onRefresh={refreshCurrentTab}
          />
        )}

        {subview === 'devices' && (
          <DevicesList
            devices={devices}
            loading={loading}
            search={deviceSearch}
            onSearchChange={setDeviceSearch}
            filterStatus={deviceFilterStatus}
            onFilterStatusChange={setDeviceFilterStatus}
            filterType={deviceFilterType}
            onFilterTypeChange={setDeviceFilterType}
            onOpenNewDevice={openNewDeviceRequest}
            onOpenEditDevice={(dev) => setDeviceModalForm(dev)}
            onOpenDeviceDetail={handleOpenDeviceDetail}
            onOpenSendCommand={(data) => setSendCommandModal(data)}
            onDeleteDevice={(dev) => {
              if (!canDeleteDevice) {
                toast.error('Acceso restringido: Solo el usuario Superadmin en el panel Central puede eliminar terminales.')
                return
              }
              setDeviceToDelete(dev)
            }}
            canDelete={canDeleteDevice}
            isCentral={isCentral}
            onRefresh={refreshCurrentTab}
            onSyncEmployees={handleSyncEmployeesForDevice}
            onSyncTime={handleSyncTimeForDevice}
          />
        )}

        {subview === 'colaboradores' && (
          <BiometricsEmployeesList
            loading={loading}
            syncData={employeesSyncData}
            onSyncNow={handleSyncAssignmentNow}
            onDeactivate={handleDeactivateAssignment}
            onRefresh={refreshCurrentTab}
          />
        )}

        {subview === 'asignaciones' && (
          <BiometricsAssignmentsManager
            loading={loading}
            syncData={employeesSyncData}
            onSaveAssignment={handleSaveAssignment}
            onDeactivateAssignment={handleDeactivateAssignment}
            onRefresh={refreshCurrentTab}
          />
        )}

        {subview === 'logs' && (
          <AttendanceLogsList
            logs={logs}
            loading={loading}
            search={logsSearch}
            onSearchChange={setLogsSearch}
            deviceFilter={logsDeviceFilter}
            onDeviceFilterChange={setLogsDeviceFilter}
            userFilter={logsUserFilter}
            onUserFilterChange={setLogsUserFilter}
            dateFrom={logsDateFrom}
            onDateFromChange={setLogsDateFrom}
            dateTo={logsDateTo}
            onDateToChange={setLogsDateTo}
            devicesCatalog={devicesCatalog}
            employeesCatalog={employeesCatalog}
            onRefresh={refreshCurrentTab}
          />
        )}

        {subview === 'commands' && (
          <DeviceCommandsList
            commands={commands}
            loading={loading}
            deviceFilter={commandDeviceFilter}
            onDeviceFilterChange={setCommandDeviceFilter}
            statusFilter={commandStatusFilter}
            onStatusFilterChange={setCommandStatusFilter}
            devicesCatalog={devicesCatalog}
            onOpenSendCommand={(data) => setSendCommandModal(data || {})}
            onToggleCommand={handleToggleCommand}
            onDeleteCommand={handleDeleteCommand}
            onRefresh={refreshCurrentTab}
          />
        )}

        {subview === 'sync' && (
          <BiometricsSyncMonitor
            devices={devices}
            stats={stats}
            loading={loading}
            policy={syncPolicy}
            onChangePolicy={changeSyncPolicy}
            syncData={employeesSyncData}
            commands={commands}
            commandDeviceFilter={commandDeviceFilter}
            onCommandDeviceFilterChange={setCommandDeviceFilter}
            commandStatusFilter={commandStatusFilter}
            onCommandStatusFilterChange={setCommandStatusFilter}
            devicesCatalog={devicesCatalog}
            onToggleCommand={handleToggleCommand}
            onDeleteCommand={handleDeleteCommand}
            onDeactivateAssignment={handleDeactivateAssignment}
            onSyncAssignmentNow={handleSyncAssignmentNow}
            onOpenSendCommand={(data) => setSendCommandModal(data || {})}
            onRefresh={refreshCurrentTab}
          />
        )}
      </div>

      {/* ── Modales ──────────────────────────────────────────────────────────── */}

      {/* Modal Crear / Editar Dispositivo */}
      {deviceModalForm && (
        <DeviceFormModal
          device={deviceModalForm}
          onClose={() => setDeviceModalForm(null)}
          onSave={handleSaveDevice}
        />
      )}

      {/* Modal Ficha Detalle Dispositivo */}
      {deviceDetailModal && (
        <DeviceDetailModal
          device={deviceDetailModal}
          onClose={() => setDeviceDetailModal(null)}
          onOpenSendCommand={(data) => {
            setDeviceDetailModal(null)
            setSendCommandModal(data)
          }}
          onSyncEmployees={handleSyncEmployeesForDevice}
          onSyncTime={handleSyncTimeForDevice}
          onRefresh={refreshCurrentTab}
        />
      )}

      {/* Modal Emitir Comando */}
      {sendCommandModal && (
        <SendCommandModal
          initialData={sendCommandModal}
          devicesCatalog={devicesCatalog.length > 0 ? devicesCatalog : devices}
          onClose={() => setSendCommandModal(null)}
          onSend={handleSendCommand}
        />
      )}

      {/* Diálogo Confirmar Eliminación de Dispositivo */}
      {deviceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  ¿Eliminar Terminal Biométrico?
                </h4>
                <span className="inline-block mt-0.5 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Exclusivo SuperAdmin Central
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2">
              <p>
                ¿Estás seguro de que deseas eliminar la terminal <strong className="text-slate-900 dark:text-white font-mono">{deviceToDelete.name || deviceToDelete.serial_number}</strong> (SN: {deviceToDelete.serial_number})?
              </p>
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] leading-relaxed">
                ✓ <strong>Preservación de checadas:</strong> Los registros de asistencia históricos de los colaboradores se mantendrán intactos.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setDeviceToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteDevice}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/25 transition-all"
              >
                Confirmar y Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (isCentral) {
    return <CentralLayout>{pageContent}</CentralLayout>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#0B132B] text-slate-900 dark:text-white">
      {/* ── Sidebar Global TailAdmin / Signum-Clock ── */}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* ── Content Area con Header ── */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* ── Header Global Idéntico a las demás páginas ── */}
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        {/* ── Main Content Container ── */}
        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          {pageContent}
        </main>
      </div>
    </div>
  )
}
