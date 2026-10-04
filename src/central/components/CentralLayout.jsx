// src/central/components/CentralLayout.jsx — Layout Maestro de Signum-Clock Central
import { useState } from 'react'
import CentralSidebar from './CentralSidebar'
import CentralHeader from './CentralHeader'

export default function CentralLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )

  return (
    <div
      className="flex h-screen overflow-hidden font-sans"
      style={{ backgroundColor: '#F8F9F9', color: '#272C3D' }}
    >
      {/* Sidebar */}
      <CentralSidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Content */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <CentralHeader sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="flex-1 px-5 py-6 md:px-8 md:py-7 max-w-[1440px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  )
}
