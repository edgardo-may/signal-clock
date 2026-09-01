/**
 * ModulePermissionsManager.jsx
 * Signum-Clock · Gestión de permisos de módulos por usuario.
 *
 * Modo "central": superadmin selecciona empresa → ve usuarios de esa empresa
 *                 → gestiona módulos SIN restricción de módulos habilitados
 *                 (superadmin puede asignar cualquier módulo del catálogo).
 *
 * Modo "tenant":  admin del tenant ve sus usuarios → gestiona módulos
 *                 SOLO muestra módulos habilitados para su empresa
 *                 (el RLS de BD también bloquea en backend cualquier intento de asignar
 *                 módulos no habilitados, incluso vía llamadas directas).
 *
 * Seguridad: las restricciones reales están en Supabase RLS (migración 035).
 * La UI solo mejora la experiencia; no es la capa de seguridad.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Check, KeyRound, Plus, RefreshCw, RotateCcw, ShieldCheck, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import { getDefaultModuleAccess, TENANT_MODULES } from '../../../shared/auth/permissions'

export default function ModulePermissionsManager({ mode, tenantId = null }) {
  const isCentral = mode === 'central'

  // ── Estado ───────────────────────────────────────────────────
  const [tenants, setTenants]               = useState([])
  const [selectedTenantId, setSelectedTenantId] = useState(tenantId)
  const [users, setUsers]                   = useState([])
  const [selectedUser, setSelectedUser]     = useState(null)
  const [overrides, setOverrides]           = useState({})
  const [modules, setModules]               = useState(TENANT_MODULES)
  const [loading, setLoading]               = useState(true)
  const [savingModule, setSavingModule]     = useState(null)
  const [newModule, setNewModule]           = useState({ key: '', label: '', description: '', group: 'Operación' })
  const [creatingModule, setCreatingModule] = useState(false)

  // En modo Central, cargar lista de tenants para el selector
  const loadTenants = useCallback(async () => {
    if (!isCentral) return
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nombre_empresa')
        .order('nombre_empresa', { ascending: true })

      if (error) throw error
      setTenants(data || [])
      if (data?.length && !selectedTenantId) {
        setSelectedTenantId(data[0].id)
      }
    } catch (err) {
      toast.error('No se pudieron cargar las empresas: ' + err.message)
    }
  }, [isCentral, selectedTenantId])

  // Cargar catálogo de módulos
  // - En modo Central: catálogo completo (superadmin puede asignar cualquier módulo)
  // - En modo Tenant:  solo módulos habilitados para la empresa
  const loadModules = useCallback(async () => {
    if (isCentral) {
      // Superadmin ve el catálogo completo
      const { data, error } = await supabase
        .from('module_catalog')
        .select('module_key, label, description, module_group, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('label', { ascending: true })

      if (error || !data?.length) return
      setModules(data.map((m) => ({ key: m.module_key, label: m.label, description: m.description, group: m.module_group })))
    } else {
      // Admin de tenant: SOLO módulos habilitados para su empresa
      const effectiveTenantId = tenantId || selectedTenantId
      if (!effectiveTenantId) return

      const { data, error } = await supabase
        .from('cliente_modulos')
        .select('module_key, module_catalog(label, description, module_group, sort_order)')
        .eq('cliente_id', effectiveTenantId)
        .eq('habilitado', true)
        .order('module_catalog(sort_order)', { ascending: true })

      if (error) {
        // Fallback: si cliente_modulos aún no existe (entorno de desarrollo sin migración 035)
        // cargar el catálogo completo con advertencia
        console.warn('[ModulePermissionsManager] cliente_modulos no disponible, usando catálogo completo')
        const { data: catalog } = await supabase
          .from('module_catalog')
          .select('module_key, label, description, module_group, sort_order')
          .eq('active', true)
          .order('sort_order')
        if (catalog?.length) {
          setModules(catalog.map((m) => ({ key: m.module_key, label: m.label, description: m.description, group: m.module_group })))
        }
        return
      }

      if (!data?.length) {
        setModules([])
        return
      }

      setModules(data.map((row) => ({
        key: row.module_key,
        label: row.module_catalog?.label || row.module_key,
        description: row.module_catalog?.description || '',
        group: row.module_catalog?.module_group || 'Otros',
      })))
    }
  }, [isCentral, tenantId, selectedTenantId])

  // Cargar overrides del usuario seleccionado
  const loadOverrides = useCallback(async (user) => {
    if (!user) return
    const { data, error } = await supabase
      .from('user_module_permissions')
      .select('module_key, allowed')
      .eq('user_id', user.id)

    if (error) {
      toast.error('No se pudieron cargar los permisos: ' + error.message)
      return
    }
    setOverrides(Object.fromEntries((data || []).map(({ module_key, allowed }) => [module_key, allowed])))
  }, [])

  // Cargar usuarios — filtrados por empresa en modo central o por tenant en modo tenant
  const loadUsers = useCallback(async () => {
    const effectiveTenantId = isCentral ? selectedTenantId : (tenantId || selectedTenantId)
    if (!isCentral && !effectiveTenantId) return

    setLoading(true)
    try {
      let query = supabase
        .from('usuarios_perfiles')
        .select('id, nombre, rol, cliente_id, estatus_cuenta, clientes(nombre_empresa)')
        .eq('estatus_cuenta', 'activo')
        .order('nombre', { ascending: true })

      if (effectiveTenantId) {
        query = query.eq('cliente_id', effectiveTenantId)
      } else if (isCentral) {
        // No hay tenant seleccionado aún en modo central
        query = query.not('cliente_id', 'is', null)
      }

      const { data, error } = await query
      if (error) throw error

      const nextUsers = data || []
      setUsers(nextUsers)

      const current = nextUsers.find((u) => u.id === selectedUser?.id) || nextUsers[0] || null
      setSelectedUser(current)
      await loadOverrides(current)
    } catch (err) {
      toast.error('No se pudieron cargar los usuarios: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [isCentral, loadOverrides, selectedTenantId, selectedUser?.id, tenantId])

  // Inicialización
  useEffect(() => { if (isCentral) loadTenants() }, [isCentral, loadTenants])

  useEffect(() => {
    const ready = isCentral ? !!selectedTenantId : !!(tenantId || selectedTenantId)
    if (ready || isCentral) {
      loadUsers()
      loadModules()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCentral, selectedTenantId, tenantId])

  const moduleGroups = useMemo(() => {
    return modules.reduce((acc, mod) => {
      acc[mod.group] = [...(acc[mod.group] || []), mod]
      return acc
    }, {})
  }, [modules])

  // ── Crear módulo nuevo (solo Central) ───────────────────────
  const createModule = async (event) => {
    event.preventDefault()
    const moduleKey = newModule.key.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_]*$/.test(moduleKey) || !newModule.label.trim()) {
      toast.error('La clave usa minúsculas, números y guiones bajos; el nombre es obligatorio.')
      return
    }

    setCreatingModule(true)
    try {
      const { error } = await supabase
        .from('module_catalog')
        .insert({
          module_key: moduleKey,
          label: newModule.label.trim(),
          description: newModule.description.trim() || 'Módulo personalizado.',
          module_group: newModule.group.trim() || 'Otros',
        })

      if (error) throw error
      setNewModule({ key: '', label: '', description: '', group: 'Operación' })
      await loadModules()
      toast.success('Módulo agregado al catálogo')
    } catch (err) {
      toast.error('No se pudo agregar el módulo: ' + err.message)
    } finally {
      setCreatingModule(false)
    }
  }

  const selectUser = async (user) => {
    setSelectedUser(user)
    await loadOverrides(user)
  }

  const isAllowed = (moduleKey) => {
    if (!selectedUser) return false
    if (Object.prototype.hasOwnProperty.call(overrides, moduleKey)) return overrides[moduleKey]
    return getDefaultModuleAccess(selectedUser, moduleKey)
  }

  // ── Guardar permiso ─────────────────────────────────────────
  const savePermission = async (moduleKey) => {
    if (!selectedUser?.cliente_id) return

    const allowed = !isAllowed(moduleKey)
    setSavingModule(moduleKey)
    try {
      const { error } = await supabase
        .from('user_module_permissions')
        .upsert(
          { user_id: selectedUser.id, cliente_id: selectedUser.cliente_id, module_key: moduleKey, allowed },
          { onConflict: 'user_id,module_key' }
        )

      if (error) throw error
      setOverrides((prev) => ({ ...prev, [moduleKey]: allowed }))
      toast.success(`${allowed ? 'Acceso habilitado' : 'Acceso bloqueado'} para ${selectedUser.nombre || 'el usuario'}`)
    } catch (err) {
      toast.error('No se pudo guardar el permiso: ' + err.message)
    } finally {
      setSavingModule(null)
    }
  }

  // ── Restaurar permiso al default del rol ────────────────────
  const resetPermission = async (moduleKey) => {
    if (!selectedUser || !Object.prototype.hasOwnProperty.call(overrides, moduleKey)) return

    setSavingModule(moduleKey)
    try {
      const { error } = await supabase
        .from('user_module_permissions')
        .delete()
        .eq('user_id', selectedUser.id)
        .eq('module_key', moduleKey)

      if (error) throw error
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[moduleKey]
        return next
      })
      toast.success('Se restauró el acceso predeterminado del rol')
    } catch (err) {
      toast.error('No se pudo restaurar el permiso: ' + err.message)
    } finally {
      setSavingModule(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Banner informativo */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-blue-600" />
          <div>
            <p className="font-bold">Permisos por módulo — excepciones individuales</p>
            <p className="mt-1 text-xs leading-5 text-blue-800 dark:text-blue-200">
              Los cambios son excepciones al rol del usuario.{' '}
              {!isCentral && 'Solo puedes asignar módulos que tu empresa tenga habilitados. '}
              Si restauras un módulo, vuelve a aplicar el acceso predeterminado de su rol.
            </p>
          </div>
        </div>
      </div>

      {/* Selector de empresa — solo en modo Central */}
      {isCentral && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold">Empresa</h2>
          </div>
          <select
            value={selectedTenantId || ''}
            onChange={(e) => {
              setSelectedTenantId(e.target.value || null)
              setSelectedUser(null)
              setUsers([])
              setOverrides({})
            }}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Selecciona una empresa…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre_empresa}</option>
            ))}
          </select>
        </div>
      )}

      {/* Formulario para crear módulo nuevo — solo en Central */}
      {isCentral && (
        <form onSubmit={createModule} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold">Registrar módulo nuevo al catálogo</h2>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1.3fr_1.5fr_1fr_auto]">
            <input
              value={newModule.key}
              onChange={(e) => setNewModule((p) => ({ ...p, key: e.target.value }))}
              placeholder="clave: vacaciones"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              value={newModule.label}
              onChange={(e) => setNewModule((p) => ({ ...p, label: e.target.value }))}
              placeholder="Nombre visible"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              value={newModule.description}
              onChange={(e) => setNewModule((p) => ({ ...p, description: e.target.value }))}
              placeholder="Descripción"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              value={newModule.group}
              onChange={(e) => setNewModule((p) => ({ ...p, group: e.target.value }))}
              placeholder="Categoría"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              disabled={creatingModule}
              className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Después usa la misma clave al proteger la ruta y el menú del módulo nuevo.
            Recuerda habilitarlo para las empresas desde la sección &quot;Módulos por empresa&quot;.
          </p>
        </form>
      )}

      {/* Advertencia si el tenant no tiene módulos habilitados */}
      {!isCentral && modules.length === 0 && !loading && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          Tu empresa no tiene módulos habilitados. Contacta a Signum Clock Central para activarlos.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(250px,0.8fr)_minmax(0,2fr)]">
        {/* Panel: lista de usuarios */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-bold">Usuarios</h2>
            </div>
            <button
              onClick={loadUsers}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
              title="Actualizar"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="max-h-[520px] overflow-y-auto p-2">
            {isCentral && !selectedTenantId ? (
              <p className="p-4 text-center text-xs text-slate-500">Selecciona una empresa para ver sus usuarios.</p>
            ) : loading ? (
              <p className="p-4 text-center text-xs text-slate-500">Cargando usuarios...</p>
            ) : users.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">No hay usuarios activos para configurar.</p>
            ) : users.map((user) => (
              <button
                key={user.id}
                onClick={() => selectUser(user)}
                className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition-colors ${
                  selectedUser?.id === user.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <p className="truncate text-sm font-bold">{user.nombre || 'Sin nombre'}</p>
                <p className={`mt-0.5 truncate text-[11px] uppercase tracking-wide ${
                  selectedUser?.id === user.id ? 'text-blue-100' : 'text-slate-500'
                }`}>
                  {user.rol}
                  {isCentral && user.clientes?.nombre_empresa ? ` · ${user.clientes.nombre_empresa}` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Panel: módulos del usuario seleccionado */}
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {!selectedUser ? (
            <div className="flex min-h-80 items-center justify-center p-8 text-center text-sm text-slate-500">
              Selecciona un usuario para configurar sus accesos.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-blue-600" />
                  <h2 className="font-bold">Módulos de {selectedUser.nombre || 'usuario'}</h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Rol actual: <span className="font-semibold uppercase">{selectedUser.rol}</span>
                  {!isCentral && modules.length > 0 && (
                    <span className="ml-2 text-amber-600">· mostrando solo módulos habilitados para tu empresa</span>
                  )}
                </p>
              </div>

              {modules.length === 0 ? (
                <div className="flex min-h-60 items-center justify-center p-8 text-center text-sm text-slate-500">
                  No hay módulos disponibles para asignar.
                </div>
              ) : (
                <div className="space-y-5 p-5">
                  {Object.entries(moduleGroups).map(([group, groupModules]) => (
                    <div key={group}>
                      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">{group}</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {groupModules.map((module) => {
                          const allowed    = isAllowed(module.key)
                          const isOverride = Object.prototype.hasOwnProperty.call(overrides, module.key)
                          const isSaving   = savingModule === module.key

                          return (
                            <div
                              key={module.key}
                              className={`rounded-xl border p-3 transition-colors ${
                                allowed
                                  ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/30'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <button
                                  disabled={isSaving}
                                  onClick={() => savePermission(module.key)}
                                  className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-50"
                                >
                                  <span className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border ${
                                    allowed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-400 bg-white dark:bg-slate-900'
                                  }`}>
                                    {allowed && <Check className="h-3 w-3" />}
                                  </span>
                                  <span>
                                    <span className="block text-xs font-bold">{module.label}</span>
                                    <span className="mt-1 block text-[11px] leading-4 text-slate-500">{module.description}</span>
                                  </span>
                                </button>

                                {isOverride && (
                                  <button
                                    disabled={isSaving}
                                    onClick={() => resetPermission(module.key)}
                                    className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-blue-600 dark:hover:bg-slate-800"
                                    title="Restaurar permiso del rol"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              {isOverride && (
                                <p className="mt-2 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                                  Excepción asignada manualmente
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
