// src/features/tenants/pages/EmpresasPage.jsx — Módulo Master SuperAdmin de Empresas y Tenants
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import { useConfirm } from '../../../shared/hooks/useConfirm'
import {
  Building2, Plus, Search, Filter, RefreshCw,
  Edit3, Trash2, X, Save, Eye, CheckCircle2,
  XCircle, AlertTriangle, ShieldCheck, Users,
  Cpu, CreditCard, Mail, Phone, MapPin,
  Calendar, Copy, Check, Sparkles, ArrowRight,
  TrendingUp, Shield, Layers, HardDrive,
} from 'lucide-react'

// ─── Configuración de Planes y Estatus ─────────────────────────
const PLANES_CONFIG = {
  free: {
    label: 'Free',
    color: 'slate',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    limiteEmp: 15,
    limiteDev: 1,
  },
  starter: {
    label: 'Starter',
    color: 'blue',
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    limiteEmp: 50,
    limiteDev: 3,
  },
  pro: {
    label: 'Pro',
    color: 'indigo',
    badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    limiteEmp: 200,
    limiteDev: 10,
  },
  enterprise: {
    label: 'Enterprise',
    color: 'purple',
    badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    limiteEmp: 1000,
    limiteDev: 50,
  },
}

const ESTATUS_CONFIG = {
  activo: {
    label: 'Activo',
    cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-500',
  },
  demo: {
    label: 'Periodo Demo',
    cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    dot: 'bg-sky-500',
  },
  suspendido: {
    label: 'Suspendido',
    cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dot: 'bg-amber-500',
  },
  cancelado: {
    label: 'Cancelado',
    cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dot: 'bg-rose-500',
  },
}

function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(d)
}

