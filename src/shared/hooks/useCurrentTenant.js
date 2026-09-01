// src/shared/hooks/useCurrentTenant.js — Contexto y Abstracción de Tenant Activo (SuperAdmin Global vs Tenant Regular)
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../features/auth/hooks/useAuth'

const STORAGE_KEY = 'signum_active_tenant_id'

export function useCurrentTenant() {
  const { profile, user, status } = useAuth()

  const isSuperAdmin = useMemo(() => {
    return profile?.rol?.toLowerCase() === 'superadmin'
  }, [profile])

  const [tenants, setTenants] = useState([])
  const [loadingTenants, setLoadingTenants] = useState(isSuperAdmin)
  const [selectedTenantId, setSelectedTenantIdState] = useState(() => {
    return typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  })

  // 1. Si es SuperAdmin, cargar lista de todos los tenants disponibles
  const fetchTenants = useCallback(async () => {
    if (!isSuperAdmin) return

    try {
      setLoadingTenants(true)
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nombre_empresa, plan_suscripcion, limite_empleados, limite_dispositivos, estatus, fecha_vencimiento')
        .order('nombre_empresa', { ascending: true })

      if (error) throw error

      setTenants(data || [])

      // Auto-seleccionar el primer tenant si no hay uno guardado o no existe
      if (data && data.length > 0) {
        setSelectedTenantIdState((prev) => {
          const exists = data.some((t) => t.id === prev)
          const chosen = exists ? prev : data[0].id
          localStorage.setItem(STORAGE_KEY, chosen)
          return chosen
        })
      }
    } catch (err) {
      console.error('[useCurrentTenant] Error cargando lista de tenants:', err)
    } finally {
      setLoadingTenants(false)
    }
  }, [isSuperAdmin])

  useEffect(() => {
    if (status === 'authenticated' && isSuperAdmin) {
      fetchTenants()
    }
  }, [status, isSuperAdmin, fetchTenants])

  // Función para cambiar de tenant (solo SuperAdmin)
  const setSelectedTenantId = useCallback((id) => {
    setSelectedTenantIdState(id)
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // 2. Determinar el cliente_id efectivo
  const effectiveClienteId = useMemo(() => {
    if (isSuperAdmin) {
      return selectedTenantId || (tenants.length > 0 ? tenants[0].id : null)
    }
    return (
      profile?.cliente_id ||
      user?.app_metadata?.cliente_id ||
      user?.user_metadata?.cliente_id ||
      null
    )
  }, [isSuperAdmin, selectedTenantId, tenants, profile, user])

  // Tenant activo completo
  const activeTenant = useMemo(() => {
    if (isSuperAdmin) {
      return tenants.find((t) => t.id === effectiveClienteId) || null
    }
    return profile?.clientes || null
  }, [isSuperAdmin, tenants, effectiveClienteId, profile])

  // Un SuperAdmin NUNCA requiere asignación de cliente_id en su perfil.
  // Solo un usuario regular sin cliente_id tiene este error.
  const requiresTenantAssignment = useMemo(() => {
    if (isSuperAdmin) return false
    return !effectiveClienteId
  }, [isSuperAdmin, effectiveClienteId])

  return {
    isSuperAdmin,
    tenants,
    loadingTenants,
    currentTenantId: effectiveClienteId,
    currentTenant: activeTenant,
    setSelectedTenantId,
    requiresTenantAssignment,
    refreshTenants: fetchTenants,
  }
}
