import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { usePagination } from '../../../shared/hooks/usePagination'
import PaginationControl from '../../../shared/components/ui/PaginationControl'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import {
  Search, RefreshCw, Calendar, Download, Activity, FileText
} from 'lucide-react'

function formatDateTime(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(d).replace(',', '')
}

function processEventos(asistencias, empleados, dispositivos) {
  return asistencias.map(a => {
    const emp = empleados.find(e => e.id === a.empleado_id) || {}
    const dev = dispositivos.find(d => d.id === a.dispositivo_id) || {}
    
    const verificadoAt = new Date(a.verificado_at)
    const dayOfWeek = new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(verificadoAt)
    const dayOfWeekCap = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)

    // Interpretar método a modo de verificación legible
    let modoVerificacion = a.metodo || '—'
    if (modoVerificacion.includes('fingerprint') || modoVerificacion === 'huella') modoVerificacion = 'Solo huella dactilar'
    if (modoVerificacion.includes('face') || modoVerificacion === 'rostro') modoVerificacion = 'Solo rostro'
    if (modoVerificacion.includes('card') || modoVerificacion === 'tarjeta') modoVerificacion = 'Solo tarjeta'
    if (a.es_manual) modoVerificacion = 'Ajuste Manual'

    let fuente = a.es_manual ? 'Sistema / Kiosko' : 'Dispositivo de asistencia'

    return {
      'ID de persona': emp.hikvision_device_userid || emp.clave_empleado || '—',
      'Nombre de la persona': emp.nombre ? `${emp.nombre} ${emp.apellido}` : 'Desconocido',
      'Departamento': emp.departamento || '—',
      'Tipo': a.tipo_verificacion === 'entrada' ? 'Entrada' : a.tipo_verificacion === 'salida' ? 'Salida' : a.tipo_verificacion,
      'Fuente': fuente,
      'Día de la semana': dayOfWeekCap,
      'Hora de fichaje': formatDateTime(a.verificado_at),
      'Zona horaria': '-05:00', // Hardcoded for Cancún/Bogotá/CDMX
      'Modo de verificación': modoVerificacion,
      'Dispositivo SN': dev.device_id_hikvision || '—',
      'Nombre del dispositivo': dev.nombre || '—',
      'Hora de carga': formatDateTime(a.created_at || a.verificado_at)
    }
  }).sort((a, b) => new Date(b['Hora de fichaje']) - new Date(a['Hora de fichaje']))
}

export default function HistorialEventosPage() {
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
      const [empRes, devRes] = await Promise.all([
        supabase.from('empleados').select('id, nombre, apellido, departamento, clave_empleado, hikvision_device_userid').eq('cliente_id', currentTenantId),
        supabase.from('dispositivos').select('id, nombre, device_id_hikvision').eq('cliente_id', currentTenantId)
      ])
      
      if (empRes.error) throw empRes.error
      if (devRes.error) throw devRes.error

      const start = new Date(`${fechaInicio}T00:00:00`).toISOString()
      const end = new Date(`${fechaFin}T23:59:59.999`).toISOString()

      const { data: asisData, error: asisError } = await supabase
        .from('registro_asistencia')
        .select('*')
        .eq('cliente_id', currentTenantId)
        .gte('verificado_at', start)
        .lte('verificado_at', end)
      
      if (asisError) throw asisError

      const processedData = processEventos(asisData || [], empRes.data || [], devRes.data || [])
      setFileData(processedData)
      
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar historial de eventos.')
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
    'ID de persona', 'Nombre de la persona', 'Departamento', 'Tipo', 'Fuente', 
    'Día de la semana', 'Hora de fichaje', 'Zona horaria', 'Modo de verificación', 
    'Dispositivo SN', 'Nombre del dispositivo', 'Hora de carga'
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
    link.download = `Eventos_${fechaInicio}_a_${fechaFin}.csv`
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
                Historial de Eventos
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                Bitácora cruda de todos los marcajes y eventos registrados por los dispositivos.
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
                  placeholder="Buscar colaborador o dispositivo..."
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
                          Consultando eventos...
                        </td>
                      </tr>
                    ) : paginatedRows.length > 0 ? (
                      paginatedRows.map((row, index) => (
                        <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          {headers.map((h, i) => (
                            <td key={i} className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {h === 'Hora de fichaje' || h === 'Hora de carga' ? (
                                <span className="font-mono text-[11px]">{row[h]}</span>
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
                          {search ? `No se encontraron coincidencias para "${search}"` : 'No hay eventos en este rango de fechas.'}
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
                  itemName="eventos"
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
