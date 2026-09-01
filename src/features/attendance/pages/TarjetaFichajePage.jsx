import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import {
  Printer, Calendar, Clock, User, Building2, ChevronDown, CheckCircle2, AlertTriangle, Fingerprint, RefreshCw
} from 'lucide-react'

// Utilidad para minutos de retraso
function calculateDelayMinutes(firstPunchDate, horarioStr, tolerancia) {
  if (!horarioStr) return 0
  const [hStr, mStr] = horarioStr.split(':')
  const expectedMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10)
  const punchMinutes = firstPunchDate.getHours() * 60 + firstPunchDate.getMinutes()
  const diff = punchMinutes - expectedMinutes
  return diff > tolerancia ? diff : 0
}

function processTimecard(asistencias, horario) {
  const groups = {}
  
  asistencias.forEach(a => {
    const dateStr = a.verificado_at.slice(0, 10)
    if (!groups[dateStr]) {
      groups[dateStr] = {
        fecha: dateStr,
        punches: []
      }
    }
    groups[dateStr].punches.push({
      date: new Date(a.verificado_at),
      tipo: a.tipo_verificacion
    })
  })

  return Object.values(groups).map(g => {
    g.punches.sort((a, b) => a.date - b.date)
    let firstPunch = null
    let breakOut = null
    let breakIn = null
    let lastPunch = null
    let estatus = 'Asistencia'

    // Separate punches by type if explicit, otherwise by chronological
    const pEntrada = g.punches.find(p => p.tipo === '0' || p.tipo === 'entrada')
    const pSalida = g.punches.find(p => p.tipo === '1' || p.tipo === 'salida')
    const pDescansoOut = g.punches.find(p => p.tipo === '2' || p.tipo === 'descanso_inicio')
    const pDescansoIn = g.punches.find(p => p.tipo === '3' || p.tipo === 'descanso_fin')

    if (g.punches.length === 1) {
      const p = g.punches[0]
      if (p.tipo === '1' || p.tipo === 'salida' || p.tipo?.toLowerCase().includes('out')) {
        lastPunch = p.date
        estatus = 'Falta Entrada'
      } else {
        firstPunch = p.date
        estatus = 'Falta Salida'
      }
    } else if (g.punches.length === 2) {
      firstPunch = pEntrada?.date || g.punches[0].date
      lastPunch = pSalida?.date || g.punches[1].date
      estatus = 'Asistencia'
    } else if (g.punches.length === 3) {
      firstPunch = pEntrada?.date || g.punches[0].date
      breakOut = pDescansoOut?.date || g.punches[1].date
      lastPunch = pSalida?.date || g.punches[2].date
      estatus = 'Incompleto (Falta 1 Marca)'
    } else if (g.punches.length >= 4) {
      firstPunch = pEntrada?.date || g.punches[0].date
      breakOut = pDescansoOut?.date || g.punches[1].date
      breakIn = pDescansoIn?.date || g.punches[2].date
      lastPunch = pSalida?.date || g.punches[g.punches.length - 1].date
      estatus = 'Asistencia'
    }

    const formatTime = (d) => d ? d.toLocaleTimeString('es-MX', { hour12: false }) : '—'

    let retraso = 0
    if (horario && firstPunch) {
      retraso = calculateDelayMinutes(firstPunch, horario.hora_entrada, horario.tolerancia_minutos || 0)
    }

    return {
      fecha: g.fecha,
      diaSemana: new Intl.DateTimeFormat('es-MX', { weekday: 'long' }).format(new Date(`${g.fecha}T12:00:00`)),
      entrada: formatTime(firstPunch),
      salidaDescanso: formatTime(breakOut),
      regresoDescanso: formatTime(breakIn),
      salida: formatTime(lastPunch),
      numPunches: g.punches.length,
      retraso: retraso,
      estatus: estatus,
      allPunches: g.punches.map(p => formatTime(p.date))
    }
  }).sort((a, b) => b.fecha.localeCompare(a.fecha))
}

