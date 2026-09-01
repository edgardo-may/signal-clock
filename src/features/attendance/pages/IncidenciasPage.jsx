import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useConfirm } from '../../../shared/hooks/useConfirm'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import {
  FileText, Plus, Search, Filter, RefreshCw,
  CheckCircle2, XCircle, Edit3, Trash2, X, Save,
  Calendar, CalendarDays, List, Grid, AlertTriangle
} from 'lucide-react'

function formatDateOnly(dateString) {
  if (!dateString) return '—'
  const d = new Date(dateString + 'T12:00:00')
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(d)
}

function Spinner({ size = 16 }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export const TIPOS_INCIDENCIA = [
  { id: 'Falta Injustificada', label: 'Falta Injustificada', abbr: 'FI', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  { id: 'Permiso con Goce de Sueldo', label: 'Permiso con Goce de Sueldo', abbr: 'PGS', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { id: 'Permiso sin Goce de Sueldo', label: 'Permiso sin Goce de Sueldo', abbr: 'PSS', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { id: 'Incapacidad por Enfermedad General', label: 'Incapacidad por Enf. General', abbr: 'IEG', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  { id: 'Incapacidad por Riesgo de Trabajo', label: 'Incapacidad por Riesgo Trab.', abbr: 'IRT', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 ' },
  { id: 'Incapacidad por Maternidad', label: 'Incapacidad por Maternidad', abbr: 'IM', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
  { id: 'Vacaciones', label: 'Vacaciones', abbr: 'V', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  { id: 'Suspensión Disciplinaria', label: 'Suspensión Disciplinaria', abbr: 'SD', color: 'bg-slate-200 text-slate-700 dark:text-slate-300 dark:bg-slate-800 ' }
]

function EstadoBadge({ estado }) {
  switch (estado) {
    case 'Aprobado': return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Aprobado</span>
    case 'Rechazado': return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Rechazado</span>
    default: return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Pendiente</span>
  }
}

// ═══════════════════════════════════════════════════════════════
// MODAL: PERIODO DE NOMINA
// ═══════════════════════════════════════════════════════════════
function ModalPeriodo({ clienteId, onClose, onSaved }) {
  const [nombre, setNombre] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!nombre || !fechaInicio || !fechaFin) return toast.error('Completa los campos requeridos')
    if (fechaInicio > fechaFin) return toast.error('La fecha de fin no puede ser menor a la inicial')

    setSaving(true)
    try {
      const { error } = await supabase.from('periodos_nomina').insert({
        cliente_id: clienteId, nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin
      })
      if (error) throw error
      toast.success('Periodo creado exitosamente')
      onSaved()
      onClose()
    } catch (err) {
      toast.error('Error al crear periodo: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800  sticky top-0 bg-white dark:bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400 ">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white ">
                Nuevo Periodo de Nómina
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Define el rango de fechas del periodo
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 ">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Nombre (Ej. Quincena 1 Enero) <span className="text-blue-600 dark:text-blue-400">*</span></label>
            <input type="text" value={nombre} onChange={e=>setNombre(e.target.value)} required className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Fecha Inicio <span className="text-blue-600 dark:text-blue-400">*</span></label>
              <input type="date" value={fechaInicio} onChange={e=>setFechaInicio(e.target.value)} required className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Fecha Fin <span className="text-blue-600 dark:text-blue-400">*</span></label>
              <input type="date" value={fechaFin} onChange={e=>setFechaFin(e.target.value)} required className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800 ">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300  rounded-md">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-slate-100 disabled:opacity-50 transition-colors rounded-md shadow-md shadow-blue-500/20">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MODAL: REGISTRAR INCIDENCIA
// ═══════════════════════════════════════════════════════════════
function ModalIncidencia({ incidencia, empleados, clienteId, userRol, onClose, onSaved }) {
  const isEdit = !!incidencia
  const [empleadoId, setEmpleadoId] = useState(incidencia?.empleado_id || empleados[0]?.id || '')
  
  const nowISO = new Date().toISOString().slice(0, 10)
  const [fechaInicio, setFechaInicio] = useState(incidencia?.fecha_inicio || nowISO)
  const [fechaFin, setFechaFin] = useState(incidencia?.fecha_fin || nowISO)
  const [tipoIncidencia, setTipoIncidencia] = useState(incidencia?.tipo_incidencia || TIPOS_INCIDENCIA[0].id)
  const [descripcion, setDescripcion] = useState(incidencia?.descripcion || '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!empleadoId || !fechaInicio || !fechaFin) return toast.error('Faltan campos')
    if (fechaInicio > fechaFin) return toast.error('Fecha fin menor a inicio')

    setSaving(true)
    try {
      const payload = {
        cliente_id: clienteId, empleado_id: empleadoId, tipo_incidencia: tipoIncidencia,
        fecha_inicio: fechaInicio, fecha_fin: fechaFin, descripcion: descripcion.trim() || null,
        ...(isEdit && userRol !== 'rh' && userRol !== 'admin' ? { estado: 'Pendiente' } : {})
      }

      if (isEdit) {
        const { error } = await supabase.from('incidencias').update(payload).eq('id', incidencia.id)
        if (error) throw error
        toast.success('Incidencia actualizada')
      } else {
        const { error } = await supabase.from('incidencias').insert(payload)
        if (error) throw error
        toast.success(`Incidencia registrada`)
      }

      onSaved()
      onClose()
    } catch (err) {
      toast.error('Error al guardar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800  sticky top-0 bg-white dark:bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white ">
                {isEdit ? 'Editar Incidencia' : 'Nueva Incidencia'}
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Registra ausencias, permisos o incapacidades
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 ">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Colaborador <span className="text-blue-600 dark:text-blue-400">*</span></label>
            <select value={empleadoId} onChange={e=>setEmpleadoId(e.target.value)} disabled={isEdit} className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 disabled:opacity-60">
              {empleados.map(emp => <option key={emp.id} value={emp.id}>{emp.nombre} {emp.apellido}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Fecha Inicio <span className="text-blue-600 dark:text-blue-400">*</span></label>
              <input type="date" value={fechaInicio} onChange={e=>setFechaInicio(e.target.value)} required className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Fecha Fin <span className="text-blue-600 dark:text-blue-400">*</span></label>
              <input type="date" value={fechaFin} onChange={e=>setFechaFin(e.target.value)} required className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Tipo de Incidencia <span className="text-blue-600 dark:text-blue-400">*</span></label>
            <select value={tipoIncidencia} onChange={e=>setTipoIncidencia(e.target.value)} className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500">
              {TIPOS_INCIDENCIA.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300  mb-1.5">Notas</label>
            <textarea value={descripcion} onChange={e=>setDescripcion(e.target.value)} rows={2} className="w-full py-2 px-3 text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500" />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800 ">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300  rounded-md">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-slate-100 disabled:opacity-50 transition-colors rounded-md shadow-md shadow-blue-500/20">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default function IncidenciasPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const [incidencias, setIncidencias] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [periodos, setPeriodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [clienteId, setClienteId] = useState(null)
  const [userRol, setUserRol] = useState('')
  const [userId, setUserId] = useState('')

  // UI State
  const [selectedPeriodoId, setSelectedPeriodoId] = useState('') 
  const [viewMode, setViewMode] = useState('list') // list | matrix
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('todos')
  const [modalForm, setModalForm] = useState(null) // null | 'nuevo' | incidencia object
  const [modalPeriodo, setModalPeriodo] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      setUserId(session.user.id)
      const { data: perfil } = await supabase.from('usuarios_perfiles').select('cliente_id, rol').eq('id', session.user.id).maybeSingle()
      if (perfil?.cliente_id) setClienteId(perfil.cliente_id)
      if (perfil?.rol) setUserRol(perfil.rol)
    })()
  }, [])

  const fetchData = useCallback(async () => {
    if (!clienteId) return
    setLoading(true)

    // Load periodos
    const { data: perData } = await supabase.from('periodos_nomina').select('*').eq('cliente_id', clienteId).order('fecha_inicio', { ascending: false })
    setPeriodos(perData || [])
    
    // Default to latest periodo if none selected
    let currentPerId = selectedPeriodoId
    if (!currentPerId && perData?.length > 0) {
      currentPerId = perData[0].id
      setSelectedPeriodoId(currentPerId)
    }

    const currentPeriodo = perData?.find(p => p.id === currentPerId)
    
    let query = supabase.from('incidencias').select('*, empleado:empleados(id, nombre, apellido, clave_empleado, departamento), autorizador:usuarios_perfiles!incidencias_autorizado_por_fkey(nombre)').eq('cliente_id', clienteId)
    
    // Filter by period dates if a period exists
    if (currentPeriodo) {
      // Overlap logic: inc.fecha_inicio <= per.fecha_fin AND inc.fecha_fin >= per.fecha_inicio
      query = query.lte('fecha_inicio', currentPeriodo.fecha_fin).gte('fecha_fin', currentPeriodo.fecha_inicio)
    }
    
    const [incRes, empRes] = await Promise.all([
      query.order('creado_at', { ascending: false }),
      supabase.from('empleados').select('id, nombre, apellido, clave_empleado, departamento').eq('cliente_id', clienteId).eq('activo', true).order('apellido', { ascending: true })
    ])

    if (incRes.error) toast.error('Error al cargar incidencias: ' + incRes.error.message)
    setIncidencias(incRes.data || [])
    setEmpleados(empRes.data || [])
    setLoading(false)
  }, [clienteId, selectedPeriodoId])

  useEffect(() => { fetchData() }, [fetchData])

  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const handleDelete = async (inc) => {
    const ok = await confirmDialog({
      title:        '¿Eliminar incidencia?',
      message:      'Se eliminará el registro de incidencia de forma permanente.',
      variant:      'danger',
      confirmLabel: 'Sí, eliminar',
    })
    if (!ok) return
    await supabase.from('incidencias').delete().eq('id', inc.id)
    toast.success('Incidencia eliminada')
    fetchData()
  }

  const handleAutorizar = async (inc, estadoStr) => {
    await supabase.from('incidencias').update({ estado: estadoStr, autorizado_por: userId }).eq('id', inc.id)
    fetchData()
  }

  const filtered = useMemo(() => {
    return incidencias.filter(i => {
      const emp = i.empleado || {}
      const q = search.toLowerCase()
      const matchSearch = !q || `${emp.nombre} ${emp.apellido}`.toLowerCase().includes(q) || i.tipo_incidencia?.toLowerCase().includes(q)
      const matchEstado = filterEstado === 'todos' || i.estado === filterEstado
      return matchSearch && matchEstado
    })
  }, [incidencias, search, filterEstado])

  const canAuthorize = userRol === 'admin' || userRol === 'rh'
  const activePeriodo = periodos.find(p => p.id === selectedPeriodoId)

  // -- MATRIZ GENERATION --
  const matrixDays = useMemo(() => {
    if (!activePeriodo) return []
    const arr = []
    let curr = new Date(activePeriodo.fecha_inicio + 'T12:00:00')
    const end = new Date(activePeriodo.fecha_fin + 'T12:00:00')
    while (curr <= end) {
      arr.push(new Date(curr))
      curr.setDate(curr.getDate() + 1)
    }
    return arr
  }, [activePeriodo])

  return (
    <div className="flex h-screen bg-[#F8FAFC]  overflow-hidden font-inter transition-colors duration-300 text-slate-900 dark:text-white ">
      <Toaster position="top-right" />
      {ConfirmDialogNode}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white  flex items-center gap-3">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                Control de Incidencias
              </h2>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300  mt-1">
                Gestión por periodos de nómina y matriz de asistencia.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {canAuthorize && (
                <button onClick={() => setModalPeriodo(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-white dark:bg-white text-slate-700 dark:text-slate-300  border border-slate-200 dark:border-slate-800  hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-50 dark:bg-slate-800/60 transition-all shadow-sm active:scale-98">
                  <CalendarDays className="w-3.5 h-3.5 text-emerald-500" /> 
                  <span>Periodos</span>
                </button>
              )}
              <button onClick={() => setModalForm('nuevo')} className="flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-slate-100 shadow-md shadow-blue-600/25 transition-all active:scale-98">
                <Plus className="w-4 h-4" /> 
                <span>Nueva Incidencia</span>
              </button>
            </div>
          </div>

          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-4 shadow-sm  dark:bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            
            <div className="flex items-center gap-3 w-full lg:w-auto">
              <select 
                value={selectedPeriodoId} 
                onChange={e => setSelectedPeriodoId(e.target.value)}
                className="w-full lg:w-64 py-2 px-3 text-sm rounded-lg border border-slate-200 dark:border-slate-800  bg-slate-50  outline-none font-semibold text-slate-700 dark:text-slate-300 "
              >
                <option value="">Selecciona un periodo</option>
                {periodos.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.fecha_inicio} a {p.fecha_fin})</option>)}
              </select>
              
              <div className="flex bg-blue-50 dark:bg-blue-950/60 dark:bg-slate-800 rounded-lg p-1 shrink-0">
                <button onClick={()=>setViewMode('list')} className={`p-1.5 rounded-md ${viewMode==='list' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300'}`}><List className="w-4 h-4"/></button>
                <button onClick={()=>setViewMode('matrix')} className={`p-1.5 rounded-md ${viewMode==='matrix' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300'}`}><Grid className="w-4 h-4"/></button>
              </div>
            </div>

            {viewMode === 'list' && (
              <div className="flex items-center gap-3 w-full lg:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                  <input type="text" placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800  bg-slate-50 " />
                </div>
                <select value={filterEstado} onChange={e=>setFilterEstado(e.target.value)} className="py-2 px-3 text-sm rounded-lg border border-slate-200 dark:border-slate-800  bg-slate-50 ">
                  <option value="todos">Todos</option>
                  <option value="Pendiente">Pendientes</option>
                  <option value="Aprobado">Aprobados</option>
                </select>
              </div>
            )}
          </div>

          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white shadow-sm  dark:bg-white">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400 dark:text-slate-500"><Spinner size={32} /></div>
            ) : viewMode === 'list' ? (
              <div className="overflow-x-auto min-h-[400px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60  border-b border-slate-200 dark:border-slate-800 ">
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 dark:text-slate-300  uppercase tracking-wider">Colaborador</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 dark:text-slate-300  uppercase tracking-wider">Fechas</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 dark:text-slate-300  uppercase tracking-wider">Tipo</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 dark:text-slate-300  uppercase tracking-wider text-center">Estado</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-700 dark:text-slate-300  uppercase tracking-wider text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(3,54,61,0.07)]  border-b border-slate-200 dark:border-slate-800 ">
                    {filtered.map(i => (
                      <tr key={i.id} className="hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-50 dark:bg-slate-800/60/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300  font-bold text-sm shrink-0">
                              {i.empleado?.nombre?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900 dark:text-white  line-clamp-1">{i.empleado?.nombre} {i.empleado?.apellido}</p>
                              <p className="text-xs text-slate-700 dark:text-slate-300  line-clamp-1 mt-0.5">{i.empleado?.departamento}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300 ">
                          {formatDateOnly(i.fecha_inicio)} a {formatDateOnly(i.fecha_fin)}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white ">{i.tipo_incidencia}</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <EstadoBadge estado={i.estado} />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            {canAuthorize && i.estado === 'Pendiente' && (
                              <>
                                <button onClick={()=>handleAutorizar(i, 'Aprobado')} className="p-1 text-emerald-600"><CheckCircle2 className="w-5 h-5" /></button>
                                <button onClick={()=>handleAutorizar(i, 'Rechazado')} className="p-1 text-rose-600"><XCircle className="w-5 h-5" /></button>
                              </>
                            )}
                            <button onClick={()=>setModalForm(i)} className="p-1 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:text-blue-400"><Edit3 className="w-4 h-4" /></button>
                            {userRol === 'admin' && <button onClick={()=>handleDelete(i)} className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              // MATRIZ VIEW
              <div className="overflow-x-auto min-h-[400px]">
                {!activePeriodo ? (
                   <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400 dark:text-slate-500">Selecciona un periodo de nómina para ver la matriz.</div>
                ) : (
                  <table className="w-full text-left border-collapse border-r border-slate-200 dark:border-slate-800 ">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 ">
                        <th className="px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300  uppercase tracking-wider sticky left-0 bg-slate-50 dark:bg-slate-800/60  z-10 border-b border-r border-slate-200 dark:border-slate-800  min-w-[200px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          Colaborador
                        </th>
                        {matrixDays.map((date, idx) => (
                          <th key={idx} className="px-2 py-3 text-[10px] font-bold text-slate-700 dark:text-slate-300  uppercase text-center border-b border-r border-slate-200 dark:border-slate-800  min-w-[36px]">
                            {date.getDate()}<br/><span className="font-normal opacity-70">{date.toLocaleDateString('es-MX', {weekday:'narrow'})}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(3,54,61,0.07)]  border-b border-slate-200 dark:border-slate-800 ">
                      {empleados.map(emp => {
                        // Find incidences for this employee in this period
                        const empIncidencias = incidencias.filter(i => i.empleado_id === emp.id && i.estado === 'Aprobado')
                        
                        return (
                          <tr key={emp.id} className="hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-50 dark:bg-slate-800/60/50 transition-colors">
                            <td className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300  sticky left-0 bg-white dark:bg-white z-10 border-r border-slate-200 dark:border-slate-800  shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] truncate max-w-[200px]" title={`${emp.nombre} ${emp.apellido}`}>
                              {emp.nombre} {emp.apellido}
                            </td>
                            {matrixDays.map((date, idx) => {
                              const dateStr = date.toISOString().slice(0, 10)
                              // Check if any incidence covers this date
                              const matchingInc = empIncidencias.find(i => dateStr >= i.fecha_inicio && dateStr <= i.fecha_fin)
                              
                              let cellContent = null
                              if (matchingInc) {
                                const typeInfo = TIPOS_INCIDENCIA.find(t => t.id === matchingInc.tipo_incidencia)
                                cellContent = (
                                  <span title={`${typeInfo?.label || matchingInc.tipo_incidencia}\n${matchingInc.descripcion || ''}`} className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold cursor-help ${typeInfo?.color || 'bg-slate-200 text-slate-700 dark:text-slate-300'}`}>
                                    {typeInfo?.abbr || '??'}
                                  </span>
                                )
                              }

                              return (
                                <td key={idx} className="p-1 text-center border-r border-slate-200 dark:border-slate-800  bg-white dark:bg-white">
                                  {cellContent}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {modalForm && <ModalIncidencia incidencia={modalForm === 'nuevo' ? null : modalForm} empleados={empleados} clienteId={clienteId} userRol={userRol} onClose={() => setModalForm(null)} onSaved={fetchData} />}
      {modalPeriodo && <ModalPeriodo clienteId={clienteId} onClose={() => setModalPeriodo(false)} onSaved={fetchData} />}
    </div>
  )
}






