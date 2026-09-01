import { useState } from 'react'
import Sidebar from '../../shared/components/Layout/Sidebar'
import Header from '../../shared/components/Layout/Header'
import AuditView from '../../shared/components/Audit/AuditView'
import { Toaster } from 'react-hot-toast'

export default function ClientAuditPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#0B132B]">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-[1400px] mx-auto h-full flex flex-col">
            <AuditView scope="tenant" />
          </div>
        </main>
      </div>
      <Toaster position="top-right" />
    </div>
  )
}
