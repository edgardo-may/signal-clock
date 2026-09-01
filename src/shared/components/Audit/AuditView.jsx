// src/shared/components/Audit/AuditView.jsx — Componente unificado de Auditoría
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  ShieldCheck, Search, Filter, RefreshCw, ChevronLeft, ChevronRight,
  Eye, X, AlertCircle, CheckCircle2, XCircle, Info, Lock, Clock
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default function AuditView({ scope = 'central' }) {
  const [logs, setLogs] = useState([])
  const [usersMap, setUsersMap] = useState({})
  const [tenantsMap, setTenantsMap] = useState({})
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterTenant, setFilterTenant] = useState('todos')
  const [filterAction, setFilterAction] = useState('todos')
  const [filterResult, setFilterResult] = useState('todos')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const pageSize = 50

  // Modal
  const [selectedLog, setSelectedLog] = useState(null)

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset page on new search
    }, 500)
    return () => clearTimeout(handler)
  }, [search])

  const fetchReferenceData = async () => {
    try {
      const promises = [
        supabase.from('usuarios_perfiles').select('id, nombre, email, rol')
      ]
      
      if (scope === 'central') {
        promises.push(supabase.from('clientes').select('id, nombre_empresa, nombre_comercial'))
      }

      const results = await Promise.all(promises)
      const users = results[0].data
      const tenants = scope === 'central' ? results[1]?.data : []

      const uMap = {}
      users?.forEach(u => uMap[u.id] = u)
      setUsersMap(uMap)

      const tMap = {}
      tenants?.forEach(t => tMap[t.id] = t)
      setTenantsMap(tMap)
    } catch (err) {
      console.error('Error fetching references:', err)
    }
  }

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (scope === 'central' && filterTenant !== 'todos') {
        if (filterTenant === 'global') query = query.is('cliente_id', null)
        else query = query.eq('cliente_id', filterTenant)
      }

      if (filterAction !== 'todos') {
        query = query.eq('action', filterAction)
      }

      if (filterResult !== 'todos') {
        query = query.eq('result', filterResult)
      }

      if (filterDateFrom) {
        query = query.gte('created_at', new Date(filterDateFrom).toISOString())
      }

      if (filterDateTo) {
        const toDate = new Date(filterDateTo)
        toDate.setHours(23, 59, 59, 999)
        query = query.lte('created_at', toDate.toISOString())
      }

      if (debouncedSearch) {
        query = query.or(`action.ilike.%${debouncedSearch}%,resource_id.ilike.%${debouncedSearch}%,ip_address.ilike.%${debouncedSearch}%`)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, count, error } = await query

      if (error) throw error

      setLogs(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('[CentralAuditPage] Error:', err)
      toast.error('Error al cargar logs de auditoría: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [page, filterTenant, filterAction, filterResult, filterDateFrom, filterDateTo, debouncedSearch])

  useEffect(() => {
    fetchReferenceData().then(() => fetchLogs())
  }, []) // Initial load

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const formatAction = (action) => {
    const actions = {
      'USER_CREATED': 'Usuario creado',
      'DEVICE_REGISTERED': 'Dispositivo registrado',
      'DEVICE_DISABLED': 'Dispositivo deshabilitado',
      'ROLE_CHANGED': 'Rol modificado',
      'SECURITY_DENIED': 'Acceso rechazado',
      'RATE_LIMIT_TRIGGERED': 'Límite de solicitudes',
      'SCHEDULE_CREATED': 'Horario creado',
      'SCHEDULE_UPDATED': 'Horario modificado',
      'SCHEDULE_DELETED': 'Horario eliminado',
      'SCHEDULE_ASSIGNED': 'Horario asignado',
      'SCHEDULE_UNASSIGNED': 'Horario retirado',
      'EMPLOYEE_CREATED': 'Empleado creado',
      'EMPLOYEE_UPDATED': 'Empleado modificado',
      'EMPLOYEE_DEACTIVATED': 'Empleado desactivado',
      'EMPLOYEE_REACTIVATED': 'Empleado reactivado'
    }
    return actions[action] || action
  }

  const maskSensitiveData = (metadata) => {
    if (!metadata) return null
    const masked = JSON.parse(JSON.stringify(metadata)) // Deep copy
    const sensitiveKeys = ['password', 'token', 'authorization', 'apikey', 'service_role', 'refresh_token', 'secret']
    
    const recurse = (obj) => {
      if (!obj || typeof obj !== 'object') return
      Object.keys(obj).forEach(key => {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          obj[key] = '********'
        } else if (typeof obj[key] === 'object') {
          recurse(obj[key])
        }
      })
    }
    recurse(masked)
    return masked
  }

  const renderResultBadge = (result) => {
    if (!result) return <span className="text-slate-400">—</span>
    const r = result.toUpperCase()
    if (r === 'SUCCESS') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"><CheckCircle2 className="w-3 h-3"/> Exitoso</span>
    if (r === 'DENIED') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/10 text-orange-600 border border-orange-500/20"><AlertCircle className="w-3 h-3"/> Rechazado</span>
    if (r === 'ERROR') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 border border-red-500/20"><XCircle className="w-3 h-3"/> Error</span>
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/10 text-slate-600 border border-slate-500/20">{r}</span>
  }

  const uniqueActions = useMemo(() => {
    // In a real app we might fetch distinct actions from the DB, but for MVP we hardcode the known ones + any loaded ones
    const base = [
      'USER_CREATED', 'DEVICE_REGISTERED', 'DEVICE_DISABLED', 'ROLE_CHANGED', 'SECURITY_DENIED',
      'SCHEDULE_CREATED', 'SCHEDULE_UPDATED', 'SCHEDULE_DELETED', 'SCHEDULE_ASSIGNED', 'SCHEDULE_UNASSIGNED',
      'EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'EMPLOYEE_DEACTIVATED', 'EMPLOYEE_REACTIVATED'
    ]
    logs.forEach(l => { if (!base.includes(l.action)) base.push(l.action) })
    return base
  }, [logs])

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#03363D] rounded-lg">
              <ShieldCheck className="w-6 h-6 text-[#BDD9D7]" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Auditoría de Seguridad
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-550 dark:text-slate-400 mt-1">
            Registro inmutable de eventos del sistema e intentos de acceso
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white transition-all bg-[#03363D] border border-transparent rounded-lg hover:bg-[#022429] focus:ring-2 focus:ring-[#BDD9D7] focus:ring-offset-1"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      <div className="mt-6 flex flex-col xl:flex-row gap-4">
        {/* Filters Sidebar */}
        <div className="w-full xl:w-64 flex-shrink-0 flex flex-col gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filtros
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Búsqueda</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Acción, Recurso, IP..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-[#BDD9D7]"
                  />
                </div>
              </div>

              {scope === 'central' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Cliente / Tenant</label>
                  <select
                    value={filterTenant}
                    onChange={e => { setFilterTenant(e.target.value); setPage(1); }}
                    className="w-full px-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-[#BDD9D7]"
                  >
                    <option value="todos">Todos los clientes</option>
                    <option value="global">Acciones Globales</option>
                    {Object.values(tenantsMap).map(t => (
                      <option key={t.id} value={t.id}>{t.nombre_comercial || t.nombre_empresa}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Acción</label>
                <select
                  value={filterAction}
                  onChange={e => { setFilterAction(e.target.value); setPage(1); }}
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-[#BDD9D7]"
                >
                  <option value="todos">Todas las acciones</option>
                  {uniqueActions.map(a => (
                    <option key={a} value={a}>{formatAction(a)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Resultado</label>
                <select
                  value={filterResult}
                  onChange={e => { setFilterResult(e.target.value); setPage(1); }}
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-[#BDD9D7]"
                >
                  <option value="todos">Todos</option>
                  <option value="SUCCESS">Exitoso</option>
                  <option value="DENIED">Rechazado</option>
                  <option value="ERROR">Error</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Desde</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
                    className="w-full px-2 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-[#BDD9D7]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Hasta</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
                    className="w-full px-2 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-[#BDD9D7]"
                  />
                </div>
              </div>
              
              {(filterTenant !== 'todos' || filterAction !== 'todos' || filterResult !== 'todos' || filterDateFrom || filterDateTo || search) && (
                <button
                  onClick={() => {
                    setFilterTenant('todos')
                    setFilterAction('todos')
                    setFilterResult('todos')
                    setFilterDateFrom('')
                    setFilterDateTo('')
                    setSearch('')
                    setPage(1)
                  }}
                  className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 py-1"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table Area */}
        <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col min-w-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3 font-semibold text-slate-500">Fecha / Hora</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Actor</th>
                  {scope === 'central' && <th className="px-4 py-3 font-semibold text-slate-500">Cliente</th>}
                  <th className="px-4 py-3 font-semibold text-slate-500">Acción</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Recurso</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Resultado</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-center">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading && logs.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-12 text-center text-slate-500">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                      Cargando registros...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={scope === 'central' ? 7 : 6} className="px-4 py-12 text-center text-slate-500">
                      <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-700" />
                      <p className="text-base font-semibold text-slate-700 dark:text-slate-300">No hay eventos de auditoría</p>
                      <p className="text-sm mt-1">Prueba cambiando los filtros seleccionados.</p>
                    </td>
                  </tr>
                ) : (
                  logs.map(log => {
                    const actor = log.actor_user_id ? usersMap[log.actor_user_id] : null
                    const tenant = log.cliente_id ? tenantsMap[log.cliente_id] : null
                    
                    return (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {format(new Date(log.created_at), 'dd MMM yyyy', { locale: es })}
                            </span>
                            <span className="text-xs text-slate-500">
                              {format(new Date(log.created_at), 'HH:mm')}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {actor ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-900 dark:text-slate-100">{actor.nombre}</span>
                              <span className="text-[10px] text-slate-500">{log.actor_role || actor.rol}</span>
                            </div>
                          ) : log.actor_user_id ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-600 dark:text-slate-400">Usuario no disponible</span>
                              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]">{log.actor_user_id}</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">Sistema</span>
                          )}
                        </td>
                        {scope === 'central' && (
                          <td className="px-4 py-3">
                            {tenant ? (
                              <span className="font-medium text-slate-700 dark:text-slate-300">{tenant.nombre_comercial || tenant.nombre_empresa}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Global</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800 dark:text-slate-200">{formatAction(log.action)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{log.resource_type}</span>
                            <span className="text-xs text-slate-600 dark:text-slate-400 font-mono truncate max-w-[150px]" title={log.resource_id}>
                              {log.resource_id || '-'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {renderResultBadge(log.result)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="p-1.5 text-slate-400 hover:text-[#03363D] hover:bg-[#BDD9D7]/30 rounded-lg transition-colors"
                            title="Ver detalle"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalCount > 0 && (
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/50">
              <span className="text-xs text-slate-500">
                Mostrando {((page - 1) * pageSize) + 1} a {Math.min(page * pageSize, totalCount)} de {totalCount} registros
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded disabled:opacity-50"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm font-medium px-2 text-slate-700 dark:text-slate-300">
                  Página {page}
                </span>
                <button
                  disabled={page * pageSize >= totalCount}
                  onClick={() => setPage(p => p + 1)}
                  className="p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded disabled:opacity-50"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-500" />
                Detalle del Evento
              </h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto no-scrollbar flex-1 space-y-6">
              {/* Header Info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Fecha</label>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {format(new Date(selectedLog.created_at), 'dd MMM yyyy HH:mm:ss', { locale: es })}
                  </p>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Acción</label>
                  <p className="text-sm font-bold text-[#03363D] dark:text-[#BDD9D7]">
                    {formatAction(selectedLog.action)}
                  </p>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Resultado</label>
                  <div className="mt-1">{renderResultBadge(selectedLog.result)}</div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">IP Origen</label>
                  <p className="text-sm font-mono text-slate-700 dark:text-slate-300">{selectedLog.ip_address || 'N/A'}</p>
                </div>
              </div>

              <div className="h-px bg-slate-200 dark:bg-slate-800" />

              {/* Context Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Lock className="w-3 h-3" /> Contexto Actor
                  </h4>
                  <div className="space-y-1">
                    <p className="text-sm"><span className="text-slate-500">ID:</span> <span className="font-mono text-xs">{selectedLog.actor_user_id || 'N/A'}</span></p>
                    <p className="text-sm"><span className="text-slate-500">Rol Reportado:</span> {selectedLog.actor_role || 'N/A'}</p>
                    {scope === 'central' && (
                      <p className="text-sm"><span className="text-slate-500">Tenant ID:</span> <span className="font-mono text-xs">{selectedLog.cliente_id || 'GLOBAL'}</span></p>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <ShieldCheck className="w-3 h-3" /> Recurso Afectado
                  </h4>
                  <div className="space-y-1">
                    <p className="text-sm"><span className="text-slate-500">Tipo:</span> {selectedLog.resource_type}</p>
                    <p className="text-sm"><span className="text-slate-500">ID:</span> <span className="font-mono text-xs">{selectedLog.resource_id || 'N/A'}</span></p>
                  </div>
                </div>
              </div>

              {/* Metadata JSON */}
              {selectedLog.metadata && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Metadata Adicional</h4>
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4 overflow-x-auto">
                    <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {JSON.stringify(maskSensitiveData(selectedLog.metadata), null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-right">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
              >
                Cerrar Detalles
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
