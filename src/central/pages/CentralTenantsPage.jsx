// src/central/pages/CentralTenantsPage.jsx — Módulo Master de Empresas y Tenants
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import CentralLayout from '../components/CentralLayout'
import { useConfirm } from '../../shared/hooks/useConfirm'
import {
  Building2, Plus, Search, Filter, RefreshCw,
  Edit3, Trash2, X, Save, Eye, CheckCircle2,
  XCircle, AlertTriangle, ShieldCheck, Users,
  Cpu, CreditCard, Mail, Phone, MapPin,
  Calendar, Copy, Check, Sparkles, ArrowRight,
  TrendingUp, Shield, Layers, HardDrive, Hash,
} from 'lucide-react'
import toast from 'react-hot-toast'

const PLANES_CONFIG = {
  free: {
    label: 'Free',
    color: 'slate',
    badge: 'bg-slate-500/10 text-slate-650 dark:text-slate-400 border-slate-500/20',
    limiteEmp: 15,
    limiteDev: 1,
  },
  starter: {
    label: 'Starter',
    color: 'blue',
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    limiteEmp: 50,
    limiteDev: 5,
  },
  pro: {
    label: 'Professional',
    color: 'indigo',
    badge: 'bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 border-indigo-500/20',
    limiteEmp: 200,
    limiteDev: 15,
  },
  enterprise: {
    label: 'Enterprise',
    color: 'purple',
    badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    limiteEmp: 1000,
    limiteDev: 50,
  },
  custom: {
    label: 'Personalizado',
    color: 'amber',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    limiteEmp: 500,
    limiteDev: 20,
  },
}

const EMPTY_EMPRESA = {
  nombre_empresa: '',
  id_empresa: '',
  rfc: '',
  plan_suscripcion: 'starter',
  estatus: 'activo',
  limite_empleados: 50,
  limite_dispositivos: 5,
  fecha_vencimiento: '',
  contacto_nombre: '',
  contacto_email: '',
  contacto_telefono: '',
  ciudad: '',
  estado: '',
  pais: 'México',
  direccion: '',
  notas: '',
}

