// src/pages/ChecadasManuales.jsx — Módulo de Registro y Gestión de Checadas Manuales / Incidencias
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useConfirm } from '../../../shared/hooks/useConfirm'
import {
  Clock, Plus, Search, Filter, RefreshCw,
  CheckCircle2, XCircle, AlertTriangle, Edit3,
  Trash2, X, Save, Calendar, User, Building2,
  FileText, ShieldCheck, UserCheck, ArrowRightLeft,
  Fingerprint, Sparkles, Check, Hash, BadgeCheck,
} from 'lucide-react'

function formatDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  }).format(d)
}

function formatTimeOnly(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  }).format(d)
}

function formatDateOnly(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(d)
}

function Spinner({ size = 16 }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size }}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

const MOTIVOS_PREDEFINIDOS = [
  'Olvido de tarjeta / credencial RFID',
  'Comisión externa / Trabajo en campo',
  'Falla eléctrica o técnica de terminal',
  'Cita médica / Justificante de salud',
  'Autorización especial de supervisor',
  'Error de lectura biométrica en terminal',
  'Horas extras autorizadas por gerencia',
]

const TIPOS_VERIFICACION = [
  { val: '0', label: 'Entrada Laboral', color: 'emerald' },
  { val: '1', label: 'Salida Laboral', color: 'rose' },
  { val: '2', label: 'Salida a Descanso', color: 'amber' },
  { val: '3', label: 'Regreso de Descanso', color: 'sky' },
  { val: '4', label: 'Entrada Extra', color: 'purple' },
  { val: '5', label: 'Salida Extra', color: 'purple' },
]

function TipoBadge({ tipo }) {
  const strTipo = tipo?.toString()
  switch (strTipo) {
    case '0':
    case 'entrada':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Entrada
        </span>
      )
    case '1':
    case 'salida':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          Salida
        </span>
      )
    case '2':
    case 'descanso_inicio':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Salida a Descanso
        </span>
      )
    case '3':
    case 'descanso_fin':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          Regreso Descanso
        </span>
      )
    case '4':
    case '5':
    case 'extra':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          Horas Extra
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          Desconocido
        </span>
      )
  }
}

