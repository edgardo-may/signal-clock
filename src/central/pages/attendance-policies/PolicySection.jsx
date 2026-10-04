/**
 * PolicySection.jsx — Sección colapsable de formulario de política
 * Signum Clock Central — Módulo: Políticas de Asistencia (UI Preview)
 */

export default function PolicySection({ title, children }) {
  return (
    <div className="space-y-4">
      <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-4">
          {title}
        </h3>
        <div className="space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}
