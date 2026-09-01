/**
 * CentralPermissionsPage.jsx
 * Signum-Clock Central — Gestión completa de módulos y permisos.
 *
 * Sección 1: Módulos por empresa (Central → Tenant)
 *   Superadmin habilita/deshabilita módulos del catálogo para cada empresa.
 *
 * Sección 2: Permisos por usuario (Tenant → Usuario)
 *   Superadmin selecciona empresa → selecciona usuario → gestiona módulos del usuario.
 */
import { useState } from 'react'
import CentralLayout from '../components/CentralLayout'
import CentralTenantModulesManager from '../../features/permissions/components/CentralTenantModulesManager'
import ModulePermissionsManager from '../../features/permissions/components/ModulePermissionsManager'
import { Building2, KeyRound } from 'lucide-react'

const TABS = [
  { id: 'tenant', label: 'Módulos por empresa', icon: Building2, description: 'Habilita o deshabilita módulos del catálogo para cada empresa.' },
  { id: 'user',   label: 'Permisos por usuario', icon: KeyRound, description: 'Asigna excepciones de acceso a usuarios individuales de cualquier empresa.' },
]

export default function CentralPermissionsPage() {
  const [activeTab, setActiveTab] = useState('tenant')
  const active = TABS.find((t) => t.id === activeTab)

  return (
    <CentralLayout>
      <div className="space-y-6">
        {/* Cabecera */}
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Permisos y módulos</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Administra qué módulos tiene contratados cada empresa y qué accesos tiene cada usuario.
          </p>
        </div>

        {/* Pestañas */}
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4 flex-none" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Descripción de la pestaña activa */}
        {active && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{active.description}</p>
        )}

        {/* Contenido según pestaña */}
        {activeTab === 'tenant' && <CentralTenantModulesManager />}
        {activeTab === 'user'   && <ModulePermissionsManager mode="central" />}
      </div>
    </CentralLayout>
  )
}
