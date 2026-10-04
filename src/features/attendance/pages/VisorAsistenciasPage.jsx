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
  FileSpreadsheet, Search, RefreshCw, 
  Clock, Calendar, User, Building2, Download
} from 'lucide-react'

// Utilidad para resolver la dirección de un marcaje
function resolvePunchDirection(punch, hasOpenCycle) {
  const rawStatus = punch?.raw_payload?.raw_status ? String(punch.raw_payload.raw_status).trim() : null
  const isAuto = punch?.raw_payload?.auto_resolved === true
  const tipo = String(punch?.tipo_verificacion || '').toLowerCase().trim()

  // Regla de Oro: Si no hay ciclo abierto, la primera perforación siempre abre jornada como ENTRADA
  // (un colaborador no puede registrar salida sin entrada previa; resuelve checadas 255 auto-resolved o fuera de horario)
  if (!hasOpenCycle) {
    return 'IN'
  }

  // Si el hardware envió 255 (sin botón de función) o fue auto-resuelto:
  // Al haber ya una entrada abierta, actúa como SALIDA de cierre
  if (rawStatus === '255' || isAuto) {
    return 'OUT'
  }

  if (tipo === '0' || tipo === 'entrada' || tipo === 'in' || tipo === 'check_in') return 'IN'
  if (tipo === '1' || tipo === 'salida' || tipo === 'out' || tipo === 'check_out') return 'OUT'
  if (tipo === '2' || tipo === 'descanso_inicio' || tipo === 'comida_salida' || tipo === 'break_out') return 'BREAK_OUT'
  if (tipo === '3' || tipo === 'descanso_fin' || tipo === 'comida_entrada' || tipo === 'break_in') return 'BREAK_IN'

  return 'OUT'
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

// Formateador seguro de hora (HH:MM:SS)
function formatTime(d) {
  if (!d) return '—'
  const dateObj = d instanceof Date ? d : new Date(d)
  if (isNaN(dateObj.getTime())) return '—'
  return dateObj.toLocaleTimeString('es-MX', { hour12: false })
}

// Formateador seguro de duración (HH:MM:SS) para que minutos y segundos nunca excedan de 59
function formatDuration(diffMs) {
  if (!diffMs || diffMs <= 0 || isNaN(diffMs)) return '—'
  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Reconstrucción lógica en memoria de ciclos de jornada por empleado
function groupByDateAndEmployee(asistencias, empleados) {
  const empMap = new Map((empleados || []).map(e => [e.id, e]))

  // 1. Agrupar checadas por empleado
  const punchesByEmp = {}
  asistencias.forEach(a => {
    const empId = a.empleado_id
    if (!punchesByEmp[empId]) punchesByEmp[empId] = []
    punchesByEmp[empId].push(a)
  })

  const cycles = []

  // 2. Para cada empleado, ordenar cronológicamente y reconstruir ciclos:
  //    IN  -> abre ciclo (determina la fecha de la jornada)
  //    OUT -> cierra el último ciclo abierto válido (máx 24h)
  Object.entries(punchesByEmp).forEach(([empId, empPunches]) => {
    const emp = empMap.get(empId) || {}
    const idPersona = emp.device_userid || emp.clave_empleado || '—'
    const nombre = emp.nombre ? `${emp.nombre} ${emp.apellido}` : 'Desconocido'
    const departamento = emp.departamento || '—'

    // Orden cronológico estricto
    const sorted = [...empPunches].sort((a, b) => new Date(a.verificado_at) - new Date(b.verificado_at))

    let currentCycle = null

    sorted.forEach(punch => {
      const punchDate = new Date(punch.verificado_at)
      const punchDateStr = getPunchDateStr(punch.verificado_at)
      const dir = resolvePunchDirection(punch, Boolean(currentCycle))

      // Evitar doble tap idéntico accidental dentro de 60 segundos
      if (currentCycle && dir === 'IN' && !currentCycle.salida) {
        const diffMs = punchDate - currentCycle.entrada
        if (diffMs >= 0 && diffMs < 60000) {
          return
        }
      }

      if (dir === 'IN') {
        // Si había un ciclo abierto sin salida, se consolida como jornada abierta
        if (currentCycle) {
          cycles.push(currentCycle)
        }
        // Nueva jornada que conserva como fecha la fecha de la entrada
        currentCycle = {
          idPersona,
          nombre,
          departamento,
          fecha: punchDateStr,
          entrada: punchDate,
          salida: null,
          numPunches: 1
        }
      } else if (dir === 'OUT') {
        // Salida que cierra el último ciclo abierto válido (máximo 24h)
        const isWithinWindow = currentCycle && (punchDate - currentCycle.entrada <= 24 * 60 * 60 * 1000)

        if (currentCycle && isWithinWindow) {
          currentCycle.salida = punchDate
          currentCycle.numPunches += 1
          cycles.push(currentCycle)
          currentCycle = null
        } else {
          if (currentCycle) {
            cycles.push(currentCycle)
          }
          // Si no había ciclo previo o excede 24h, abre nueva jornada como entrada
          currentCycle = {
            idPersona,
            nombre,
            departamento,
            fecha: punchDateStr,
            entrada: punchDate,
            salida: null,
            numPunches: 1
          }
        }
      } else if (dir === 'BREAK_OUT' || dir === 'BREAK_IN') {
        if (currentCycle) {
          currentCycle.numPunches += 1
        }
      }
    })

    if (currentCycle) {
      cycles.push(currentCycle)
    }
  })

  // 3. Proyectar al formato de filas requerido por la tabla del reporte
  const result = cycles.map(c => {
    let durationStr = '—'
    if (c.entrada && c.salida) {
      const diffMs = c.salida - c.entrada
      if (diffMs > 0) {
        durationStr = formatDuration(diffMs)
      }
    }

    const dayOfWeek = new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(new Date(`${c.fecha}T12:00:00`))

    return {
      'ID de persona': c.idPersona,
      'Nombre de la persona': c.nombre,
      'Departamento': c.departamento,
      'Fecha': c.fecha,
      'Día de la semana': dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
      'Primera perforación': formatTime(c.entrada),
      'Última perforación': formatTime(c.salida),
      'Número de perforaciones': c.numPunches,
      'Horas reales de trabajo': durationStr
    }
  })

  // Ordenar por fecha descendente y luego por nombre
  return result.sort((a, b) => {
    if (a.Fecha === b.Fecha) return a['Nombre de la persona'].localeCompare(b['Nombre de la persona'])
    return b.Fecha.localeCompare(a.Fecha)
  })
}

export default function VisorAsistenciasPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  
  const { currentTenantId } = useCurrentTenant()
  
  // Data
  const [fileData, setFileData] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  
  // Filtros de fecha (por defecto hoy)
  const today = new Date().toISOString().slice(0, 10)
  const [fechaInicio, setFechaInicio] = useState(today)
  const [fechaFin, setFechaFin] = useState(today)

  // Cargar datos de la BD
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

      // 2. Cargar Asistencias en el rango con buffer de 24h para cruces de medianoche
      const start = new Date(new Date(`${fechaInicio}T00:00:00`).getTime() - 24 * 60 * 60 * 1000).toISOString()
      const end = new Date(new Date(`${fechaFin}T23:59:59.999`).getTime() + 24 * 60 * 60 * 1000).toISOString()

      const { data: asisData, error: asisError } = await supabase
        .from('registro_asistencia')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .gte('verificado_at', start)
        .lte('verificado_at', end)
      if (asisError) throw asisError

      // 3. Reconstruir ciclos y filtrar únicamente las jornadas cuya fecha pertenezca al rango seleccionado
      const processedData = groupByDateAndEmployee(asisData || [], empData || [])
      const inRangeData = processedData.filter(row => row.Fecha >= fechaInicio && row.Fecha <= fechaFin)
      setFileData(inRangeData)
      
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar datos desde los checadores.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [currentTenantId])

  // Filtrado
  const filteredData = useMemo(() => {
    return fileData.filter(row => {
      const q = search.toLowerCase()
      if (!q) return true
      return Object.values(row).some(val => 
        String(val).toLowerCase().includes(q)
      )
    })
  }, [fileData, search])

  // Paginación Global
  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedRows,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage
  } = usePagination(filteredData, 10, [search, fileData])

  const headers = fileData.length > 0 ? Object.keys(fileData[0]) : [
    'ID de persona', 'Nombre de la persona', 'Departamento', 'Fecha', 
    'Día de la semana', 'Primera perforación', 'Última perforación', 
    'Número de perforaciones', 'Horas reales de trabajo'
  ]

  // Exportar a CSV
  const handleExport = () => {
    if (fileData.length === 0) return
    const separator = ','
    const keys = headers
    const csvContent =
      keys.join(separator) +
      '\n' +
      filteredData.map(row => {
        return keys.map(k => {
          let cell = row[k] === null || row[k] === undefined ? '' : row[k]
          cell = cell.toString().replace(/"/g, '""')
          if (cell.search(/("|,|\n)/g) >= 0) cell = `"${cell}"`
          return cell
        }).join(separator)
      }).join('\n')

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `Reporte_Checadas_${fechaInicio}_a_${fechaFin}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('Reporte exportado exitosamente')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-slate-900 text-slate-900 dark:text-white">
      
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                Reporte de Checadas (Dispositivos)
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                Consulta los marcajes registrados por los checadores físicos en tiempo real.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300"
                title="Actualizar datos"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-blue-500' : ''}`} />
              </button>
              
              <button
                onClick={handleExport}
                disabled={fileData.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800/60 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>
            </div>
          </div>

          <div className="space-y-4">
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
                    className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
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
                  placeholder="Buscar colaborador..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-900 dark:text-white transition-colors"
                />
              </div>
            </div>

            {/* Tabla de Resultados */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i} className="px-4 py-3 font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {loading ? (
                      <tr>
                        <td colSpan={headers.length} className="px-4 py-12 text-center text-slate-500">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                          Consultando base de datos...
                        </td>
                      </tr>
                    ) : paginatedRows.length > 0 ? (
                      paginatedRows.map((row, index) => (
                        <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          {headers.map((h, i) => (
                            <td key={i} className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {h === 'Primera perforación' || h === 'Última perforación' || h === 'Horas reales de trabajo' ? (
                                <span className="font-mono text-xs font-semibold">{row[h]}</span>
                              ) : h === 'Número de perforaciones' ? (
                                <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 text-xs font-bold">
                                  {row[h]}
                                </span>
                              ) : (
                                row[h]
                              )}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={headers.length} className="px-4 py-12 text-center text-slate-500">
                          {search ? `No se encontraron coincidencias para "${search}"` : 'No hay asistencias registradas en este rango de fechas.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Controles de Paginación */}
              {!loading && filteredData.length > 0 && (
                <PaginationControl
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  startIndex={startIndex}
                  endIndex={endIndex}
                  nextPage={nextPage}
                  prevPage={prevPage}
                  itemName="registros"
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
