// src/features/reports/pages/ReportesPage.jsx — Módulo de Reportes de Asistencias y Nómina
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import {
  FileSpreadsheet, FileDown, CalendarDays, Download,
  Users, AlertTriangle, RefreshCw, Activity,
  CheckCircle2, Building2
} from 'lucide-react'

// ─── Componentes Auxiliares ──────────────────────────────────────────
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

function formatDateOnly(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
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

// ─── Lógica de Generación de Archivos CSV ────────────────────────────
function exportToCsv(filename, rows) {
  if (!rows || !rows.length) return
  const separator = ','
  const keys = Object.keys(rows[0])
  const csvContent =
    keys.join(separator) +
    '\n' +
    rows.map(row => {
      return keys.map(k => {
        let cell = row[k] === null || row[k] === undefined ? '' : row[k]
        cell = cell instanceof Date
          ? cell.toLocaleString()
          : cell.toString().replace(/"/g, '""')
        if (cell.search(/("|,|\n)/g) >= 0) {
          cell = `"${cell}"`
        }
        return cell
      }).join(separator)
    }).join('\n')

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success(`Reporte ${filename} descargado`)
  }
}

// ─── Página Principal ────────────────────────────────────────────────
export default function ReportesPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  
  const {
    isSuperAdmin,
    tenants,
    loadingTenants,
    currentTenantId,
    currentTenant,
    setSelectedTenantId,
    requiresTenantAssignment,
  } = useCurrentTenant()

  // Data
  const [periodos, setPeriodos] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [asistencias, setAsistencias] = useState([])
  const [incidencias, setIncidencias] = useState([])
  
  // Filtros
  const [selectedPeriodoId, setSelectedPeriodoId] = useState('')

  const fetchData = useCallback(async () => {
    if (!currentTenantId) {
      setPeriodos([])
      setEmpleados([])
      setAsistencias([])
      setIncidencias([])
      setLoading(false)
      return
    }
    setLoading(true)

    try {
      // 1. Obtener Periodos
      const { data: perData } = await supabase
        .from('periodos_nomina')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .order('fecha_inicio', { ascending: false })
      
      setPeriodos(perData || [])
      
      let currPeriodoId = selectedPeriodoId
      if ((!currPeriodoId || !perData?.some(p => p.id === currPeriodoId)) && perData?.length > 0) {
        currPeriodoId = perData[0].id
        setSelectedPeriodoId(currPeriodoId)
      }
      
      const currentPeriodo = perData?.find(p => p.id === currPeriodoId)
      
      if (!currentPeriodo) {
        setEmpleados([])
        setAsistencias([])
        setIncidencias([])
        setLoading(false)
        return
      }

      // 2. Obtener Empleados
      const { data: empData } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, clave_empleado, departamento')
        .eq('cliente_id', currentTenantId)
        .order('apellido')
      
      setEmpleados(empData || [])

      // 3. Obtener Asistencias del periodo
      const startDate = new Date(currentPeriodo.fecha_inicio)
      const endDate = new Date(currentPeriodo.fecha_fin)
      endDate.setDate(endDate.getDate() + 1)

      const { data: asisData } = await supabase
        .from('registro_asistencia')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .gte('verificado_at', startDate.toISOString())
        .lt('verificado_at', endDate.toISOString())
        .order('verificado_at', { ascending: true })
      
      setAsistencias(asisData || [])

      // 4. Obtener Incidencias
      const { data: incData } = await supabase
        .from('incidencias')
        .select('*, empleado:empleados(id, nombre, apellido, clave_empleado)')
        .eq('cliente_id', currentTenantId)
        .eq('estado', 'Aprobado')
        .gte('fecha_fin', currentPeriodo.fecha_inicio)
        .lte('fecha_inicio', currentPeriodo.fecha_fin)

      setIncidencias(incData || [])

    } catch (err) {
      toast.error('Error al cargar datos: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [currentTenantId, selectedPeriodoId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ─── Generadores de Reportes ───────────────────────────────────────

  const handleDownloadAsistenciasDetallado = async () => {
    setGenerating(true)
    try {
      const rows = asistencias.map(a => {
        const emp = empleados.find(e => e.id === a.empleado_id)
        return {
          'Clave Empleado': emp?.clave_empleado || '',
          'Nombre': emp ? `${emp.nombre} ${emp.apellido}` : 'Desconocido',
          'Departamento': emp?.departamento || '',
          'Fecha': formatDateOnly(a.verificado_at),
          'Hora': formatTimeOnly(a.verificado_at),
          'Tipo de Registro': a.tipo_verificacion,
          'Método': a.metodo,
          'Es Manual': a.es_manual ? 'Sí' : 'No',
          'Motivo/Notas': a.es_manual ? (a.motivo_manual || a.notas) : ''
        }
      })
      if (rows.length === 0) return toast.error('No hay registros de asistencia en este periodo')
      exportToCsv('Reporte_Asistencias_Detallado.csv', rows)
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadResumenNomina = async () => {
    setGenerating(true)
    try {
      const periodo = periodos.find(p => p.id === selectedPeriodoId)
      if (!periodo) return toast.error('Periodo inválido')

      // Días totales del periodo
      const start = new Date(periodo.fecha_inicio)
      const end = new Date(periodo.fecha_fin)
      const totalDias = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1

      const rows = empleados.map(emp => {
        // Filtrar datos del empleado
        const empAsis = asistencias.filter(a => a.empleado_id === emp.id)
        const empInc = incidencias.filter(i => i.empleado_id === emp.id)

        // Calcular días trabajados (días únicos con alguna checada de entrada)
        const diasConChecada = new Set(
          empAsis.filter(a => a.tipo_verificacion === 'entrada').map(a => formatDateOnly(a.verificado_at))
        ).size

        // Resumen de incidencias
        let faltas = 0
        let vacaciones = 0
        let incapacidades = 0
        let permisos = 0

        empInc.forEach(inc => {
          // Determinar cuántos días de esta incidencia caen dentro del periodo seleccionado
          const incStart = new Date(Math.max(new Date(inc.fecha_inicio).getTime(), new Date(periodo.fecha_inicio).getTime()))
          const incEnd = new Date(Math.min(new Date(inc.fecha_fin).getTime(), new Date(periodo.fecha_fin).getTime()))
          const diasInc = Math.max(0, Math.round((incEnd - incStart) / (1000 * 60 * 60 * 24)) + 1)
          
          if (inc.tipo_incidencia === 'Falta Injustificada') faltas += diasInc
          else if (inc.tipo_incidencia === 'Vacaciones') vacaciones += diasInc
          else if (inc.tipo_incidencia === 'Incapacidad Enfermedad General' || inc.tipo_incidencia === 'Incapacidad Riesgo Trabajo' || inc.tipo_incidencia === 'Incapacidad Maternidad') incapacidades += diasInc
          else if (inc.tipo_incidencia === 'Permiso Goce de Sueldo' || inc.tipo_incidencia === 'Permiso Sin Sueldo') permisos += diasInc
        })

        // Estimación de pago (Días trabajados reales - o días totales menos faltas)
        // Por simplicidad, se usa el total de días menos las faltas y permisos sin sueldo si se considera el periodo pagado,
        // esto es flexible. Lo dejaremos como Días Pagados = Días del Periodo - Faltas
        const diasPagados = Math.max(0, totalDias - faltas)

        return {
          'Clave Empleado': emp.clave_empleado || '',
          'Nombre': `${emp.nombre} ${emp.apellido}`,
          'Departamento': emp.departamento || '',
          'Días en Periodo': totalDias,
          'Días Asistidos (Marcaje)': diasConChecada,
          'Faltas Registradas': faltas,
          'Vacaciones Tomadas': vacaciones,
          'Incapacidades': incapacidades,
          'Permisos Especiales': permisos,
          'Días a Pagar Sugeridos': diasPagados
        }
      })
      exportToCsv('Resumen_Nomina.csv', rows)
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadIncidencias = async () => {
    setGenerating(true)
    try {
      const rows = incidencias.map(i => {
        return {
          'Clave Empleado': i.empleado?.clave_empleado || '',
          'Nombre': i.empleado ? `${i.empleado.nombre} ${i.empleado.apellido}` : 'Desconocido',
          'Tipo de Incidencia': i.tipo_incidencia,
          'Fecha Inicio': formatDateOnly(i.fecha_inicio),
          'Fecha Fin': formatDateOnly(i.fecha_fin),
          'Estado': i.estado,
          'Descripción/Notas': i.descripcion || ''
        }
      })
      if (rows.length === 0) return toast.error('No hay incidencias aprobadas en este periodo')
      exportToCsv('Reporte_Incidencias_Aprobadas.csv', rows)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC]  overflow-hidden font-inter transition-colors duration-300 text-slate-900 dark:text-white ">
      <Toaster position="top-right" />
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

          {/* Encabezado */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white  flex items-center gap-3">
                  <FileSpreadsheet className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  Reportes para Nómina
                </h2>
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    SuperAdmin
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300  mt-1">
                Genera consolidados de asistencia para <strong className="text-blue-600 dark:text-blue-400">{currentTenant?.nombre_empresa || 'Empresa'}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              {isSuperAdmin && (
                <TenantSelector
                  tenants={tenants}
                  currentTenantId={currentTenantId}
                  onSelectTenant={setSelectedTenantId}
                  loading={loadingTenants}
                />
              )}
              <button onClick={fetchData} className="p-2 rounded-md border border-slate-200 dark:border-slate-800  text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white  bg-white dark:bg-white transition-colors shadow-sm cursor-pointer">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Selector de Periodo */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-5 shadow-sm  dark:bg-white flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex items-center gap-4 w-full lg:w-1/3">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/60 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400 ">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300  uppercase tracking-wider mb-1">
                  Periodo a Evaluar
                </label>
                <select 
                  value={selectedPeriodoId} 
                  onChange={e => setSelectedPeriodoId(e.target.value)}
                  disabled={loading || periodos.length === 0}
                  className="w-full py-2 px-3 text-sm font-semibold rounded-md border border-slate-200 dark:border-slate-800  bg-slate-50  text-slate-900 dark:text-white  outline-none focus:border-blue-500 transition-colors"
                >
                  {periodos.length === 0 ? (
                    <option value="">No hay periodos registrados</option>
                  ) : (
                    periodos.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre} ({formatDateOnly(p.fecha_inicio)} - {formatDateOnly(p.fecha_fin)})</option>
                    ))
                  )}
                </select>
              </div>
            </div>
            
            <div className="flex-1 flex gap-4 text-sm text-slate-700 dark:text-slate-300 ">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                <span><strong className="text-slate-900 dark:text-white ">{empleados.length}</strong> Colaboradores</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-500" />
                <span><strong className="text-slate-900 dark:text-white ">{asistencias.length}</strong> Marcajes</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span><strong className="text-slate-900 dark:text-white ">{incidencias.length}</strong> Incidencias</span>
              </div>
            </div>
          </div>

          {/* Grid de Reportes */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Tarjeta: Resumen Nómina */}
            <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-6 shadow-sm  dark:bg-white flex flex-col relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-blue-50 dark:bg-blue-950/60"></div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white  mb-2">Resumen de Pre-Nómina</h3>
              <p className="text-sm text-slate-700 dark:text-slate-300  flex-1 mb-6">
                Consolidado por empleado con el total de días trabajados, faltas, vacaciones, y sugerencia de días a pagar en el periodo.
              </p>
              <button 
                onClick={handleDownloadResumenNomina}
                disabled={loading || generating || periodos.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold text-white bg-blue-600 hover:bg-slate-100 shadow-md shadow-blue-600/25 transition-all active:scale-98 disabled:opacity-50"
              >
                <FileDown className="w-4 h-4" />
                Descargar Resumen
              </button>
            </div>

            {/* Tarjeta: Asistencias Detallado */}
            <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-6 shadow-sm  dark:bg-white flex flex-col relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white  mb-2">Asistencia Detallada</h3>
              <p className="text-sm text-slate-700 dark:text-slate-300  flex-1 mb-6">
                Listado completo de cada marcaje de entrada y salida, incluyendo el método de registro (biométrico, PIN, manual).
              </p>
              <button 
                onClick={handleDownloadAsistenciasDetallado}
                disabled={loading || generating || periodos.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 transition-all active:scale-98 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Descargar Detalle
              </button>
            </div>

            {/* Tarjeta: Incidencias */}
            <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-6 shadow-sm  dark:bg-white flex flex-col relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white  mb-2">Reporte de Incidencias</h3>
              <p className="text-sm text-slate-700 dark:text-slate-300  flex-1 mb-6">
                Registro de permisos con/sin goce de sueldo, vacaciones, faltas e incapacidades aprobadas para el periodo seleccionado.
              </p>
              <button 
                onClick={handleDownloadIncidencias}
                disabled={loading || generating || periodos.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800 transition-all active:scale-98 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Descargar Incidencias
              </button>
            </div>

          </div>

          {/* Información y Tips */}
          <div className="rounded-sm border border-blue-500/40 bg-blue-50 dark:bg-blue-950/60 dark:border-blue-900/50 dark:bg-blue-950/30 p-4 shadow-sm flex items-start gap-3 text-sm text-indigo-800 dark:text-blue-300">
            <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400  shrink-0 mt-0.5" />
            <div>
              <p className="font-bold mb-1">Nota sobre los cortes de nómina</p>
              <p>
                Los reportes se generan filtrando estrictamente los eventos (marcajes e incidencias) que ocurrieron entre las fechas de inicio y fin del periodo seleccionado. Las incidencias que crucen por el periodo se contabilizarán proporcionalmente a los días que correspondan.
              </p>
            </div>
          </div>

        </main>
      </div>
    </div>
  )
}






