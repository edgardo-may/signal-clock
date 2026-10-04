/**
 * AttendancePoliciesPage.jsx — Módulo: Políticas de Asistencia
 * Signum Clock Central — SuperAdmin
 *
 * Lee las empresas dadas de alta en Supabase y permite configurar
 * y versionar las políticas de retardos, faltas, horas extras y tolerancias
 * para cada una de ellas.
 */
import { useState, useEffect, useCallback } from 'react'
import CentralLayout from '../../components/CentralLayout'
import PolicyCompanyList from './PolicyCompanyList'
import PolicyEditor from './PolicyEditor'
import { fetchCompaniesWithPolicies } from './policyService'
import { ClipboardList, RefreshCw, AlertCircle, Building2, ShieldCheck, FileClock } from 'lucide-react'
import toast from 'react-hot-toast'

export default function AttendancePoliciesPage() {
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCompaniesWithPolicies()
      setPolicies(data)
      // Si hay una empresa seleccionada, refrescar sus datos
      if (selectedEntry) {
        const refreshed = data.find((p) => p.clienteId === selectedEntry.clienteId)
        if (refreshed) setSelectedEntry(refreshed)
      }
    } catch (err) {
      console.error('[AttendancePoliciesPage] Error al cargar empresas:', err)
      setError(err.message || 'No se pudieron cargar las empresas registradas.')
      toast.error('Error al consultar empresas en el sistema')
    } finally {
      setLoading(false)
    }
  }, [selectedEntry])

  useEffect(() => {
    loadData()
  }, [])

  function handleConfigure(entry) {
    setSelectedEntry(entry)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleBack() {
    setSelectedEntry(null)
  }

  function handleSaveSuccess(updatedEntry) {
    setSelectedEntry(updatedEntry)
    setPolicies((prev) =>
      prev.map((p) => (p.clienteId === updatedEntry.clienteId ? updatedEntry : p))
    )
  }

  // Métricas rápidas
  const activeCount = policies.filter((p) => p.estado === 'active').length
  const draftCount = policies.filter((p) => p.estado === 'draft').length
  const unconfiguredCount = policies.filter((p) => p.estado === 'unconfigured').length

  return (
    <CentralLayout>
      <div className="space-y-6">
        {/* ── Page Header ── */}
        {!selectedEntry && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="w-5 h-5 text-[#03363D] dark:text-teal-400" />
                <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight">
                  Políticas de Asistencia
                </h1>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Configura y versiona las reglas de retardos, faltas, tolerancias y horas extras por empresa.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                title="Actualizar listado de empresas"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Actualizar</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Resumen de empresas (solo en vista de listado) ── */}
        {!selectedEntry && !loading && !error && policies.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 mb-1">
                <Building2 className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Empresas</span>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{policies.length}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-emerald-500 mb-1">
                <ShieldCheck className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Activas</span>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{activeCount}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-amber-500 mb-1">
                <FileClock className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">En borrador</span>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{draftCount}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <ClipboardList className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Sin configurar</span>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{unconfiguredCount}</p>
            </div>
          </div>
        )}

        {/* ── Error state ── */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Error al cargar empresas</p>
              <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">{error}</p>
              <button
                onClick={loadData}
                className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300 underline hover:no-underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* ── Vista condicional: Listado ↔ Editor ── */}
        {selectedEntry ? (
          <PolicyEditor
            entry={selectedEntry}
            onBack={handleBack}
            onSaveSuccess={handleSaveSuccess}
          />
        ) : (
          <PolicyCompanyList
            policies={policies}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            stateFilter={stateFilter}
            onStateFilterChange={setStateFilter}
            onConfigure={handleConfigure}
          />
        )}
      </div>
    </CentralLayout>
  )
}
