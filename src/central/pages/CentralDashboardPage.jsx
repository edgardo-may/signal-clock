// src/central/pages/CentralDashboardPage.jsx — Dashboard Master de Signum-Clock Central
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import CentralLayout from '../components/CentralLayout'
import {
  Building2,
  Users,
  Cpu,
  CreditCard,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  HardDrive,
  Layers,
  Sparkles,
  Search,
} from 'lucide-react'
import toast from 'react-hot-toast'

export default function CentralDashboardPage() {
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchGlobalData = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Intentar RPC optimizado fn_resumen_global_tenants
      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_resumen_global_tenants')

      if (!rpcErr && rpcData) {
        setTenants(rpcData)
        setLoading(false)
        return
      }

      // 2. Fallback: Consulta agregada directa
      const [
        { data: clientData, error: clientErr },
        { data: empData, error: empErr },
        { data: devData, error: devErr }
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

      const consolidated = (clientData || []).map(c => ({
        ...c,
        empleados_actuales: empCountMap[c.id] || 0,
        dispositivos_actuales: devCountMap[c.id] || 0,
        vencido: c.fecha_vencimiento ? new Date(c.fecha_vencimiento) < new Date() : false,
      }))

      setTenants(consolidated)
    } catch (err) {
      console.error('[CentralDashboard] Error:', err)
      toast.error('Error al cargar datos globales: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGlobalData()
  }, [fetchGlobalData])

  // KPIs Globales Consolidados
  const metrics = useMemo(() => {
    const totalTenants = tenants.length
    const activos = tenants.filter(t => t.estatus === 'activo' && !t.vencido).length
    const suspendidos = tenants.filter(t => t.estatus === 'suspendido' || t.vencido).length
    
    const totalEmpleados = tenants.reduce((acc, t) => acc + Number(t.empleados_actuales || 0), 0)
    const capEmpleados = tenants.reduce((acc, t) => acc + Number(t.limite_empleados || 50), 0)
    
    const totalDispositivos = tenants.reduce((acc, t) => acc + Number(t.dispositivos_actuales || 0), 0)
    const capDispositivos = tenants.reduce((acc, t) => acc + Number(t.limite_dispositivos || 5), 0)

    const porcVencenPronto = tenants.filter(t => {
      if (!t.fecha_vencimiento) return false
      const diff = (new Date(t.fecha_vencimiento) - new Date()) / (1000 * 60 * 60 * 24)
      return diff >= 0 && diff <= 15
    }).length

    return {
      totalTenants,
      activos,
      suspendidos,
      totalEmpleados,
      capEmpleados,
      totalDispositivos,
      capDispositivos,
      porcVencenPronto,
    }
  }, [tenants])

  const filteredTenants = useMemo(() => {
    const q = search.toLowerCase()
    return tenants.filter(t => 
      !q ||
      t.nombre_empresa?.toLowerCase().includes(q) ||
      t.rfc?.toLowerCase().includes(q) ||
      t.plan_suscripcion?.toLowerCase().includes(q)
    )
  }, [tenants, search])

  return (
    <CentralLayout>
      {/* Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              Signum-Clock Central
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">| Control Global de Operaciones</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
            Dashboard Central SaaS
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Supervisión consolidada de clientes, capacidades, consumo de colaboradores y terminales biométricas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchGlobalData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar Datos</span>
          </button>

          <Link
            to="/central/empresas"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md shadow-blue-600/30"
          >
            <Building2 className="w-4 h-4" />
            <span>Administrar Empresas</span>
          </Link>
        </div>
      </div>

      {/* Grid de KPIs Globales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Empresas */}
        <div className="rounded-xl p-4 sm:p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-semibold text-slate-650 dark:text-slate-400">Total Empresas</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <h4 className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white">{metrics.totalTenants}</h4>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {metrics.activos} activas
              </span>
              {metrics.suspendidos > 0 && (
                <span className="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> {metrics.suspendidos} suspendidas
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Consumo Global de Colaboradores */}
        <div className="rounded-xl p-4 sm:p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-semibold text-slate-650 dark:text-slate-400">Colaboradores Globales</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <h4 className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white">{metrics.totalEmpleados}</h4>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">/ {metrics.capEmpleados} cap.</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-blue-600 h-full rounded-full transition-all duration-500" 
                style={{ width: `${metrics.capEmpleados > 0 ? (metrics.totalEmpleados / metrics.capEmpleados) * 100 : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Consumo real en Supabase across all tenants
            </p>
          </div>
        </div>

        {/* Terminales ISUP Biométricas */}
        <div className="rounded-xl p-4 sm:p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-semibold text-slate-650 dark:text-slate-400">Terminales ISUP 5.0</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <h4 className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white">{metrics.totalDispositivos}</h4>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">/ {metrics.capDispositivos} cap.</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${metrics.capDispositivos > 0 ? (metrics.totalDispositivos / metrics.capDispositivos) * 100 : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Terminales Hikvision vinculadas
            </p>
          </div>
        </div>

        {/* Estado de Suscripciones */}
        <div className="rounded-xl p-4 sm:p-5 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-semibold text-slate-650 dark:text-slate-400">Suscripciones</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <h4 className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white">{metrics.activos}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {metrics.porcVencenPronto > 0 ? (
                <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {metrics.porcVencenPronto} vencen pronto
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Todas al día</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Tabla Resumen de Empresas y Consumo */}
      <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Consumo y Capacidad por Empresa
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Estado de sincronización y límites reales aplicados a cada cliente
            </p>
          </div>

          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa, RFC o plan..."
              className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <tr>
                <th className="px-5 py-3.5">Empresa</th>
                <th className="px-5 py-3.5">Plan Contratado</th>
                <th className="px-5 py-3.5">Consumo Colaboradores</th>
                <th className="px-5 py-3.5">Terminales ISUP</th>
                <th className="px-5 py-3.5">Estatus</th>
                <th className="px-5 py-3.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-455">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando información de empresas...
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-455">
                    No se encontraron empresas registradas.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => {
                  const empCurrent = Number(t.empleados_actuales || 0)
                  const empLimit = Number(t.limite_empleados || 50)
                  const empPct = empLimit > 0 ? Math.min(100, Math.round((empCurrent / empLimit) * 100)) : 0

                  const devCurrent = Number(t.dispositivos_actuales || 0)
                  const devLimit = Number(t.limite_dispositivos || 5)

                  return (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Empresa */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm">
                            {t.nombre_empresa?.[0]?.toUpperCase() || 'E'}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white text-sm">{t.nombre_empresa}</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{t.id}</p>
                          </div>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-5 py-4">
                        <span className="px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {t.plan_suscripcion || 'starter'}
                        </span>
                      </td>

                      {/* Consumo Colaboradores */}
                      <td className="px-5 py-4">
                        <div className="space-y-1 max-w-[160px]">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">{empCurrent} / {empLimit}</span>
                            <span className="text-slate-500 dark:text-slate-400 font-semibold">{empPct}%</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                empPct >= 100 ? 'bg-rose-500' : empPct >= 80 ? 'bg-amber-500' : 'bg-blue-500'
                              }`}
                              style={{ width: `${empPct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Terminales */}
                      <td className="px-5 py-4 font-mono font-semibold text-slate-705 dark:text-slate-200">
                        {devCurrent} / {devLimit}
                      </td>

                      {/* Estatus */}
                      <td className="px-5 py-4">
                        {t.vencido ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            Vencida
                          </span>
                        ) : t.estatus === 'activo' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Activo
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            {t.estatus || 'Suspendido'}
                          </span>
                        )}
                      </td>

                      {/* Acción */}
                      <td className="px-5 py-4 text-right">
                        <Link
                          to="/central/empresas"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-white hover:bg-blue-600 transition-colors"
                        >
                          <span>Administrar</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </CentralLayout>
  )
}
