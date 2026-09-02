import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Users, Search, Fingerprint, UserCheck } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import BiometricFaceEnrollment from '../../employees/components/BiometricFaceEnrollment'
import BiometricFingerprintEnrollment from '../../employees/components/BiometricFingerprintEnrollment'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'

export default function EnrollmentPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined'
      ? window.innerWidth >= 1024
      : true
  )

  const { currentTenantId } = useCurrentTenant()

  const [empleados, setEmpleados] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmpleado, setSelectedEmpleado] = useState(null)
  const [loading, setLoading] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()

  // ────────────────────────────────────────────────────────────────────────
  // Cargar empleados del tenant
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (currentTenantId) {
      loadEmpleados()
    } else {
      setEmpleados([])
      setSelectedEmpleado(null)
    }
  }, [currentTenantId])

  const loadEmpleados = async () => {
    if (!currentTenantId) return

    setLoading(true)

    try {
      const { data, error } = await supabase
        .from('empleados')
        .select(`
          id,
          nombre,
          apellido,
          clave_empleado,
          device_userid,
          avatar_url
        `)
        .eq('cliente_id', currentTenantId)
        .eq('activo', true)
        .order('nombre', { ascending: true })

      if (error) {
        console.error(
          '[EnrollmentPage] Error cargando empleados:',
          error
        )

        throw error
      }

      const employeeList = data || []

      setEmpleados(employeeList)

      // ────────────────────────────────────────────────────────────────────
      // Recuperar empleado desde ?empleado_id=
      // ────────────────────────────────────────────────────────────────────

      const empId = searchParams.get('empleado_id')

      if (empId) {
        const found = employeeList.find(
          employee => employee.id === empId
        )

        if (found) {
          setSelectedEmpleado(found)
        } else {
          // Si no pertenece al tenant actual,
          // eliminar el parámetro por seguridad.
          const newParams = new URLSearchParams(searchParams)

          newParams.delete('empleado_id')

          setSearchParams(newParams, {
            replace: true
          })

          setSelectedEmpleado(null)
        }
      }
    } catch (error) {
      console.error(
        '[EnrollmentPage] Error:',
        error
      )

      setEmpleados([])
      setSelectedEmpleado(null)
    } finally {
      setLoading(false)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Filtrado de empleados
  // ────────────────────────────────────────────────────────────────────────

  const filteredEmpleados = empleados.filter(emp => {
    const term = searchTerm.trim().toLowerCase()

    if (!term) return true

    return (
      emp.nombre
        ?.toLowerCase()
        .includes(term) ||

      emp.apellido
        ?.toLowerCase()
        .includes(term) ||

      emp.clave_empleado
        ?.toLowerCase()
        .includes(term) ||

      String(emp.device_userid || '')
        .toLowerCase()
        .includes(term)
    )
  })

  // ────────────────────────────────────────────────────────────────────────
  // Seleccionar empleado
  // ────────────────────────────────────────────────────────────────────────

  const handleSelectEmpleado = employee => {
    setSelectedEmpleado(employee)
    setSearchTerm('')

    const newParams = new URLSearchParams(searchParams)

    if (employee?.id) {
      newParams.set(
        'empleado_id',
        employee.id
      )
    } else {
      newParams.delete('empleado_id')
    }

    setSearchParams(newParams, {
      replace: true
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Cambiar empleado desde select
  // ────────────────────────────────────────────────────────────────────────

  const handleEmployeeChange = event => {
    const employeeId = event.target.value

    const employee =
      empleados.find(
        employee => employee.id === employeeId
      ) || null

    handleSelectEmpleado(employee)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Limpiar empleado
  // ────────────────────────────────────────────────────────────────────────

  const clearSelectedEmpleado = () => {
    setSelectedEmpleado(null)

    const newParams = new URLSearchParams(searchParams)

    newParams.delete('empleado_id')

    setSearchParams(newParams, {
      replace: true
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#1a222c] text-slate-900 dark:text-white">

      {/* ──────────────────────────────────────────────────────────────────
          SIDEBAR
      ────────────────────────────────────────────────────────────────── */}

      <Sidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">

        {/* ────────────────────────────────────────────────────────────────
            HEADER
        ──────────────────────────────────────────────────────────────── */}

        <Header
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />

        <main className="mx-auto max-w-7xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

          {/* ──────────────────────────────────────────────────────────────
              ENCABEZADO
          ────────────────────────────────────────────────────────────── */}

          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Fingerprint className="w-5 h-5 text-indigo-500" />

              Enrolamiento Biométrico
            </h1>

            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Selecciona un colaborador para registrar su rostro y/o huellas dactilares.
            </p>
          </div>

          {/* ──────────────────────────────────────────────────────────────
              BUSCADOR
          ────────────────────────────────────────────────────────────── */}

          <div className="bg-white dark:bg-[#1c2434] border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">

            <div className="flex flex-col md:flex-row gap-3 items-stretch">

              {/* Input de búsqueda */}

              <div className="relative flex-1">

                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />

                <input
                  type="text"
                  placeholder="Buscar por nombre, clave o PIN biométrico..."
                  value={searchTerm}
                  onChange={e =>
                    setSearchTerm(e.target.value)
                  }
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 dark:text-slate-200"
                />

              </div>

              {/* Lista desplegable */}

              <div className="flex-1">

                <select
                  value={selectedEmpleado?.id || ''}
                  onChange={handleEmployeeChange}
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 dark:text-slate-200 disabled:opacity-60"
                >

                  <option value="">
                    {loading
                      ? 'Cargando colaboradores...'
                      : '— Selecciona un colaborador —'}
                  </option>

                  {filteredEmpleados.map(emp => (
                    <option
                      key={emp.id}
                      value={emp.id}
                    >
                      {emp.clave_empleado
                        ? `[${emp.clave_empleado}] `
                        : ''}
                      {emp.nombre || ''}
                      {' '}
                      {emp.apellido || ''}
                    </option>
                  ))}

                </select>

              </div>

            </div>

            {/* ────────────────────────────────────────────────────────────
                Empleado seleccionado
            ──────────────────────────────────────────────────────────── */}

            {selectedEmpleado && (
              <div className="mt-3 flex items-center gap-3 px-3 py-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-lg">

                <div className="w-7 h-7 rounded-full bg-indigo-200 dark:bg-indigo-500/30 flex items-center justify-center flex-shrink-0">

                  <UserCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />

                </div>

                <div className="flex-1 min-w-0">

                  <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 truncate">
                    {selectedEmpleado.nombre || ''}
                    {' '}
                    {selectedEmpleado.apellido || ''}
                  </p>

                  <p className="text-xs text-indigo-500 dark:text-indigo-400">

                    Clave:{' '}
                    {selectedEmpleado.clave_empleado || '—'}

                    {selectedEmpleado.device_userid ? (
                      <>
                        {' · '}
                        PIN Biométrico:{' '}
                        <span className="font-semibold">
                          {selectedEmpleado.device_userid}
                        </span>
                      </>
                    ) : (
                      <>
                        {' · '}
                        <span className="text-amber-600 dark:text-amber-400">
                          Sin PIN biométrico
                        </span>
                      </>
                    )}

                  </p>

                </div>

                <button
                  type="button"
                  onClick={clearSelectedEmpleado}
                  className="text-indigo-400 hover:text-indigo-600 text-xs font-medium"
                >
                  Cambiar
                </button>

              </div>
            )}

          </div>

          {/* ──────────────────────────────────────────────────────────────
              MÓDULOS BIOMÉTRICOS
          ────────────────────────────────────────────────────────────── */}

          {selectedEmpleado ? (

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4">

              {/* ──────────────────────────────────────────────────────────
                  Huellas
              ────────────────────────────────────────────────────────── */}

              <BiometricFingerprintEnrollment
                empleadoId={selectedEmpleado.id}
                clienteId={currentTenantId}
              />

              {/* ──────────────────────────────────────────────────────────
                  Rostro
              ────────────────────────────────────────────────────────── */}

              <BiometricFaceEnrollment
                empleadoId={selectedEmpleado.id}
                clienteId={currentTenantId}
              />

            </div>

          ) : (

            <div className="flex flex-col items-center justify-center py-20 text-center bg-white dark:bg-[#1c2434] border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">

              <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />

              <h3 className="text-base font-medium text-slate-600 dark:text-slate-400">
                Ningún colaborador seleccionado
              </h3>

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

