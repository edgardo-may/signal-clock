// src/pages/AsignacionHorarios.jsx — Agenda y Asignación de Horarios a Colaboradores
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useConfirm } from '../../../shared/hooks/useConfirm'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { usePagination } from '../../../shared/hooks/usePagination'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import PaginationControl from '../../../shared/components/ui/PaginationControl'
import {
  CalendarDays, Clock, Search, Filter,
  CheckCircle2, AlertTriangle, UserCheck,
  UserX, RefreshCw, X, Save, Check,
  BadgeCheck, Users, Calendar, ArrowRight,
  ShieldCheck, HelpCircle,
} from 'lucide-react'

function formatDate(ts) {
  if (!ts) return 'Permanente'
  const parts = String(ts).split('T')[0].split('-')
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(d)
  }
  return String(ts)
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

// ═══════════════════════════════════════════════════════════════
// MODAL: ASIGNAR HORARIO (INDIVIDUAL O EN LOTE)
// ═══════════════════════════════════════════════════════════════
function ModalAsignarHorario({
  selectedEmployees,
  horarios,
  clienteId,
  onClose,
  onSaved,
}) {
  const [horarioId, setHorarioId] = useState(horarios[0]?.id || '')
  const [fechaInicio, setFechaInicio] = useState(() => new Date().toISOString().slice(0, 10))
  const [esPermanente, setEsPermanente] = useState(true)
  const [fechaFin, setFechaFin] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedHorario = useMemo(() => {
    return horarios.find(h => h.id === horarioId)
  }, [horarios, horarioId])

  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!horarioId) {
      toast.error('Selecciona un horario válido')
      return
    }
    if (!fechaInicio) {
      toast.error('La fecha de inicio es requerida')
      return
    }
    if (!esPermanente && !fechaFin) {
      toast.error('Indica la fecha de fin o marca como permanente')
      return
    }

    const ok = await confirmDialog({
      title: '¿Asignar horario?',
      message: `El horario "${selectedHorario?.nombre}" será asignado a ${selectedEmployees.length} colaborador(es).`,
      variant: 'info',
      confirmLabel: 'Sí, asignar'
    })
    if (!ok) return

    setSaving(true)
    try {
      // Desactivar asignaciones activas previas de estos empleados
      const employeeIds = selectedEmployees.map(emp => emp.id)
      await supabase
        .from('empleados_horarios')
        .update({ activo: false, actualizado_at: new Date().toISOString() })
        .in('empleado_id', employeeIds)
        .eq('activo', true)

      // Insertar nuevas asignaciones
      const payloads = selectedEmployees.map(emp => ({
        cliente_id: clienteId,
        empleado_id: emp.id,
        horario_id: horarioId,
        fecha_inicio: fechaInicio,
        fecha_fin: esPermanente ? null : (fechaFin || null),
        activo: true,
        notas: notas.trim() || null,
      }))

      const { error } = await supabase
        .from('empleados_horarios')
        .insert(payloads)

      if (error) throw error

      toast.success(`Horario asignado a ${selectedEmployees.length} colaborador(es)`)
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err?.message || 'Error al asignar horario')
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800  sticky top-0 bg-white dark:bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400 ">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white ">
                Asignación de Horario / Turno
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300">
                {selectedEmployees.length === 1
                  ? `${selectedEmployees[0].nombre} ${selectedEmployees[0].apellido}`
                  : `Asignación masiva a ${selectedEmployees.length} colaboradores`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 ">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Selector de Horario */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Seleccionar Turno / Horario <span className="text-blue-600 dark:text-blue-400">*</span>
            </label>
            <select
              value={horarioId}
              onChange={e => setHorarioId(e.target.value)}
              className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 font-medium"
            >
              {horarios.map(h => (
                <option key={h.id} value={h.id}>
                  {h.nombre} (Tolerancia: {h.tolerancia_minutos} min)
                </option>
              ))}
            </select>
          </div>

          {/* Vista previa del horario seleccionado */}
          {selectedHorario && (
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800  bg-[#F8FAFC]  space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedHorario.color }} />
                  <span className="text-xs font-bold text-slate-900 dark:text-white ">{selectedHorario.nombre}</span>
                </div>
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400 ">
                  Tolerancia: {selectedHorario.tolerancia_minutos} min
                </span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 ">
                {selectedHorario.descripcion || 'Sin descripción adicional.'}
              </p>
            </div>
          )}

          {/* Fechas de vigencia */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Fecha de Inicio <span className="text-blue-600 dark:text-blue-400">*</span>
              </label>
              <input
                type="date"
                value={fechaInicio}
                onChange={e => setFechaInicio(e.target.value)}
                required
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Fecha de Fin
              </label>
              <input
                type="date"
                value={fechaFin}
                onChange={e => {
                  setFechaFin(e.target.value)
                  if (e.target.value) setEsPermanente(false)
                }}
                disabled={esPermanente}
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="f-permanente"
              checked={esPermanente}
              onChange={e => {
                setEsPermanente(e.target.checked)
                if (e.target.checked) setFechaFin('')
              }}
              className="w-4 h-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 cursor-pointer"
            />
            <label htmlFor="f-permanente" className="text-xs font-semibold text-slate-700 dark:text-slate-300  cursor-pointer">
              Horario permanente e indefinido (Sin fecha de vencimiento)
            </label>
          </div>

          {/* Notas */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Observaciones o Motivo de Rotación (Opcional)
            </label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="ej. Rotación trimestral de área o asignación inicial"
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-blue-500"
            />
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
              disabled={saving || !horarioId}
              className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-slate-100 shadow-md shadow-blue-600/25 transition-all active:scale-98 disabled:opacity-50"
            >
              {saving ? <><Spinner size={14} /> Asignando...</> : <><Save className="w-4 h-4" /> Confirmar Asignación</>}
            </button>
          </div>
        </form>
      </div>
      {ConfirmDialogNode}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: ASIGNACIÓN DE HORARIOS
// ═══════════════════════════════════════════════════════════════
export default function AsignacionHorarios() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))

  const {
    isSuperAdmin,
    tenants,
    loadingTenants,
    currentTenantId,
    currentTenant,
    setSelectedTenantId,
    requiresTenantAssignment,
  } = useCurrentTenant()

  const [empleados, setEmpleados] = useState([])
  const [horarios, setHorarios] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filterDepto, setFilterDepto] = useState('todos')
  const [filterHorario, setFilterHorario] = useState('todos')
  const [selectedIds, setSelectedIds] = useState([])

  const [modalAsignar, setModalAsignar] = useState(null)

  // Cargar datos
  const fetchData = useCallback(async () => {
    if (!currentTenantId) {
      setEmpleados([])
      setHorarios([])
      setAsignaciones([])
      setLoading(false)
      return
    }
    setLoading(true)

    // Cargar empleados, horarios y asignaciones en paralelo
    const [empRes, horRes, asigRes] = await Promise.all([
      supabase
        .from('empleados')
        .select('id, nombre, apellido, clave_empleado, departamento, puesto, device_userid, activo, email')
        .eq('cliente_id', currentTenantId)
        .order('apellido', { ascending: true }),
      supabase
        .from('horarios')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .order('nombre', { ascending: true }),
      supabase
        .from('empleados_horarios')
        .select('*, horario:horarios(*)')
        .eq('cliente_id', currentTenantId)
        .eq('activo', true),
    ])

    if (empRes.error) toast.error('Error al cargar colaboradores: ' + empRes.error.message)
    if (horRes.error) toast.error('Error al cargar horarios: ' + horRes.error.message)
    if (asigRes.error) toast.error('Error al cargar asignaciones: ' + asigRes.error.message)

    setEmpleados(empRes.data || [])
    setHorarios(horRes.data || [])
    setAsignaciones(asigRes.data || [])
    setLoading(false)
  }, [currentTenantId])

  useEffect(() => { fetchData() }, [fetchData])

  // Mapeo rápido de horario por empleado
  const asignacionPorEmpleado = useMemo(() => {
    const map = {}
    asignaciones.forEach(a => {
      map[a.empleado_id] = a
    })
    return map
  }, [asignaciones])

  // Departamentos únicos
  const departamentos = useMemo(() => {
    const set = new Set(empleados.map(e => e.departamento).filter(Boolean))
    return Array.from(set)
  }, [empleados])

  // Filtrado reactivo
  const filtered = useMemo(() => {
    return empleados.filter(emp => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        `${emp.nombre} ${emp.apellido}`.toLowerCase().includes(q) ||
        emp.clave_empleado?.toLowerCase().includes(q) ||
        emp.device_userid?.toLowerCase().includes(q) ||
        emp.departamento?.toLowerCase().includes(q) ||
        emp.puesto?.toLowerCase().includes(q)

      const matchDepto = filterDepto === 'todos' || emp.departamento === filterDepto

      const asig = asignacionPorEmpleado[emp.id]
      const matchHorario =
        filterHorario === 'todos' ||
        (filterHorario === 'sin_horario' && !asig) ||
        (asig && asig.horario_id === filterHorario)

      return matchSearch && matchDepto && matchHorario
    })
  }, [empleados, search, filterDepto, filterHorario, asignacionPorEmpleado])

  // Usar el custom hook de paginación
  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedEmpleados,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage
  } = usePagination(filtered, 5, [search, filterDepto, filterHorario])

  // Métricas
  const totalConHorario = Object.keys(asignacionPorEmpleado).length
  const totalSinHorario = Math.max(0, empleados.length - totalConHorario)

  // Toggle de selección en lote
  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map(e => e.id))
    }
  }

  const toggleSelectOne = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  // Desasignar horario
  const handleDesasignar = async (empleado) => {
    const ok = await confirmDialog({
      title: '¿Retirar horario?',
      message: `Se eliminará la asignación actual de horario para ${empleado.nombre}.`,
      variant: 'warning',
      confirmLabel: 'Sí, retirar'
    })
    if (!ok) return

    try {
      const { error } = await supabase
        .from('empleados_horarios')
        .update({ activo: false, actualizado_at: new Date().toISOString() })
        .eq('empleado_id', empleado.id)
        .eq('activo', true)

      if (error) throw error
      toast.success(`Horario retirado a ${empleado.nombre}`)
      fetchData()
    } catch (err) {
      toast.error('Error al desasignar horario: ' + err.message)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]  text-slate-900 dark:text-white ">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />
      {ConfirmDialogNode}

      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

          {/* Banner de Asignación de Tenant (SOLO para usuarios regulares sin cliente_id) */}
          {requiresTenantAssignment && (
            <div className="flex items-center gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
            </div>
          )}

          {/* Barra Superior */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white  flex items-center gap-2.5">
                  <CalendarDays className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  Agenda y Asignación de Horarios
                </h2>
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    SuperAdmin
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                Vinculación de turnos para <strong className="text-blue-600 dark:text-blue-400">{currentTenant?.nombre_empresa || 'Empresa'}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Selector de Tenant para SuperAdmin */}
              {isSuperAdmin && (
                <TenantSelector
                  tenants={tenants}
                  currentTenantId={currentTenantId}
                  onSelectTenant={setSelectedTenantId}
                  loading={loadingTenants}
                />
              )}

              {/* Botón Asignación Masiva */}
              <button
                onClick={() => {
                  if (selectedIds.length === 0) {
                    toast.error('Selecciona al menos un colaborador con las casillas de la tabla')
                    return
                  }
                  const selected = empleados.filter(e => selectedIds.includes(e.id))
                  setModalAsignar(selected)
                }}
                disabled={selectedIds.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <Users className="w-4 h-4" />
                <span>Asignar Horario en Lote ({selectedIds.length})</span>
              </button>
            </div>
          </div>

          {/* Cards de Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Plantilla de Colaboradores</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{empleados.length}</h3>
              </div>
              <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400 ">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Con Horario Asignado</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{totalConHorario}</h3>
              </div>
              <div className="p-3 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Sin Horario (Alerta)</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{totalSinHorario}</h3>
              </div>
              <div className="p-3 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                <UserX className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Toolbar de Filtros */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-4 shadow-sm  dark:bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Buscador */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por clave laboral, nombre, ID biométrico..."
                className="w-full pl-9 pr-4 py-2 rounded-md border border-slate-200 dark:border-slate-800  bg-slate-50  text-xs sm:text-sm text-slate-900 dark:text-white  placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Filtros Dropdown */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Filtro Departamento */}
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <select
                  value={filterDepto}
                  onChange={e => setFilterDepto(e.target.value)}
                  className="py-1.5 px-2.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50  text-slate-700 dark:text-slate-300  outline-none font-medium"
                >
                  <option value="todos">Todos los Departamentos</option>
                  {departamentos.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Filtro Horario */}
              <div className="flex items-center gap-1.5 text-xs">
                <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <select
                  value={filterHorario}
                  onChange={e => setFilterHorario(e.target.value)}
                  className="py-1.5 px-2.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50  text-slate-700 dark:text-slate-300  outline-none font-medium"
                >
                  <option value="todos">Todos los Turnos</option>
                  <option value="sin_horario">⚠️ Sin Horario Asignado</option>
                  {horarios.map(h => (
                    <option key={h.id} value={h.id}>{h.nombre}</option>
                  ))}
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

          {/* Tabla de Asignación */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white shadow-sm  dark:bg-white">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-20 gap-2 text-slate-700 dark:text-slate-300 text-sm">
                  <Spinner size={18} />
                  Cargando agenda de colaboradores...
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400 dark:text-slate-500">
                  <CalendarDays className="w-10 h-10 stroke-1" />
                  <p className="text-sm font-medium">No se encontraron colaboradores con los filtros seleccionados.</p>
                </div>
              ) : (
                <table className="w-full table-auto">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60  text-left border-b border-slate-200 dark:border-slate-800 ">
                      <th className="px-4 py-3.5 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.length === filtered.length && filtered.length > 0}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 cursor-pointer"
                        />
                      </th>
                      {['Clave', 'Colaborador', 'Departamento / Puesto', 'Horario Asignado', 'Vigencia', 'Acciones'].map(h => (
                        <th key={h} className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(3,54,61,0.07)] ">
                    {paginatedEmpleados.map(emp => {
                      const asig = asignacionPorEmpleado[emp.id]
                      const hor = asig?.horario
                      const isSelected = selectedIds.includes(emp.id)

                      return (
                        <tr
                          key={emp.id}
                          className={`transition-colors ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-950/60/60 dark:bg-blue-950/30'
                              : 'hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-50 dark:bg-slate-800/60/50'
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="px-4 py-3.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectOne(emp.id)}
                              className="w-4 h-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 cursor-pointer"
                            />
                          </td>

                          {/* Clave de Colaborador */}
                          <td className="px-4 py-3.5">
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
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white  leading-tight">
                                {emp.nombre} {emp.apellido}
                              </p>
                              <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                                ID: {emp.device_userid}
                              </span>
                            </div>
                          </td>

                          {/* Departamento y Puesto */}
                          <td className="px-4 py-3.5">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 ">
                              {emp.departamento || 'Sin área'}
                            </p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500">{emp.puesto || 'Sin cargo'}</p>
                          </td>

                          {/* Horario Asignado */}
                          <td className="px-4 py-3.5">
                            {hor ? (
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: hor.color || '#4f46e5' }}
                                />
                                <div>
                                  <p className="text-xs font-bold text-slate-900 dark:text-white  leading-tight">
                                    {hor.nombre}
                                  </p>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                    Tolerancia: {hor.tolerancia_minutos} min
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/40">
                                <AlertTriangle className="w-3 h-3" /> Sin Horario
                              </span>
                            )}
                          </td>

                          {/* Vigencia */}
                          <td className="px-4 py-3.5 text-xs text-slate-700 dark:text-slate-300  font-mono">
                            {asig ? (
                              <div>
                                <span>{formatDate(asig.fecha_inicio)}</span>
                                <span className="text-slate-400 dark:text-slate-500 mx-1">➔</span>
                                <span>{formatDate(asig.fecha_fin)}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500">—</span>
                            )}
                          </td>

                          {/* Acciones */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setModalAsignar([emp])}
                                className="px-2.5 py-1 rounded text-xs font-semibold text-blue-600 dark:text-blue-400  bg-blue-50 dark:bg-blue-950/60  border border-blue-500/40  hover:bg-blue-100 transition-colors"
                              >
                                {hor ? 'Cambiar Turno' : 'Asignar Turno'}
                              </button>

                              {hor && (
                                <button
                                  onClick={() => handleDesasignar(emp)}
                                  className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                  title="Quitar horario asignado"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Controles de Paginación Global */}
            {!loading && filtered.length > 0 && (
              <PaginationControl
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                startIndex={startIndex}
                endIndex={endIndex}
                nextPage={nextPage}
                prevPage={prevPage}
                itemName="colaboradores"
              />
            )}
          </div>

        </main>
      </div>

      {/* Modal de Asignación */}
      {modalAsignar && (
        <ModalAsignarHorario
          selectedEmployees={modalAsignar}
          horarios={horarios}
          clienteId={currentTenantId}
          onClose={() => setModalAsignar(null)}
          onSaved={() => {
            setSelectedIds([])
            fetchData()
          }}
        />
      )}
    </div>
  )
}






