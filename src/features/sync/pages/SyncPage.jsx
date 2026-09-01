// src/features/sync/pages/SyncPage.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { useAuth } from '../../auth/hooks/useAuth'
import {
  RefreshCw, Wifi, WifiOff, Play, Eye,
  CheckCircle2, AlertTriangle, XCircle, Users, ArrowUpDown,
  Search, Download, Loader2, User, Hash, AlertCircle
} from 'lucide-react'
import BiometricFaceEnrollment from '../../employees/components/BiometricFaceEnrollment'
import BiometricFingerprintEnrollment from '../../employees/components/BiometricFingerprintEnrollment'

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
  try {
    data = JSON.parse(rawText)
  } catch {
    // El backend no devolvió JSON — puede ser un error de proxy/red
    console.error(`[SYNC] Respuesta no-JSON del backend (status ${response.status}):`, rawText.slice(0, 300))
    throw new Error(`Error de comunicación con el servidor (status ${response.status}). Verifica que el servidor backend esté corriendo.`)
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Error ${response.status}`)
  }

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

export default function SyncPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const { profile } = useAuth()
  const { currentTenantId, requiresTenantAssignment } = useCurrentTenant()

  // ── Estado General ────────────────────────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState(null)
  const [loadingTest, setLoadingTest] = useState(false)

  // ── Estado: Sincronización Individual ──────────────────────────────────────
  const [trabId, setTrabId] = useState('')
  const [loadingIndividualPreview, setLoadingIndividualPreview] = useState(false)
  const [loadingIndividualSync, setLoadingIndividualSync] = useState(false)
  const [individualPreviewData, setIndividualPreviewData] = useState(null)
  const [localEmpleadoId, setLocalEmpleadoId] = useState(null)
  const [localClienteId, setLocalClienteId] = useState(null)
  
  const isAnyLoading = loadingIndividualPreview || loadingIndividualSync || loadingTest

  // ── Handlers Generales ────────────────────────────────────────────────────
  async function handleTest() {
    setLoadingTest(true)
    setConnectionStatus(null)
    try {
      await callSyncApi('test')
      setConnectionStatus('ok')
      toast.success('Conexión con API Consolide exitosa')
    } catch (err) {
      setConnectionStatus('error')
      toast.error(`Error de conexión: ${err.message}`)
    } finally {
      setLoadingTest(false)
    }
  }

  // ── Handlers: Sincronización Individual ────────────────────────────────────
  const handleIndividualPreview = async (e, isSilent = false) => {
    if (e) e.preventDefault()
    if (!trabId.trim()) return

    try {
      setLoadingIndividualPreview(true)
      setIndividualPreviewData(null)
      setLocalEmpleadoId(null)
      setLocalClienteId(null)
      
      const result = await callSyncApi('preview', { trabId: trabId.trim() })
      
      if (result.preview && result.preview.length > 0) {
        const emp = result.preview[0]
        setIndividualPreviewData(emp)

        // Buscar si ya existe localmente para habilitar biometría
        const searchId = String(emp.trab_ID || emp.trab_id || emp.clave_empleado || trabId.trim())
        const { data: dbEmp } = await supabase
          .from('empleados')
          .select('id, cliente_id')
          .eq('clave_empleado', searchId)
          .maybeSingle()
        if (dbEmp) {
          setLocalEmpleadoId(dbEmp.id)
        }

        if (emp.activo === false) {
          toast('Colaborador encontrado pero está inactivo en nómina', { icon: '⚠️' })
        } else {
          toast.success('Colaborador encontrado')
        }
      }
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    } finally {
      setLoadingIndividualPreview(false)
    }
  }

  async function handleIndividualSync() {
    if (!individualPreviewData) return

    setLoadingIndividualSync(true)
    try {
      const result = await callSyncApi('execute', { trabId: trabId.trim() })
      if (result.errores > 0) {
        toast.error(`Error al sincronizar: ${result.erroresList[0]?.error || 'Error desconocido'}`)
      } else {
        toast.success('Colaborador sincronizado exitosamente')
        // Actualizar el localEmpleadoId recargando la preview silenciosamente
        await handleIndividualPreview(null, true)
      }
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    } finally {
      setLoadingIndividualSync(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#1a222c] text-slate-900 dark:text-white">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          
          {requiresTenantAssignment && (
            <div className="flex items-center gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <RefreshCw className="w-6 h-6 text-indigo-500" />
              Integraciones
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Módulo de integración con la API externa de colaboradores.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* ── COLUMNA IZQUIERDA: Herramientas ── */}
            <div className="xl:col-span-4 space-y-6">
              
              {/* Tarjeta de Estado de Conexión */}
              <div className="rounded-xl border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#1c2434] shadow-sm p-5">
                <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-4">Estado de Conexión</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {connectionStatus === 'ok' ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 text-xs font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Conectado
                      </div>
                    ) : connectionStatus === 'error' ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 text-xs font-bold">
                        <WifiOff className="w-3 h-3" /> Sin conexión
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-bold">
                        No verificada
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleTest}
                    disabled={isAnyLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 dark:border-[#2e3a4e] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#2e3a4e] transition-colors disabled:opacity-50"
                  >
                    {loadingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                    Probar
                  </button>
                </div>
              </div>

              {/* Sincronización Individual */}
              <div className="rounded-xl border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#1c2434] shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2e3a4e] bg-slate-50 dark:bg-[#24303f]">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <User className="w-4 h-4 text-indigo-500" /> Sincronización Individual
                  </h3>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                      Clave Externa (trab_ID) <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Ej. 70118"
                          value={trabId}
                          onChange={(e) => setTrabId(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleIndividualPreview()}
                          className="w-full pl-9 pr-4 py-2.5 text-sm font-mono rounded-lg border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#24303f] focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                          disabled={isAnyLoading}
                        />
                      </div>
                      <button
                        onClick={handleIndividualPreview}
                        disabled={!trabId.trim() || isAnyLoading}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 transition-all"
                      >
                        {loadingIndividualPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* ── COLUMNA DERECHA: Resultados Individuales ── */}
            <div className="xl:col-span-8 space-y-6">
              
              {/* Resultado de Sincronización Individual (Aparece aquí al buscar) */}
              {individualPreviewData && (
                <div className="rounded-xl border border-slate-200 dark:border-[#2e3a4e] bg-white dark:bg-[#1c2434] shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2e3a4e] bg-slate-50 dark:bg-[#24303f]">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                      <User className="w-4 h-4 text-indigo-500" /> Tarjeta de Colaborador
                    </h3>
                  </div>
                  <div className="p-5">
                    <div className={`p-5 rounded-xl border space-y-4 ${
                      individualPreviewData.activo === false
                        ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20'
                        : 'border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20'
                    }`}>

                      {/* Advertencia de inactivo */}
                      {individualPreviewData.activo === false && (
                        <div className="flex items-start gap-2.5 p-4 rounded-lg bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700">
                          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Empleado inactivo en nómina</p>
                            <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">Este colaborador aparece como <strong>inactivo</strong> en la base de datos de Consolide. No puede ser agregado al sistema.</p>
                          </div>
                        </div>
                      )}

                      <h4 className={`text-sm font-bold uppercase tracking-wider ${
                        individualPreviewData.activo === false
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-indigo-600 dark:text-indigo-400'
                      }`}>Información Encontrada</h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
                        <div className="space-y-1">
                          <span className="block text-xs uppercase tracking-wider text-slate-500">Nombre completo</span>
                          <span className="block font-bold text-slate-800 dark:text-slate-200 text-base">{individualPreviewData.nombre}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="block text-xs uppercase tracking-wider text-slate-500">Puesto</span>
                          <span className="block font-medium text-slate-700 dark:text-slate-300">{individualPreviewData.puesto || '—'}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="block text-xs uppercase tracking-wider text-slate-500">Departamento</span>
                          <span className="block font-medium text-slate-700 dark:text-slate-300">{individualPreviewData.departamento || '—'}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="block text-xs uppercase tracking-wider text-slate-500">Estatus nómina</span>
                          <div>
                            {individualPreviewData.activo === false ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                                <AlertCircle className="w-3.5 h-3.5" /> Inactivo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Activo
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-200/50 dark:border-slate-700/50">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-500">Acción requerida:</span>
                          <AccionBadge accion={individualPreviewData.accion} />
                        </div>
                        
                        <button
                          onClick={handleIndividualSync}
                          disabled={isAnyLoading || individualPreviewData.accion === 'sin_cambios' || individualPreviewData.activo === false}
                          className="flex justify-center items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-500/20 transition-all"
                          title={individualPreviewData.activo === false ? 'No se puede importar un empleado inactivo' : ''}
                        >
                          {loadingIndividualSync ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          {individualPreviewData.activo === false ? 'No disponible (Inactivo)' : 'Guardar Empleado'}
                        </button>
                      </div>

                    </div>

                    {/* Módulos Biométricos Separados (Solo si el empleado ya existe localmente) */}
                    {localEmpleadoId && (
                      <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700 animate-in fade-in slide-in-from-bottom-4">
                        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-6">
                          Biometría del Colaborador
                        </h4>
                        
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                          <BiometricFaceEnrollment 
                            empleadoId={localEmpleadoId} 
                            clienteId={localClienteId || currentTenantId} 
                          />
                          
                          <BiometricFingerprintEnrollment 
                            empleadoId={localEmpleadoId} 
                            clienteId={localClienteId || currentTenantId} 
                            numeroSerieDispositivo="" 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
