// src/shared/hooks/useTenantLimits.js — Hook reactivo de capacidades y límites por Tenant
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../features/auth/hooks/useAuth'

export function useTenantLimits(customClienteId = null) {
  const { profile } = useAuth()
  const clienteId = customClienteId || profile?.cliente_id

  const isSuperAdmin = profile?.rol?.toLowerCase() === 'superadmin'

  const [loading, setLoading] = useState(true)
  const [tenantInfo, setTenantInfo] = useState({
    nombre_empresa: '',
    plan_suscripcion: 'starter',
    estatus: 'activo',
    fecha_vencimiento: null,
    limite_empleados: 50,
    limite_dispositivos: 5,
    empleados_actuales: 0,
    dispositivos_actuales: 0,
  })

  const refreshLimits = useCallback(async () => {
    if (!clienteId) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)

      // 1. Obtener datos reales del tenant desde clientes
      const [
        { data: clienteData, error: clienteError },
        { count: empleadosCount, error: empError },
        { count: dispositivosCount, error: devError },
      ] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, nombre_empresa, plan_suscripcion, limite_empleados, limite_dispositivos, estatus, fecha_vencimiento')
          .eq('id', clienteId)
          .maybeSingle(),
        supabase
          .from('empleados')
          .select('*', { count: 'exact', head: true })
          .eq('cliente_id', clienteId),
        supabase
          .from('dispositivos')
          .select('*', { count: 'exact', head: true })
          .eq('cliente_id', clienteId),
      ])

      if (clienteError) throw clienteError

      if (clienteData) {
        setTenantInfo({
          nombre_empresa: clienteData.nombre_empresa || 'Empresa',
          plan_suscripcion: clienteData.plan_suscripcion || 'starter',
          estatus: clienteData.estatus || 'activo',
          fecha_vencimiento: clienteData.fecha_vencimiento || null,
          limite_empleados: clienteData.limite_empleados || 50,
          limite_dispositivos: clienteData.limite_dispositivos || 5,
          empleados_actuales: empleadosCount ?? 0,
          dispositivos_actuales: dispositivosCount ?? 0,
        })
      }
    } catch (err) {
      console.error('[useTenantLimits] Error al cargar límites del tenant:', err)
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => {
    refreshLimits()
  }, [refreshLimits])

  // Cálculos reactivos
  const limiteEmp = tenantInfo.limite_empleados || 50
  const actualEmp = tenantInfo.empleados_actuales || 0
  const limiteDev = tenantInfo.limite_dispositivos || 5
  const actualDev = tenantInfo.dispositivos_actuales || 0

  const porcentajeEmp = Math.min(100, Math.round((actualEmp / limiteEmp) * 100))
  const porcentajeDev = Math.min(100, Math.round((actualDev / limiteDev) * 100))

  const empAlcanzado = actualEmp >= limiteEmp
  const empAlerta80  = porcentajeEmp >= 80 && !empAlcanzado

  const devAlcanzado = actualDev >= limiteDev
  const devAlerta80  = porcentajeDev >= 80 && !devAlcanzado

  const vencido = tenantInfo.fecha_vencimiento && new Date(tenantInfo.fecha_vencimiento) < new Date(new Date().setHours(0,0,0,0))
  const bloqueado = ['suspendido', 'cancelado'].includes(tenantInfo.estatus) || vencido

  // Validaciones antes de crear
  const canAddEmployee = () => {
    if (bloqueado) {
      return {
        ok: false,
        reason: vencido
          ? `La suscripción de tu empresa venció el ${tenantInfo.fecha_vencimiento}. Contacta al administrador para renovar tu servicio.`
          : `La empresa se encuentra en estatus "${tenantInfo.estatus.toUpperCase()}". Operación restringida.`,
      }
    }
    if (empAlcanzado) {
      return {
        ok: false,
        reason: `Has alcanzado el límite de colaboradores de tu plan.\n\nLímite actual: ${limiteEmp}\nEmpleados registrados: ${actualEmp}\n\nContacta al administrador de Signum-Clock Central para ampliar tu capacidad.`,
        current: actualEmp,
        limit: limiteEmp,
      }
    }
    return { ok: true, current: actualEmp, limit: limiteEmp }
  }

  const canAddDevice = () => {
    if (bloqueado) {
      return {
        ok: false,
        reason: vencido
          ? `La suscripción de tu empresa venció el ${tenantInfo.fecha_vencimiento}.`
          : `La empresa se encuentra en estatus "${tenantInfo.estatus.toUpperCase()}".`,
      }
    }
    if (devAlcanzado) {
      return {
        ok: false,
        reason: `Has alcanzado el límite de terminales biométricas de este tenant.\n\nLímite actual: ${limiteDev}\nDispositivos registrados: ${actualDev}\n\nContacta al administrador de Signum-Clock Central para ampliar tu capacidad.`,
        current: actualDev,
        limit: limiteDev,
      }
    }
    return { ok: true, current: actualDev, limit: limiteDev }
  }

  return {
    loading,
    clienteId,
    isSuperAdmin,
    tenantInfo,
    refreshLimits,
    // Empleados
    limiteEmpleados: limiteEmp,
    empleadosActuales: actualEmp,
    empleadosDisponibles: Math.max(0, limiteEmp - actualEmp),
    porcentajeEmpleados: porcentajeEmp,
    empleadosAlcanzado: empAlcanzado,
    empleadosAlerta80: empAlerta80,
    canAddEmployee,
    // Dispositivos
    limiteDispositivos: limiteDev,
    dispositivosActuales: actualDev,
    dispositivosDisponibles: Math.max(0, limiteDev - actualDev),
    porcentajeDispositivos: porcentajeDev,
    dispositivosAlcanzado: devAlcanzado,
    dispositivosAlerta80: devAlerta80,
    canAddDevice,
    // Estatus y Vencimiento
    vencido,
    bloqueado,
  }
}
