import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast from 'react-hot-toast'
import { usePagination } from '../../../shared/hooks/usePagination'
import PaginationControl from '../../../shared/components/ui/PaginationControl'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { DatePicker } from '../../../shared/components/ui'
import {
  Coffee, Search, RefreshCw, Calendar, Download,
  Clock, Users, CheckCircle2, AlertCircle, Timer
} from 'lucide-react'

// Utilidad para clasificar si un marcaje es salida a descanso/comida
function isBreakOut(punch) {
  const raw = String(punch?.raw_payload?.raw_status || '').toLowerCase().trim()
  const tipo = String(punch?.tipo_verificacion || '').toLowerCase().trim()
  return raw === 'break_out' || tipo === 'descanso_inicio' || tipo === 'comida_salida' || raw === '2'
}

// Utilidad para clasificar si un marcaje es regreso de descanso/comida
function isBreakIn(punch) {
  const raw = String(punch?.raw_payload?.raw_status || '').toLowerCase().trim()
  const tipo = String(punch?.tipo_verificacion || '').toLowerCase().trim()
  return raw === 'break_in' || tipo === 'descanso_fin' || tipo === 'comida_entrada' || raw === '3'
}

// Utilidad para obtener YYYY-MM-DD local de una checada
function getPunchDateStr(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Formateador seguro de hora local (HH:MM:SS)
function formatTime(d) {
  if (!d) return '—'
  const dateObj = d instanceof Date ? d : new Date(d)
  if (isNaN(dateObj.getTime())) return '—'
  return dateObj.toLocaleTimeString('es-MX', { hour12: false })
}

// Formateador seguro de duración sexagesimal (HH:MM:SS)
function formatDuration(diffMs) {
  if (!diffMs || diffMs <= 0 || isNaN(diffMs)) return '00:00:00'
  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Reconstrucción lógica de intervalos de descanso por colaborador
function processDescansos(asistencias, empleados) {
  const empMap = new Map((empleados || []).map(e => [e.id, e]))

  const punchesByEmp = {}
  asistencias.forEach(a => {
    const empId = a.empleado_id
    if (!punchesByEmp[empId]) punchesByEmp[empId] = []
    punchesByEmp[empId].push(a)
  })

  const breakIntervals = []

  Object.entries(punchesByEmp).forEach(([empId, pList]) => {
    const emp = empMap.get(empId) || {}
    const idPersona = emp.device_userid || emp.clave_empleado || '—'
    const nombre = emp.nombre ? `${emp.nombre} ${emp.apellido}` : 'Desconocido'
    const departamento = emp.departamento || '—'

    // Orden cronológico estricto
    const sorted = [...pList].sort((a, b) => new Date(a.verificado_at) - new Date(b.verificado_at))

    let currentBreak = null

    sorted.forEach(punch => {
      const punchDate = new Date(punch.verificado_at)

      if (isBreakOut(punch)) {
        // Si había un descanso sin fin, se consolida como pendiente
        if (currentBreak) {
          breakIntervals.push(currentBreak)
        }
        currentBreak = {
          idPersona,
          nombre,
          departamento,
          fecha: getPunchDateStr(punch.verificado_at),
          inicio: punchDate,
          fin: null
        }
      } else if (isBreakIn(punch)) {
        // Empareja con el inicio de descanso abierto si está dentro de una ventana máxima de 12 horas
        if (currentBreak && (punchDate - currentBreak.inicio <= 12 * 60 * 60 * 1000)) {
          currentBreak.fin = punchDate
          breakIntervals.push(currentBreak)
          currentBreak = null
        }
      }
    })

    if (currentBreak) {
      breakIntervals.push(currentBreak)
    }
  })

  // Proyectar datos finales con duraciones
  return breakIntervals.map(b => {
    const dayOfWeek = b.fecha
      ? new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(new Date(`${b.fecha}T12:00:00`))
      : '—'
    const capitalizedDay = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)

    let durationMs = 0
    let durationStr = '—'
    let estatus = 'Pendiente de regreso'

    if (b.inicio && b.fin) {
      durationMs = Math.max(0, b.fin - b.inicio)
      durationStr = formatDuration(durationMs)
      estatus = 'Completado'
    }

    return {
      idPersona: b.idPersona,
      nombre: b.nombre,
      departamento: b.departamento,
      fecha: b.fecha,
      diaSemana: capitalizedDay,
      inicio: formatTime(b.inicio),
      fin: formatTime(b.fin),
      durationMs,
      duracion: durationStr,
      estatus
    }
  }).sort((a, b) => {
    if (a.fecha === b.fecha) return a.nombre.localeCompare(b.nombre)
    return b.fecha.localeCompare(a.fecha)
  })
}

export default function ReporteDescansosPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const { currentTenantId } = useCurrentTenant()

  const [descansosData, setDescansosData] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Filtros de fecha (por defecto hoy)
  const today = new Date().toISOString().slice(0, 10)
  const [fechaInicio, setFechaInicio] = useState(today)
  const [fechaFin, setFechaFin] = useState(today)

  const fetchData = async () => {
    if (!currentTenantId) return
    setLoading(true)
    try {
      // 1. Cargar Empleados
      const { data: empData, error: empError } = await supabase
        .from('empleados')
        .select('*')
        .eq('cliente_id', currentTenantId)
      if (empError) throw empError

      // 2. Cargar Asistencias con buffer de 24h para cubrir cruces de medianoche
      const start = new Date(new Date(`${fechaInicio}T00:00:00`).getTime() - 24 * 60 * 60 * 1000).toISOString()
      const end = new Date(new Date(`${fechaFin}T23:59:59.999`).getTime() + 24 * 60 * 60 * 1000).toISOString()

      const { data: asisData, error: asisError } = await supabase
        .from('registro_asistencia')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .gte('verificado_at', start)
        .lte('verificado_at', end)
      if (asisError) throw asisError

      // 3. Procesar intervalos de descanso y filtrar por rango de fecha
      const processed = processDescansos(asisData || [], empData || [])
      const inRange = processed.filter(d => d.fecha >= fechaInicio && d.fecha <= fechaFin)
      setDescansosData(inRange)

    } catch (error) {
      console.error(error)
      toast.error('Error al cargar datos de descansos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [currentTenantId])

  // Filtrado de búsqueda
  const filteredData = useMemo(() => {
    return descansosData.filter(row => {
      const q = search.toLowerCase()
      if (!q) return true
      return (
        row.idPersona.toLowerCase().includes(q) ||
        row.nombre.toLowerCase().includes(q) ||
        row.departamento.toLowerCase().includes(q) ||
        row.fecha.includes(q)
      )
    })
  }, [descansosData, search])

  // Cálculos y Totales
  const metrics = useMemo(() => {
    const totalEventos = filteredData.length
    const completados = filteredData.filter(d => d.estatus === 'Completado')
    const totalMs = completados.reduce((acc, curr) => acc + curr.durationMs, 0)
    const uniqueEmployees = new Set(filteredData.map(d => d.idPersona)).size
    const avgMs = completados.length > 0 ? Math.round(totalMs / completados.length) : 0

    return {
      totalEventos,
      uniqueEmployees,
      totalHorasDescanso: formatDuration(totalMs),
      promedioDescanso: formatDuration(avgMs),
      totalMs
    }
  }, [filteredData])

  // Paginación
  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedRows,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage
  } = usePagination(filteredData, 20)

  // Exportar a CSV
  const handleExport = () => {
    if (filteredData.length === 0) return

    const headers = [
      'ID de Persona',
      'Nombre del Colaborador',
      'Departamento',
      'Fecha',
      'Día de la semana',
      'Salida a Descanso',
      'Regreso de Descanso',
      'Tiempo de Descanso (HH:MM:SS)',
      'Estatus'
    ]

    const rows = filteredData.map(r => [
      r.idPersona,
      `"${r.nombre}"`,
      `"${r.departamento}"`,
      r.fecha,
      r.diaSemana,
      r.inicio,
      r.fin,
      r.duracion,
      r.estatus
    ])

    // Fila final de total acumulado
    rows.push([])
    rows.push([
      'TOTAL GENERAL',
      `"${metrics.uniqueEmployees} Colaboradores"`,
      '',
      '',
      '',
      '',
      `"${metrics.totalEventos} Descansos"`,
      `"${metrics.totalHorasDescanso}"`,
      ''
    ])

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `Reporte_Horas_Descanso_${fechaInicio}_a_${fechaFin}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('Reporte de descansos exportado correctamente')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-slate-900 text-slate-900 dark:text-white">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          
          {/* Encabezado y Acciones */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                  <Coffee className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                    Reporte de Horas de Descanso
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                    Control de tiempos de comida y descansos tomados por los colaboradores con total acumulado.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300"
                title="Actualizar datos"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-amber-500' : ''}`} />
              </button>

              <button
                onClick={handleExport}
                disabled={filteredData.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800/60 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>
            </div>
          </div>

          {/* Tarjetas de Resumen KPI (Totales Destacados) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Colaboradores</span>
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">
                {metrics.uniqueEmployees}
              </div>
              <span className="text-xs text-slate-500">Con pausas registradas</span>
            </div>

            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Eventos de Pausa</span>
                <Timer className="w-5 h-5 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">
                {metrics.totalEventos}
              </div>
              <span className="text-xs text-slate-500">Salidas a descanso/comida</span>
            </div>

            <div className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Total Horas Descanso
                </span>
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="mt-2 text-2xl font-mono font-black text-amber-700 dark:text-amber-300">
                {metrics.totalHorasDescanso}
              </div>
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Suma exacta en HH:MM:SS
              </span>
            </div>

            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Promedio x Pausa</span>
                <Coffee className="w-5 h-5 text-purple-500" />
              </div>
              <div className="mt-2 text-2xl font-mono font-bold text-slate-800 dark:text-white">
                {metrics.promedioDescanso}
              </div>
              <span className="text-xs text-slate-500">Duración promedio</span>
            </div>
          </div>

          {/* Barra de Filtros */}
          <div className="flex flex-col sm:flex-row items-end justify-between gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
              <div className="space-y-1.5 w-full sm:w-44">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Desde</label>
                <DatePicker
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  placeholder="Fecha inicio"
                />
              </div>

              <div className="space-y-1.5 w-full sm:w-44">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Hasta</label>
                <DatePicker
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  placeholder="Fecha fin"
                />
              </div>

              <div className="pt-5 w-full sm:w-auto">
                <button 
                  onClick={fetchData}
                  disabled={loading}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  Consultar
                </button>
              </div>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o departamento..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-900 dark:text-white transition-colors"
              />
            </div>
          </div>

          {/* Tabla de Resultados con Fila de Totales */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">ID Persona</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Colaborador</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Departamento</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Fecha</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Día</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Salida a Descanso</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Regreso de Descanso</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Tiempo de Descanso</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                        Calculando tiempos de descanso...
                      </td>
                    </tr>
                  ) : paginatedRows.length > 0 ? (
                    paginatedRows.map((row, index) => (
                      <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-300">
                          {row.idPersona}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900 dark:text-white">
                          {row.nombre}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {row.departamento}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-300">
                          {row.fecha}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {row.diaSemana}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-300">
                          {row.inicio}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-300">
                          {row.fin}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-md">
                            {row.duracion}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.estatus === 'Completado' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                              <CheckCircle2 className="w-3 h-3" />
                              Completado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                              <AlertCircle className="w-3 h-3" />
                              En descanso
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                        {search ? `No se encontraron descansos para "${search}"` : 'No hay descansos registrados en este rango de fechas.'}
                      </td>
                    </tr>
                  )}
                </tbody>

                {/* Pie de Tabla con Total General */}
                {!loading && filteredData.length > 0 && (
                  <tfoot className="bg-slate-100/80 dark:bg-slate-900/80 border-t-2 border-slate-300 dark:border-slate-700 font-bold text-slate-800 dark:text-white">
                    <tr>
                      <td colSpan={5} className="px-4 py-3.5 uppercase text-xs tracking-wider">
                        Total General del Periodo ({metrics.totalEventos} pausas)
                      </td>
                      <td colSpan={2} className="px-4 py-3.5 text-right text-xs uppercase text-slate-500">
                        Suma Total de Horas:
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="font-mono text-sm font-black text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700">
                          {metrics.totalHorasDescanso}
                        </span>
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Paginación */}
            {!loading && filteredData.length > 0 && (
              <PaginationControl
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                startIndex={startIndex}
                endIndex={endIndex}
                nextPage={nextPage}
                prevPage={prevPage}
                itemName="descansos"
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