function Spinner({ size = 16 }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════
// MODAL: ALTA / EDICIÓN DE EMPRESA (TENANT)
// ═══════════════════════════════════════════════════════════════
function ModalEmpresa({ empresa, onClose, onSaved }) {
  const isEdit = !!empresa
  const [form, setForm] = useState(
    isEdit
      ? {
          nombre_empresa: empresa.nombre_empresa || '',
          rfc: empresa.rfc || '',
          plan_suscripcion: empresa.plan_suscripcion || 'starter',
          estatus: empresa.estatus || 'activo',
          contacto_nombre: empresa.contacto_nombre || '',
          contacto_email: empresa.contacto_email || '',
          contacto_telefono: empresa.contacto_telefono || '',
          direccion: empresa.direccion || '',
          ciudad: empresa.ciudad || '',
          estado: empresa.estado || '',
          pais: empresa.pais || 'México',
          limite_empleados: empresa.limite_empleados || 50,
          limite_dispositivos: empresa.limite_dispositivos || 5,
          fecha_vencimiento: empresa.fecha_vencimiento ? String(empresa.fecha_vencimiento).split('T')[0] : '',
          notas: empresa.notas || '',
        }
      : {
          nombre_empresa: '',
          rfc: '',
          plan_suscripcion: 'starter',
          estatus: 'activo',
          contacto_nombre: '',
          contacto_email: '',
          contacto_telefono: '',
          direccion: '',
          ciudad: '',
          estado: '',
          pais: 'México',
          limite_empleados: 50,
          limite_dispositivos: 5,
          fecha_vencimiento: '',
          notas: '',
        }
  )

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  const setField = (field) => (e) => {
    const val = e.target.value
    setForm(f => ({ ...f, [field]: val }))
    setErrors(er => ({ ...er, [field]: undefined }))

    // Auto-ajustar límites según plan si es nuevo
    if (field === 'plan_suscripcion' && !isEdit && PLANES_CONFIG[val]) {
      setForm(f => ({
        ...f,
        plan_suscripcion: val,
        limite_empleados: PLANES_CONFIG[val].limiteEmp,
        limite_dispositivos: PLANES_CONFIG[val].limiteDev,
      }))
    }
  }

  const validate = () => {
    const errs = {}
    if (!form.nombre_empresa.trim()) errs.nombre_empresa = 'El nombre de la empresa es obligatorio'
    if (form.contacto_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contacto_email.trim())) {
      errs.contacto_email = 'Correo electrónico inválido'
    }
    if (Number(form.limite_empleados) <= 0) errs.limite_empleados = 'Debe ser mayor a 0'
    if (Number(form.limite_dispositivos) <= 0) errs.limite_dispositivos = 'Debe ser mayor a 0'
    return errs
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setSaving(true)
    try {
      const payload = {
        nombre_empresa: form.nombre_empresa.trim(),
        rfc: form.rfc ? form.rfc.trim().toUpperCase() : null,
        plan_suscripcion: form.plan_suscripcion,
        estatus: form.estatus,
        contacto_nombre: form.contacto_nombre.trim() || null,
        contacto_email: form.contacto_email.trim().toLowerCase() || null,
        contacto_telefono: form.contacto_telefono.trim() || null,
        direccion: form.direccion.trim() || null,
        ciudad: form.ciudad.trim() || null,
        estado: form.estado.trim() || null,
        pais: form.pais.trim() || 'México',
        limite_empleados: parseInt(form.limite_empleados, 10),
        limite_dispositivos: parseInt(form.limite_dispositivos, 10),
        fecha_vencimiento: form.fecha_vencimiento || null,
        notas: form.notas.trim() || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('clientes')
          .update({ ...payload, actualizado_at: new Date().toISOString() })
          .eq('id', empresa.id)

        if (error) throw error
        toast.success(`Empresa ${payload.nombre_empresa} actualizada exitosamente`)
      } else {
        const { error } = await supabase
          .from('clientes')
          .insert(payload)

        if (error) throw error
        toast.success(`Empresa ${payload.nombre_empresa} creada exitosamente`)
      }

      onSaved()
      onClose()
    } catch (err) {
      toast.error('Error al guardar empresa: ' + (err?.message || 'Error desconocido'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-[95%] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-[#1c2434] border border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-[#1c2434] z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isEdit ? 'Editar Empresa / Tenant' : 'Alta de Nueva Empresa (Tenant)'}
              </h3>
              <p className="text-xs text-slate-500">
                {isEdit ? `ID: ${empresa.id}` : 'Configuración de suscripción, límites de personal y hardware'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-6">

          {/* Sección 1: Datos Generales */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-1.5">
              <Building2 className="w-4 h-4" />
              Datos de la Empresa
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Nombre Comercial / Razón Social <span className="text-blue-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.nombre_empresa}
                  onChange={setField('nombre_empresa')}
                  placeholder="ej. InnovaTech Solutions S.A. de C.V."
                  className={`w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none ${
                    errors.nombre_empresa ? 'border-rose-500' : 'border-slate-200 dark:border-slate-700 focus:border-blue-500'
                  }`}
                  required
                />
                {errors.nombre_empresa && <p className="text-[11px] text-rose-500">{errors.nombre_empresa}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  RFC / Identificador Fiscal
                </label>
                <input
                  type="text"
                  value={form.rfc}
                  onChange={setField('rfc')}
                  placeholder="ej. ITS190520ABC"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 uppercase font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Estatus Operativo
                </label>
                <select
                  value={form.estatus}
                  onChange={setField('estatus')}
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 font-medium"
                >
                  <option value="activo">✓ Activo</option>
                  <option value="demo">⏳ Periodo Demo</option>
                  <option value="suspendido">⚠️ Suspendido</option>
                  <option value="cancelado">✗ Cancelado</option>
                </select>
              </div>
            </div>
          </div>

          {/* Sección 2: Plan y Límites SaaS */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-1.5">
              <Layers className="w-4 h-4" />
              Suscripción & Capacidad de Hardware
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Plan Contratado
                </label>
                <select
                  value={form.plan_suscripcion}
                  onChange={setField('plan_suscripcion')}
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="free">Free (Hasta 15 empleados / 1 terminal)</option>
                  <option value="starter">Starter (Hasta 50 empleados / 3 terminales)</option>
                  <option value="pro">Pro (Hasta 200 empleados / 10 terminales)</option>
                  <option value="enterprise">Enterprise (Hasta 1000 empleados / 50 terminales)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Límite Empleados
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.limite_empleados}
                  onChange={setField('limite_empleados')}
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Límite Terminales ISUP
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.limite_dispositivos}
                  onChange={setField('limite_dispositivos')}
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Fecha de Vencimiento / Próxima Facturación
                </label>
                <input
                  type="date"
                  value={form.fecha_vencimiento}
                  onChange={setField('fecha_vencimiento')}
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Sección 3: Contacto y Facturación */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-1.5">
              <Mail className="w-4 h-4" />
              Contacto Principal & Soporte
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Nombre de Contacto
                </label>
                <input
                  type="text"
                  value={form.contacto_nombre}
                  onChange={setField('contacto_nombre')}
                  placeholder="ej. Lic. Roberto Gómez"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  value={form.contacto_email}
                  onChange={setField('contacto_email')}
                  placeholder="admin@empresa.com"
                  className={`w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none ${
                    errors.contacto_email ? 'border-rose-500' : 'border-slate-200 dark:border-slate-700 focus:border-blue-500'
                  }`}
                />
                {errors.contacto_email && <p className="text-[11px] text-rose-500">{errors.contacto_email}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Teléfono / WhatsApp
                </label>
                <input
                  type="tel"
                  value={form.contacto_telefono}
                  onChange={setField('contacto_telefono')}
                  placeholder="ej. +52 55 1234 5678"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Sección 4: Ubicación y Notas */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-1.5">
              <MapPin className="w-4 h-4" />
              Ubicación & Notas Administrativas
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Ciudad
                </label>
                <input
                  type="text"
                  value={form.ciudad}
                  onChange={setField('ciudad')}
                  placeholder="ej. Monterrey"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Estado / Región
                </label>
                <input
                  type="text"
                  value={form.estado}
                  onChange={setField('estado')}
                  placeholder="ej. Nuevo León"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  País
                </label>
                <input
                  type="text"
                  value={form.pais}
                  onChange={setField('pais')}
                  placeholder="ej. México"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Dirección Fiscal / Sede Central
                </label>
                <input
                  type="text"
                  value={form.direccion}
                  onChange={setField('direccion')}
                  placeholder="ej. Av. Constitución 2000, Col. Obispado"
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Notas Internas del SuperAdmin
                </label>
                <textarea
                  rows={2}
                  value={form.notas}
                  onChange={setField('notas')}
                  placeholder="Detalles sobre contratación, requerimientos de hardware ISUP o integraciones..."
                  className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#24303f] text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>
          </div>

          {/* Footer de Acciones */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/30 transition-all active:scale-98 disabled:opacity-50"
            >
              {saving ? <><Spinner size={14} /> Guardando...</> : <><Save className="w-4 h-4" /> {isEdit ? 'Actualizar Empresa' : 'Registrar Empresa'}</>}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MODAL: FICHA DETALLADA DE LA EMPRESA
// ═══════════════════════════════════════════════════════════════
function ModalDetalleEmpresa({ empresa, onClose, onEdit }) {
  const [copied, setCopied] = useState(false)

  const copyTenantId = () => {
    navigator.clipboard.writeText(empresa.id)
    setCopied(true)
    toast.success('UUID de Empresa copiado al portapapeles')
    setTimeout(() => setCopied(false), 2000)
  }

  const planCfg = PLANES_CONFIG[empresa.plan_suscripcion] || PLANES_CONFIG.starter
  const estCfg = ESTATUS_CONFIG[empresa.estatus] || ESTATUS_CONFIG.activo

  const InfoItem = ({ icon: Icon, label, value, isMono }) => (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 ${isMono ? 'font-mono' : ''}`}>
          {value || '—'}
        </p>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-[95%] sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-[#1c2434] border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-[#1c2434] z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg shadow-md shadow-blue-600/30">
              {empresa.nombre_empresa.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                {empresa.nombre_empresa}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${estCfg.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${estCfg.dot}`} />
                  {estCfg.label}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${planCfg.badge}`}>
                  Plan {planCfg.label}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* UUID del Tenant */}
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">UUID del Tenant (cliente_id)</p>
              <p className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 truncate">{empresa.id}</p>
            </div>
            <button
              onClick={copyTenantId}
              className="p-2 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 hover:text-blue-600 transition-colors flex-shrink-0"
              title="Copiar ID"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* Consumo y Límites */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-center space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Límite Colaboradores</p>
              <p className="text-2xl font-bold font-mono text-slate-900 dark:text-white">{empresa.limite_empleados || 50}</p>
              <p className="text-[10px] text-slate-400">Capacidad contratada</p>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40 text-center space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Límite Terminales ISUP</p>
              <p className="text-2xl font-bold font-mono text-slate-900 dark:text-white">{empresa.limite_dispositivos || 5}</p>
              <p className="text-[10px] text-slate-400">Biométricos permitidos</p>
            </div>
          </div>

          {/* Datos Fiscales y Contacto */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">Información Corporativa</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={Building2} label="RFC Fiscal" value={empresa.rfc} isMono />
              <InfoItem icon={Calendar} label="Próxima Facturación" value={formatDate(empresa.fecha_vencimiento)} isMono />
              <InfoItem icon={Users} label="Contacto Principal" value={empresa.contacto_nombre} />
              <InfoItem icon={Mail} label="Correo Electrónico" value={empresa.contacto_email} />
              <InfoItem icon={Phone} label="Teléfono" value={empresa.contacto_telefono} isMono />
              <InfoItem icon={MapPin} label="Ubicación" value={empresa.ciudad ? `${empresa.ciudad}, ${empresa.estado || ''} (${empresa.pais || 'México'})` : empresa.direccion} />
            </div>
          </div>

          {empresa.notas && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Notas de Soporte / Contrato</p>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{empresa.notas}</p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => { onClose(); onEdit(empresa) }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editar Empresa
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Cerrar Ficha
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: EMPRESAS (MASTER SUPERADMIN)
// ═══════════════════════════════════════════════════════════════
export default function EmpresasPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const [empresas, setEmpresas] = useState([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [search, setSearch] = useState('')
  const [filtroPlan, setFiltroPlan] = useState('todos')
  const [filtroEstatus, setFiltroEstatus] = useState('todos')

  // Modales
  const [modalEmpresa, setModalEmpresa] = useState(null)
  const [modalDetalle, setModalDetalle] = useState(null)

  const { confirm, ConfirmDialogNode } = useConfirm()

  // Cargar lista global de empresas / tenants con conteos reales en vivo
  const fetchEmpresas = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Intentar obtener datos agregados vía RPC de SuperAdmin
      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_resumen_global_tenants')

      if (!rpcErr && rpcData && Array.isArray(rpcData)) {
        const formatted = rpcData.map(c => {
          const empActual = Number(c.empleados_actuales) || 0
          const devActual = Number(c.dispositivos_actuales) || 0
          const empLimit  = Number(c.limite_empleados) || 50
          const devLimit  = Number(c.limite_dispositivos) || 5

          return {
            ...c,
            empleados_actuales: empActual,
            dispositivos_actuales: devActual,
            porcentaje_empleados: Math.min(100, Math.round((empActual / empLimit) * 100)),
            porcentaje_dispositivos: Math.min(100, Math.round((devActual / devLimit) * 100)),
            vencido: !!c.vencido,
          }
        })
        setEmpresas(formatted)
        return
      }

      // 2. Fallback: Consulta directa con RLS de SuperAdmin
      const [
        { data: clientesData, error: clientErr },
        { data: empData, error: empErr },
        { data: devData, error: devErr },
      ] = await Promise.all([
        supabase.from('clientes').select('*').order('creado_at', { ascending: false }),
        supabase.from('empleados').select('cliente_id'),
        supabase.from('dispositivos').select('cliente_id'),
      ])

      if (clientErr) throw clientErr

      // Mapear conteos por cliente_id
      const empCountMap = {}
      ;(empData || []).forEach(e => {
        if (e.cliente_id) empCountMap[e.cliente_id] = (empCountMap[e.cliente_id] || 0) + 1
      })

      const devCountMap = {}
      ;(devData || []).forEach(d => {
        if (d.cliente_id) devCountMap[d.cliente_id] = (devCountMap[d.cliente_id] || 0) + 1
      })

      const now = new Date().setHours(0, 0, 0, 0)

      const formatted = (clientesData || []).map(c => {
        const empActual = empCountMap[c.id] || 0
        const devActual = devCountMap[c.id] || 0
        const empLimit  = Number(c.limite_empleados) || 50
        const devLimit  = Number(c.limite_dispositivos) || 5
        const isVencido = c.fecha_vencimiento && new Date(c.fecha_vencimiento) < now

        return {
          ...c,
          empleados_actuales: empActual,
          dispositivos_actuales: devActual,
          porcentaje_empleados: Math.min(100, Math.round((empActual / empLimit) * 100)),
          porcentaje_dispositivos: Math.min(100, Math.round((devActual / devLimit) * 100)),
          vencido: isVencido,
        }
      })

      setEmpresas(formatted)
    } catch (err) {
      toast.error('Error al cargar empresas: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEmpresas() }, [fetchEmpresas])

  // Eliminar empresa con confirmación
  const handleDelete = async (empresa) => {
    const ok = await confirm({
      title: '¿Eliminar Empresa / Tenant?',
      message: `Estás a punto de eliminar definitivamente la empresa "${empresa.nombre_empresa}". Esto eliminará en cascada todos sus empleados, checadas y dispositivos vinculados. Esta acción no se puede deshacer.`,
      confirmText: 'Sí, Eliminar Empresa',
      danger: true,
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
      toast.error('Error al eliminar: ' + err.message)
    }
  }

  // Filtrado reactivo
  const filtered = useMemo(() => {
    return empresas.filter(emp => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        emp.nombre_empresa?.toLowerCase().includes(q) ||
        emp.rfc?.toLowerCase().includes(q) ||
        emp.contacto_nombre?.toLowerCase().includes(q) ||
        emp.contacto_email?.toLowerCase().includes(q) ||
        emp.ciudad?.toLowerCase().includes(q)

      const matchPlan = filtroPlan === 'todos' || emp.plan_suscripcion === filtroPlan
      const matchEstatus = filtroEstatus === 'todos' || emp.estatus === filtroEstatus

      return matchSearch && matchPlan && matchEstatus
    })
  }, [empresas, search, filtroPlan, filtroEstatus])

  // Métricas globales del SuperAdmin
  const totalEmpresas = empresas.length
  const totalActivas = empresas.filter(e => e.estatus === 'activo').length
  const totalDemos = empresas.filter(e => e.estatus === 'demo').length
  const totalEmpleadosActuales = empresas.reduce((sum, e) => sum + (Number(e.empleados_actuales) || 0), 0)
  const totalCapacidadEmp = empresas.reduce((sum, e) => sum + (Number(e.limite_empleados) || 50), 0)
  const totalDispositivosActuales = empresas.reduce((sum, e) => sum + (Number(e.dispositivos_actuales) || 0), 0)
  const totalCapacidadDev = empresas.reduce((sum, e) => sum + (Number(e.limite_dispositivos) || 5), 0)

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc] dark:bg-[#0f172a] text-slate-800 dark:text-slate-100">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">

          {/* Barra Superior Master */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  Master SuperAdmin
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mt-1">
                <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                Gestión de Empresas & Tenants
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Alta, licenciamiento y administración central de clientes multi-tenant ({totalEmpresas} clientes registrados)
              </p>
            </div>

            <button
              onClick={() => setModalEmpresa('nuevo')}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all active:scale-98 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nueva Empresa / Tenant</span>
            </button>
          </div>

          {/* Cards de Métricas Master */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Total Empresas */}
            <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Tenants Registrados</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono">{totalEmpresas}</h3>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">{totalActivas} activos / {totalDemos} demo</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                <Building2 className="w-5 h-5" />
              </div>
            </div>

            {/* 2. Empleados Globales */}
            <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Consumo Colaboradores</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">{totalEmpleadosActuales}</span>
                  <span className="text-sm font-mono text-slate-400">/ {totalCapacidadEmp}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {totalCapacidadEmp > 0 ? Math.round((totalEmpleadosActuales / totalCapacidadEmp) * 100) : 0}% capacidad global
                </p>
              </div>
              <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                <Users className="w-5 h-5" />
              </div>
            </div>

            {/* 3. Dispositivos Globales */}
            <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Terminales ISUP 5.0</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{totalDispositivosActuales}</span>
                  <span className="text-sm font-mono text-slate-400">/ {totalCapacidadDev}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {totalCapacidadDev > 0 ? Math.round((totalDispositivosActuales / totalCapacidadDev) * 100) : 0}% terminales en uso
                </p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <Cpu className="w-5 h-5" />
              </div>
            </div>

            {/* 4. Capacidad Contratada Total */}
            <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Capacidad Contratada</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono">{totalCapacidadEmp}</h3>
                <p className="text-[11px] text-purple-600 dark:text-purple-400 font-medium mt-0.5">Licencias autorizadas</p>
              </div>
              <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Barra de Filtros y Búsqueda */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e293b] p-4 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre de empresa, RFC, contacto o ciudad..."
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Filtro Plan */}
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={filtroPlan}
                  onChange={e => setFiltroPlan(e.target.value)}
                  className="py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none font-medium"
                >
                  <option value="todos">Todos los Planes</option>
                  <option value="free">Plan Free</option>
                  <option value="starter">Plan Starter</option>
                  <option value="pro">Plan Pro</option>
                  <option value="enterprise">Plan Enterprise</option>
                </select>
              </div>

              {/* Filtro Estatus */}
              <div className="flex items-center gap-1.5 text-xs">
                <select
                  value={filtroEstatus}
                  onChange={e => setFiltroEstatus(e.target.value)}
                  className="py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none font-medium"
                >
                  <option value="todos">Todos los Estatus</option>
                  <option value="activo">Activos</option>
                  <option value="demo">En Demo</option>
                  <option value="suspendido">Suspendidos</option>
                  <option value="cancelado">Cancelados</option>
                </select>
              </div>

              <button
                onClick={fetchEmpresas}
                disabled={loading}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
                title="Recargar"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Tabla de Empresas (Tenants) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e293b] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-20 gap-2 text-slate-500 text-sm">
                  <Spinner size={18} />
                  Cargando empresas registradas...
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <Building2 className="w-12 h-12 stroke-1 opacity-40" />
                  <p className="text-sm font-medium">No se encontraron empresas con los filtros aplicados.</p>
                  <button
                    onClick={() => setModalEmpresa('nuevo')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Registrar Primera Empresa
                  </button>
                </div>
              ) : (
                <table className="w-full table-auto">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-left">
                      {['Empresa / Tenant', 'RFC', 'Plan & Estatus', 'Capacidad / Límites', 'Contacto Principal', 'Vencimiento', 'Acciones'].map(h => (
                        <th key={h} className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map(emp => {
                      const planCfg = PLANES_CONFIG[emp.plan_suscripcion] || PLANES_CONFIG.starter
                      const estCfg = ESTATUS_CONFIG[emp.estatus] || ESTATUS_CONFIG.activo

                      return (
                        <tr key={emp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          {/* Empresa */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-base shadow-sm">
                                {emp.nombre_empresa.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                  {emp.nombre_empresa}
                                </p>
                                <p className="text-[11px] font-mono text-slate-400 truncate">
                                  ID: {emp.id.slice(0, 8)}...
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* RFC */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {emp.rfc ? (
                              <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                {emp.rfc}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 italic">Sin RFC</span>
                            )}
                          </td>

                          {/* Plan & Estatus */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex flex-col gap-1 items-start">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${estCfg.cls}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${estCfg.dot}`} />
                                {estCfg.label}
                              </span>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${planCfg.badge}`}>
                                Plan {planCfg.label}
                              </span>
                            </div>
                          </td>

                          {/* Capacidad & Consumo en Tiempo Real */}
                          <td className="px-4 py-3.5 min-w-[200px]">
                            <div className="space-y-2">
                              {/* Empleados Progress */}
                              <div>
                                <div className="flex items-center justify-between text-[11px] font-semibold mb-0.5">
                                  <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                                    <Users className="w-3.5 h-3.5 text-blue-500" />
                                    Colaboradores
                                  </span>
                                  <span className="font-mono">
                                    <strong className={emp.empleados_actuales >= (emp.limite_empleados || 50) ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}>
                                      {emp.empleados_actuales}
                                    </strong>
                                    <span className="text-slate-400"> / {emp.limite_empleados || 50}</span>
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      emp.empleados_actuales >= (emp.limite_empleados || 50)
                                        ? 'bg-rose-500'
                                        : emp.porcentaje_empleados >= 80
                                        ? 'bg-amber-500'
                                        : 'bg-blue-600'
                                    }`}
                                    style={{ width: `${emp.porcentaje_empleados}%` }}
                                  />
                                </div>
                              </div>

                              {/* Dispositivos Progress */}
                              <div>
                                <div className="flex items-center justify-between text-[11px] font-semibold mb-0.5">
                                  <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                                    <Cpu className="w-3.5 h-3.5 text-emerald-500" />
                                    Terminales ISUP
                                  </span>
                                  <span className="font-mono">
                                    <strong className={emp.dispositivos_actuales >= (emp.limite_dispositivos || 5) ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}>
                                      {emp.dispositivos_actuales}
                                    </strong>
                                    <span className="text-slate-400"> / {emp.limite_dispositivos || 5}</span>
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      emp.dispositivos_actuales >= (emp.limite_dispositivos || 5)
                                        ? 'bg-rose-500'
                                        : emp.porcentaje_dispositivos >= 80
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${emp.porcentaje_dispositivos}%` }}
                                  />
                                </div>
                              </div>

                              {/* Alerta de Límite Alcanzado o 80% */}
                              {emp.empleados_actuales >= (emp.limite_empleados || 50) ? (
                                <span className="inline-block text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-1.5 py-0.5 rounded">
                                  LÍMITE ALCANZADO
                                </span>
                              ) : emp.porcentaje_empleados >= 80 ? (
                                <span className="inline-block text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                                  80%+ CAPACIDAD
                                </span>
                              ) : null}
                            </div>
                          </td>

                          {/* Contacto */}
                          <td className="px-4 py-3.5">
                            <div className="text-xs">
                              <p className="font-semibold text-slate-800 dark:text-slate-200">{emp.contacto_nombre || 'Sin contacto'}</p>
                              <p className="text-slate-400 text-[11px] truncate">{emp.contacto_email || emp.contacto_telefono || '—'}</p>
                            </div>
                          </td>

                          {/* Vencimiento */}
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs font-mono">
                            {emp.vencido ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                <AlertTriangle className="w-3 h-3" />
                                Vencida ({formatDate(emp.fecha_vencimiento)})
                              </span>
                            ) : (
                              <span className="text-slate-600 dark:text-slate-400">
                                {formatDate(emp.fecha_vencimiento)}
                              </span>
                            )}
                          </td>

                          {/* Acciones */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setModalDetalle(emp)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 transition-colors"
                                title="Ver Ficha Completa"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setModalEmpresa(emp)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-sky-600 transition-colors"
                                title="Editar Empresa"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(emp)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-rose-600 transition-colors"
                                title="Eliminar Empresa"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </main>
      </div>

      {/* Modales */}
      {modalEmpresa && (
        <ModalEmpresa
          empresa={modalEmpresa === 'nuevo' ? null : modalEmpresa}
          onClose={() => setModalEmpresa(null)}
          onSaved={fetchEmpresas}
        />
      )}

      {modalDetalle && (
        <ModalDetalleEmpresa
          empresa={modalDetalle}
          onClose={() => setModalDetalle(null)}
          onEdit={(emp) => setModalEmpresa(emp)}
        />
      )}

      {ConfirmDialogNode}
    </div>
  )
}
