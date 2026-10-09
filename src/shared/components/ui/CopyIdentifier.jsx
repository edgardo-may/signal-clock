import { Copy } from 'lucide-react'
import toast from 'react-hot-toast'

export default function CopyIdentifier({ value, label = 'ID' }) {
  if (!value) return null

  const copy = async event => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(value))
      toast.success(`${label} copiado`)
    } catch {
      toast.error('No se pudo copiar. Selecciona el ID y cópialo manualmente.')
    }
  }

  return (
    <div className="mt-1 flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="shrink-0 py-1">{label}:</span>
      <span className="min-w-0 select-all break-all py-1 font-mono" title={String(value)}>{value}</span>
      <button type="button" onClick={copy} aria-label={`Copiar ${label}`} title={`Copiar ${label}`} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#03363D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#03363D] dark:hover:bg-slate-800 dark:hover:text-teal-300">
        <Copy size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
