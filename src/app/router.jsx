/**
 * router.jsx — Enrutador Inteligente Signum-Clock
 * Separa completamente Signum-Clock Central (Master) de Signum-Clock Client (Tenant)
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../features/auth/hooks/useAuth'

// Central (Master App)
import CentralAdminRoute from '../central/guards/CentralAdminRoute'
import CentralLoginPage from '../central/pages/CentralLoginPage'
import CentralDashboardPage from '../central/pages/CentralDashboardPage'
import CentralTenantsPage from '../central/pages/CentralTenantsPage'
import CentralUsersPage from '../central/pages/CentralUsersPage'
import CentralPermissionsPage from '../central/pages/CentralPermissionsPage'
import CentralSyncPage from '../central/pages/CentralSyncPage'
import CentralBiometricsSummaryPage from '../central/pages/CentralBiometricsSummaryPage'
import CentralAuditPage from '../central/pages/CentralAuditPage'

// Client (Tenant App)
import ClientTenantRoute from '../client/guards/ClientTenantRoute'
import ClientPermissionRoute from '../client/guards/ClientPermissionRoute'
import ClientAdminRoute from '../client/guards/ClientAdminRoute'
import { isSuperAdmin, PERMISSION } from '../shared/auth/permissions'
import ClientLoginPage from '../client/pages/ClientLoginPage'
import ClientAuditPage from '../client/pages/ClientAuditPage'
import DashboardPage from '../features/dashboard/pages/DashboardPage'
import EmpleadosPage from '../features/employees/pages/EmpleadosPage'
import HorariosPage from '../features/schedules/pages/HorariosPage'
import AsignacionHorariosPage from '../features/schedules/pages/AsignacionHorariosPage'
import DiasFestivosPage from '../features/schedules/pages/DiasFestivosPage'
import ChecadasManualesPage from '../features/attendance/pages/ChecadasManualesPage'
import IncidenciasPage from '../features/attendance/pages/IncidenciasPage'
import KioskoChecadorPage from '../features/attendance/pages/KioskoChecadorPage'
import VisorAsistenciasPage from '../features/attendance/pages/VisorAsistenciasPage'
import ReporteRetardosPage from '../features/attendance/pages/ReporteRetardosPage'
import MatrizChecadasPage from '../features/attendance/pages/MatrizChecadasPage'
import HistorialEventosPage from '../features/attendance/pages/HistorialEventosPage'
import TarjetaFichajePage from '../features/attendance/pages/TarjetaFichajePage'
import ReportesPage from '../features/reports/pages/ReportesPage'
import UsersPage from '../features/users/pages/UsersPage'
import PermissionsPage from '../features/permissions/pages/PermissionsPage'
import BiometricosPage from '../features/biometrics/pages/BiometricosPage'
import EnrollmentPage from '../features/biometrics/pages/EnrollmentPage'
import SyncPage from '../features/sync/pages/SyncPage'

import { Clock } from 'lucide-react'

// Placeholder para módulos en construcción
const PlaceholderPage = ({ title }) => (
  <div
    className="flex min-h-screen items-center justify-center bg-[#F8FAFC] dark:bg-[#0B132B]"
  >
    <div className="text-center space-y-3">
      <p className="text-4xl">🚧</p>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
      <p className="text-sm text-blue-600">Módulo en integración</p>
    </div>
  </div>
)

/**
 * PublicClientRoute — Para /login del Client.
 * Si ya está autenticado:
 * - Si es SuperAdmin → redirige a /central
 * - Si es usuario de tenant → redirige a /
 */
function PublicClientRoute({ children }) {
  const { status, profile } = useAuth()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0B132B]">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 shadow-md animate-spin" style={{ animationDuration: '3s' }}>
          <Clock className="w-6 h-6 text-white" />
        </div>
      </div>
    )
  }

  if (status === 'authenticated') {
    return isSuperAdmin(profile) ? <Navigate to="/central" replace /> : <Navigate to="/" replace />
  }

  return children
}

/**
 * PublicCentralRoute — Para /central/login.
 * Si ya está autenticado y es SuperAdmin → redirige a /central.
 */
function PublicCentralRoute({ children }) {
  const { status, profile } = useAuth()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070D1E]">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 shadow-md animate-pulse">
          <Clock className="w-6 h-6 text-white" />
        </div>
      </div>
    )
  }

  if (status === 'authenticated') {
    return isSuperAdmin(profile) ? <Navigate to="/central" replace /> : <Navigate to="/" replace />
  }

  return children
}

function ClientRoute({ permission, children }) {
  return (
    <ClientTenantRoute>
      <ClientPermissionRoute permission={permission}>{children}</ClientPermissionRoute>
    </ClientTenantRoute>
  )
}

