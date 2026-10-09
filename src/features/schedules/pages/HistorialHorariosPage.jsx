import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { cancunToday } from '../services/scheduleLocalDate'

const empty = { tenant: null, schedules: [], revisions: [], assignments: [], employees: [] }

// Read every page: PostgREST's default row cap must not hide older history.
async function readTenantHistory(table, fields, tenant) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select(fields)
      .eq('cliente_id', tenant).order('id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

export default function HistorialHorariosPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const { currentTenantId, currentTenant, isSuperAdmin, tenants, loadingTenants, setSelectedTenantId } = useCurrentTenant()
  const [history, setHistory] = useState(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [scheduleId, setScheduleId] = useState('')
  const [tab, setTab] = useState('revisions')
  const [page, setPage] = useState(1)
  const today = cancunToday()

  useEffect(() => {
    let cancelled = false
    setHistory(empty)
    setScheduleId('')
    setPage(1)
    setError('')
    if (!currentTenantId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      readTenantHistory('horarios', 'id,nombre', currentTenantId),
      readTenantHistory('schedule_revisions', 'id,horario_id,version,effective_from,config_snapshot,created_by,reason', currentTenantId),
      readTenantHistory('empleados_horarios', 'id,horario_id,empleado_id,schedule_revision_id,fecha_inicio,fecha_fin,activo,notas', currentTenantId),
      readTenantHistory('empleados', 'id,nombre,apellido', currentTenantId),
    ]).then(([schedules, revisions, assignments, employees]) => {
      if (!cancelled) setHistory({ tenant: currentTenantId, schedules, revisions, assignments, employees })
    }).catch(err => { if (!cancelled) setError(err.message || 'No se pudo cargar el historial.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentTenantId, refresh])

  const visible = history.tenant === currentTenantId ? history : empty
  const scheduleNames = new Map(visible.schedules.map(s => [s.id, s.nombre]))
  const employeeNames = new Map(visible.employees.map(e => [e.id, `${e.nombre || ''} ${e.apellido || ''}`.trim()]))
  const revisionNames = new Map(visible.revisions.map(r => [r.id, `v${r.version}`]))
  const revisionPeriods = useMemo(() => {
    const periods = new Map()
    const grouped = new Map()
    visible.revisions.forEach(r => {
      if (!grouped.has(r.horario_id)) grouped.set(r.horario_id, [])
      grouped.get(r.horario_id).push(r)
    })
    grouped.forEach(rows => {
      rows.sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.version - b.version)
      rows.forEach((row, i) => periods.set(row.id, rows[i + 1]?.effective_from || null))
    })
    return periods
  }, [visible.revisions])
  const rows = (tab === 'revisions' ? visible.revisions : visible.assignments)
    .filter(row => !scheduleId || row.horario_id === scheduleId)
    .slice().sort((a, b) => (b.effective_from || b.fecha_inicio).localeCompare(a.effective_from || a.fecha_inicio) || a.id.localeCompare(b.id))
  const pages = Math.max(1, Math.ceil(rows.length / 20))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * 20, currentPage * 20)
  const th = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap'
  const td = 'px-4 py-4 align-top text-sm text-slate-700 dark:text-slate-300'

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-white">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <main className="mx-auto w-full max-w-screen-2xl space-y-6 p-4 md:p-6 2xl:p-10">
          <Link to="/horarios" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#03363D] dark:hover:text-teal-300">
            <ArrowLeft size={16} /> Volver a Horarios
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold"><History className="text-[#03363D] dark:text-teal-300" /> Historial de Horarios</h1>
              <p className="mt-1 text-sm text-slate-500">Revisiones y asignaciones de {currentTenant?.nombre_empresa || 'la empresa seleccionada'}. Consulta sin edición del histórico.</p>
            </div>
            {isSuperAdmin && <TenantSelector tenants={tenants} currentTenantId={currentTenantId} onSelectTenant={setSelectedTenantId} loading={loadingTenants} />}
          </div>
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <label className="space-y-1 text-xs font-semibold text-slate-500">Horario
                <select value={scheduleId} onChange={e => { setScheduleId(e.target.value); setPage(1) }} className="block w-full min-w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#03363D] dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="">Todos los horarios</option>
                  {visible.schedules.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </label>
              <button onClick={() => setRefresh(x => x + 1)} disabled={loading || !currentTenantId} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
            </div>
            <div className="flex gap-5 border-b border-slate-200 px-4 dark:border-slate-800" role="tablist" aria-label="Tipo de historial">
              {[['revisions', 'Revisiones'], ['assignments', 'Asignaciones']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} aria-controls="schedule-history-panel" id={`history-tab-${key}`} onClick={() => { setTab(key); setPage(1) }} className={`border-b-2 py-3 text-sm font-semibold ${tab === key ? 'border-[#03363D] text-[#03363D] dark:border-teal-300 dark:text-teal-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}>{label}</button>)}
            </div>
            <div id="schedule-history-panel" role="tabpanel" aria-labelledby={`history-tab-${tab}`} aria-busy={loading}>
              {!currentTenantId ? <p className="p-10 text-center text-sm text-slate-500">Selecciona una empresa para consultar el historial.</p>
                : loading ? <p className="p-10 text-center text-sm text-slate-500" role="status">Cargando historial…</p>
                  : error ? <p role="alert" className="p-6 text-sm text-rose-600">No se pudo cargar el historial: {error}</p>
                    : !rows.length ? <p className="p-10 text-center text-sm text-slate-500">No hay {tab === 'revisions' ? 'revisiones' : 'asignaciones'} registradas para esta selección.</p>
                      : <div className="overflow-x-auto"><table className="w-full border-collapse">
                        <caption className="sr-only">Historial de {tab === 'revisions' ? 'revisiones' : 'asignaciones'} de horarios</caption>
                        <thead className="bg-slate-50 dark:bg-slate-800/50"><tr>
                          {(tab === 'revisions' ? ['Horario', 'Revisión', 'Vigente desde', 'Vigente hasta', 'Cambio', 'Actor', 'Motivo'] : ['Colaborador', 'Horario', 'Revisión', 'Desde', 'Hasta', 'Estado', 'Motivo']).map(label => <th key={label} scope="col" className={th}>{label}</th>)}
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{pageRows.map(row => tab === 'revisions' ? <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className={`${td} font-semibold`}>{scheduleNames.get(row.horario_id) || row.horario_id}</td>
                          <td className={td}><span className="rounded bg-[#BDD9D7]/30 px-2 py-1 font-mono text-xs text-[#03363D] dark:text-teal-300">v{row.version}</span></td>
                          <td className={`${td} whitespace-nowrap`}>{row.effective_from}</td>
                          <td className={`${td} whitespace-nowrap`}>{revisionPeriods.get(row.id) ? `Antes de ${revisionPeriods.get(row.id)}` : 'Sin fecha de fin'}</td>
                          <td className={td}>{row.config_snapshot?.horario_activo === false ? 'Deshabilitación' : row.version === 1 ? 'Creación' : 'Nueva revisión'}</td>
                          <td className={`${td} max-w-52 break-all text-xs`} title={row.created_by || ''}>{row.created_by || 'Sistema'}</td>
                          <td className={`${td} min-w-48 max-w-sm break-words`}>{row.reason || '—'}</td>
                        </tr> : <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className={`${td} font-semibold`}>{employeeNames.get(row.empleado_id) || row.empleado_id}</td>
                          <td className={td}>{scheduleNames.get(row.horario_id) || row.horario_id}</td>
                          <td className={td}>{revisionNames.get(row.schedule_revision_id) || 'Sin revisión'}</td>
                          <td className={`${td} whitespace-nowrap`}>{row.fecha_inicio}</td>
                          <td className={`${td} whitespace-nowrap`}>{row.fecha_fin || 'Sin fecha de fin'}</td>
                          <td className={td}>{!row.activo ? 'Anulada' : row.fecha_inicio > today ? 'Futura' : row.fecha_fin && row.fecha_fin < today ? 'Finalizada' : 'Vigente'}</td>
                          <td className={`${td} min-w-48 max-w-sm break-words`}>{row.notas || '—'}</td>
                        </tr>)}</tbody>
                      </table></div>}
            </div>
            {!loading && !error && rows.length > 0 && <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
              <span>{rows.length} registros · Página {currentPage} de {pages}</span>
              <div className="flex gap-2"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded border border-slate-200 px-3 py-1.5 disabled:opacity-40 dark:border-slate-700">Anterior</button><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded border border-slate-200 px-3 py-1.5 disabled:opacity-40 dark:border-slate-700">Siguiente</button></div>
            </div>}
          </section>
        </main>
      </div>
    </div>
  )
}
