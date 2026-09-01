// src/client/components/ClientLayout.jsx — Layout Corporativo para Signum-Clock Client
import { useState } from 'react'
import ClientSidebar from './ClientSidebar'
import ClientHeader from './ClientHeader'
import { Toaster } from 'react-hot-toast'

export default function ClientLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#0B132B] text-slate-900 dark:text-white font-sans transition-colors">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      {/* Menú Lateral Corporativo */}
      <ClientSidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Área de Contenido del Tenant */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <ClientHeader sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-8 w-full space-y-6">
          {children}
        </main>
      </div>
    </div>
  )
}
