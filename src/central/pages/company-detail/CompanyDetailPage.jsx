/**
 * CompanyDetailPage.jsx — Detalle administrativo de Empresa
 * Signum Clock Central — Solo accesible desde Central (SuperAdmin).
 *
 * Ruta: /central/empresas/:id
 * Carga la empresa desde Supabase y muestra tabs administrativos.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import CentralLayout from '../../components/CentralLayout'
import { useConfirm } from '../../../shared/hooks/useConfirm'
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Edit3,
  MoreHorizontal,
  RefreshCw,
  Users,
  Cpu,
  CreditCard,
  ClipboardList,
  ShieldAlert,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Check,
  Mail,
  Phone,
  MapPin,
  Calendar,
} from 'lucide-react'
import toast from 'react-hot-toast'

/* ── Tokens ────────────────────────────────────────────────── */
const ESTATUS_CONFIG = {
  activo:     { label: 'Activa',      dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  suspendido: { label: 'Suspendida',  dot: 'bg-amber-400',   badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
  cancelado:  { label: 'Cancelada',   dot: 'bg-rose-500',    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20' },
  demo:       { label: 'Demo',        dot: 'bg-blue-400',    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' },
}

const PLAN_BADGE = {
  free:       'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  starter:    'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  pro:        'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20',
  enterprise: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/20',
  custom:     'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
}

/* ── Subcomponentes locales ────────────────────────────────── */
function EstatusChip({ estatus, vencido }) {
  const key = vencido ? 'cancelado' : (estatus || 'cancelado')
  const cfg = ESTATUS_CONFIG[key] || ESTATUS_CONFIG.cancelado
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function CapBar({ current, limit, color = 'bg-blue-500' }) {
  const pct = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0
  const bar = pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : color
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{current} / {limit}</span>
        <span className="text-slate-400 dark:text-slate-500 tabular-nums">{pct}%</span>
      </div>
      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
        <div className={`${bar} h-full rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="py-3 flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 w-36">{label}</span>
      <span className={`text-sm text-slate-900 dark:text-white text-right min-w-0 truncate ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {value || '—'}
      </span>
    </div>
  )
}

/* ── Tabs ──────────────────────────────────────────────────── */
const TABS = [
  { id: 'resumen',     label: 'Resumen',     icon: LayoutGrid },
  { id: 'capacidades', label: 'Capacidades', icon: CreditCard },
  { id: 'usuarios',    label: 'Usuarios',    icon: Users },
  { id: 'dispositivos', label: 'Dispositivos', icon: Cpu },
  { id: 'politicas',   label: 'Políticas',   icon: ClipboardList },
  { id: 'auditoria',   label: 'Auditoría',   icon: ShieldAlert },
]

/* ── Tab Resumen ───────────────────────────────────────────── */
function TabResumen({ empresa }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(empresa.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Identificación */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Identificación</h3>
        </div>
        <div className="px-5">
          <InfoRow label="Nombre" value={empresa.nombre_empresa} />
          <InfoRow label="ID Empresa" value={empresa.id_empresa || 'Sin configurar'} mono />
          <InfoRow label="RFC" value={empresa.rfc} />
          <InfoRow label="País" value={empresa.pais || 'México'} />
          <InfoRow label="Ciudad" value={[empresa.ciudad, empresa.estado].filter(Boolean).join(', ')} />
          <div className="py-3 flex items-start justify-between gap-4">
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 w-36">UUID interno</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-400 truncate max-w-[160px]">{empresa.id}</span>
              <button onClick={copy} className="flex-shrink-0 p-1 rounded text-slate-300 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Plan y suscripción */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Plan y suscripción</h3>
        </div>
        <div className="px-5">
          <div className="py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">Plan</span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${PLAN_BADGE[empresa.plan_suscripcion] || PLAN_BADGE.starter}`}>
              {empresa.plan_suscripcion || 'Starter'}
            </span>
          </div>
          <InfoRow label="Vencimiento" value={empresa.fecha_vencimiento
            ? new Date(empresa.fecha_vencimiento).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
            : 'Sin vencimiento'} />
          <InfoRow label="Registro" value={empresa.creado_at
            ? new Date(empresa.creado_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
            : null} />
        </div>
      </div>

      {/* Contacto */}
      {(empresa.contacto_nombre || empresa.contacto_email) && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Contacto</h3>
          </div>
          <div className="px-5">
            <InfoRow label="Nombre" value={empresa.contacto_nombre} />
            <InfoRow label="Email" value={empresa.contacto_email} />
            <InfoRow label="Teléfono" value={empresa.contacto_telefono} />
          </div>
        </div>
      )}

      {/* Notas */}
      {empresa.notas && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Notas operativas</h3>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{empresa.notas}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Tab Capacidades ───────────────────────────────────────── */
function TabCapacidades({ empresa }) {
  const empCurrent = Number(empresa.empleados_actuales || 0)
  const empLimit   = Number(empresa.limite_empleados || 50)
  const devCurrent = Number(empresa.dispositivos_actuales || 0)
  const devLimit   = Number(empresa.limite_dispositivos || 5)

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#BDD9D7]/20 border border-[#BDD9D7]/40">
        <ShieldAlert className="w-3.5 h-3.5 text-[#03363D]/60 dark:text-teal-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[#03363D]/80 dark:text-teal-300/80 leading-relaxed">
          <span className="font-semibold">Central configura los límites.</span> El cliente puede consultar su consumo actual pero no modificar estos valores.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Colaboradores */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Colaboradores</h3>
          </div>
          <CapBar current={empCurrent} limit={empLimit} color="bg-blue-500" />
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Límite configurado por Central</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{empLimit}</span>
            </div>
          </div>
        </div>

        {/* Dispositivos */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Dispositivos</h3>
          </div>
          <CapBar current={devCurrent} limit={devLimit} color="bg-emerald-500" />
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Límite configurado por Central</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{devLimit}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Tab placeholder ───────────────────────────────────────── */
function TabPlaceholder({ icon: Icon, title, description }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 py-16 text-center">
      <Icon className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs mx-auto">{description}</p>
    </div>
  )
}

/* ── Componente principal ──────────────────────────────────── */
export default function CompanyDetailPage() {
  const { id }           = useParams()
  const navigate         = useNavigate()
  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const [empresa,  setEmpresa]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [activeTab, setActiveTab] = useState('resumen')
  const [menuOpen, setMenuOpen] = useState(false)

  const fetchEmpresa = useCallback(async () => {
    setLoading(true)
    try {
      // Intenta con RPC; si no, agrega counts manualmente
      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_resumen_global_tenants')
      if (!rpcErr && rpcData) {
        const found = rpcData.find(t => t.id === id)
        if (found) { setEmpresa(found); setLoading(false); return }
      }

      const [
        { data: clientData, error: clientErr },
        { count: empCount },
        { count: devCount },
      ] = await Promise.all([
        supabase.from('clientes').select('*').eq('id', id).single(),
        supabase.from('empleados').select('*', { count: 'exact', head: true }).eq('cliente_id', id),
        supabase.from('dispositivos').select('*', { count: 'exact', head: true }).eq('cliente_id', id),
      ])
      if (clientErr) throw clientErr
      setEmpresa({
        ...clientData,
        empleados_actuales:    empCount    || 0,
        dispositivos_actuales: devCount    || 0,
        vencido: clientData.fecha_vencimiento ? new Date(clientData.fecha_vencimiento) < new Date() : false,
      })
    } catch (err) {
      toast.error('Error al cargar empresa: ' + err.message)
      navigate('/central/empresas')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchEmpresa() }, [fetchEmpresa])

  const handleToggleEstatus = async () => {
    if (!empresa) return
    const nuevoEstatus = empresa.estatus === 'activo' ? 'suspendido' : 'activo'
    const accion = nuevoEstatus === 'activo' ? 'reactivar' : 'suspender'
    const ok = await confirmDialog({
      title: `${accion.charAt(0).toUpperCase() + accion.slice(1)} Empresa`,
      message: `¿Confirmas ${accion} a ${empresa.nombre_empresa}?`,
      variant: nuevoEstatus === 'suspendido' ? 'danger' : 'info',
      confirmLabel: `Sí, ${accion}`,
    })
    if (!ok) return
    try {
      const { error } = await supabase.from('clientes').update({ estatus: nuevoEstatus }).eq('id', id)
      if (error) throw error
      toast.success(`Empresa ${nuevoEstatus === 'activo' ? 'reactivada' : 'suspendida'}`)
      fetchEmpresa()
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
    setMenuOpen(false)
  }

  if (loading) {
    return (
      <CentralLayout>
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="w-5 h-5 animate-spin text-slate-300 dark:text-slate-600" />
        </div>
      </CentralLayout>
    )
  }

  if (!empresa) return null

  const activeTabDef = TABS.find(t => t.id === activeTab)

  return (
    <CentralLayout>
      {ConfirmDialogNode}

      <div className="space-y-6">
        {/* ── Breadcrumb ── */}
        <nav className="flex items-center gap-1.5 text-[13px]">
          <Link to="/central/empresas" className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Empresas
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
          <span className="text-slate-800 dark:text-slate-200 font-medium truncate">{empresa.nombre_empresa}</span>
        </nav>

        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {/* Avatar empresa */}
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
              {empresa.nombre_empresa?.[0]?.toUpperCase() || 'E'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-white leading-tight truncate">
                  {empresa.nombre_empresa}
                </h1>
                <EstatusChip estatus={empresa.estatus} vencido={empresa.vencido} />
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                {empresa.id_empresa && (
                  <span className="font-mono">{empresa.id_empresa}</span>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${PLAN_BADGE[empresa.plan_suscripcion] || PLAN_BADGE.starter}`}>
                  {empresa.plan_suscripcion || 'Starter'}
                </span>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={`/central/empresas`}
              state={{ editId: empresa.id }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Editar
            </Link>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-44 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1 z-20">
                  <button
                    onClick={handleToggleEstatus}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-left transition-colors ${
                      empresa.estatus === 'activo'
                        ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                        : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                    }`}
                  >
                    {empresa.estatus === 'activo'
                      ? <><AlertTriangle className="w-3.5 h-3.5" /> Suspender</>
                      : <><CheckCircle2 className="w-3.5 h-3.5" /> Reactivar</>
                    }
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/central/empresas') }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Volver al listado
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="border-b border-slate-200 dark:border-slate-800">
          <nav className="flex items-center gap-0.5 -mb-px">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>

        {/* ── Tab content ── */}
        <div>
          {activeTab === 'resumen'     && <TabResumen empresa={empresa} />}
          {activeTab === 'capacidades' && <TabCapacidades empresa={empresa} />}
          {activeTab === 'usuarios'    && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-lg font-bold">Usuarios de esta empresa</h2>
              <p className="mt-2 text-sm text-slate-500">Crea el primer acceso del administrador y consulta las cuentas de esta empresa.</p>
              <Link to={`/central/usuarios?empresa=${empresa.id}`} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#03363D] px-4 py-2 text-sm font-semibold text-white"><Users className="w-4 h-4" /> Gestionar usuarios</Link>
            </div>
          )}
          {activeTab === 'dispositivos' && (
            <TabPlaceholder icon={Cpu} title="Dispositivos de esta empresa" description="Terminales biométricas asociadas a esta empresa." />
          )}
          {activeTab === 'politicas'   && (
            <TabPlaceholder icon={ClipboardList} title="Política de asistencia" description="Configura la política de asistencia desde el módulo Políticas de Asistencia." />
          )}
          {activeTab === 'auditoria'   && (
            <TabPlaceholder icon={ShieldAlert} title="Auditoría de esta empresa" description="Registro de cambios administrativos. Disponible en próxima fase." />
          )}
        </div>
      </div>
    </CentralLayout>
  )
}