export default function TarjetaFichajePage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const { currentTenantId } = useCurrentTenant()
  
  const [empleados, setEmpleados] = useState([])
  const [selectedEmpId, setSelectedEmpId] = useState('')
  const [empleadoData, setEmpleadoData] = useState(null)
  const [horarioData, setHorarioData] = useState(null)
  
  const [timecardData, setTimecardData] = useState([])
  const [loading, setLoading] = useState(false)
  
  const today = new Date().toISOString().slice(0, 10)
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10)
  const [fechaInicio, setFechaInicio] = useState(startOfMonth)
  const [fechaFin, setFechaFin] = useState(today)

  const printRef = useRef()

  // Cargar lista de empleados
  useEffect(() => {
    if (!currentTenantId) return
    const fetchEmpleados = async () => {
      const { data } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, clave_empleado, departamento, puesto, hikvision_device_userid')
        .eq('cliente_id', currentTenantId)
        .order('nombre', { ascending: true })
      setEmpleados(data || [])
    }
    fetchEmpleados()
  }, [currentTenantId])

  // Cargar datos del empleado seleccionado
  const fetchTimecard = async () => {
    if (!currentTenantId || !selectedEmpId) return
    setLoading(true)
    try {
      // Info del empleado
      const emp = empleados.find(e => e.id === selectedEmpId)
      setEmpleadoData(emp)

      // Horario asignado
      const { data: asig } = await supabase
        .from('empleados_horarios')
        .select('*, horario:horarios(*)')
        .eq('empleado_id', selectedEmpId)
        .eq('activo', true)
        .maybeSingle()
      
      const horario = asig?.horario || null
      setHorarioData(horario)

      // Asistencias
      const start = new Date(`${fechaInicio}T00:00:00`).toISOString()
      const end = new Date(`${fechaFin}T23:59:59.999`).toISOString()

      const { data: asisData } = await supabase
        .from('registro_asistencia')
        .select('*')
        .eq('empleado_id', selectedEmpId)
        .gte('verificado_at', start)
        .lte('verificado_at', end)

      const processed = processTimecard(asisData || [], horario)
      setTimecardData(processed)
      
    } catch (error) {
      console.error(error)
      toast.error('Error al cargar la tarjeta de fichaje.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedEmpId) fetchTimecard()
  }, [selectedEmpId, fechaInicio, fechaFin])

  const handlePrint = () => {
    window.print()
  }

  // Cálculos resumen
  const totalRetardos = timecardData.filter(d => d.retraso > 0).length
  const totalDiasTrabajados = timecardData.length

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-slate-900 text-slate-900 dark:text-white print:bg-white print:text-black">
      <Toaster position="top-right" />
      <div className="print:hidden">
        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      </div>

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <div className="print:hidden">
          <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        </div>

        <main className="mx-auto max-w-screen-xl p-4 md:p-6 2xl:p-10 w-full space-y-6 print:p-0 print:m-0 print:max-w-none">
          
          {/* Controles (Ocultos en impresión) */}
          <div className="print:hidden flex flex-col md:flex-row items-end justify-between gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
              <div className="w-full sm:w-64">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Colaborador</label>
                <div className="relative">
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    className="w-full appearance-none px-4 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 pr-10"
                  >
                    <option value="">Selecciona un colaborador...</option>
                    {empleados.map(e => (
                      <option key={e.id} value={e.id}>{e.nombre} {e.apellido}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              
              <div className="w-full sm:w-auto">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Desde</label>
                <input
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="w-full sm:w-auto">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Hasta</label>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              onClick={handlePrint}
              disabled={!empleadoData || timecardData?.length === 0}
              className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white dark:bg-blue-600 dark:hover:bg-blue-700 text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              Imprimir Expediente
            </button>
          </div>

          {/* Expediente (Visible en pantalla e impresión) */}
          {empleadoData ? (
            <div ref={printRef} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden print:shadow-none print:border-0 print:bg-white print:text-black">
              
              {/* Encabezado Tarjeta */}
              <div className="relative p-6 md:p-8 border-b border-slate-100 dark:border-slate-700/50 flex flex-col md:flex-row gap-6 items-start md:items-center">
                <div className="w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 border-4 border-white dark:border-slate-800 shadow-md print:border-slate-200">
                  <User className="w-10 h-10 text-slate-400" />
                </div>
                
                <div className="flex-1">
                  <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white print:text-black">
                    {empleadoData.nombre} {empleadoData.apellido}
                  </h1>
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-500 dark:text-slate-400 print:text-slate-700">
                    <span className="flex items-center gap-1.5"><Fingerprint className="w-4 h-4" /> ID Biométrico: {empleadoData.hikvision_device_userid || 'N/A'}</span>
                    <span className="flex items-center gap-1.5"><Building2 className="w-4 h-4" /> {empleadoData.departamento || 'Sin departamento'}</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 print:bg-slate-50 w-full md:w-auto">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Horario Asignado</div>
                  {horarioData ? (
                    <div>
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{horarioData.nombre}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{horarioData.hora_entrada?.slice(0,5)} - {horarioData.hora_salida?.slice(0,5)} (Tol: {horarioData.tolerancia_minutos}m)</div>
                    </div>
                  ) : (
                    <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">Sin horario asignado</div>
                  )}
                </div>
              </div>

              {/* Resumen del periodo */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-700/50 print:bg-white">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Periodo</div>
                  <div className="text-sm font-medium mt-1">{fechaInicio} a {fechaFin}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Días laborados</div>
                  <div className="text-sm font-medium mt-1">{totalDiasTrabajados} días</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Faltas</div>
                  <div className="text-sm font-medium mt-1 text-slate-400">N/A (Cálculo externo)</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Retardos</div>
                  <div className="text-sm font-medium mt-1 text-rose-600 dark:text-rose-400 font-bold">{totalRetardos} días con retraso</div>
                </div>
              </div>

              {/* Tabla de Detalle */}
              <div className="p-6 md:p-8">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 print:text-black">Detalle de Checadas</h3>
                
                {loading ? (
                  <div className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Generando tarjeta...
                  </div>
                ) : timecardData.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 print:border-0 print:border-b">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-900/50 print:bg-slate-100 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500">Fecha</th>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500">Entrada</th>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500">S. Descanso</th>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500">R. Descanso</th>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500">Salida</th>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500">Estatus / Retardo</th>
                          <th className="px-4 py-3 font-bold uppercase text-[11px] text-slate-500 hidden sm:table-cell">Bitácora Completa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 print:divide-slate-200">
                        {timecardData.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors print:break-inside-avoid">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="font-semibold text-slate-800 dark:text-slate-200 print:text-black">{row.fecha}</div>
                              <div className="text-[11px] text-slate-500 capitalize">{row.diaSemana}</div>
                            </td>
                            <td className="px-4 py-3 font-mono">{row.entrada}</td>
                            <td className="px-4 py-3 font-mono text-slate-500">{row.salidaDescanso}</td>
                            <td className="px-4 py-3 font-mono text-slate-500">{row.regresoDescanso}</td>
                            <td className="px-4 py-3 font-mono">{row.salida}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                {row.estatus === 'Asistencia' ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 print:bg-transparent print:text-black">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Asistencia
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400 print:bg-transparent print:border print:border-amber-200">
                                    <AlertTriangle className="w-3 h-3" />
                                    {row.estatus}
                                  </span>
                                )}
                                {row.retraso > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400 print:bg-transparent print:border print:border-rose-200 mt-1">
                                    <Clock className="w-3 h-3" />
                                    Retraso de {row.retraso} min
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[11px] text-slate-500 hidden sm:table-cell print:table-cell">
                              {row.allPunches.join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-500 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                    No hay checadas registradas en el periodo seleccionado.
                  </div>
                )}
                
                <div className="mt-12 hidden print:flex justify-between px-12 pt-8 border-t border-slate-300 text-sm text-slate-600">
                  <div className="text-center">
                    <div className="w-48 border-b border-slate-400 mb-2"></div>
                    Firma del Colaborador
                  </div>
                  <div className="text-center">
                    <div className="w-48 border-b border-slate-400 mb-2"></div>
                    Recursos Humanos / Autoriza
                  </div>
                </div>

              </div>
            </div>
          ) : (
            <div className="py-20 text-center flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white/50 dark:bg-slate-800/50 print:hidden">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                <User className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">Selecciona un colaborador</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-sm">
                Busca y selecciona un empleado en la parte superior para visualizar su expediente de asistencia y generar el reporte.
              </p>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
