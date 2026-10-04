/**
 * PolicyVersionHistory.jsx — Historial de versiones de una política
 * Signum Clock Central — Módulo: Políticas de Asistencia (UI Preview)
 */
import { Clock, CheckCircle2, Archive } from 'lucide-react'

export default function PolicyVersionHistory({ historial }) {
  if (!historial || historial.length === 0) {
    return (
      <div className="py-10 text-center">
        <Archive className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Sin historial de versiones</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Las versiones publicadas aparecerán aquí.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {historial.map((v) => {
        const isActive = v.estado === 'active'
        const isDraft  = v.estado === 'draft'
        return (
          <div
            key={v.version}
            className="flex items-start gap-3 px-4 py-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
          >
            {/* Indicador de estado */}
            <div className="mt-0.5 flex-shrink-0">
              {isActive ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 block animate-pulse" />
              ) : isDraft ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 block" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 block" />
              )}
            </div>

            {/* Contenido */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                  v{v.version}
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-500/20'
                      : isDraft
                      ? 'bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-500/20'
                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                  }`}
                >
                  {isActive ? 'Activa' : isDraft ? 'Borrador' : 'Finalizada'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3 flex-shrink-0" />
                {v.vigencia}
              </p>
              {v.resumen && (
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{v.resumen}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