export default function CentralTenantsPage() {
  const [empresas, setEmpresas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEstatus, setFilterEstatus] = useState('todos')
  const [filterPlan, setFilterPlan] = useState('todos')

  const [modalForm, setModalForm] = useState(null)
  const [modalDetalle, setModalDetalle] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const fetchEmpresas = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Intentar RPC optimizado fn_resumen_global_tenants
      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_resumen_global_tenants')

      if (!rpcErr && rpcData) {
        setEmpresas(rpcData)
        setLoading(false)
        return
      }

      // 2. Fallback agregación directa
      const [
        { data: clientData, error: clientErr },
        { data: empData },
        { data: devData }
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

      setEmpresas(consolidated)
    } catch (err) {
      console.error('[CentralTenantsPage] Error:', err)
      toast.error('Error al cargar empresas: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEmpresas()
  }, [fetchEmpresas])

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('UUID copiado al portapapeles')
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Filtrado reactivo
  const filteredEmpresas = useMemo(() => {
    return empresas.filter(e => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        e.nombre_empresa?.toLowerCase().includes(q) ||
        e.rfc?.toLowerCase().includes(q) ||
        e.contacto_email?.toLowerCase().includes(q) ||
        e.id?.toLowerCase().includes(q)

      const matchEstatus =
        filterEstatus === 'todos' ||
        (filterEstatus === 'vencido' && e.vencido) ||
        (filterEstatus === 'activo' && e.estatus === 'activo' && !e.vencido) ||
        (filterEstatus === 'suspendido' && e.estatus === 'suspendido')

      const matchPlan =
        filterPlan === 'todos' || e.plan_suscripcion === filterPlan

      return matchSearch && matchEstatus && matchPlan
    })
  }, [empresas, search, filterEstatus, filterPlan])

  // Suspender / Reactivar Empresa
  const handleToggleEstatus = async (empresa) => {
    const nuevoEstatus = empresa.estatus === 'activo' ? 'suspendido' : 'activo'
    const accion = nuevoEstatus === 'activo' ? 'reactivar' : 'suspender'

    const ok = await confirmDialog({
      title: `${accion.charAt(0).toUpperCase() + accion.slice(1)} Empresa`,
      message: `¿Estás seguro de ${accion} a ${empresa.nombre_empresa}? ${
        nuevoEstatus === 'suspendido'
          ? 'Los colaboradores no podrán registrar asistencias ni iniciar sesión.'
          : 'Se restaurará el acceso operativo inmediatamente.'
      }`,
      variant: nuevoEstatus === 'suspendido' ? 'danger' : 'info',
      confirmLabel: `Sí, ${accion}`,
    })
    if (!ok) return

    try {
      const { error } = await supabase
        .from('clientes')
        .update({ estatus: nuevoEstatus })
        .eq('id', empresa.id)

      if (error) throw error

      toast.success(`Empresa ${empresa.nombre_empresa} ${nuevoEstatus === 'activo' ? 'reactivada' : 'suspendida'}`)
      fetchEmpresas()
    } catch (err) {
      toast.error('Error al cambiar estatus: ' + err.message)
    }
  }

  // Eliminar Empresa
  const handleDeleteEmpresa = async (empresa) => {
    const ok = await confirmDialog({
      title: 'Eliminar Empresa',
      message: `¿Estás seguro de eliminar permanentemente a "${empresa.nombre_empresa}"? Esta acción eliminará los colaboradores, dispositivos y marcajes vinculados.`,
      variant: 'danger',
      confirmLabel: 'Sí, eliminar empresa',
    })
    if (!ok) return

    try {
      const { error } = await supabase
        .from('clientes')
        .delete()
        .eq('id', empresa.id)

      if (error) throw error

      toast.success(`Empresa ${empresa.nombre_empresa} eliminada`)
      fetchEmpresas()
    } catch (err) {
      toast.error('No se pudo eliminar la empresa: ' + err.message)
    }
  }

  return (
    <CentralLayout>
      {ConfirmDialogNode}

      {/* Header y Acciones */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Empresas
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              {empresas.length} Clientes
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-555 dark:text-slate-400 mt-1">
            Administración central de cuentas SaaS, planes de suscripción y límites de capacidad
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchEmpresas}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refrescar</span>
          </button>

          <button
            onClick={() => setModalForm('nuevo')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-md shadow-blue-600/30 cursor-pointer active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Crear Empresa</span>
          </button>
        </div>
      </div>

      {/* Barra de Búsqueda y Filtros */}
      <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, RFC, email o UUID..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={filterEstatus}
              onChange={(e) => setFilterEstatus(e.target.value)}
              className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-350 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer transition-all"
            >
              <option value="todos">Todos los Estatus</option>
              <option value="activo">Activos</option>
              <option value="suspendido">Suspendidos</option>
              <option value="vencido">Vencidos</option>
            </select>
          </div>

          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-350 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer transition-all"
          >
            <option value="todos">Todos los Planes</option>
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Professional</option>
            <option value="enterprise">Enterprise</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
      </div>

      {/* Grid / Tabla de Empresas */}
      <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <tr>
                <th className="px-5 py-3.5">IDEmpresa</th>
                <th className="px-5 py-3.5">Empresa</th>
                <th className="px-5 py-3.5">Plan</th>
                <th className="px-5 py-3.5">Capacidad Colaboradores</th>
                <th className="px-5 py-3.5">Capacidad Terminales</th>
                <th className="px-5 py-3.5">Vencimiento</th>
                <th className="px-5 py-3.5">Estatus</th>
                <th className="px-5 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando padrón de empresas...
                  </td>
                </tr>
              ) : filteredEmpresas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                    No se encontraron empresas con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredEmpresas.map((e) => {
                  const empCurrent = Number(e.empleados_actuales || 0)
                  const empLimit = Number(e.limite_empleados || 50)
                  const empPct = empLimit > 0 ? Math.min(100, Math.round((empCurrent / empLimit) * 100)) : 0

                  const devCurrent = Number(e.dispositivos_actuales || 0)
                  const devLimit = Number(e.limite_dispositivos || 5)

                  const planConf = PLANES_CONFIG[e.plan_suscripcion] || PLANES_CONFIG.starter

                  return (
                    <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
                      {/* IDEmpresa */}
                      <td className="px-5 py-4 font-mono text-sm font-bold text-slate-800 dark:text-white">
                        {e.id_empresa || <span className="text-slate-400 text-xs font-normal">Sin configurar</span>}
                      </td>

                      {/* Empresa */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-sm">
                            {e.nombre_empresa?.[0]?.toUpperCase() || 'E'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900 dark:text-white text-sm">{e.nombre_empresa}</p>
                              {e.rfc && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">({e.rfc})</span>
                              )}
                            </div>
                            <button
                              onClick={() => copyToClipboard(e.id, e.id)}
                              className="text-[10px] text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1 mt-0.5"
                              title="Copiar UUID"
                            >
                              <span className="font-mono truncate max-w-[120px]">UUID: {e.id}</span>
                              {copiedId === e.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${planConf.badge}`}>
                          {e.plan_suscripcion || 'starter'}
                        </span>
                      </td>

                      {/* Capacidad Empleados */}
                      <td className="px-5 py-4">
                        <div className="space-y-1 max-w-[150px]">
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

                      {/* Capacidad Dispositivos */}
                      <td className="px-5 py-4 font-mono font-semibold text-slate-705 dark:text-slate-200">
                        {devCurrent} / {devLimit}
                      </td>

                      {/* Vencimiento */}
                      <td className="px-5 py-4">
                        {e.fecha_vencimiento ? (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-550" />
                            <span>{e.fecha_vencimiento}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-[11px]">Indefinido</span>
                        )}
                      </td>

                      {/* Estatus */}
                      <td className="px-5 py-4">
                        {e.vencido ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            Vencida
                          </span>
                        ) : e.estatus === 'activo' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Activo
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            {e.estatus || 'Suspendido'}
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setModalDetalle(e)}
                            className="p-1.5 rounded-lg text-slate-450 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Ver detalles completos"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setModalForm(e)}
                            className="p-1.5 rounded-lg text-slate-450 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-600/10 transition-colors"
                            title="Editar empresa y límites"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleToggleEstatus(e)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              e.estatus === 'activo'
                                ? 'text-amber-550 dark:text-amber-400 hover:bg-amber-500/10'
                                : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                            }`}
                            title={e.estatus === 'activo' ? 'Suspender empresa' : 'Reactivar empresa'}
                          >
                            {e.estatus === 'activo' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                          </button>

                          <button
                            onClick={() => handleDeleteEmpresa(e)}
                            className="p-1.5 rounded-lg text-slate-450 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Eliminar empresa"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Formulario Empresa (Crear / Editar) */}
      {modalForm && (
        <ModalFormEmpresa
          empresa={modalForm === 'nuevo' ? null : modalForm}
          onClose={() => setModalForm(null)}
          onSaved={() => {
            setModalForm(null)
            fetchEmpresas()
          }}
        />
      )}

      {/* Modal Detalle Empresa */}
      {modalDetalle && (
        <ModalDetalleEmpresa
          empresa={modalDetalle}
          onClose={() => setModalDetalle(null)}
        />
      )}
    </CentralLayout>
  )
}

function ModalFormEmpresa({ empresa, onClose, onSaved }) {
  const isEdit = !!empresa
  const [form, setForm] = useState(
    isEdit
      ? {
          ...EMPTY_EMPRESA,
          ...empresa,
          fecha_vencimiento: empresa.fecha_vencimiento ? String(empresa.fecha_vencimiento).split('T')[0] : '',
        }
      : { ...EMPTY_EMPRESA }
  )
  const [saving, setSaving] = useState(false)

  const handlePlanChange = (planKey) => {
    const conf = PLANES_CONFIG[planKey]
    setForm(f => ({
      ...f,
      plan_suscripcion: planKey,
      limite_empleados: conf ? conf.limiteEmp : f.limite_empleados,
      limite_dispositivos: conf ? conf.limiteDev : f.limite_dispositivos,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.nombre_empresa.trim()) {
      toast.error('El nombre de la empresa es obligatorio')
      return
    }

    setSaving(true)
    try {
      const payload = {
        nombre_empresa: form.nombre_empresa.trim(),
        id_empresa: form.id_empresa?.trim() || null,
        rfc: form.rfc?.trim() || null,
        plan_suscripcion: form.plan_suscripcion,
        estatus: form.estatus,
        limite_empleados: Number(form.limite_empleados) || 50,
        limite_dispositivos: Number(form.limite_dispositivos) || 5,
        fecha_vencimiento: form.fecha_vencimiento || null,
        contacto_nombre: form.contacto_nombre?.trim() || null,
        contacto_email: form.contacto_email?.trim() || null,
        contacto_telefono: form.contacto_telefono?.trim() || null,
        ciudad: form.ciudad?.trim() || null,
        estado: form.estado?.trim() || null,
        pais: form.pais?.trim() || 'México',
        direccion: form.direccion?.trim() || null,
        notas: form.notas?.trim() || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('clientes')
          .update(payload)
          .eq('id', empresa.id)

        if (error) throw error
        toast.success(`Empresa ${payload.nombre_empresa} actualizada`)
      } else {
        const { error } = await supabase
          .from('clientes')
          .insert(payload)

        if (error) throw error
        toast.success(`Empresa ${payload.nombre_empresa} creada exitosamente`)
      }

      onSaved()
    } catch (err) {
      toast.error('Error al guardar empresa: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isEdit ? 'Editar Empresa y Límites' : 'Crear Nueva Empresa'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Datos de la Empresa */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">
              Información de la Cuenta
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nombre de la Empresa <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.nombre_empresa}
                  onChange={(e) => setForm(f => ({ ...f, nombre_empresa: e.target.value }))}
                  placeholder="Ej. Arriva Hotels"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  IDEmpresa
                </label>
                <input
                  type="text"
                  value={form.id_empresa || ''}
                  onChange={(e) => setForm(f => ({ ...f, id_empresa: e.target.value }))}
                  placeholder="Ej. ARRIVA-01"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  RFC
                </label>
                <input
                  type="text"
                  value={form.rfc}
                  onChange={(e) => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                  placeholder="XAXX010101000"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white uppercase placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Plan y Límites Reales */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">
              Plan de Suscripción & Límites de Capacidad
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Plan Contratado
                </label>
                <select
                  value={form.plan_suscripcion}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-700 dark:text-slate-300 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all cursor-pointer"
                >
                  <option value="free">Free (15 emp / 1 dev)</option>
                  <option value="starter">Starter (50 emp / 5 dev)</option>
                  <option value="pro">Professional (200 emp / 15 dev)</option>
                  <option value="enterprise">Enterprise (1000 emp / 50 dev)</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Límite Empleados
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.limite_empleados}
                  onChange={(e) => setForm(f => ({ ...f, limite_empleados: parseInt(e.target.value, 10) || 0 }))}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white font-mono outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Límite Terminales ISUP
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.limite_dispositivos}
                  onChange={(e) => setForm(f => ({ ...f, limite_dispositivos: parseInt(e.target.value, 10) || 0 }))}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white font-mono outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Fecha de Vencimiento
                </label>
                <input
                  type="date"
                  value={form.fecha_vencimiento}
                  onChange={(e) => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Estatus de la Cuenta
                </label>
                <select
                  value={form.estatus}
                  onChange={(e) => setForm(f => ({ ...f, estatus: e.target.value }))}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-700 dark:text-slate-300 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all cursor-pointer"
                >
                  <option value="activo">Activo (Operación Habilitada)</option>
                  <option value="suspendido">Suspendido (Operación Bloqueada)</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>
            </div>
          </div>

          {/* Contacto */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">
              Datos de Contacto
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contacto</label>
                <input
                  type="text"
                  value={form.contacto_nombre}
                  onChange={(e) => setForm(f => ({ ...f, contacto_nombre: e.target.value }))}
                  placeholder="Lic. María González"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  value={form.contacto_email}
                  onChange={(e) => setForm(f => ({ ...f, contacto_email: e.target.value }))}
                  placeholder="admin@empresa.com"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Teléfono</label>
                <input
                  type="tel"
                  value={form.contacto_telefono}
                  onChange={(e) => setForm(f => ({ ...f, contacto_telefono: e.target.value }))}
                  placeholder="+52 33 1234 5678"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Ubicación */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">
              Dirección y Ubicación
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Ciudad</label>
                <input
                  type="text"
                  value={form.ciudad || ''}
                  onChange={(e) => setForm(f => ({ ...f, ciudad: e.target.value }))}
                  placeholder="Guadalajara"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Estado</label>
                <input
                  type="text"
                  value={form.estado || ''}
                  onChange={(e) => setForm(f => ({ ...f, estado: e.target.value }))}
                  placeholder="Jalisco"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">País</label>
                <input
                  type="text"
                  value={form.pais || ''}
                  onChange={(e) => setForm(f => ({ ...f, pais: e.target.value }))}
                  placeholder="México"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Dirección</label>
                <input
                  type="text"
                  value={form.direccion || ''}
                  onChange={(e) => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Av. Vallarta 1234"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">
              Notas Operativas / Comentarios
            </h4>
            <textarea
              value={form.notas || ''}
              onChange={(e) => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Detalles de facturación, condiciones especiales de soporte, etc."
              rows={3}
              className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
            />
          </div>


          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-550 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/30 cursor-pointer disabled:opacity-50 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Empresa'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalDetalleEmpresa({ empresa, onClose }) {
  const formatDate = (dateString) => {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const InfoItem = ({ icon: Icon, label, value, isMono }) => (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/60  text-slate-700 dark:text-slate-300  flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
        <p className={`text-xs sm:text-sm font-semibold text-slate-900 dark:text-white  ${isMono ? 'font-mono' : ''}`}>
          {value || '—'}
        </p>
      </div>
    </div>
  )

  const EstatusBadge = ({ estatus }) => {
    let colorClass = 'bg-slate-100 text-slate-500'
    if (estatus === 'activo') colorClass = 'bg-emerald-100 text-emerald-700'
    if (estatus === 'suspendido') colorClass = 'bg-amber-100 text-amber-700'
    if (estatus === 'cancelado') colorClass = 'bg-rose-100 text-rose-700'

    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${colorClass}`}>
        {estatus}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-[95%] sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-600/10 text-blue-650 dark:text-blue-400 flex items-center justify-center font-black text-xl">
              {empresa.nombre_empresa?.[0]?.toUpperCase() || 'E'}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">{empresa.nombre_empresa}</h3>
              <div className="flex items-center gap-2 mt-1">
                <EstatusBadge estatus={empresa.estatus} />
                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">IDEmpresa: {empresa.id_empresa || 'No configurado'}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Identificación y Plan */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-1.5">
              <Building2 className="w-4 h-4" />
              Identificación y Suscripción
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={Building2} label="Nombre de Empresa" value={empresa.nombre_empresa} />
              <InfoItem icon={CreditCard} label="Plan Contratado" value={empresa.plan_suscripcion?.toUpperCase()} />
              <InfoItem icon={Hash} label="UUID" value={empresa.id} isMono />
              <InfoItem icon={Calendar} label="Fecha de Registro" value={formatDate(empresa.creado_at)} />
            </div>
          </div>

          {/* Capacidades */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Límites y Capacidades
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={Users} label="Colaboradores (Usado / Total)" value={`${empresa.empleados_actuales || 0} / ${empresa.limite_empleados || 0}`} isMono />
              <InfoItem icon={HardDrive} label="Dispositivos (Usado / Total)" value={`${empresa.dispositivos_actuales || 0} / ${empresa.limite_dispositivos || 0}`} isMono />
            </div>
          </div>

          {/* Contacto */}
          {empresa.contacto_nombre && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Información de Contacto
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoItem icon={Users} label="Nombre de Contacto" value={empresa.contacto_nombre} />
                <InfoItem icon={Mail} label="Correo Electrónico" value={empresa.contacto_email} />
                {empresa.contacto_telefono && <InfoItem icon={Phone} label="Teléfono" value={empresa.contacto_telefono} />}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-600/25 transition-colors"
          >
            Cerrar Ficha
          </button>
        </div>
      </div>
    </div>
  )
}
