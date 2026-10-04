/**
 * PolicyCompanyList.jsx — Tabla de empresas con su política activa
 * Signum Clock Central — Módulo: Políticas de Asistencia
 */
import { Search, ChevronDown, Settings2, ShieldAlert, Building2, Loader2 } from 'lucide-react'
import { MOCK_POLICY_STATES } from './mockData'

const STATE_FILTER_OPTIONS = [
  { value: 'all',          label: 'Todas' },
  { value: 'active',       label: 'Activa' },
  { value: 'draft',        label: 'Borrador' },
  { value: 'unconfigured', label: 'Sin configurar' },
]

export default function PolicyCompanyList({
  policies = [],
  loading = false,
  search,
  onSearchChange,
  stateFilter,
  onStateFilterChange,
  onConfigure,
}) {
  const filtered = policies.filter((p) => {
    const q = search.toLowerCase()
    const matchName = (p.empresa || '').toLowerCase().includes(q) ||
                      (p.idEmpresa || '').toLowerCase().includes(q) ||
                      (p.rfc || '').toLowerCase().includes(q)
    const matchState = stateFilter === 'all' || p.estado === stateFilter
    return matchName && matchState
  })

  return (
    <div className="space-y-4">
      {/* ── Barra de filtros ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Búsqueda */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            id="policy-search"
            type="text"
            placeholder="Buscar empresa por nombre, ID o RFC…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all placeholder:text-slate-400"
          />
        </div>

        {/* Filtro de estado */}
        <div className="relative sm:w-48">
          <select
            id="policy-state-filter"
            value={stateFilter}
            onChange={(e) => onStateFilterChange(e.target.value)}
            className="w-full pl-3.5 pr-8 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all appearance-none cursor-pointer"
          >
            {STATE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="hidden md:grid grid-cols-[1.4fr_1.1fr_90px_140px_130px_110px] gap-4 px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
          {['Empresa registrada', 'Política configurada', 'Versión', 'Vigencia', 'Estado', 'Acción'].map((h) => (
            <span
              key={h}
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500"
            >
              {h}
            </span>
          ))}
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="px-5 py-14 text-center">
            <Loader2 className="w-7 h-7 text-[#03363D] dark:text-teal-400 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Cargando empresas dadas de alta…
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <ShieldAlert className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              No se encontraron empresas
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Prueba con otro término de búsqueda o cambia el filtro de estado.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((entry) => {
              const stateInfo = MOCK_POLICY_STATES[entry.estado] || MOCK_POLICY_STATES.unconfigured

              return (
                <li
                  key={entry.clienteId}
                  className="group hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  {/* Desktop row */}
                  <div className="hidden md:grid grid-cols-[1.4fr_1.1fr_90px_140px_130px_110px] gap-4 items-center px-5 py-3.5">
                    {/* Empresa */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {entry.empresa}
                        </span>
                        {entry.idEmpresa && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            #{entry.idEmpresa}
                          </span>
                        )}
                      </div>
                      {entry.rfc && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                          RFC: {entry.rfc}
                        </p>
                      )}
                    </div>

                    {/* Política */}
                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate font-medium">
                      {entry.politica}
                    </span>

                    {/* Versión */}
                    <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
                      {entry.version ? `v${entry.version}` : '—'}
                    </span>

                    {/* Vigencia */}
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {entry.vigencia}
                    </span>

                    {/* Estado */}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border w-fit ${stateInfo.badge}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateInfo.dot}`} />
                      {stateInfo.label}
                    </span>

                    {/* Acción */}
                    <div className="flex justify-end">
                      <button
                        id={`configure-${entry.clienteId}`}
                        onClick={() => onConfigure(entry)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#03363D] dark:text-teal-300 bg-[#03363D]/5 hover:bg-[#03363D]/10 dark:bg-teal-400/10 dark:hover:bg-teal-400/20 border border-[#03363D]/15 dark:border-teal-400/20 transition-all"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        Configurar
                      </button>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{entry.empresa}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{entry.politica}</p>
                        {entry.rfc && <p className="text-[11px] text-slate-400 font-mono">RFC: {entry.rfc}</p>}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border flex-shrink-0 ${stateInfo.badge}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateInfo.dot}`} />
                        {stateInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="text-xs text-slate-400 dark:text-slate-500 space-x-2">
                        <span>{entry.version ? `v${entry.version}` : 'Sin versión'}</span>
                        <span>·</span>
                        <span>{entry.vigencia}</span>
                      </div>
                      <button
                        onClick={() => onConfigure(entry)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#03363D] dark:text-teal-300 bg-[#03363D]/5 dark:bg-teal-400/10 hover:bg-[#03363D]/15 transition-colors border border-[#03363D]/15 dark:border-teal-400/20"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        Configurar
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40 flex items-center justify-between">
            <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
              Mostrando {filtered.length} {filtered.length === 1 ? 'empresa' : 'empresas'}
            </p>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Datos sincronizados con catálogo de empresas
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
