// src/pages/DiasFestivos.jsx — Calendario de Días Festivos, Asuetos y Festivos Trabajados
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
  CalendarHeart, Plus, Sparkles, Edit3,
  Trash2, AlertTriangle, X, Save, RefreshCw,
  Search, Filter, CheckCircle2, DollarSign,
  Calendar, Check, ShieldCheck, HelpCircle,
  Building2, PartyPopper, Clock,
} from 'lucide-react'

function formatDateLong(dateStr) {
  if (!dateStr) return '—'
  const parts = String(dateStr).split('T')[0].split('-')
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    return new Intl.DateTimeFormat('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(d)
  }
  return dateStr
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—'
  const parts = String(dateStr).split('T')[0].split('-')
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit', month: 'short',
    }).format(d)
  }
  return dateStr
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

// Helper para calcular el N-ésimo Lunes de un mes
function getNthMonday(year, monthIndex, nth) {
  const d = new Date(year, monthIndex, 1)
  let count = 0
  while (d.getMonth() === monthIndex) {
    if (d.getDay() === 1) { // 1 = Lunes
      count++
      if (count === nth) {
        return d.toISOString().slice(0, 10)
      }
    }
    d.setDate(d.getDate() + 1)
  }
  return null
}

// Generador de Festivos Oficiales de la Ley Federal del Trabajo (México)
function generarFestivosOficialesLFT(year) {
  const y = Number(year)
  const lft = [
    {
      fecha: `${y}-01-01`,
      nombre: 'Año Nuevo',
      tipo: 'oficial',
      descripcion: 'Feriado oficial de descanso obligatorio por LFT.',
      remuneracion_extra: true,
      color: '#ec4899',
    },
    {
      fecha: getNthMonday(y, 1, 1) || `${y}-02-05`, // 1er Lunes de Febrero
      nombre: 'Día de la Constitución Mexicana',
      tipo: 'oficial',
      descripcion: 'Conmemoración del 5 de Febrero (primer lunes de febrero).',
      remuneracion_extra: true,
      color: '#ec4899',
    },
    {
      fecha: getNthMonday(y, 2, 3) || `${y}-03-21`, // 3er Lunes de Marzo
      nombre: 'Natalicio de Benito Juárez',
      tipo: 'oficial',
      descripcion: 'Conmemoración del 21 de Marzo (tercer lunes de marzo).',
      remuneracion_extra: true,
      color: '#ec4899',
    },
    {
      fecha: `${y}-05-01`,
      nombre: 'Día Internacional del Trabajo',
      tipo: 'oficial',
      descripcion: 'Feriado oficial de descanso obligatorio por LFT.',
      remuneracion_extra: true,
      color: '#ec4899',
    },
    {
      fecha: `${y}-09-16`,
      nombre: 'Día de la Independencia de México',
      tipo: 'oficial',
      descripcion: 'Feriado nacional de descanso obligatorio por LFT.',
      remuneracion_extra: true,
      color: '#10b981',
    },
    {
      fecha: getNthMonday(y, 10, 3) || `${y}-11-20`, // 3er Lunes de Noviembre
      nombre: 'Día de la Revolución Mexicana',
      tipo: 'oficial',
      descripcion: 'Conmemoración del 20 de Noviembre (tercer lunes de noviembre).',
      remuneracion_extra: true,
      color: '#ec4899',
    },
    {
      fecha: `${y}-12-25`,
      nombre: 'Navidad',
      tipo: 'oficial',
      descripcion: 'Feriado oficial de descanso obligatorio por LFT.',
      remuneracion_extra: true,
      color: '#ec4899',
    },
  ]

  // Transmisión del Poder Ejecutivo (1 de Octubre cada 6 años: 2024, 2030...)
  if ((y - 2024) % 6 === 0) {
    lft.push({
      fecha: `${y}-10-01`,
      nombre: 'Transmisión del Poder Ejecutivo Federal',
      tipo: 'oficial',
      descripcion: 'Cambio de mando presidencial cada 6 años por reforma LFT.',
      remuneracion_extra: true,
      color: '#8b5cf6',
    })
  }

  return lft
}

