/**
 * ConfirmDialog.jsx — Modal de confirmación global v4 · Jet Stream + Blue Whale
 * Uso:
 *   <ConfirmDialog
 *     open={open}
 *     title="¿Eliminar registro?"
 *     message="Esta acción no se puede deshacer."
 *     variant="danger"          // 'danger' | 'warning' | 'info' | 'success'
 *     confirmLabel="Sí, eliminar"
 *     onConfirm={fn}
 *     onCancel={fn}
 *     loading={false}
 *   />
 */
import { useEffect, useRef } from 'react'
import { AlertTriangle, Trash2, Info, CheckCircle, X } from 'lucide-react'

const VARIANT_CONFIG = {
  danger: {
    icon:        Trash2,
    iconBg:      'bg-rose-50',
    iconColor:   'text-rose-600',
    confirmCls:  'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500 text-white',
    borderTop:   'border-t-rose-500',
  },
  warning: {
    icon:        AlertTriangle,
    iconBg:      'bg-amber-50',
    iconColor:   'text-amber-600',
    confirmCls:  'bg-amber-500 hover:bg-amber-600 focus:ring-amber-400 text-white',
    borderTop:   'border-t-amber-500',
  },
  info: {
    icon:        Info,
    iconBg:      'bg-blue-600/20',
    iconColor:   'text-blue-600 dark:text-blue-400',
    confirmCls:  'bg-blue-600 hover:bg-slate-100 focus:ring-brand-primary text-white',
    borderTop:   'border-t-brand-primary',
  },
  success: {
    icon:        CheckCircle,
    iconBg:      'bg-emerald-50',
    iconColor:   'text-emerald-600',
    confirmCls:  'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500 text-white',
    borderTop:   'border-t-emerald-500',
  },
}

export default function ConfirmDialog({
  open,
  title        = '¿Estás seguro?',
  message      = 'Esta acción no se puede deshacer.',
  variant      = 'danger',
  confirmLabel = 'Confirmar',
  cancelLabel  = 'Cancelar',
  onConfirm,
  onCancel,
  loading      = false,
}) {
  const confirmRef = useRef(null)
  const cfg = VARIANT_CONFIG[variant] ?? VARIANT_CONFIG.danger
  const Icon = cfg.icon

  // Focus trap — enfocar botón confirmar al abrir
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => confirmRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open])

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={!loading ? onCancel : undefined}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`
          relative w-full max-w-md rounded-xl
          bg-white
          border border-blue-500/10
          shadow-2xl
          border-t-4 ${cfg.borderTop}
          transform transition-all duration-200
        `}
        style={{
          boxShadow: '0 8px 40px rgba(3,54,61,0.18), 0 2px 8px rgba(3,54,61,0.08)',
          animation: 'dialogIn 0.2s cubic-bezier(0.34,1.56,0.64,1) both',
        }}
      >
        {/* Close button */}
        <button
          onClick={!loading ? onCancel : undefined}
          className="absolute right-3 top-3 p-1.5 rounded-lg transition-colors"
          style={{ color: 'rgba(3,54,61,0.40)' }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'rgba(189,217,215,0.20)'
            e.currentTarget.style.color = '#2563EB'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = 'rgba(3,54,61,0.40)'
          }}
          aria-label="Cerrar"
          disabled={loading}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6">
          {/* Icon + Title */}
          <div className="flex items-start gap-4">
            <div className={`flex-shrink-0 flex h-11 w-11 items-center justify-center rounded-full ${cfg.iconBg}`}>
              <Icon className={`w-5 h-5 ${cfg.iconColor}`} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h3
                id="confirm-title"
                className="text-base font-bold leading-snug"
                style={{ color: '#0f172a' }}
              >
                {title}
              </h3>
              {message && (
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: '#2563EB' }}>
                  {message}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{
                border: '1px solid rgba(3,54,61,0.12)',
                backgroundColor: '#E6F4EA',
                color: '#2563EB',
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#E0F0EF' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#E6F4EA' }}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-60 disabled:cursor-not-allowed transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 ${cfg.confirmCls}`}
            >
              {loading && (
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>

      {/* Keyframe global */}
      <style>{`
        @keyframes dialogIn {
          from { opacity: 0; transform: scale(0.92) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
      `}</style>
    </div>
  )
}





