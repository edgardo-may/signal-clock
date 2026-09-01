// src/central/pages/CentralSyncPage.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import CentralLayout from '../components/CentralLayout'
import toast, { Toaster } from 'react-hot-toast'
import { Users, Eye, Play, Loader2, AlertTriangle } from 'lucide-react'

// ── Llamada al backend proxy ──────────────────────────────────────────────────
async function callSyncApi(endpoint, body = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sin sesión activa')

  const response = await fetch(`/api/sync/${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await response.text()
  let data
  try { data = JSON.parse(rawText) } catch {
    throw new Error(`Error de comunicación con el servidor (status ${response.status}). Verifica que el servidor backend esté corriendo.`)
  }
  if (!response.ok || !data.ok) throw new Error(data.error || `Error ${response.status}`)
  return data
}

function getDefaultDates() {
  const now = new Date()
  const inicio = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const fin = now.toISOString().slice(0, 10)
  return { inicio, fin }
}

function AccionBadge({ accion }) {
  const config = {
    crear:        { label: 'Nuevo',         className: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' },
    actualizar:   { label: 'Actualizar',    className: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800' },
    sin_cambios:  { label: 'Sin cambios',   className: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700' },
  }[accion] || { label: accion, className: 'bg-slate-100 text-slate-500' }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${config.className}`}>
      {config.label}
    </span>
  )
}