function ClientSuperAdminRoute({ permission, children }) {
  const { profile } = useAuth()
  return (
    <ClientTenantRoute>
      <ClientPermissionRoute permission={permission}>
        {isSuperAdmin(profile) ? children : <Navigate to="/biometricos" replace />}
      </ClientPermissionRoute>
    </ClientTenantRoute>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ═══════════════════════════════════════════════════════ */}
        {/* ── 1. SIGNUM-CLOCK CENTRAL (Master Platform) ───────── */}
        {/* ═══════════════════════════════════════════════════════ */}
        <Route
          path="/central/login"
          element={
            <PublicCentralRoute>
              <CentralLoginPage />
            </PublicCentralRoute>
          }
        />

        <Route
          path="/central"
          element={
            <CentralAdminRoute>
              <CentralDashboardPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/empresas"
          element={
            <CentralAdminRoute>
              <CentralTenantsPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/usuarios"
          element={
            <CentralAdminRoute>
              <CentralUsersPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/permisos"
          element={
            <CentralAdminRoute>
              <CentralPermissionsPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/dispositivos"
          element={
            <CentralAdminRoute>
              <BiometricosPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/sincronizacion"
          element={
            <CentralAdminRoute>
              <CentralSyncPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/biometricos-resumen"
          element={
            <CentralAdminRoute>
              <CentralBiometricsSummaryPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/planes"
          element={
            <CentralAdminRoute>
              <CentralTenantsPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/estadisticas"
          element={
            <CentralAdminRoute>
              <CentralDashboardPage />
            </CentralAdminRoute>
          }
        />
        <Route
          path="/central/auditoria"
          element={
            <CentralAdminRoute>
              <CentralAuditPage />
            </CentralAdminRoute>
          }
        />


        {/* ═══════════════════════════════════════════════════════ */}
        {/* ── 2. SIGNUM-CLOCK CLIENT (Tenant App) ─────────────── */}
        {/* ═══════════════════════════════════════════════════════ */}
        <Route
          path="/login"
          element={
            <PublicClientRoute>
              <ClientLoginPage />
            </PublicClientRoute>
          }
        />

        <Route
          path="/"
          element={
            <ClientRoute permission={PERMISSION.DASHBOARD}>
              <DashboardPage />
            </ClientRoute>
          }
        />
        <Route
          path="/empleados"
          element={
            <ClientRoute permission={PERMISSION.EMPLOYEES}>
              <EmpleadosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/horarios"
          element={
            <ClientRoute permission={PERMISSION.SCHEDULES}>
              <HorariosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/agenda-horarios"
          element={
            <ClientRoute permission={PERMISSION.SCHEDULE_AGENDA}>
              <AsignacionHorariosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/festivos"
          element={
            <ClientRoute permission={PERMISSION.HOLIDAYS}>
              <DiasFestivosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/checadas-manuales"
          element={
            <ClientRoute permission={PERMISSION.ATTENDANCE_MANAGE}>
              <ChecadasManualesPage />
            </ClientRoute>
          }
        />
        <Route
          path="/incidencias"
          element={
            <ClientRoute permission={PERMISSION.ATTENDANCE_MANAGE}>
              <IncidenciasPage />
            </ClientRoute>
          }
        />
        <Route
          path="/kiosko"
          element={
            <ClientRoute permission={PERMISSION.ATTENDANCE_MANAGE}>
              <KioskoChecadorPage />
            </ClientRoute>
          }
        />
        <Route
          path="/visor-asistencias"
          element={
            <ClientRoute permission={PERMISSION.ATTENDANCE}>
              <VisorAsistenciasPage />
            </ClientRoute>
          }
        />
        <Route
          path="/reporte-retardos"
          element={
            <ClientRoute permission={PERMISSION.REPORTS}>
              <ReporteRetardosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/matriz-checadas"
          element={
            <ClientRoute permission={PERMISSION.REPORTS}>
              <MatrizChecadasPage />
            </ClientRoute>
          }
        />
        <Route
          path="/historial-eventos"
          element={
            <ClientRoute permission={PERMISSION.REPORTS}>
              <HistorialEventosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/tarjeta-fichaje"
          element={
            <ClientRoute permission={PERMISSION.REPORTS}>
              <TarjetaFichajePage />
            </ClientRoute>
          }
        />
        <Route
          path="/usuarios"
          element={
            <ClientRoute permission={PERMISSION.USERS}>
              <UsersPage />
            </ClientRoute>
          }
        />
        <Route
          path="/permisos"
          element={
            <ClientRoute permission={PERMISSION.PERMISSIONS}>
              <PermissionsPage />
            </ClientRoute>
          }
        />
        {/* Reportes de Asistencia */}
        <Route
          path="/reportes"
          element={
            <ClientRoute permission={PERMISSION.REPORTS}>
              <ReportesPage />
            </ClientRoute>
          }
        />

        {/* Sincronización */}
        <Route
          path="/sincronizacion"
          element={
            <ClientRoute permission={PERMISSION.SYNCHRONIZATION}>
              <SyncPage />
            </ClientRoute>
          }
        />

        {/* Auditoría (Solo Admin) */}
        <Route
          path="/auditoria"
          element={
            <ClientAdminRoute>
              <ClientAuditPage />
            </ClientAdminRoute>
          }
        />

        {/* Gestión de Dispositivos (Solo Admin) */}
        {/* ── Rutas Módulo Biométricos ────────────────────────── */}
        <Route
          path="/biometricos"
          element={
            <ClientRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/biometricos/dashboard"
          element={
            <ClientSuperAdminRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientSuperAdminRoute>
          }
        />
        <Route
          path="/biometricos/resumen"
          element={
            <ClientRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/enrolamiento"
          element={
            <ClientRoute permission={PERMISSION.ENROLLMENT}>
              <EnrollmentPage />
            </ClientRoute>
          }
        />
        <Route
          path="/biometricos/dispositivos"
          element={
            <ClientRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/biometricos/colaboradores"
          element={
            <ClientSuperAdminRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientSuperAdminRoute>
          }
        />
        <Route
          path="/biometricos/asignaciones"
          element={
            <ClientSuperAdminRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientSuperAdminRoute>
          }
        />
        <Route
          path="/biometricos/asistencias"
          element={
            <ClientRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/biometricos/historial"
          element={
            <ClientRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientRoute>
          }
        />
        <Route
          path="/biometricos/comandos"
          element={
            <ClientSuperAdminRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientSuperAdminRoute>
          }
        />
        <Route
          path="/biometricos/sincronizacion"
          element={
            <ClientSuperAdminRoute permission={PERMISSION.BIOMETRICS}>
              <BiometricosPage />
            </ClientSuperAdminRoute>
          }
        />

        {/* ── Fallback ────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
