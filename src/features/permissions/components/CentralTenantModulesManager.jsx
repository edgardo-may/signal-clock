/**
 * CentralTenantModulesManager.jsx
 * Signum-Clock Central — Gestión de módulos habilitados por tenant.
 *
 * Permite al superadmin seleccionar una empresa y activar/desactivar
 * qué módulos del catálogo están disponibles para esa empresa.
 *
 * Solo accesible desde Central (requiere auth_is_superadmin en RLS).
 * Los cambios se propagan en tiempo real a los usuarios del tenant
 * mediante la suscripción Realtime de AuthProvider en cliente_modulos.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, Package, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'

export default function CentralTenantModulesManager() {
  const [tenants, setTenants]               = useState([])
  const [selectedTenantId, setSelectedTenant] = useState(null)
  const [modules, setModules]               = useState([])
  const [tenantModules, setTenantModules]   = useState({}) // { module_key → habilitado }
  const [loadingTenants, setLoadingTenants] = useState(true)
  const [loadingModules, setLoadingModules] = useState(false)
  const [savingKey, setSavingKey]           = useState(null)

  // ── Cargar lista de tenants ──────────────────────────────────
  const fetchTenants = useCallback(async () => {
    setLoadingTenants(true)
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nombre_empresa, plan_suscripcion, estatus')
        .order('nombre_empresa', { ascending: true })

      if (error) throw error
      setTenants(data || [])
      if (data?.length && !selectedTenantId) {
        setSelectedTenant(data[0].id)
      }
    } catch (err) {
      toast.error('No se pudieron cargar las empresas: ' + err.message)
    } finally {
      setLoadingTenants(false)
    }
  }, [selectedTenantId])

  // ── Cargar catálogo de módulos y estado de habilitación del tenant ──
  const fetchModulesForTenant = useCallback(async (tenantId) => {
    if (!tenantId) return
    setLoadingModules(true)
    try {
      const [{ data: catalog }, { data: enabled }] = await Promise.all([
        supabase
          .from('module_catalog')
          .select('module_key, label, description, module_group, sort_order')
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('cliente_modulos')
          .select('module_key, habilitado')
          .eq('cliente_id', tenantId),
      ])

      setModules(catalog || [])

      // Mapa { module_key → habilitado }
      const map = {}
      ;(enabled || []).forEach(({ module_key, habilitado }) => {
        map[module_key] = habilitado
      })
      setTenantModules(map)
    } catch (err) {
      toast.error('No se pudieron cargar los módulos: ' + err.message)
    } finally {
      setLoadingModules(false)
    }
  }, [])

  useEffect(() => { fetchTenants() }, [fetchTenants])

  useEffect(() => {
    if (selectedTenantId) fetchModulesForTenant(selectedTenantId)
  }, [selectedTenantId, fetchModulesForTenant])

  // ── Calcular grupos de módulos ───────────────────────────────
  const moduleGroups = useMemo(() => {
    return modules.reduce((acc, mod) => {
      acc[mod.module_group] = [...(acc[mod.module_group] || []), mod]
      return acc
    }, {})
  }, [modules])

  // ── Toggle habilitado/deshabilitado ─────────────────────────
  const toggleModule = async (moduleKey) => {
    if (!selectedTenantId || savingKey) return

    const currentState = tenantModules[moduleKey] ?? false
    const newState = !currentState
    setSavingKey(moduleKey)

    try {
      const { error } = await supabase
        .from('cliente_modulos')
        .upsert(
          { cliente_id: selectedTenantId, module_key: moduleKey, habilitado: newState },
          { onConflict: 'cliente_id,module_key' }
        )

      if (error) throw error

      setTenantModules((prev) => ({ ...prev, [moduleKey]: newState }))
      toast.success(
        newState
          ? `Módulo habilitado para la empresa`
          : `Módulo deshabilitado — los permisos de usuario asociados fueron eliminados`
      )
    } catch (err) {
      toast.error('No se pudo actualizar el módulo: ' + err.message)
    } finally {
      setSavingKey(null)
    }
  }

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId)

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
          <div>
            <p className="font-bold">Módulos habilitados por empresa</p>
            <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
              Aquí defines qué módulos están disponibles para cada empresa. Los administradores del tenant
              solo podrán asignar a sus usuarios módulos que estén habilitados aquí. Deshabilitar un módulo
              elimina inmediatamente los permisos individuales de ese módulo en esa empresa.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,2fr)]">
        {/* Panel: Selector de empresa */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-bold">Empresa</h2>
            </div>
            <button
              onClick={fetchTenants}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-amber-600 dark:hover:bg-slate-800"
              title="Actualizar"
            >
              <RefreshCw className={`h-4 w-4 ${loadingTenants ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="max-h-[480px] overflow-y-auto p-2">
            {loadingTenants ? (
              <p className="p-4 text-center text-xs text-slate-500">Cargando empresas...</p>
            ) : tenants.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">No hay empresas registradas.</p>
            ) : tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => setSelectedTenant(tenant.id)}
                className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition-colors ${
                  selectedTenantId === tenant.id
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <p className="truncate text-sm font-bold">{tenant.nombre_empresa}</p>
                <p className={`mt-0.5 truncate text-[11px] uppercase tracking-wide ${
                  selectedTenantId === tenant.id ? 'text-amber-100' : 'text-slate-500'
                }`}>
                  {tenant.plan_suscripcion} · {tenant.estatus}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Panel: Módulos del tenant seleccionado */}
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {!selectedTenant ? (
            <div className="flex min-h-80 items-center justify-center p-8 text-center text-sm text-slate-500">
              Selecciona una empresa para gestionar sus módulos.
            </div>
          ) : loadingModules ? (
            <div className="flex min-h-80 items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-amber-600" />
                  <h2 className="font-bold">Módulos de {selectedTenant.nombre_empresa}</h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {Object.values(tenantModules).filter(Boolean).length} de {modules.length} módulos habilitados
                </p>
              </div>

              <div className="space-y-5 p-5">
                {Object.entries(moduleGroups).map(([group, groupModules]) => (
                  <div key={group}>
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">{group}</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {groupModules.map((mod) => {
                        const enabled   = tenantModules[mod.module_key] ?? false
                        const isSaving  = savingKey === mod.module_key

                        return (
                          <button
                            key={mod.module_key}
                            disabled={isSaving}
                            onClick={() => toggleModule(mod.module_key)}
                            className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                              enabled
                                ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                                : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/30'
                            }`}
                          >
                            <span className="mt-0.5 flex-none">
                              {enabled ? (
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                              ) : (
                                <XCircle className="h-5 w-5 text-slate-400" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-bold">{mod.label}</span>
                              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{mod.description}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