export default function CentralSyncPage() {
  const defaults = getDefaultDates()
  const [fechaInicio, setFechaInicio] = useState(defaults.inicio)
  const [fechaFin, setFechaFin] = useState(defaults.fin)
  const [targetClienteId, setTargetClienteId] = useState('')
  const [clientes, setClientes] = useState([])
  const [loadingClientes, setLoadingClientes] = useState(true)
  
  const [loadingBulkPreview, setLoadingBulkPreview] = useState(false)
  const [loadingBulkSync, setLoadingBulkSync] = useState(false)
  const [bulkPreview, setBulkPreview] = useState(null)
  const [bulkSyncResult, setBulkSyncResult] = useState(null)
  const [bulkErroresList, setBulkErroresList] = useState([])
  
  const isAnyLoading = loadingBulkPreview || loadingBulkSync

  useEffect(() => {
    async function fetchClientes() {
      try {
        const { data, error } = await supabase
          .from('clientes')
          .select('id, nombre_empresa, id_empresa')
          .eq('estatus', 'activo')
          .order('nombre_empresa')
        
        if (error) throw error
        setClientes(data || [])
        if (data && data.length > 0) {
          setTargetClienteId(data[0].id)
        }
      } catch (err) {
        toast.error('Error al cargar empresas')
      } finally {
        setLoadingClientes(false)
      }
    }
    fetchClientes()
  }, [])

  async function handleBulkPreview() {
    if (!targetClienteId) return toast.error('Selecciona una empresa')
    if (!fechaInicio || !fechaFin) return toast.error('Selecciona el rango de fechas')
    setLoadingBulkPreview(true)
    setBulkPreview(null)
    setBulkSyncResult(null)
    setBulkErroresList([])

    try {
      const result = await callSyncApi('preview', { fechaInicio, fechaFin, targetClienteId })
      setBulkPreview(result)
      if (result.consultados === 0) {
        toast('No se encontraron colaboradores en ese rango de fechas', { icon: '⚠️' })
      } else {
        toast.success(`${result.consultados} colaboradores consultados`)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoadingBulkPreview(false)
    }
  }

  async function handleBulkSync() {
    if (!targetClienteId) return toast.error('Selecciona una empresa')
    if (!fechaInicio || !fechaFin) return toast.error('Selecciona el rango de fechas')
    const confirmMsg = bulkPreview
      ? `Se crearán ${bulkPreview.nuevos} y actualizarán ${bulkPreview.actualizados} colaboradores. ¿Continuar?`
      : '¿Ejecutar sincronización?'

    if (!window.confirm(confirmMsg)) return

    setLoadingBulkSync(true)
    setBulkSyncResult(null)
    setBulkErroresList([])

    try {
      const result = await callSyncApi('execute', { fechaInicio, fechaFin, targetClienteId })
      setBulkSyncResult(result)
      if (result.erroresList && result.erroresList.length > 0) {
        setBulkErroresList(result.erroresList)
        toast.error(`Sincronización completada con ${result.errores} errores`)
      } else {
        toast.success(`Sincronización masiva completada exitosamente`)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoadingBulkSync(false)
    }
  }

  return (
    <CentralLayout>
      <Toaster position="top-right" />
      <div className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-300">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Sincronización Global</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-2xl">
              Sincroniza el padrón completo de colaboradores (altas, bajas y actualizaciones) con la plataforma externa Consolide.
            </p>
          </div>
        </header>

        <div className="rounded-xl border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#1c2434] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2e3a4e] bg-slate-50 dark:bg-[#24303f]">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-500" /> Sincronización Masiva por Fechas
            </h3>
          </div>
          <div className="p-5 space-y-6">
            
            {/* Empresa Selector */}
            <div className="max-w-2xl">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                Empresa (Tenant) <span className="text-indigo-500">*</span>
              </label>
              <select
                value={targetClienteId}
                onChange={e => setTargetClienteId(e.target.value)}
                disabled={isAnyLoading || loadingClientes}
                className="w-full py-2.5 px-3 text-sm rounded-lg border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#24303f] focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all disabled:opacity-50"
              >
                <option value="" disabled>Selecciona una empresa...</option>
                {clientes.map(cli => (
                  <option key={cli.id} value={cli.id}>
                    {cli.nombre_empresa} {cli.id_empresa ? `(ID: ${cli.id_empresa})` : '(Sin ID configurado)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Fecha Inicio <span className="text-indigo-500">*</span>
                </label>
                <input
                  type="date"
                  value={fechaInicio}
                  onChange={e => setFechaInicio(e.target.value)}
                  disabled={isAnyLoading}
                  className="w-full py-2.5 px-3 text-sm rounded-lg border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#24303f] focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Fecha Fin <span className="text-indigo-500">*</span>
                </label>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={e => setFechaFin(e.target.value)}
                  disabled={isAnyLoading}
                  className="w-full py-2.5 px-3 text-sm rounded-lg border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#24303f] focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all disabled:opacity-50"
                />
              </div>
            </div>

            {/* Acciones */}
            <div className="flex gap-3">
              <button
                onClick={handleBulkPreview}
                disabled={isAnyLoading}
                className="flex justify-center items-center gap-1.5 px-6 py-2.5 text-sm font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
              >
                {loadingBulkPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Consultar (Vista Previa)
              </button>
              <button
                onClick={handleBulkSync}
                disabled={isAnyLoading || !bulkPreview}
                className="flex justify-center items-center gap-1.5 px-6 py-2.5 text-sm font-bold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-500/20 transition-all disabled:opacity-50"
              >
                {loadingBulkSync ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Ejecutar Sincronización
              </button>
            </div>

            {/* Resultados y Preview */}
            {bulkPreview && (
              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-[#2e3a4e] space-y-4">
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Consultados', value: bulkPreview.consultados, color: 'text-slate-700 dark:text-slate-200' },
                    { label: 'Por crear',   value: bulkPreview.nuevos,      color: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Por actualizar', value: bulkPreview.actualizados, color: 'text-amber-600 dark:text-amber-400' },
                    { label: 'Sin cambios', value: bulkPreview.sinCambios,  color: 'text-slate-500 dark:text-slate-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-xl bg-slate-50 dark:bg-[#24303f] p-3 text-center border border-slate-200 dark:border-[#2e3a4e]">
                      <p className={`text-xl font-black ${color}`}>{value}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                    </div>
                  ))}
                </div>

                {bulkPreview.preview?.length > 0 && (
                  <div className="rounded-xl border border-slate-200 dark:border-[#2e3a4e] overflow-hidden">
                    <div className="max-h-80 overflow-y-auto">
                      <table className="w-full table-auto text-sm">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-[#24303f] shadow-sm">
                          <tr>
                            {['ID Externo', 'Nombre', 'Departamento', 'Puesto', 'Estatus', 'Acción'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-[#2e3a4e]">
                          {bulkPreview.preview.map(emp => (
                            <tr key={emp.trab_ID} className="hover:bg-slate-50 dark:hover:bg-[#24303f]/50">
                              <td className="px-4 py-2 font-mono text-xs text-slate-500">{emp.trab_ID}</td>
                              <td className="px-4 py-2 text-xs font-semibold">{emp.nombre}</td>
                              <td className="px-4 py-2 text-xs text-slate-500">{emp.departamento || '—'}</td>
                              <td className="px-4 py-2 text-xs text-slate-500">{emp.puesto || '—'}</td>
                              <td className="px-4 py-2 text-xs">
                                {emp.activo ? <span className="text-emerald-600">Activo</span> : <span className="text-red-500">Inactivo</span>}
                              </td>
                              <td className="px-4 py-2"><AccionBadge accion={emp.accion} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Resultado Final Bulk */}
            {bulkSyncResult && (
              <div className="mt-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/50 animate-in fade-in">
                <h4 className="text-sm font-bold text-emerald-800 dark:text-emerald-400 mb-2">Resumen de Sincronización</h4>
                <ul className="text-sm space-y-1 text-emerald-700 dark:text-emerald-500">
                  <li>Nuevos: <strong>{bulkSyncResult.nuevos}</strong></li>
                  <li>Actualizados: <strong>{bulkSyncResult.actualizados}</strong></li>
                  <li>Sin cambios: <strong>{bulkSyncResult.sinCambios}</strong></li>
                  <li>Errores: <strong>{bulkSyncResult.errores}</strong></li>
                  <li>Tiempo: <strong>{(bulkSyncResult.duracionMs / 1000).toFixed(1)}s</strong></li>
                </ul>
              </div>
            )}

            {/* Lista de Errores Bulk */}
            {bulkErroresList.length > 0 && (
              <div className="mt-4 p-4 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900/50 animate-in fade-in">
                <h4 className="text-sm font-bold text-rose-800 dark:text-rose-400 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Detalle de Errores ({bulkErroresList.length})
                </h4>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {bulkErroresList.map((err, i) => (
                    <div key={i} className="text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2 bg-white/50 dark:bg-rose-950/30 p-2 rounded border border-rose-100 dark:border-rose-900/30">
                      <span className="font-bold shrink-0">{err.clave || 'N/A'}:</span>
                      <span>{err.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </CentralLayout>
  )
}
