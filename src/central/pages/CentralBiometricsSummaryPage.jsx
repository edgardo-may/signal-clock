// src/central/pages/CentralBiometricsSummaryPage.jsx — Resumen Biométrico para Signum-Clock Central
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import CentralLayout from '../components/CentralLayout'
import TenantSelector from '../../shared/components/Layout/TenantSelector'
import BiometricsDashboard from '../../features/biometrics/components/BiometricsDashboard'
import { useBiometrics } from '../../features/biometrics/hooks/useBiometrics'
import { useCurrentTenant } from '../../shared/hooks/useCurrentTenant'
import { Cpu, AlertTriangle } from 'lucide-react'

export default function CentralBiometricsSummaryPage() {
  const navigate = useNavigate()
  const {
    tenants,
    currentTenantId,
    setSelectedTenantId,
    loadingTenants,
  } = useCurrentTenant()

  const {
    loading,
    refreshCurrentTab,
    stats,
  } = useBiometrics(currentTenantId)

  // Handlers ficticios o reducidos para navegación (ya que en Central no tenemos las pestañas de cliente por defecto)
  const handleNavigateTab = (tab) => {
    // Si el SuperAdmin quiere ver los dispositivos del tenant, podemos mandarlo a /central/dispositivos
    // o simplemente no hacer nada ya que los links del dashboard original apuntan a rutas de cliente.
    if (tab === 'devices') navigate('/central/dispositivos')
    // Los demás tabs del cliente (logs, colaboradores) no existen directamente en Central,
    // así que por ahora solo interceptamos o evitamos que se rompa.
  }

  return (
    <CentralLayout>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
              <Cpu className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              Resumen Biométrico (ADMS)
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              SuperAdmin
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5">
            Monitoreo en tiempo real, KPIs consolidados y actividad de terminales
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <TenantSelector
            tenants={tenants}
            currentTenantId={currentTenantId}
            onSelectTenant={setSelectedTenantId}
            loading={loadingTenants}
          />
        </div>
      </div>

      {!currentTenantId ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <div className="h-16 w-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="h-8 w-8 text-blue-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
            Selecciona una empresa
          </h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm">
            Para ver el resumen biométrico, por favor selecciona un cliente en el menú desplegable superior.
          </p>
        </div>
      ) : (
        <BiometricsDashboard
          stats={stats}
          loading={loading}
          onNavigateTab={handleNavigateTab}
          onOpenNewDevice={() => navigate('/central/dispositivos')}
          onOpenSendCommand={() => {}}
          onRefresh={refreshCurrentTab}
        />
      )}
    </CentralLayout>
  )
}
