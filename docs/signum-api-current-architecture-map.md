# CURRENT ARCHITECTURE MAP

Audit delivered before edits on 2026-09-23; implementation continued 2026-09-24.
Scope: local source and existing contract documents. No production connection or
catalog verification was performed. The working tree already contained extensive
changes, including employee UI, SQL scripts, auth and tests.

| Area | Location | Direct coupling |
| --- | --- | --- |
| Frontend | `src/app`, `src/features`, `src/central`, `src/client` | React pages/hooks call tables, RPC, Auth and Realtime via `src/lib/supabase.js` |
| Backend | Existing ISUP, integration/sync, attendance runtimes, dispatcher | Express and injected/direct Supabase clients; no general employee HTTP API |
| Supabase | `src/lib/supabase.js`, `supabase/functions`, migrations | Auth, PostgREST, RLS, PostgreSQL functions, triggers, Realtime |
| Auth | `src/app/providers/AuthProvider.jsx`, `src/features/auth/services/authService.js` | Supabase session, `usuarios_perfiles`, module overrides and tenant modules |
| Tenant | `src/shared/providers/TenantProvider.jsx`, `src/shared/hooks/useCurrentTenant.js` | Profile then app/user metadata fallbacks; global admin chooses localStorage tenant |
| Employee | `src/features/employees/pages/EmpleadosPage.jsx` | Direct list, insert, update, CSV import; lifecycle RPC; credential Edge Function |
| Attendance | `src/domain/attendance`, `backend/services/attendance/AttendanceEngineOrchestrator.js` | Domain engine plus adapters/runtime orchestration; unchanged |
| Workday | `backend/services/attendance/WorkdayPersistenceService.js` | `upsert_workday_record`, persistence outcome/version/hash contracts |
| ZKTeco | `zkteco-push-ta` | Separate ADMS gateway, Supabase repository and device command processing |

## Supabase entry points and consumers

The browser SDK is instantiated in `src/lib/supabase.js`. Its shared proxy also
handles rate-limit errors on PostgREST and RPC responses. Consumers include:

- Attendance: ChecadasManuales, HistorialEventos, Incidencias, KioskoChecador,
  MatrizChecadas, ReporteDescansos, ReporteRetardos, TarjetaFichaje, VisorAsistencias.
- Employees: EmpleadosPage and BiometricFaceEnrollment.
- Biometrics: DeviceDetailModal, useBiometrics, useFingerEnrollment, EnrollmentPage,
  biometricsService, enrollmentService, syncService.
- Schedules: AsignacionHorarios, DiasFestivos, Horarios, scheduleLifecycleService.
- Dashboard, reports, collaborator dashboard, sync, tenants and users pages.
- Permissions: CentralTenantModulesManager and ModulePermissionsManager.
- Central: attendance policy service, company detail, dashboard, login, sync,
  tenants and users pages; client login and password reset.
- Shared: auth provider, TenantProvider, useCurrentTenant, useTenantLimits,
  AuditView, Header and Sidebar.

Backend SDK imports occur in the existing receptor/sync files,
`backend/api-integracion`, attendance runtime bootstraps, persistence dispatcher,
and rollout/audit scripts. ZKTeco creates its client in `src/supabase.ts` within
its own directory. The `create-user` Edge Function imports the SDK separately.

## Authentication, tenant and roles

Auth verifies credentials with Supabase, loads `usuarios_perfiles` and checks
account/company suspension. React stores session/profile and loads
`user_module_permissions` plus `cliente_modulos`. Frontend defaults and guards
live in `src/shared/auth/permissions.js` and client/central guards; local role
module overrides also exist. They must not become API authorization authorities.

Current browser tenant fallback includes editable user metadata. Global admin
selection is an intentional UI feature, not proof of tenant membership. The new
canary must resolve tenant from the verified user's authoritative profile.

Migration 031 defines profile-backed `auth_current_role`,
`auth_current_cliente_id`, `auth_can_read_tenant`, `auth_can_write_tenant` and RLS.
It denies auditor mutations. Script 101 proposes admin/RH writes,
supervisor/auditor reads and collaborator own-record reads. It is explicitly
marked prepared for review; local presence and static tests do not establish
which version is installed. Preserve installed RLS and verify the matrix in the
isolated target before activation.

## Employee behavior and PostgreSQL dependencies

The page owns CRUD, CSV parsing/import/export, employee plan limits and lifecycle
confirmation dialogs. Its direct update deliberately omits `activo`; initial
creation can be active or inactive. When a collaborator code and sufficiently
long PIN exist, it also requests credential provisioning through `create-user`.

The active UI calls `fn_employee_lifecycle` with `CHECK`, `DEACTIVATE`, `ACTIVATE`
and `DELETE`. `fn_delete_employee_safe` (037) is an earlier deletion contract:
it checks current/future shifts, attendance, incidents and device assignments;
it supports simulation and only deletes when dependency checks pass. A defensive
deletion trigger also protects history.

Lifecycle 038/050 and the proposed 101 must not be conflated:

- Active/future `empleados_horarios` block deactivation.
- History in `registro_asistencia` and `incidencias` is preserved.
- Deactivation changes `empleados.activo`; 050's lifecycle trigger suspends
  tenant-owned active assignments with reason `EMPLOYEE_DEACTIVATED`.
- The assignment producer queues canonical device commands and sets `PENDING`.
- Reactivation restores only assignments suspended by employee deactivation;
  `MANUAL_UNASSIGN` is not restored. Pending offline desired-state commands are
  superseded without deleting command history.
- `biometric_templates` survive logical deactivation. The lifecycle response
  explicitly reports `RE_ENROLLMENT_REQUIRED`; physical reenrollment behavior
  is not proven by retaining stored templates.
- Guarded physical deletion remains a separate existing action.
- Existing tenant-limit, biometric-ID uniqueness/allocation and audit triggers
  remain responsible for their constraints; the API must not replace them.

## Existing tests and reusable backend pieces

`tests/compliance/employee-module-matrix.test.js` covers employee contracts through
source/SQL assertions. `employee-deactivation-device-removal.test.js` checks
assignment lifecycle, command safety, history/template preservation and UI RPC
delegation. DBREAL helpers contain isolated database fixtures but require explicit
test configuration; source assertions alone do not prove live RLS.

Reuse the Express app-factory/dependency-injection approach and existing lifecycle
RPC. Keep internal attendance tokens and persistence service-role clients out of
the public employee API. Existing runtime release hashes include the parent
backend manifests, so the new API needs a separate package and lockfile.

## Later Workday extraction proposal

Keep the engine in place. First characterize the orchestrator-to-persistence
contract: workday identity, schedule/revision versions, integrity hashes,
`INSERTED/UPDATED/UNCHANGED/STALE` outcomes, transaction/history behavior and
idempotency. Then introduce a port around the current `upsert_workday_record`
adapter and prove parity with shadow fixtures and DBREAL, without moving or
changing calculations. Only after that consider moving orchestration behind an
internal API. The historical frontend WorkdayPersistenceService is a fail-closed
server-only guard, not the persistence implementation to migrate.

No Workday, attendance-domain or ZKTeco extraction is part of this phase.
