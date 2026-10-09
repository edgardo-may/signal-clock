// src/features/biometrics/components/DeviceFormModal.jsx
import { useState, useEffect } from 'react'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import {
  X,
  Cpu,
  Save,
  MapPin,
  Barcode,
  Tag,
  Power,
  Globe,
  Network,
  ArrowRightLeft,
  LogIn,
  LogOut,
  Utensils,
  UserCheck,
  ShieldCheck,
  Key,
  ShieldAlert,
  Info,
  Clock,
} from 'lucide-react'

const TIMEZONES = [
  { value: 'America/Mexico_City',  label: 'Centro / CDMX / Guadalajara / Monterrey (UTC-6)' },
  { value: 'America/Cancun',       label: 'Sureste / Cancún / Quintana Roo (UTC-5)' },
  { value: 'America/Tijuana',      label: 'Noroeste / Tijuana / Baja California (UTC-7 verano / UTC-8 invierno)' },
  { value: 'America/Hermosillo',   label: 'Pacífico / Sonora / Hermosillo (UTC-7 / MST)' },
  { value: 'America/Chihuahua',    label: 'Norte / Chihuahua / Cd. Juárez (UTC-6)' },
  { value: 'America/Mazatlan',     label: 'Pacífico / Sinaloa / Mazatlán (UTC-7)' },
  { value: 'America/Merida',       label: 'Yucatán / Mérida (UTC-6)' },
  { value: 'America/Bogota',       label: 'Colombia / Perú / Ecuador (UTC-5)' },
  { value: 'America/Santiago',     label: 'Chile / Santiago (UTC-3)' },
  { value: 'America/Buenos_Aires', label: 'Argentina / Buenos Aires (UTC-3)' },
  { value: 'UTC',                  label: 'UTC (Tiempo Universal Coordinado)' },
]

