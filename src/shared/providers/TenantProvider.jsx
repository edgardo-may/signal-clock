// src/shared/providers/TenantProvider.jsx — Contexto Automático de Tenant para Signum-Clock Client
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../features/auth/hooks/useAuth'

export const TenantContext = createContext({
  clienteId: null,
  tenant: null,
  loading: true,
  limiteEmpleados: 50,
  limiteDispositivos: 5,
  empleadosActuales: 0,
  dispositivosActuales: 0,
  porcentajeEmpleados: 0,
  empleadosAlcanzado: false,
  dispositivosAlcanzado: false,
  bloqueado: false,
  vencido: false,
  refreshTenant: async () => {},
})

export function TenantProvider({ children }) {
  const { profile, user, status } = useAuth()

  const clienteId = useMemo(() => {
    return (
      profile?.cliente_id ||
      user?.app_metadata?.cliente_id ||
      user?.user_metadata?.cliente_id ||
      null
    )
  }, [profile, user])

  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)
  const [empleadosCount, setEmpleadosCount] = useState(0)
  const [dispositivosCount, setDispositivosCount] = useState(0)

  const fetchTenantData = useCallback(async () => {
    if (!clienteId) {
      setTenant(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // Consultar información de la empresa y conteos en paralelo
      const [
        { data: tenantData, error: tenantErr },
        { count: cEmpleados },
        { count: cDispositivos }
      ] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, nombre_empresa, rfc, plan_suscripcion, estatus, limite_empleados, limite_dispositivos, fecha_vencimiento, contacto_nombre, contacto_email, contacto_telefono, direccion, notas')
          .eq('id', clienteId)
          .maybeSingle(),
        supabase
          .from('empleados')
          .select('id', { count: 'exact', head: true })
          .eq('cliente_id', clienteId),
        supabase
          .from('dispositivos')
          .select('id', { count: 'exact', head: true })
          .eq('cliente_id', clienteId),
      ])

      if (tenantErr) throw tenantErr

      setTenant(tenantData || null)
      setEmpleadosCount(cEmpleados ?? 0)
      setDispositivosCount(cDispositivos ?? 0)
    } catch (err) {
      console.error('[TenantProvider] Error al cargar tenant:', err)
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => {
    if (status === 'authenticated' && clienteId) {
      fetchTenantData()
    } else if (status === 'unauthenticated') {
      setTenant(null)
      setLoading(false)
    }
  }, [status, clienteId, fetchTenantData])

  const limiteEmpleados = tenant?.limite_empleados ?? 50
  const limiteDispositivos = tenant?.limite_dispositivos ?? 5

  const porcentajeEmpleados = limiteEmpleados > 0
    ? Math.min(100, Math.round((empleadosCount / limiteEmpleados) * 100))
    : 0

  const empleadosAlcanzado = empleadosCount >= limiteEmpleados
  const dispositivosAlcanzado = dispositivosCount >= limiteDispositivos

  const isVencido = useMemo(() => {
    if (!tenant?.fecha_vencimiento) return false
    const exp = new Date(tenant.fecha_vencimiento)
    exp.setHours(23, 59, 59, 999)
    return exp < new Date()
  }, [tenant?.fecha_vencimiento])

  const isBloqueado = (tenant?.estatus && tenant.estatus !== 'activo') || isVencido

  const value = useMemo(() => ({
    clienteId,
    tenant,
    loading,
    limiteEmpleados,
    limiteDispositivos,
    empleadosActuales: empleadosCount,
    dispositivosActuales: dispositivosCount,
    empleadosDisponibles: Math.max(0, limiteEmpleados - empleadosCount),
    dispositivosDisponibles: Math.max(0, limiteDispositivos - dispositivosCount),
    porcentajeEmpleados,
    empleadosAlcanzado,
    dispositivosAlcanzado,
    bloqueado: isBloqueado,
    vencido: isVencido,
    refreshTenant: fetchTenantData,
  }), [
    clienteId,
    tenant,
    loading,
    limiteEmpleados,
    limiteDispositivos,
    empleadosCount,
    dispositivosCount,
    porcentajeEmpleados,
    empleadosAlcanzado,
    dispositivosAlcanzado,
    isBloqueado,
    isVencido,
    fetchTenantData,
  ])

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}
