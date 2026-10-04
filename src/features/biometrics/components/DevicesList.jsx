import { useState, useEffect, useRef } from 'react'
import {
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
  Power,
  MoreVertical,
  Smartphone,
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

function DeviceActionMenu({
  device,
  isCentral,
  canDelete,
  onOpenEditDevice,
  onOpenDeviceDetail,
  onOpenSendCommand,
  onSyncEmployees,
  onSyncTime,
  onDeleteDevice,
  isOpen,
  onToggle,
  onClose,
  menuRef,
  dropUp = false,
}) {
  return (
    <div className="relative inline-block text-left" ref={isOpen ? menuRef : null}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className="p-1.5 sm:p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[#03363D]/20 flex items-center justify-center"
        title="Opciones de terminal"
        aria-label="Opciones"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute right-0 ${
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } w-52 sm:w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-left`}
        >
          {/* Ver información y biometría (disponible para todos) */}
          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenDeviceDetail && onOpenDeviceDetail(device)
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Eye className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <span>Ver información del checador</span>
          </button>

          {/* Opción exclusiva de Central: Enviar comando ADMS manual */}
          {isCentral && (
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenSendCommand && onOpenSendCommand({ device_serial: device.serial_number })
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Send className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>Enviar comando ADMS</span>
            </button>
          )}

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          {/* Opciones disponibles tanto en Cliente como en Central */}
          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenEditDevice && onOpenEditDevice(device)
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Edit3 className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span>Editar terminal</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          {onSyncEmployees && (
            <button
              type="button"
              onClick={() => {
                onClose()
                onSyncEmployees(device)
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <UserCheck className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span>Sincronizar colaboradores</span>
            </button>
          )}

          {onSyncTime && (
            <button
              type="button"
              onClick={() => {
                onClose()
                onSyncTime(device)
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span>Sincronizar fecha y hora</span>
            </button>
          )}

          {/* Solo Superadmin Central */}
          {canDelete && (
            <>
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onDeleteDevice && onDeleteDevice(device)
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4 text-rose-500 flex-shrink-0" />
                <span>Eliminar terminal</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
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
  canDelete = false,
  isCentral = false,
  onRefresh,
  onSyncEmployees,
  onSyncTime,
}) {
  const [openMenuId, setOpenMenuId] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null)
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenMenuId(null)
      }
    }
    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuId])
  return (
    <div className="space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar por nombre o número de serie..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-[#03363D] focus:ring-2 focus:ring-[#03363D]/10 transition-all"
            />
          </div>
          <span className="hidden sm:inline-flex text-[11px] font-medium text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 whitespace-nowrap">
            {devices.length} {devices.length === 1 ? 'terminal' : 'terminales'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onFilterTypeChange && (
            <select
              value={filterType}
              onChange={(e) => onFilterTypeChange(e.target.value)}
              className="h-10 py-2 px-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 outline-none focus:border-[#03363D] cursor-pointer transition-all"
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
            className="h-10 py-2 px-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 outline-none focus:border-[#03363D] cursor-pointer transition-all"
          >
            <option value="todos">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="h-10 flex items-center gap-1.5 px-3.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* ── Tabla Desktop/Tablet ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hidden md:block overflow-visible shadow-xs">
        <table className="w-full text-left table-fixed">
          <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              <th className="px-5 py-3.5 w-[21%]">Terminal / Dispositivo</th>
              <th className="px-4 py-3.5 w-[16%]">Tipo</th>
              <th className="px-4 py-3.5 w-[18%]">Ubicación</th>
              <th className="px-4 py-3.5 w-[17%]">Colaboradores</th>
              <th className="px-4 py-3.5 w-[17%]">Estado &amp; Conexión</th>
              <th className="px-4 py-3.5 w-[11%] text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-14">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-400">Cargando terminales...</p>
                  </div>
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-14">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <HardDrive className="w-9 h-9 text-slate-200 dark:text-slate-700" />
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Sin terminales registradas</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Agrega tu primer biométrico para comenzar</p>
                  </div>
                </td>
              </tr>
            ) : (
              devices.map((d, index) => {
                const statusKey = getDeviceStatus(d)
                const status = STATUS_CONFIG[statusKey]
                const typeInfo = TYPE_CONFIG[d.device_type] || TYPE_CONFIG.general
                const TypeIcon = typeInfo.icon

                return (
                  <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/20 transition-colors duration-150">

                    {/* 1. Terminal / Dispositivo */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3.5">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${status.badge} border`}>
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight truncate">
                            {d.name || 'Terminal sin nombre'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/70 dark:border-slate-700/60 truncate">
                              SN: {d.serial_number}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* 2. Tipo */}
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border whitespace-nowrap ${typeInfo.badge}`}>
                        <TypeIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{typeInfo.label}</span>
                      </span>
                    </td>

                    {/* 3. Ubicación */}
                    <td className="px-4 py-4">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                          {d.location
                            ? <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[130px]">{d.location}</span>
                            : <span className="text-xs font-normal text-slate-400">Sin ubicación</span>
                          }
                        </div>
                        {d.timezone && (
                          <div className="flex items-center gap-1 pl-5">
                            <Globe className="w-3 h-3 text-slate-300 dark:text-slate-600 flex-shrink-0" />
                            <span className="text-[10px] text-slate-400 truncate">
                              {d.timezone.replace('America/', '')}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* 4. Colaboradores */}
                    <td className="px-4 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white leading-none">
                            {d.syncStats?.total || 0}
                          </span>
                          <span className="text-[11px] font-medium text-slate-400">asignados</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                            {d.syncStats?.synced || 0} sync
                          </span>
                          {(d.syncStats?.pending > 0) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                              {d.syncStats.pending} pend.
                            </span>
                          )}
                          {(d.syncStats?.error > 0) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                              {d.syncStats.error} err.
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 5. Estado & Conexión */}
                    <td className="px-4 py-4">
                      <div className="space-y-1.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap ${status.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot} flex-shrink-0`} />
                          {status.label}
                        </span>
                        <div className="flex items-center gap-1 pl-0.5">
                          <Clock className="w-3 h-3 text-slate-300 dark:text-slate-600 flex-shrink-0" />
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                            {formatActivity(d.last_activity)}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 6. Acciones */}
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenDeviceDetail && onOpenDeviceDetail(d)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 bg-slate-100/80 hover:bg-blue-50/80 dark:bg-slate-800 dark:hover:bg-blue-900/30 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                          title="Ver información del dispositivo y biometría"
                        >
                          <Eye className="w-3.5 h-3.5 text-blue-500" />
                          <span>Ver</span>
                        </button>
                        <DeviceActionMenu
                          device={d}
                          isCentral={isCentral}
                          canDelete={canDelete}
                          onOpenEditDevice={onOpenEditDevice}
                          onOpenDeviceDetail={onOpenDeviceDetail}
                          onOpenSendCommand={onOpenSendCommand}
                          onSyncEmployees={onSyncEmployees}
                          onSyncTime={onSyncTime}
                          onDeleteDevice={onDeleteDevice}
                          isOpen={openMenuId === `desktop-${d.id}`}
                          onToggle={() => setOpenMenuId(openMenuId === `desktop-${d.id}` ? null : `desktop-${d.id}`)}
                          onClose={() => setOpenMenuId(null)}
                          menuRef={menuRef}
                          dropUp={index >= devices.length - 2 && devices.length > 2}
                        />
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
          devices.map((d, index) => {
            const statusKey = getDeviceStatus(d)
            const status = STATUS_CONFIG[statusKey]
            const typeInfo = TYPE_CONFIG[d.device_type] || TYPE_CONFIG.general
            const TypeIcon = typeInfo.icon

            return (
              <div key={d.id} className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Header card */}
                <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${typeInfo.badge} border`}>
                      <TypeIcon className="w-4 h-4" />
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
                    <UserCheck className="w-3.5 h-3.5 text-[#03363D] dark:text-teal-400 flex-shrink-0" />
                    <span>{d.syncStats?.total || 0} asignados</span>
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {d.syncStats?.synced || 0} sync
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onOpenDeviceDetail && onOpenDeviceDetail(d)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 flex items-center gap-1 transition-colors cursor-pointer"
                      title="Ver información del checador"
                    >
                      <Eye className="w-3 h-3 text-blue-500" />
                      Ver
                    </button>
                    <button
                      onClick={() => onSyncEmployees && onSyncEmployees(d)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#03363D] dark:text-teal-300 bg-[#BDD9D7]/20 border border-[#BDD9D7]/40 hover:bg-[#BDD9D7]/30 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Sync
                    </button>
                    <button
                      onClick={() => onSyncTime && onSyncTime(d)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 flex items-center gap-1 transition-colors cursor-pointer"
                      title="Sincronizar hora"
                    >
                      <Clock className="w-3 h-3" />
                      Hora
                    </button>
                  </div>
                </div>

                {/* Actions agrupadas en botón de 3 puntos */}
                <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${status.dot} flex-shrink-0`} />
                    <span className="font-medium text-slate-600 dark:text-slate-400">
                      {status.label}
                    </span>
                  </div>

                  <DeviceActionMenu
                    device={d}
                    isCentral={isCentral}
                    canDelete={canDelete}
                    onOpenEditDevice={onOpenEditDevice}
                    onOpenDeviceDetail={onOpenDeviceDetail}
                    onOpenSendCommand={onOpenSendCommand}
                    onSyncEmployees={onSyncEmployees}
                    onSyncTime={onSyncTime}
                    onDeleteDevice={onDeleteDevice}
                    isOpen={openMenuId === `mobile-${d.id}`}
                    onToggle={() => setOpenMenuId(openMenuId === `mobile-${d.id}` ? null : `mobile-${d.id}`)}
                    onClose={() => setOpenMenuId(null)}
                    menuRef={menuRef}
                    dropUp={index >= devices.length - 2 && devices.length > 2}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