const DEVICE_TYPES = [
  { id: 'general',  label: 'Entradas y Salidas',  desc: 'Registro general de inicio y fin de turno',       icon: ArrowRightLeft, color: 'border-[#BDD9D7] bg-[#BDD9D7]/20 text-[#03363D] dark:text-teal-300' },
  { id: 'entrada',  label: 'Solo Entradas',        desc: 'Torniquete o puerta de acceso de ingreso',        icon: LogIn,          color: 'border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  { id: 'salida',   label: 'Solo Salidas',          desc: 'Torniquete o puerta de egreso de personal',       icon: LogOut,         color: 'border-orange-400 bg-orange-500/10 text-orange-700 dark:text-orange-400' },
  { id: 'comedor',  label: 'Comedor',               desc: 'Control de tiempos de comida y raciones',         icon: Utensils,       color: 'border-purple-400 bg-purple-500/10 text-purple-700 dark:text-purple-400' },
  { id: 'rh',       label: 'RH / Enrolamiento',    desc: 'Terminal de oficina para registro de huellas',    icon: UserCheck,      color: 'border-indigo-400 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' },
  { id: 'acceso',   label: 'Control de Acceso',    desc: 'Apertura de esclusas, barreras y chapas',         icon: ShieldCheck,    color: 'border-amber-400 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
]

const inputClass = 'w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all placeholder:text-slate-400'
const labelClass = 'block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5'

export default function DeviceFormModal({ device, onClose, onSave, requestMode = false }) {
  const isEditing = Boolean(device && device !== 'nuevo')
  const { isSuperAdmin } = useCurrentTenant()

  const [formData, setFormData] = useState({
    name: '',
    serial_number: '',
    location: '',
    ip_address: '',
    port: '7660',
    timezone: 'America/Mexico_City',
    device_type: 'general',
    is_active: !requestMode,
    marca: 'zkteco',
    isup_key: '',
  })

  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isEditing && typeof device === 'object') {
      setFormData({
        name:          (device.name || '').toUpperCase(),
        serial_number: (device.serial_number || '').toUpperCase(),
        location:      (device.location || '').toUpperCase(),
        ip_address:    device.ip_address || '',
        port:          device.port ? String(device.port) : '7660',
        timezone:      device.timezone || 'America/Mexico_City',
        device_type:   device.device_type || 'general',
        is_active:     device.is_active !== undefined ? device.is_active : true,
        marca:         device.marca || 'zkteco',
        isup_key:      device.isup_key || '',
      })
    }
  }, [device, isEditing])


  const validate = () => {
    const errs = {}
    if (!formData.name.trim())          errs.name          = 'El nombre es obligatorio.'
    if (!formData.serial_number.trim()) errs.serial_number = 'El número de serie (SN) es obligatorio.'
    if (formData.port && isNaN(Number(formData.port))) errs.port = 'El puerto debe ser un número.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    try {
      await onSave({
        ...(isEditing ? { id: device.id } : {}),
        ...Object.fromEntries(Object.entries(formData).filter(([key]) => !['serial_number', 'is_active', 'marca', 'isup_key'].includes(key))),
        name: formData.name.toUpperCase(),
        location: formData.location.toUpperCase(),
        ...(requestMode ? { serial_number: formData.serial_number.toUpperCase(), protocol: formData.marca === 'hikvision' ? 'HIKVISION_ISUP' : 'ZKTECO_ADMS' } : {}),
        ...(!requestMode && isSuperAdmin ? { is_active: formData.is_active } : {}),
        port: formData.port ? parseInt(formData.port, 10) : 7660,
      })
    } catch (error) {
      setErrors(previous => ({ ...previous, submit: error.message || 'No se pudo guardar el dispositivo.' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl shadow-black/10">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {isEditing ? 'Editar terminal' : 'Registrar terminal'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isEditing ? 'Modifica los parámetros del dispositivo' : 'Agrega un biométrico a tu flota'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">

          {/* ── Identificación ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Nombre */}
              <div>
                <label className={labelClass}>Nombre descriptivo *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.toUpperCase() })}
                  placeholder="Ej: Entrada Principal"
                  className={inputClass}
                />
                {errors.name && <p className="text-[11px] text-rose-500 mt-1">{errors.name}</p>}
              </div>

              {/* SN */}
              <div>
                <label className={labelClass}>Número de serie (SN) *</label>
                <input
                  type="text"
                  readOnly={isEditing}
                  value={formData.serial_number}
                  onChange={(e) => setFormData({ ...formData, serial_number: e.target.value.toUpperCase() })}
                  placeholder="Ej: XKHZ240800001"
                  className={`${inputClass} font-mono`}
                />
                {errors.serial_number && <p className="text-[11px] text-rose-500 mt-1">{errors.serial_number}</p>}
              </div>
            </div>

            {/* Hint ZKTeco */}
            {formData.marca === 'zkteco' && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#BDD9D7]/20 border border-[#BDD9D7]/40">
                <Info className="w-3.5 h-3.5 text-[#03363D]/60 dark:text-teal-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[#03363D]/80 dark:text-teal-300/80 leading-relaxed">
                  Registra el número de serie del biométrico. Cuando el dispositivo se conecte al servidor, Signum Clock lo reconocerá automáticamente.
                </p>
              </div>
            )}

            {/* Ubicación */}
            <div>
              <label className={labelClass}>Ubicación o área</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value.toUpperCase() })}
                placeholder="Ej: Puerta Principal · Recepción"
                className={inputClass}
              />
            </div>
          </div>

          {/* ── Protocolo (solo SuperAdmin) ─────────────────────────────── */}
          <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Protocolo y conexión</p>

            {requestMode ? <div>
              <label className={labelClass}>Marca del dispositivo</label>
              <select value={formData.marca} onChange={event => setFormData({ ...formData, marca: event.target.value })} className={inputClass}>
                <option value="zkteco">ZKTeco (ADMS Push)</option>
                <option value="hikvision">Hikvision (ISUP 5.0)</option>
              </select>
              <p className="mt-2 text-xs text-slate-500">Central debe autorizar la asociación antes de habilitar esta terminal.</p>
            </div> : <p className="text-xs text-slate-500">La identidad y asociación del dispositivo se autorizan en Central. Este formulario sólo edita sus parámetros operativos.</p>}

            {/* Zona horaria */}
            <div>
              <label className={labelClass}>Zona horaria</label>
              <select
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                className={inputClass}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span>La zona horaria del catálogo no sustituye la configuración física del checador. Usa la acción de sincronización para enviar su configuración.</span>
              </p>
            </div>
          </div>

          {/* ── Tipo de Terminal ─────────────────────────────────────────── */}
          <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Propósito de la terminal</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {DEVICE_TYPES.map((t) => {
                const Icon = t.icon
                const isSelected = formData.device_type === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, device_type: t.id })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? `${t.color} shadow-sm`
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 mb-1.5" />
                    <span className="text-xs font-semibold block leading-tight">{t.label}</span>
                    <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">{t.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Estado Operativo (Habilitada / Pausada) ────────────────────────── */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 transition-all">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border ${
                  formData.is_active
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                }`}>
                  <Power className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {formData.is_active ? 'Terminal activa' : 'Terminal pausada'}
                    </p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      formData.is_active
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400'
                    }`}>
                      {formData.is_active ? 'En servicio' : 'Deshabilitada'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {formData.is_active
                      ? 'Permite recibir marcajes y sincronizar asignaciones con este biométrico.'
                      : 'Pausa las operaciones del dispositivo sin eliminar checadas ni historial laboral.'}
                  </p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  disabled={requestMode || !isSuperAdmin}
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-slate-300 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#03363D]" />
              </label>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          {requestMode && <p className="text-xs text-amber-700 dark:text-amber-400">Pendiente de autorización. Central habilita la terminal al aprobar la solicitud.</p>}
          {errors.submit && <p role="alert" className="text-sm text-rose-600">{errors.submit}</p>}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#03363D] hover:bg-[#03363D]/90 shadow-sm transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {submitting ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