// ═══════════════════════════════════════════════════════════════
// MODAL: CREAR / EDITAR DÍA FESTIVO
// ═══════════════════════════════════════════════════════════════
function ModalFestivo({ festivo, clienteId, defaultYear, onClose, onSaved }) {
  const { confirmDialog, ConfirmDialogNode } = useConfirm()
  const isEdit = !!festivo
  const [nombre, setNombre] = useState(festivo?.nombre || '')
  const [fecha, setFecha] = useState(festivo?.fecha || `${defaultYear}-01-01`)
  const [tipo, setTipo] = useState(festivo?.tipo || 'oficial')
  const [remuneracionExtra, setRemuneracionExtra] = useState(festivo?.remuneracion_extra ?? true)
  const [color, setColor] = useState(festivo?.color || '#ec4899')
  const [descripcion, setDescripcion] = useState(festivo?.descripcion || '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!nombre.trim()) {
      toast.error('Indica el nombre del festivo o asueto')
      return
    }
    if (!fecha) {
      toast.error('Selecciona la fecha')
      return
    }

    if (!isEdit) {
      const ok = await confirmDialog({
        title: '¿Registrar día festivo?',
        message: `Se creará el festivo "${nombre.trim()}" en la fecha seleccionada.`,
        variant: 'info',
        confirmLabel: 'Sí, registrar'
      });
      if (!ok) return;
    }

    setSaving(true)
    try {
      const payload = {
        cliente_id: clienteId,
        nombre: nombre.trim(),
        fecha,
        tipo,
        remuneracion_extra: remuneracionExtra,
        color,
        descripcion: descripcion.trim() || null,
        activo: true,
        actualizado_at: new Date().toISOString(),
      }

      if (isEdit) {
        const { error } = await supabase
          .from('dias_festivos')
          .update(payload)
          .eq('id', festivo.id)
        if (error) throw error
        toast.success(`Festivo "${nombre}" actualizado`)
      } else {
        const { error } = await supabase
          .from('dias_festivos')
          .insert(payload)
        if (error) throw error
        toast.success(`Festivo "${nombre}" registrado`)
      }

      onSaved()
      onClose()
    } catch (err) {
      if (err?.code === '23505') {
        toast.error('Ya existe un día festivo registrado en esa fecha.')
      } else {
        toast.error(err?.message || 'Error al guardar el festivo')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-[95%] sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800  sticky top-0 bg-white dark:bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-pink-50 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400">
              <CalendarHeart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white ">
                {isEdit ? 'Editar Día Festivo' : 'Registrar Día Festivo / Asueto'}
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Configuración de descansos automáticos y festivos laborados
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 ">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Nombre de la Celebración / Asueto <span className="text-pink-500">*</span>
            </label>
            <input
              type="text"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="ej. Día de la Independencia, Aniversario de la Empresa..."
              required
              className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-pink-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Fecha del Festivo <span className="text-pink-500">*</span>
              </label>
              <input
                type="date"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                required
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-pink-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Tipo de Feriado
              </label>
              <select
                value={tipo}
                onChange={e => setTipo(e.target.value)}
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  outline-none focus:border-pink-500"
              >
                <option value="oficial">🏛️ Oficial Obligatorio (LFT)</option>
                <option value="empresa">🏢 Asueto de Empresa / Local</option>
                <option value="bancario">🏦 Feriado Bancario</option>
              </select>
            </div>
          </div>

          {/* Regla de Festivo Trabajado */}
          <div className="rounded-lg p-4 bg-pink-50/60 dark:bg-pink-950/20 border border-pink-100 dark:border-pink-900/40 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="f-remuneracion"
                checked={remuneracionExtra}
                onChange={e => setRemuneracionExtra(e.target.checked)}
                className="w-4 h-4 rounded text-pink-600 focus:ring-pink-500 cursor-pointer"
              />
              <label htmlFor="f-remuneracion" className="text-xs font-bold text-slate-900 dark:text-white  cursor-pointer">
                Considerar como Festivo Trabajado (Remuneración Especial)
              </label>
            </div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300  pl-6 leading-relaxed">
              Si un colaborador checa su entrada en las terminales biométricas este día, el sistema no lo considerará una jornada ordinaria sino un <strong>festivo laborado</strong> para cálculo de prima/pago doble según la normativa laboral.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Descripción o Motivo (Opcional)
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Detalles sobre guardias, descansos obligatorios..."
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-pink-500"
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
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-pink-600 hover:bg-pink-700 shadow-md shadow-pink-500/30 transition-all active:scale-98 disabled:opacity-50"
            >
              {saving ? <><Spinner size={14} /> Guardando...</> : <><Save className="w-4 h-4" /> {isEdit ? 'Actualizar Festivo' : 'Guardar Festivo'}</>}
            </button>
          </div>
        </form>
      </div>
      {ConfirmDialogNode}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: DÍAS FESTIVOS
// ═══════════════════════════════════════════════════════════════
export default function DiasFestivos() {
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

  const [festivos, setFestivos] = useState([])
  const [loading, setLoading] = useState(true)
  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear())
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState('todos')
  const [modalForm, setModalForm] = useState(null)
  const [importingLFT, setImportingLFT] = useState(false)

  // Cargar catálogo de festivos del año
  const fetchFestivos = useCallback(async () => {
    if (!currentTenantId) {
      setFestivos([])
      setLoading(false)
      return
    }
    setLoading(true)
    const startYear = `${selectedYear}-01-01`
    const endYear = `${selectedYear}-12-31`

    const { data, error } = await supabase
      .from('dias_festivos')
      .select('*')
      .eq('cliente_id', currentTenantId)
      .gte('fecha', startYear)
      .lte('fecha', endYear)
      .order('fecha', { ascending: true })

    if (error) {
      toast.error('Error al cargar festivos: ' + error.message)
    } else {
      setFestivos(data || [])
    }
    setLoading(false)
  }, [currentTenantId, selectedYear])

  useEffect(() => { fetchFestivos() }, [fetchFestivos])

  // Cargar Festivos Oficiales LFT con 1 clic
  const handleCargarOficialesLFT = async () => {
    if (!currentTenantId) {
      toast.error(isSuperAdmin ? 'Por favor selecciona una empresa primero.' : 'Se requiere cliente_id')
      return
    }
    setImportingLFT(true)
    try {
      const oficiales = generarFestivosOficialesLFT(selectedYear)
      const payloads = oficiales.map(f => ({
        cliente_id: currentTenantId,
        nombre: f.nombre,
        fecha: f.fecha,
        tipo: f.tipo,
        remuneracion_extra: f.remuneracion_extra,
        color: f.color,
        descripcion: f.descripcion,
        activo: true,
      }))

      // Inserción en lote ignorando duplicados si ya existen
      const { error } = await supabase
        .from('dias_festivos')
        .upsert(payloads, { onConflict: 'cliente_id,fecha' })

      if (error) throw error

      toast.success(`Festivos oficiales ${selectedYear} cargados exitosamente`)
      fetchFestivos()
    } catch (err) {
      toast.error('Error al importar festivos LFT: ' + err.message)
    } finally {
      setImportingLFT(false)
    }
  }


  // Eliminar festivo
  const handleDelete = async (festivo) => {
    const ok = await confirmDialog({
      title: 'Eliminar Día Festivo',
      message: `¿Eliminar "${festivo.nombre}" (${festivo.fecha})? Esta acción afectará el cálculo de nómina.`,
      variant: 'danger',
      confirmLabel: 'Sí, eliminar'
    })
    if (!ok) return

    try {
      const { error } = await supabase
        .from('dias_festivos')
        .delete()
        .eq('id', festivo.id)

      if (error) throw error

      toast.success(`Festivo "${festivo.nombre}" eliminado`)
      fetchFestivos()
    } catch (err) {
      toast.error('Error al eliminar festivo: ' + err.message)
    }
  }

  // Filtrado reactivo
  const filtered = festivos.filter(f => {
    const q = search.toLowerCase()
    const matchSearch = !q || f.nombre.toLowerCase().includes(q) || f.descripcion?.toLowerCase().includes(q)
    const matchTipo = filterTipo === 'todos' || f.tipo === filterTipo
    return matchSearch && matchTipo
  })

  // Usar el custom hook de paginación
  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedFestivos,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage
  } = usePagination(filtered, 5, [search, filterTipo, selectedYear])

  // Métricas rápidas
  const totalRemunerados = festivos.filter(f => f.remuneracion_extra && f.activo).length
  const proximoFestivo = festivos
    .filter(f => {
      const parts = f.fecha.split('-')
      const festDate = new Date(parts[0], parts[1] - 1, parts[2])
      const today = new Date()
      today.setHours(0,0,0,0)
      return festDate >= today && f.activo
    })
    .map(f => {
      const parts = f.fecha.split('-')
      const festDate = new Date(parts[0], parts[1] - 1, parts[2])
      const today = new Date()
      today.setHours(0,0,0,0)
      const diffDays = Math.ceil((festDate - today) / (1000 * 60 * 60 * 24))
      return { ...f, diasFaltantes: diffDays }
    })[0]

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]  text-slate-900 dark:text-white ">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />
      {ConfirmDialogNode}

      {/* ── Sidebar TailAdmin ───────────────────────────────── */}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* ── Content Area ────────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* ── Header TailAdmin ──────────────────────────────── */}
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        {/* ── Main Content Container ────────────────────────── */}
        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

          {/* Banner de Asignación de Tenant (SOLO para usuarios regulares sin cliente_id) */}
          {requiresTenantAssignment && (
            <div className="flex items-center gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
            </div>
          )}

          {/* Barra superior de acciones */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white  flex items-center gap-2.5">
                  <CalendarHeart className="w-6 h-6 text-pink-500" />
                  Días Festivos & Feriados Oficiales
                </h2>
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    SuperAdmin
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                Calendario laboral para <strong className="text-blue-600 dark:text-blue-400">{currentTenant?.nombre_empresa || 'Empresa'}</strong> ({filtered.length} registrados)
              </p>
            </div>

            {/* Controles y Botón Alta */}
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

              {/* Selector de Año */}
              <div className="flex items-center gap-1 bg-white dark:bg-white border border-slate-200 dark:border-slate-800  rounded-md px-3 py-1.5 shadow-sm">
                <Calendar className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="bg-transparent text-xs sm:text-sm font-semibold text-slate-900 dark:text-white  outline-none cursor-pointer"
                >
                  {[2024, 2025, 2026, 2027, 2028].map(y => (
                    <option key={y} value={y} className="bg-white  text-slate-900 dark:text-white ">
                      Año {y}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botón Cargar Festivos LFT con 1 clic */}
              <button
                onClick={handleCargarOficialesLFT}
                disabled={importingLFT}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-white dark:bg-white text-pink-600 dark:text-pink-400 border border-slate-200 dark:border-slate-800  hover:bg-pink-50 dark:hover:bg-slate-50 dark:bg-slate-800/60 transition-all shadow-sm active:scale-98 disabled:opacity-50 cursor-pointer"
                title="Carga en lote los feriados oficiales de la Ley Federal del Trabajo"
              >
                {importingLFT ? <Spinner size={14} /> : <Sparkles className="w-3.5 h-3.5 text-pink-500" />}
                <span>Cargar Festivos Oficiales LFT</span>
              </button>

              {/* Botón Agregar Festivo Personalizado */}
              <button
                onClick={() => currentTenantId ? setModalForm('nuevo') : toast.error(isSuperAdmin ? 'Selecciona una empresa primero' : 'Se requiere cliente_id')}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-white bg-pink-600 hover:bg-pink-700 shadow-md shadow-pink-500/30 transition-all active:scale-98 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Nuevo Día Festivo</span>
              </button>
            </div>
          </div>

          {/* Cards de Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Festivos del Año {selectedYear}</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{festivos.length}</h3>
              </div>
              <div className="p-3 rounded-full bg-pink-50 dark:bg-pink-950/50 text-pink-600 dark:text-pink-400">
                <PartyPopper className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Con Pago Festivo Trabajado</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white  mt-1">{totalRemunerados}</h3>
              </div>
              <div className="p-3 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 ">Próximo Festivo</p>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white  mt-1 truncate max-w-[180px]">
                  {proximoFestivo ? proximoFestivo.nombre : 'Sin festivos próximos'}
                </h3>
                {proximoFestivo && (
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                    {proximoFestivo.diasFaltantes === 0 ? '¡Es hoy!' : `Faltan ${proximoFestivo.diasFaltantes} días (${formatDateShort(proximoFestivo.fecha)})`}
                  </p>
                )}
              </div>
              <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/60 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 ">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Buscador y Filtros */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-4 shadow-sm  dark:bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar festivo por nombre o descripción..."
                className="w-full pl-9 pr-4 py-2 rounded-md border border-slate-200 dark:border-slate-800  bg-slate-50  text-xs sm:text-sm text-slate-900 dark:text-white  placeholder-slate-400 focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <select
                  value={filterTipo}
                  onChange={e => setFilterTipo(e.target.value)}
                  className="py-1.5 px-2.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50  text-slate-700 dark:text-slate-300  outline-none font-medium"
                >
                  <option value="todos">Todos los Tipos</option>
                  <option value="oficial">Oficial LFT</option>
                  <option value="empresa">Asueto de Empresa</option>
                  <option value="bancario">Feriado Bancario</option>
                </select>
              </div>

              <button
                onClick={fetchFestivos}
                disabled={loading}
                className="p-2 rounded-md border border-slate-200 dark:border-slate-800  text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white  transition-colors"
                title="Recargar"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Lista de Festivos */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white shadow-sm  dark:bg-white">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-20 gap-2 text-slate-700 dark:text-slate-300 text-sm">
                  <Spinner size={18} />
                  Cargando calendario festivo...
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-sm p-8 text-center">
                  <CalendarHeart className="w-12 h-12 text-slate-300 dark:text-slate-700 dark:text-slate-300" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white ">
                      No hay festivos registrados en {selectedYear}
                    </h4>
                    <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                      Carga en 1 clic los feriados de la Ley Federal del Trabajo o agrega los propios de tu empresa.
                    </p>
                  </div>
                  <button
                    onClick={handleCargarOficialesLFT}
                    className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold text-white bg-pink-600 hover:bg-pink-700 shadow-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    Cargar Festivos Oficiales LFT
                  </button>
                </div>
              ) : (
                <table className="w-full table-auto">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60  text-left border-b border-slate-200 dark:border-slate-800 ">
                      {['Fecha', 'Celebración / Festivo', 'Tipo', 'Regla de Asistencia', 'Descripción', 'Acciones'].map(h => (
                        <th key={h} className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(3,54,61,0.07)] ">
                    {paginatedFestivos.map(f => (
                      <tr key={f.id} className="hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-50 dark:bg-slate-800/60/50 transition-colors">
                        {/* Fecha */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: f.color || '#ec4899' }} />
                            <div>
                              <span className="font-mono text-xs font-bold text-slate-900 dark:text-white  block">
                                {formatDateShort(f.fecha)}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium capitalize">
                                {formatDateLong(f.fecha).split(',')[0]}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Nombre */}
                        <td className="px-4 py-3.5">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white  leading-tight">
                            {f.nombre}
                          </p>
                        </td>

                        {/* Tipo */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {f.tipo === 'oficial' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-pink-50 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400 border border-pink-200 dark:border-pink-800/40">
                              🏛️ Oficial LFT
                            </span>
                          ) : f.tipo === 'empresa' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400  border border-blue-500/40 ">
                              🏢 Asueto Empresa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  text-slate-700 dark:text-slate-300 ">
                              🏦 Bancario
                            </span>
                          )}
                        </td>

                        {/* Regla de Asistencia (Festivo Trabajado) */}
                        <td className="px-4 py-3.5">
                          {f.remuneracion_extra ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/40">
                              <DollarSign className="w-3 h-3" />
                              Festivo Trabajado (Remuneración Especial)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-blue-50 dark:bg-blue-950/60  px-2 py-0.5 rounded">
                              Descanso Ordinario
                            </span>
                          )}
                        </td>

                        {/* Descripción */}
                        <td className="px-4 py-3.5 text-xs text-slate-700 dark:text-slate-300  max-w-xs truncate">
                          {f.descripcion || '—'}
                        </td>

                        {/* Acciones */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setModalForm(f)}
                              className="p-1.5 rounded hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-sky-600 transition-colors"
                              title="Editar Festivo"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(f)}
                              className="p-1.5 rounded hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-rose-600 transition-colors"
                              title="Eliminar Festivo"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
                itemName="festivos"
              />
            )}
          </div>

        </main>
      </div>

      {/* Modal Form */}
      {modalForm && (
        <ModalFestivo
          festivo={modalForm === 'nuevo' ? null : modalForm}
          clienteId={currentTenantId}
          defaultYear={selectedYear}
          onClose={() => setModalForm(null)}
          onSaved={fetchFestivos}
        />
      )}
    </div>
  )
}






