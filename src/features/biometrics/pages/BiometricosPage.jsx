// src/features/biometrics/pages/BiometricosPage.jsx
import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBiometrics } from '../hooks/useBiometrics'
import { useAuth } from '../../auth/hooks/useAuth'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { syncService } from '../services/syncService'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import toast, { Toaster } from 'react-hot-toast'
import BiometricsDashboard from '../components/BiometricsDashboard'
import DevicesList from '../components/DevicesList'
import DeviceDetailModal from '../components/DeviceDetailModal'
import DeviceFormModal from '../components/DeviceFormModal'
import AttendanceLogsList from '../components/AttendanceLogsList'
import DeviceCommandsList from '../components/DeviceCommandsList'
import BiometricsSyncMonitor from '../components/BiometricsSyncMonitor'
import SendCommandModal from '../components/SendCommandModal'
import BiometricsEmployeesList from '../components/BiometricsEmployeesList'
import BiometricsAssignmentsManager from '../components/BiometricsAssignmentsManager'
import { Cpu, Plus, Send, AlertTriangle, RefreshCw } from 'lucide-react'

export default function BiometricosPage({ forcedSubview }) {
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

  const canMutate = ['admin', 'rh', 'superadmin'].includes(profile?.rol?.toLowerCase())

  // Determinar subvista activa a partir de la URL
  const determineSubview = () => {
    if (forcedSubview) return forcedSubview
    const p = location.pathname
    if (p.includes('/dispositivos')) return 'devices'
    if (p.includes('/colaboradores')) return 'colaboradores'
    if (p.includes('/asignaciones')) return 'asignaciones'
    if (p.includes('/asistencias') || p.includes('/logs') || p.includes('/historial')) return 'logs'
    if (p.includes('/comandos')) return 'commands'
    if (p.includes('/sincronizacion')) return 'sync'
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

  const [deviceToDelete, setDeviceToDelete] = useState(null)

  const confirmDeleteDevice = async () => {
    if (!deviceToDelete) return
    await handleDeleteDevice(deviceToDelete.id, deviceToDelete.name || deviceToDelete.serial_number)
    setDeviceToDelete(null)
  }

  useEffect(() => {
    const nextView = determineSubview()
    setSubview(nextView)
    setActiveTab(nextView)
  }, [location.pathname, forcedSubview])

  const SUBVIEW_TITLES = {
    dashboard: {
      title: 'Resumen Biométrico',
      subtitle: 'Indicadores generales del sistema de asistencia',
    },
    devices: {
      title: 'Dispositivos Biométricos',
      subtitle: 'Administración de terminales y su estado de conexión ADMS',
    },
    colaboradores: {
      title: 'Colaboradores & Provisión Biométrica',
      subtitle: 'Administración de usuarios enrolados en dispositivos biométricos',
    },
    asignaciones: {
      title: 'Asignaciones de Acceso Biométrico',
      subtitle: 'Panel de enrolamiento bidireccional (Colaborador ↔ Biométrico)',
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

  const currentInfo = SUBVIEW_TITLES[subview] || SUBVIEW_TITLES.devices

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#0B132B] text-slate-900 dark:text-white">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      {/* ── Sidebar Global TailAdmin / Signum-Clock ── */}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* ── Content Area con Header ── */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* ── Header Global Idéntico a las demás páginas ── */}
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        {/* ── Main Content Container ── */}
        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          {/* Banner de Asignación de Tenant (solo si aplica) */}
          {requiresTenantAssignment && (
            <div className="flex items-center gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
            </div>
          )}

          {/* ── Barra Superior del Módulo ────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
                  <Cpu className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  {currentInfo.title}
                </h2>
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    SuperAdmin
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                {currentInfo.subtitle} {currentTenant?.nombre_empresa ? `— ${currentTenant.nombre_empresa}` : ''}
              </p>
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

              {canMutate && subview === 'devices' && (
                <button
                  onClick={() => setDeviceModalForm('nuevo')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Registrar Dispositivo</span>
                </button>
              )}
            </div>
          </div>

          {/* ── Contenido de la Subvista Activa ──────────────────────────────── */}
          <div>

            {subview === 'dashboard' && (
              <BiometricsDashboard
                stats={stats}
                loading={loading}
                onNavigateTab={(tab) => navigate(`/biometricos/${tab === 'logs' ? 'historial' : tab}`)}
                onOpenNewDevice={() => setDeviceModalForm('nuevo')}
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
                onOpenNewDevice={() => setDeviceModalForm('nuevo')}
                onOpenEditDevice={(dev) => setDeviceModalForm(dev)}
                onOpenDeviceDetail={handleOpenDeviceDetail}
                onOpenSendCommand={(data) => setSendCommandModal(data)}
                onDeleteDevice={(dev) => setDeviceToDelete(dev)}
                onRefresh={refreshCurrentTab}
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
        </main>
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
          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  ¿Eliminar Terminal?
                </h4>
                <p className="text-xs text-slate-500">
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              ¿Estás seguro de que deseas eliminar la terminal <strong className="text-slate-900 dark:text-white font-mono">{deviceToDelete.name || deviceToDelete.serial_number}</strong> (SN: {deviceToDelete.serial_number})?
            </p>

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
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
