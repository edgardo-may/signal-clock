// src/shared/components/Layout/TenantSelector.jsx — Selector de Tenant Activo para SuperAdmin
import { Building2, ChevronDown } from 'lucide-react'

export default function TenantSelector({
  tenants = [],
  currentTenantId,
  onSelectTenant,
  loading = false,
  className = '',
}) {
  if (!tenants || tenants.length === 0) return null

  const selectedTenant = tenants.find((t) => t.id === currentTenantId) || tenants[0]

  return (
    <div className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs font-semibold ${className}`}>
      <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
      <span className="text-slate-600 dark:text-slate-300 hidden sm:inline">Empresa:</span>
      
      <div className="relative">
        <select
          value={currentTenantId || ''}
          onChange={(e) => onSelectTenant && onSelectTenant(e.target.value)}
          disabled={loading}
          className="appearance-none bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-md pl-2.5 pr-7 py-1 text-xs font-semibold outline-none focus:border-blue-500 cursor-pointer shadow-sm disabled:opacity-50"
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre_empresa} ({t.plan_suscripcion || 'starter'})
            </option>
          ))}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
      </div>
    </div>
  )
}
