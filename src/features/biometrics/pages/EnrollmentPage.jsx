import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Users, Search, Fingerprint, UserCheck } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import BiometricFaceEnrollment from '../../employees/components/BiometricFaceEnrollment'
import BiometricFingerprintEnrollment from '../../employees/components/BiometricFingerprintEnrollment'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'

export default function EnrollmentPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const { currentTenantId } = useCurrentTenant()
  const [empleados, setEmpleados] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmpleado, setSelectedEmpleado] = useState(null) // objeto completo
  const [loading, setLoading] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (currentTenantId) loadEmpleados()
  }, [currentTenantId])

  const loadEmpleados = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, clave_empleado, hikvision_device_userid, avatar_url')
      .eq('cliente_id', currentTenantId)
      .eq('activo', true)
      .order('nombre')

    if (!error && data) {
      setEmpleados(data)
      const empId = searchParams.get('empleado_id')
      if (empId) {
        const found = data.find(e => e.id === empId)
        if (found) {
          setSelectedEmpleado(found)
        } else {
          // Si el empleado no existe o no tiene permiso, limpiamos la URL por seguridad
          searchParams.delete('empleado_id')
          setSearchParams(searchParams, { replace: true })
        }
      }
    }
    setLoading(false)
  }

  const filteredEmpleados = empleados.filter(emp => {
    const term = searchTerm.toLowerCase()
    return (
      emp.nombre?.toLowerCase().includes(term) ||
      emp.apellido?.toLowerCase().includes(term) ||
      emp.clave_empleado?.toLowerCase().includes(term)
    )
  })

  const handleSelectEmpleado = (emp) => {
    setSelectedEmpleado(emp)
    setSearchTerm('')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#1a222c] text-slate-900 dark:text-white">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        
        <main className="mx-auto max-w-7xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

        {/* ── Encabezado ──────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-indigo-500" />
            Enrolamiento Biométrico
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Selecciona un colaborador para registrar su rostro y/o huellas dactilares.
          </p>
        </div>

        {/* ── Buscador ────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-[#1c2434] border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col md:flex-row gap-3 items-stretch">

            {/* Input de búsqueda */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar por nombre o clave de empleado..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 dark:text-slate-200"
              />
            </div>

            {/* Lista desplegable */}
            <div className="flex-1">
              <select
                value={selectedEmpleado?.id || ''}
                onChange={e => {
                  const emp = empleados.find(x => x.id === e.target.value)
                  setSelectedEmpleado(emp || null)
                }}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 dark:text-slate-200"
              >
                <option value="">— Selecciona un colaborador —</option>
                {filteredEmpleados.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.clave_empleado ? `[${emp.clave_empleado}] ` : ''}{emp.nombre} {emp.apellido}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Empleado seleccionado — chip */}
          {selectedEmpleado && (
            <div className="mt-3 flex items-center gap-3 px-3 py-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-lg">
              <div className="w-7 h-7 rounded-full bg-indigo-200 dark:bg-indigo-500/30 flex items-center justify-center flex-shrink-0">
                <UserCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 truncate">
                  {selectedEmpleado.nombre} {selectedEmpleado.apellido}
                </p>
                <p className="text-xs text-indigo-500 dark:text-indigo-400">
                  Clave: {selectedEmpleado.clave_empleado || '—'}
                  {selectedEmpleado.hikvision_device_userid ? ` · PIN Biométrico: ${selectedEmpleado.hikvision_device_userid}` : ' · Sin PIN biométrico'}
                </p>
              </div>
              <button
                onClick={() => setSelectedEmpleado(null)}
                className="text-indigo-400 hover:text-indigo-600 text-xs font-medium"
              >
                Cambiar
              </button>
            </div>
          )}
        </div>

        {/* ── Módulos Biométricos ─────────────────────────────────────────── */}
        {selectedEmpleado ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4">

            {/* Módulo de Huella — con SVG interactivo */}
            <BiometricFingerprintEnrollment
              empleadoId={selectedEmpleado.id}
              clienteId={currentTenantId}
            />

            {/* Módulo de Rostro */}
            <BiometricFaceEnrollment
              empleadoId={selectedEmpleado.id}
              clienteId={currentTenantId}
            />

          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white dark:bg-[#1c2434] border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
            <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-base font-medium text-slate-600 dark:text-slate-400">Ningún colaborador seleccionado</h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-xs">
              Usa el buscador para encontrar al colaborador que deseas enrolar.
            </p>
          </div>
        )}

        </main>
      </div>
    </div>
  )
}
