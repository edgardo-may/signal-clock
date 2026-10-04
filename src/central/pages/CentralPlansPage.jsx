/**
 * CentralPlansPage.jsx — Planes y Capacidades
 * Signum Clock Central — Configuración global de planes SaaS.
 *
 * Muestra los planes configurados en el sistema y permite
 * ver su configuración de límites. CRUD de plan asignado a empresa
 * se gestiona desde el módulo Empresas.
 */
import CentralLayout from '../components/CentralLayout'
import { Link } from 'react-router-dom'
import { CreditCard, Users, Cpu, ArrowRight, Info } from 'lucide-react'

const PLANES = [
  {
    id: 'free',
    label: 'Free',
    badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    limiteEmp: 15,
    limiteDev: 1,
    descripcion: 'Acceso básico para evaluación. Sin soporte premium.',
  },
  {
    id: 'starter',
    label: 'Starter',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
    limiteEmp: 50,
    limiteDev: 5,
    descripcion: 'Para empresas pequeñas. Biométricos ZKTeco incluidos.',
  },
  {
    id: 'pro',
    label: 'Professional',
    badge: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20',
    limiteEmp: 200,
    limiteDev: 15,
    descripcion: 'Para empresas medianas. Políticas de asistencia avanzadas.',
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    badge: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/20',
    limiteEmp: 1000,
    limiteDev: 50,
    descripcion: 'Sin límite práctico. Soporte dedicado y configuración personalizada.',
  },
  {
    id: 'custom',
    label: 'Personalizado',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    limiteEmp: null,
    limiteDev: null,
    descripcion: 'Límites configurados manualmente por empresa.',
  },
]

export default function CentralPlansPage() {
  return (
    <CentralLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-slate-400" />
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight">
              Planes y Capacidades
            </h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Catálogo de planes del sistema. Asigna o modifica el plan de una empresa desde el módulo Empresas.
          </p>
        </div>

        {/* Info */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#BDD9D7]/20 border border-[#BDD9D7]/40">
          <Info className="w-3.5 h-3.5 text-[#03363D]/60 dark:text-teal-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#03363D]/80 dark:text-teal-300/80 leading-relaxed">
            Los límites de este catálogo son los valores por defecto al asignar un plan.
            Cada empresa puede tener límites personalizados configurados desde su detalle en{' '}
            <Link to="/central/empresas" className="font-semibold underline underline-offset-2">
              Empresas
            </Link>.
          </p>
        </div>

        {/* Grid de planes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLANES.map((plan) => (
            <div
              key={plan.id}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
            >
              {/* Plan label */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${plan.badge}`}>
                  {plan.label}
                </span>
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase">{plan.id}</span>
              </div>

              {/* Descripción */}
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {plan.descripcion}
              </p>

              {/* Límites */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <Users className="w-3 h-3" />
                    Colaboradores
                  </div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {plan.limiteEmp !== null ? plan.limiteEmp : '∞'}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <Cpu className="w-3 h-3" />
                    Dispositivos
                  </div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {plan.limiteDev !== null ? plan.limiteDev : '∞'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA a empresas */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Gestionar plan por empresa</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Cambia el plan, ajusta límites individuales o suspende una empresa desde el módulo Empresas.
            </p>
          </div>
          <Link
            to="/central/empresas"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#03363D] hover:bg-[#03363D]/90 transition-colors flex-shrink-0"
          >
            Ir a Empresas
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </CentralLayout>
  )
}
