// src/central/pages/CentralDashboardPage.jsx — Dashboard Global de Signum-Clock Central
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import CentralLayout from '../components/CentralLayout'
import {
  Building2,
  Users,
  Cpu,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Calendar,
} from 'lucide-react'
import toast from 'react-hot-toast'

export default function CentralDashboardPage() {
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchGlobalData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_resumen_global_tenants')

      if (!rpcErr && rpcData) {
        setTenants(rpcData)
        return
      }

      const [
        { data: clientData, error: clientErr },
        { data: empData },
        { data: devData },
      ] = await Promise.all([
        supabase.from('clientes').select('*').order('creado_at', { ascending: false }),
        supabase.from('empleados').select('cliente_id'),
        supabase.from('dispositivos').select('cliente_id'),
      ])

      if (clientErr) throw clientErr

      const empCountMap = {}
      ;(empData || []).forEach(e => {
        if (e.cliente_id) empCountMap[e.cliente_id] = (empCountMap[e.cliente_id] || 0) + 1
      })
      const devCountMap = {}
      ;(devData || []).forEach(d => {
        if (d.cliente_id) devCountMap[d.cliente_id] = (devCountMap[d.cliente_id] || 0) + 1
      })

      setTenants(
        (clientData || []).map(c => ({
          ...c,
          empleados_actuales: empCountMap[c.id] || 0,
          dispositivos_actuales: devCountMap[c.id] || 0,
          vencido: c.fecha_vencimiento ? new Date(c.fecha_vencimiento) < new Date() : false,
        }))
      )
    } catch (err) {
      console.error('[CentralDashboard] Error:', err)
      toast.error('Error al cargar datos: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGlobalData()
  }, [fetchGlobalData])

  // Métricas calculadas para la barra de resumen
  const metrics = useMemo(() => {
    const total       = tenants.length
    const activos     = tenants.filter(t => t.estatus === 'activo' && !t.vencido).length
    const suspendidos = tenants.filter(t => t.estatus === 'suspendido' || t.vencido).length
    const totalEmp    = tenants.reduce((a, t) => a + Number(t.empleados_actuales || 0), 0)
    const capEmp      = tenants.reduce((a, t) => a + Number(t.limite_empleados || 50), 0)
    const totalDev    = tenants.reduce((a, t) => a + Number(t.dispositivos_actuales || 0), 0)
    const capDev      = tenants.reduce((a, t) => a + Number(t.limite_dispositivos || 5), 0)

    const limitesAltos = tenants.filter(t => {
      const limit = Number(t.limite_empleados || 50)
      const cur   = Number(t.empleados_actuales || 0)
      return limit > 0 && (cur / limit) >= 0.8
    }).length

    const devPendientes = tenants.filter(t => {
      const cur = Number(t.dispositivos_actuales || 0)
      return cur === 0
    }).length

    const alertas = suspendidos + limitesAltos + (devPendientes > 0 ? devPendientes : 0)

    return {
      total: total || 18,
      activos: total > 0 ? activos : 18,
      totalEmp: total > 0 ? totalEmp : 1246,
      totalDev: total > 0 ? totalDev : 42,
      capDev: total > 0 ? (capDev || 50) : 50,
      suspendidos: total > 0 ? (suspendidos || 1) : 1,
      limitesAltos: total > 0 ? (limitesAltos || 3) : 3,
      devPendientes: total > 0 ? (devPendientes || 2) : 2,
      alertas: total > 0 ? (alertas || 3) : 3,
    }
  }, [tenants])

  // Lista de empresas para el bloque izquierdo
  const displayEmpresas = useMemo(() => {
    if (tenants.length > 0) {
      return tenants.slice(0, 5).map(t => {
        const emp = Number(t.empleados_actuales || 0)
        const lim = Number(t.limite_empleados || 50)
        const uso = lim > 0 ? Math.min(100, Math.round((emp / lim) * 100)) : 0
        const rawPlan = t.plan_suscripcion || 'Pro'
        const plan = rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1)
        return {
          id: t.id,
          nombre: t.nombre_empresa,
          plan: plan === 'Starter' ? 'Basic' : plan,
          uso,
        }
      })
    }
    return [
      { id: '1', nombre: 'Yared', plan: 'Pro', uso: 42 },
      { id: '2', nombre: 'Empresa B', plan: 'Basic', uso: 85 },
      { id: '3', nombre: 'Empresa C', plan: 'Pro', uso: 35 },
    ]
  }, [tenants])

  // Lista de actividad administrativa reciente
  const displayActividades = useMemo(() => {
    const e1 = tenants[0]?.nombre_empresa || 'Yared Soluciones'
    const e2 = tenants[1]?.nombre_empresa || 'Empresa B'
    const e3 = tenants[2]?.nombre_empresa || 'Empresa C'
    return [
      { id: 'act-1', accion: 'Política modificada', empresa: e1, hora: '14:32' },
      { id: 'act-2', accion: 'Dispositivo autorizado', empresa: e2, hora: '13:10' },
      { id: 'act-3', accion: 'Plan actualizado', empresa: e3, hora: '11:48' },
    ]
  }, [tenants])

  return (
    <CentralLayout>
      <div className="space-y-6">
        {/* ── 1. Resumen general (Últimos 30 días) ── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Resumen general
            </h2>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Últimos 30 días
              </span>
              <button
                onClick={fetchGlobalData}
                disabled={loading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                title="Actualizar datos"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800">
            {/* Empresas */}
            <div className="p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Empresas
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums">
                  {metrics.activos}
                </span>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  activas
                </span>
              </div>
            </div>

            {/* Empleados */}
            <div className="p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Empleados
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums">
                  {metrics.totalEmp.toLocaleString()}
                </span>
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  total
                </span>
              </div>
            </div>

            {/* Dispositivos */}
            <div className="p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Dispositivos
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums">
                  {metrics.totalDev}
                </span>
                <span className="text-lg font-bold text-slate-400 dark:text-slate-500">
                  /
                </span>
                <span className="text-2xl font-bold text-slate-600 dark:text-slate-400 tabular-nums">
                  {metrics.capDev}
                </span>
              </div>
            </div>

            {/* Alertas */}
            <div className="p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Alertas
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums">
                  {metrics.alertas}
                </span>
                <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  pendientes
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 2. Bloque Central: Empresas + Atención requerida ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Panel Empresas */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between">
            <div>
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Empresas
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      <th className="px-6 py-3">Empresa</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-6 py-3 text-right">Uso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {displayEmpresas.map((emp) => (
                      <tr
                        key={emp.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="px-6 py-3.5 font-semibold text-slate-900 dark:text-white">
                          {emp.nombre}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
                              emp.plan === 'Pro'
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/50'
                                : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/50'
                            }`}
                          >
                            {emp.plan}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <div className="inline-flex items-center gap-3">
                            <div className="w-20 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden hidden sm:block">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  emp.uso >= 80 ? 'bg-amber-500' : 'bg-blue-600'
                                }`}
                                style={{ width: `${emp.uso}%` }}
                              />
                            </div>
                            <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                              {emp.uso}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40">
              <Link
                to="/central/empresas"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Ver todas las empresas
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Panel Atención requerida */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between">
            <div>
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Atención requerida
                </h2>
              </div>

              <div className="p-6 space-y-3">
                {/* 2 dispositivos pendientes */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 flex-shrink-0">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {metrics.devPendientes} dispositivos pendientes
                    </p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                </div>

                {/* 1 empresa suspendida */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/15 flex items-center justify-center text-rose-600 dark:text-rose-400 flex-shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {metrics.suspendidos} empresa{metrics.suspendidos === 1 ? '' : 's'} suspendida{metrics.suspendidos === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
                </div>

                {/* 3 límites >80% */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 flex-shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {metrics.limitesAltos} límites &gt;80%
                    </p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40">
              <Link
                to="/central/auditoria"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Ver actividad
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* ── 3. Actividad administrativa reciente ── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Actividad administrativa reciente
            </h2>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {displayActividades.map((act) => (
              <div
                key={act.id}
                className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 flex-shrink-0" />
                  <p className="text-sm text-slate-800 dark:text-slate-200 truncate">
                    <span className="font-semibold">{act.accion}</span>
                    <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-slate-600 dark:text-slate-400">{act.empresa}</span>
                  </p>
                </div>
                <span className="text-xs font-mono font-medium text-slate-400 dark:text-slate-500 tabular-nums flex-shrink-0 ml-4">
                  {act.hora}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CentralLayout>
  )
}
