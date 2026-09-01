// src/central/components/CentralLayout.jsx — Layout Maestro de Signum-Clock Central
import { useState } from 'react'
import CentralSidebar from './CentralSidebar'
import CentralHeader from './CentralHeader'
import { Toaster } from 'react-hot-toast'

export default function CentralLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc] dark:bg-[#0f172a] text-slate-800 dark:text-slate-100 font-sans">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      {/* Menú Lateral Master */}
      <CentralSidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Área de Contenido Central */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <CentralHeader sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-8 w-full space-y-6">
          {children}
        </main>
      </div>
    </div>
  )
}
