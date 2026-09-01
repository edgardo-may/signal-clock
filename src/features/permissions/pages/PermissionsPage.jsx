import { useState } from 'react'
import Header from '../../../shared/components/Layout/Header'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import { useAuth } from '../../auth/hooks/useAuth'
import ModulePermissionsManager from '../components/ModulePermissionsManager'

export default function PermissionsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const { profile } = useAuth()

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="min-w-0 flex-1">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <main className="mx-auto max-w-screen-2xl space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-extrabold">Permisos de módulos</h1>
            <p className="mt-1 text-sm text-slate-500">Define qué secciones puede consultar o administrar cada usuario de tu empresa.</p>
          </div>
          <ModulePermissionsManager mode="tenant" tenantId={profile?.cliente_id} />
        </main>
      </div>
    </div>
  )
}
