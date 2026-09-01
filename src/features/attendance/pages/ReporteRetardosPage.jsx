import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { usePagination } from '../../../shared/hooks/usePagination'
import PaginationControl from '../../../shared/components/ui/PaginationControl'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import {
  Clock, Search, RefreshCw, Calendar, Download, AlertTriangle
} from 'lucide-react'

// Utilidad para calcular minutos de retraso
function calculateDelayMinutes(firstPunchDate, horarioStr, tolerancia) {
  if (!horarioStr) return 0
  
  const [hStr, mStr] = horarioStr.split(':')
  const expectedMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10)
  const punchMinutes = firstPunchDate.getHours() * 60 + firstPunchDate.getMinutes()
  
  const diff = punchMinutes - expectedMinutes
  if (diff > tolerancia) {
    return diff
  }
  return 0
}

function processRetardos(asistencias, empleados, asignaciones) {
  const groups = {}

  asistencias.forEach(a => {
    const dateStr = a.verificado_at.slice(0, 10)
    const empId = a.empleado_id
    const key = `${dateStr}_${empId}`

    if (!groups[key]) {
      const emp = empleados.find(e => e.id === empId) || {}
      const asig = asignaciones.find(as => as.empleado_id === empId)
      const horario = asig?.horario

      groups[key] = {
        empleado_id: empId,
        id_persona: emp.hikvision_device_userid || emp.clave_empleado || '—',
        nombre: emp.nombre ? `${emp.nombre} ${emp.apellido}` : 'Desconocido',
        departamento: emp.departamento || '—',
        fecha: dateStr,
        horario: horario,
        punches: []
      }
    }
    groups[key].punches.push(new Date(a.verificado_at))
  })

  const result = Object.values(groups).map(g => {
    g.punches.sort((a, b) => a - b)
    
    const firstPunch = g.punches[0]
    const lastPunch = g.punches[g.punches.length - 1]
    
    const formatTime = (d) => d.toLocaleTimeString('es-MX', { hour12: false })
    const dayOfWeek = new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(new Date(`${g.fecha}T12:00:00`))

    let retraso = 0
    let horarioLabel = 'Sin Horario'
    if (g.horario) {
      horarioLabel = `${g.horario.hora_entrada?.slice(0,5) || ''} - ${g.horario.hora_salida?.slice(0,5) || ''}`
      retraso = calculateDelayMinutes(firstPunch, g.horario.hora_entrada, g.horario.tolerancia_minutos || 0)
    }

    return {
      'ID de persona': g.id_persona,
      'Nombre de la persona': g.nombre,
      'Departamento': g.departamento,
      'Fecha': g.fecha,
      'Día de la semana': dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
      'Horario': horarioLabel,
      'Registro de entrada': formatTime(firstPunch),
      'Registro de salida': formatTime(lastPunch),
      'Minutos de retraso': retraso
    }
  })

  // Mostrar primero los que tienen retraso, luego ordenar por fecha y nombre
  return result.sort((a, b) => {
    if (b['Minutos de retraso'] !== a['Minutos de retraso']) {
      return b['Minutos de retraso'] - a['Minutos de retraso']
    }
    if (a.Fecha === b.Fecha) return a['Nombre de la persona'].localeCompare(b['Nombre de la persona'])
    return b.Fecha.localeCompare(a.Fecha)
  })
}

export default function ReporteRetardosPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const { currentTenantId } = useCurrentTenant()
  
  const [fileData, setFileData] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  
  const today = new Date().toISOString().slice(0, 10)
  const [fechaInicio, setFechaInicio] = useState(today)
  const [fechaFin, setFechaFin] = useState(today)

  const fetchData = async () => {
    if (!currentTenantId) return
    setLoading(true)
    try {
      const [empRes, asigRes] = await Promise.all([
        supabase.from('empleados').select('*').eq('cliente_id', currentTenantId),
        supabase.from('empleados_horarios').select('*, horario:horarios(*)').eq('cliente_id', currentTenantId).eq('activo', true)
      ])
      
      if (empRes.error) throw empRes.error
      if (asigRes.error) throw asigRes.error

      const start = new Date(`${fechaInicio}T00:00:00`).toISOString()
      const end = new Date(`${fechaFin}T23:59:59.999`).toISOString()

      const { data: asisData, error: asisError } = await supabase
        .from('registro_asistencia')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .gte('verificado_at', start)
        .lte('verificado_at', end)
      
      if (asisError) throw asisError

      const processedData = processRetardos(asisData || [], empRes.data || [], asigRes.data || [])
      setFileData(processedData)
      
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar datos de retardos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [currentTenantId])

  const filteredData = useMemo(() => {
    return fileData.filter(row => {
      const q = search.toLowerCase()
      if (!q) return true
      return Object.values(row).some(val => 
        String(val).toLowerCase().includes(q)
      )
    })
  }, [fileData, search])

  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedRows,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage
  } = usePagination(filteredData, 15, [search, fileData])

  const headers = fileData.length > 0 ? Object.keys(fileData[0]) : [
    'ID de persona', 'Nombre de la persona', 'Departamento', 'Fecha', 
    'Día de la semana', 'Horario', 'Registro de entrada', 'Registro de salida', 
    'Minutos de retraso'
  ]

  const handleExport = () => {
    if (fileData.length === 0) return
    const separator = ','
    const csvContent =
      headers.join(separator) + '\n' +
      filteredData.map(row => {
        return headers.map(k => {
          let cell = row[k] === null || row[k] === undefined ? '' : row[k]
          cell = cell.toString().replace(/"/g, '""')
          if (cell.search(/("|,|\n)/g) >= 0) cell = `"${cell}"`
          return cell
        }).join(separator)
      }).join('\n')

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `Reporte_Retardos_${fechaInicio}_a_${fechaFin}.csv`
    link.click()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-slate-900 text-slate-900 dark:text-white">
      <Toaster position="top-right" />
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                Reporte de Retardos
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                Visualiza los minutos de retraso de los colaboradores según su horario asignado.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300"
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
            <div className="flex flex-col sm:flex-row items-end justify-between gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                <div className="space-y-1.5 w-full sm:w-auto">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Desde</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full sm:w-auto px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5 w-full sm:w-auto">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Hasta</label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="w-full sm:w-auto px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-900 dark:text-white"
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
                          Calculando retardos...
                        </td>
                      </tr>
                    ) : paginatedRows.length > 0 ? (
                      paginatedRows.map((row, index) => (
                        <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          {headers.map((h, i) => (
                            <td key={i} className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {h === 'Minutos de retraso' ? (
                                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md ${
                                  row[h] > 0 
                                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}>
                                  {row[h] > 0 && <AlertTriangle className="w-3 h-3" />}
                                  {row[h] > 0 ? `${row[h]} min` : '0'}
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
                          {search ? `No se encontraron coincidencias para "${search}"` : 'No hay datos en este rango de fechas.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

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