// ═══════════════════════════════════════════════════════════════
// MODAL: REGISTRAR / EDITAR CHECADA MANUAL
// ═══════════════════════════════════════════════════════════════
function ModalChecadaManual({ checada, empleados, supervisores, clienteId, userEmail, onClose, onSaved }) {
  const isEdit = !!checada
  const [empleadoId, setEmpleadoId] = useState(checada?.empleado_id || empleados[0]?.id || '')
  
  // Desglose de fecha y hora
  const nowISO = new Date()
  const initialDate = checada ? checada.verificado_at.slice(0, 10) : nowISO.toISOString().slice(0, 10)
  const initialTime = checada 
    ? new Date(checada.verificado_at).toTimeString().slice(0, 5) 
    : nowISO.toTimeString().slice(0, 5)

  const [fecha, setFecha] = useState(initialDate)
  const [hora, setHora] = useState(initialTime)
  const [tipoVerificacion, setTipoVerificacion] = useState(checada?.tipo_verificacion || 'entrada')
  const [motivo, setMotivo] = useState(checada?.motivo_manual || MOTIVOS_PREDEFINIDOS[0])
  const [otroMotivo, setOtroMotivo] = useState('')
  const [autorizadoPor, setAutorizadoPor] = useState(checada?.autorizado_por || (supervisores?.length > 0 ? supervisores[0].nombre : userEmail || 'Supervisor'))
  const [notas, setNotas] = useState(checada?.notas || '')
  const [saving, setSaving] = useState(false)

  const selectedEmpleado = useMemo(() => {
    return empleados.find(e => e.id === empleadoId)
  }, [empleados, empleadoId])

  const setHoraActual = () => {
    const d = new Date()
    setFecha(d.toISOString().slice(0, 10))
    setHora(d.toTimeString().slice(0, 5))
    toast.success('Hora actual sincronizada')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!empleadoId) {
      toast.error('Selecciona un colaborador')
      return
    }
    if (!fecha || !hora) {
      toast.error('Indica la fecha y la hora del marcaje')
      return
    }

    const timestampVerificado = new Date(`${fecha}T${hora}:00`).toISOString()
    const motivoFinal = motivo === 'Otro' ? otroMotivo.trim() : motivo

    if (!motivoFinal) {
      toast.error('Indica el motivo o justificación de la checada manual')
      return
    }

    setSaving(true)
    try {
      const payload = {
        cliente_id: clienteId,
        empleado_id: empleadoId,
        dispositivo_id: null,
        verificado_at: timestampVerificado,
        tipo_verificacion: tipoVerificacion,
        metodo: 'manual',
        es_manual: true,
        motivo_manual: motivoFinal,
        autorizado_por: autorizadoPor.trim() || null,
        notas: notas.trim() || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('registro_asistencia')
          .update(payload)
          .eq('id', checada.id)
        if (error) throw error
        toast.success('Checada manual actualizada')
      } else {
        const { error } = await supabase
          .from('registro_asistencia')
          .insert(payload)
        if (error) throw error
        toast.success(`Marcaje manual registrado para ${selectedEmpleado?.nombre || 'colaborador'}`)
      }

      onSaved()
      onClose()
    } catch (err) {
      toast.error(err?.message || 'Error al guardar el marcaje manual')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-[95%] sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800  sticky top-0 bg-white dark:bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400 ">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white ">
                {isEdit ? 'Editar Checada Manual' : 'Registro de Checada Manual'}
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Auditoría de incidencias, olvido de credenciales o comisiones
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 ">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Selector de Colaborador */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Colaborador <span className="text-blue-600 dark:text-blue-400">*</span>
            </label>
            <select
              value={empleadoId}
              onChange={e => setEmpleadoId(e.target.value)}
              disabled={isEdit}
              className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 font-medium disabled:opacity-60"
            >
              {empleados.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.clave_empleado ? `[${emp.clave_empleado}] ` : ''}{emp.nombre} {emp.apellido} — {emp.departamento || 'Sin área'}
                </option>
              ))}
            </select>
          </div>

          {/* Fecha, Hora y Tipo de Marcaje */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Fecha <span className="text-blue-600 dark:text-blue-400">*</span>
              </label>
              <input
                type="date"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                required
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                  Hora <span className="text-blue-600 dark:text-blue-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={setHoraActual}
                  className="text-[10px] text-blue-600 dark:text-blue-400  hover:underline font-semibold"
                >
                  Hora actual
                </button>
              </div>
              <input
                type="time"
                value={hora}
                onChange={e => setHora(e.target.value)}
                required
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Tipo Marcaje <span className="text-blue-600 dark:text-blue-400">*</span>
              </label>
              <select
                value={tipoVerificacion}
                onChange={e => setTipoVerificacion(e.target.value)}
                className="w-full py-2 px-2.5 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 font-medium"
              >
                {TIPOS_VERIFICACION.map(t => (
                  <option key={t.val} value={t.val}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Motivo / Justificación */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Motivo de la Incidencia / Justificación <span className="text-blue-600 dark:text-blue-400">*</span>
            </label>
            <select
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 font-medium"
            >
              {MOTIVOS_PREDEFINIDOS.map((m, idx) => (
                <option key={idx} value={m}>{m}</option>
              ))}
              <option value="Otro">Otro / Motivo personalizado</option>
            </select>

            {motivo === 'Otro' && (
              <input
                type="text"
                value={otroMotivo}
                onChange={e => setOtroMotivo(e.target.value)}
                placeholder="Escribe la justificación específica..."
                required
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-blue-400 bg-white  text-slate-900 dark:text-white  outline-none"
              />
            )}
          </div>

          {/* Autorizado Por */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Autorizado Por (Supervisor / RH)
              </label>
              <select
                value={autorizadoPor}
                onChange={e => setAutorizadoPor(e.target.value)}
                className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 font-medium"
              >
                {supervisores?.length > 0 ? (
                  supervisores.map(sup => (
                    <option key={sup.id} value={sup.nombre}>{sup.nombre}</option>
                  ))
                ) : (
                  <option value={userEmail || 'Supervisor'}>{userEmail || 'Supervisor'}</option>
                )}
                <option value="RH Central">RH Central</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Folio / Notas Internas
              </label>
              <input
                type="text"
                value={notas}
                onChange={e => setNotas(e.target.value)}
                placeholder="ej. Justificante médico #4092"
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800 ">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300  hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-slate-100 shadow-md shadow-blue-600/25 transition-all active:scale-98 disabled:opacity-50"
            >
              {saving ? <><Spinner size={14} /> Guardando...</> : <><Save className="w-4 h-4" /> {isEdit ? 'Actualizar Marcaje' : 'Registrar Checada'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: CHECADAS MANUALES
// ═══════════════════════════════════════════════════════════════
export default function ChecadasManuales() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const [asistencias, setAsistencias] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [supervisores, setSupervisores] = useState([])
  const [loading, setLoading] = useState(true)
  const [clienteId, setClienteId] = useState(null)
  const [userEmail, setUserEmail] = useState('')

  // Filtros
  const [fechaFiltro, setFechaFiltro] = useState(() => new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [filterMetodo, setFilterMetodo] = useState('todos') // 'todos', 'manual', 'terminal'
  const [filterTipo, setFilterTipo] = useState('todos')
  const [modalForm, setModalForm] = useState(null)

  // Obtener cliente_id y user email
  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      setUserEmail(session.user?.email || '')
      const fromJwt = session.user?.app_metadata?.cliente_id ?? session.user?.user_metadata?.cliente_id ?? null
      if (fromJwt) {
        setClienteId(fromJwt)
        return
      }

      const { data: perfil } = await supabase
        .from('usuarios_perfiles')
        .select('cliente_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (perfil?.cliente_id) setClienteId(perfil.cliente_id)
    })()
  }, [])

  // Cargar asistencias y empleados
  const fetchData = useCallback(async () => {
    if (!clienteId) return
    setLoading(true)

    const startDay = `${fechaFiltro}T00:00:00.000Z`
    const endDay = `${fechaFiltro}T23:59:59.999Z`

    const [asigRes, empRes, supRes] = await Promise.all([
      supabase
        .from('registro_asistencia')
        .select('*, empleado:empleados(id, nombre, apellido, clave_empleado, departamento, puesto, hikvision_device_userid)')
        .eq('cliente_id', clienteId)
        .gte('verificado_at', startDay)
        .lte('verificado_at', endDay)
        .order('verificado_at', { ascending: false }),
      supabase
        .from('empleados')
        .select('id, nombre, apellido, clave_empleado, departamento, puesto, hikvision_device_userid')
        .eq('cliente_id', clienteId)
        .eq('activo', true)
        .order('apellido', { ascending: true }),
      supabase
        .from('usuarios_perfiles')
        .select('id, nombre, rol')
        .eq('cliente_id', clienteId)
        .eq('rol', 'supervisor')
        .order('nombre', { ascending: true }),
    ])

    if (asigRes.error) toast.error('Error al cargar marcajes: ' + asigRes.error.message)
    if (empRes.error) toast.error('Error al cargar colaboradores: ' + empRes.error.message)
    if (supRes.error) console.error('Error al cargar supervisores:', supRes.error.message)

    setAsistencias(asigRes.data || [])
    setEmpleados(empRes.data || [])
    setSupervisores(supRes?.data || [])
    setLoading(false)
  }, [clienteId, fechaFiltro])

  useEffect(() => { fetchData() }, [fetchData])

  // Eliminar checada
  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const handleDelete = async (checada) => {
    const ok = await confirmDialog({
      title:        '¿Eliminar registro de asistencia?',
      message:      'Esta acción eliminará el marcaje permanentemente y no se puede deshacer.',
      variant:      'danger',
      confirmLabel: 'Sí, eliminar',
    })
    if (!ok) return
    try {
      const { error } = await supabase
        .from('registro_asistencia')
        .delete()
        .eq('id', checada.id)

      if (error) throw error
      toast.success('Registro de asistencia eliminado')
      fetchData()
    } catch (err) {
      toast.error('Error al eliminar: ' + err.message)
    }
  }

  // Filtrado reactivo
  const filtered = useMemo(() => {
    return asistencias.filter(a => {
      const emp = a.empleado || {}
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        `${emp.nombre} ${emp.apellido}`.toLowerCase().includes(q) ||
        emp.clave_empleado?.toLowerCase().includes(q) ||
        emp.hikvision_device_userid?.toLowerCase().includes(q) ||
        a.motivo_manual?.toLowerCase().includes(q) ||
        a.autorizado_por?.toLowerCase().includes(q)

      const matchMetodo =
        filterMetodo === 'todos' ||
        (filterMetodo === 'manual' && a.es_manual) ||
        (filterMetodo === 'terminal' && !a.es_manual)

      const matchTipo = filterTipo === 'todos' || a.tipo_verificacion === filterTipo

      return matchSearch && matchMetodo && matchTipo
    })
  }, [asistencias, search, filterMetodo, filterTipo])

  // Métricas
  const totalManuales = asistencias.filter(a => a.es_manual).length
  const totalTerminales = asistencias.length - totalManuales
  const totalEntradas = asistencias.filter(a => a.tipo_verificacion === 'entrada').length

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]  text-slate-900 dark:text-white ">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />
      {ConfirmDialogNode}


      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

          {/* Barra Superior */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white  flex items-center gap-2.5">
                <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                Checadas Manuales e Incidencias
              </h2>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 ">
                Registro y justificación de asistencias manuales por olvido de credencial o comisiones ({asistencias.length} registros hoy)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Selector de Fecha */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-white border border-slate-200 dark:border-slate-800  text-xs font-semibold text-slate-700 dark:text-slate-300  shadow-sm">
                <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Fecha:</span>
                <input
                  type="date"
                  value={fechaFiltro}
                  onChange={e => setFechaFiltro(e.target.value)}
                  className="bg-transparent font-bold text-blue-600 dark:text-blue-400  outline-none cursor-pointer"
                />
              </div>

              {/* Botón Registrar Checada Manual */}
              <button
                onClick={() => clienteId ? setModalForm('nuevo') : toast.error('Se requiere cliente_id')}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-slate-100 shadow-md shadow-blue-600/25 transition-all active:scale-98"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar Checada Manual</span>
              </button>
            </div>
          </div>

          {/* Cards de Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Marcajes del Día</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{asistencias.length}</h3>
              </div>
              <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400 ">
                <Clock className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Checadas Manuales RH</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{totalManuales}</h3>
              </div>
              <div className="p-3 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                <FileText className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Terminales Hardware Hikvision</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{totalTerminales}</h3>
              </div>
              <div className="p-3 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <Fingerprint className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Toolbar de Filtros y Búsqueda */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-4 shadow-sm  dark:bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por colaborador, clave laboral, motivo o supervisor..."
                className="w-full pl-9 pr-4 py-2 rounded-md border border-slate-200 dark:border-slate-800  bg-slate-50  text-xs sm:text-sm text-slate-900 dark:text-white  placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Filtro Origen */}
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <select
                  value={filterMetodo}
                  onChange={e => setFilterMetodo(e.target.value)}
                  className="py-1.5 px-2.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50  text-slate-700 dark:text-slate-300  outline-none font-medium"
                >
                  <option value="todos">Todos los Orígenes</option>
                  <option value="manual">✍️ Solo Manuales RH</option>
                  <option value="terminal">📡 Solo Terminales ISUP</option>
                </select>
              </div>

              {/* Filtro Tipo */}
              <div className="flex items-center gap-1.5 text-xs">
                <select
                  value={filterTipo}
                  onChange={e => setFilterTipo(e.target.value)}
                  className="py-1.5 px-2.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50  text-slate-700 dark:text-slate-300  outline-none font-medium"
                >
                  <option value="todos">Todos los Marcajes</option>
                  <option value="0">Entradas</option>
                  <option value="1">Salidas</option>
                  <option value="2">Salida a Descanso</option>
                  <option value="3">Regreso de Descanso</option>
                  <option value="4">Entrada Extra</option>
                  <option value="5">Salida Extra</option>
                </select>
              </div>

              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-md border border-slate-200 dark:border-slate-800  text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white  transition-colors"
                title="Recargar"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Tabla de Checadas */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white shadow-sm  dark:bg-white">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-20 gap-2 text-slate-700 dark:text-slate-300 text-sm">
                  <Spinner size={18} />
                  Cargando checadas del día...
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400 dark:text-slate-500">
                  <Clock className="w-10 h-10 stroke-1" />
                  <p className="text-sm font-medium">No se encontraron marcajes en la fecha seleccionada.</p>
                  <button
                    onClick={() => setModalForm('nuevo')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-blue-600 dark:text-blue-400  bg-blue-50 dark:bg-blue-950/60  border border-blue-500/40 "
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Registrar una checada manual
                  </button>
                </div>
              ) : (
                <table className="w-full table-auto">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60  text-left border-b border-slate-200 dark:border-slate-800 ">
                      {['Hora Marcaje', 'Clave', 'Colaborador', 'Tipo', 'Origen / Método', 'Motivo / Justificación', 'Autorizado Por', 'Acciones'].map(h => (
                        <th key={h} className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(3,54,61,0.07)] ">
                    {filtered.map(a => {
                      const emp = a.empleado || {}
                      return (
                        <tr key={a.id} className="hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-50 dark:bg-slate-800/60/50 transition-colors">
                          {/* Hora */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white  block">
                              {formatTimeOnly(a.verificado_at)}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              {formatDateOnly(a.verificado_at)}
                            </span>
                          </td>

                          {/* Clave de Colaborador */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {emp.clave_empleado ? (
                              <span className="inline-flex items-center gap-1 font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  text-slate-900 dark:text-white  border border-slate-200 dark:border-slate-800 ">
                                <BadgeCheck className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                {emp.clave_empleado}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 text-xs font-mono">—</span>
                            )}
                          </td>

                          {/* Colaborador */}
                          <td className="px-4 py-3.5">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white  leading-tight">
                              {emp.nombre} {emp.apellido}
                            </p>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {emp.departamento || 'Sin área'}
                            </span>
                          </td>

                          {/* Tipo */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <TipoBadge tipo={a.tipo_verificacion} />
                          </td>

                          {/* Origen / Método */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {a.es_manual ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
                                ✍️ Manual RH
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  text-slate-700 dark:text-slate-300 ">
                                📡 {a.metodo || 'Biométrico'}
                              </span>
                            )}
                          </td>

                          {/* Motivo */}
                          <td className="px-4 py-3.5 text-xs text-slate-700 dark:text-slate-300  max-w-xs">
                            {a.motivo_manual ? (
                              <div>
                                <p className="font-medium">{a.motivo_manual}</p>
                                {a.notas && <p className="text-[10px] text-slate-400 dark:text-slate-500">{a.notas}</p>}
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 italic">Marcaje en terminal física</span>
                            )}
                          </td>

                          {/* Autorizado Por */}
                          <td className="px-4 py-3.5 text-xs text-slate-700 dark:text-slate-300  whitespace-nowrap">
                            {a.autorizado_por || '—'}
                          </td>

                          {/* Acciones */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {a.es_manual && (
                                <button
                                  onClick={() => setModalForm(a)}
                                  className="p-1.5 rounded hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-sky-600 transition-colors"
                                  title="Editar Marcaje Manual"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDelete(a)}
                                className="p-1.5 rounded hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-rose-600 transition-colors"
                                title="Eliminar Registro"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </main>
      </div>

      {/* Modal Form */}
      {modalForm && (
        <ModalChecadaManual
          checada={modalForm === 'nuevo' ? null : modalForm}
          empleados={empleados}
          supervisores={supervisores}
          clienteId={clienteId}
          userEmail={userEmail}
          onClose={() => setModalForm(null)}
          onSaved={fetchData}
        />
      )}
    </div>
  )
}






