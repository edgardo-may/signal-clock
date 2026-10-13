# CURRENT STACK CLEANUP REPORT

Checkout exclusivo: C:/Users/Edgar/signal-clock.
Rama: main. HEAD conservado: 95718495fbbb93f9b736d5e835320e6214f4a0a5.
No commit/push/deploy/producción.
Archivos versionados: 682 → 629; eliminados 61, movidos 15, modificados 28, nuevos 8. Archivos nuevos visibles en diff mediante
intent-to-add; no contenido staged para un commit.

## CURRENT_IMPLEMENTATIONS

KEEP: src/features/biometrics, api/employee.js, backend/employee-portal,
backend/api-integracion, backend/signum-api, backend/services/attendance,
backend/attendance-runtime-v3, backend/attendance-persist-dispatcher.
Gateway físico externo zkteco-push-ta no se modifica ni incorpora.
El runtime vigente se demuestra como implementación de código por capacidades,
Dockerfile, imports y tests; esto no modifica ni certifica el despliegue productivo.

## REMOVED_LEGACY

Se retiraron receptor raíz dual, sync raíz duplicado, utilidad de emails,
su suite exclusiva, SDK/binarios proveedor, runtime v1/v2 y snapshots locales.
Los backends canónicos de Consolide y API de empleados conservan sus tests.
backend/package.json/lock se mantienen: Express/Supabase en producción;
dotenv sólo dev para los tres CLI existentes; cors/object-assign se retiran.
Versiones restantes del lockfile: sin cambios. npm audit --omit=dev: cero.

## REMOVED_HIKVISION

Formularios y service de solicitudes emiten exclusivamente ZKTECO_ADMS.
Se retiran marca como decisión de protocolo y clave del protocolo retirado.
Lecturas de catálogo/límites/historial migran a devices con name/serial_number.
La eliminación usa sólo fn_delete_device_superadmin: sin fallback HTTP ni DML
directo de checadas/templates/asignaciones. Fallos de RPC fallan cerrado.
Se retira el atajo PING del socket antiguo: el gateway externo inspeccionado no
implementa ese alias. No se inventan comandos o traducciones nuevas.

## HISTORICAL_REFERENCES_RETAINED

El grep solicitado se clasifica por archivo en current-stack-cleanup-inventory.json.
Migraciones históricas permanecen intactas; el archivo documental conserva bytes.
Las tres menciones de ISUP en dos archivos de tipos/comentarios del motor son
compatibilidad de evidencia histórica, sin productor/listener/selector activo.
Se preservan por la prohibición de cambiar Attendance Engine. Tests negativos
y precheck nuevo nombran campos retirados para detectarlos/rechazarlos; los
lockfiles tienen coincidencias de base64 que no son soporte de protocolo.
CLAUDE.MD y el contrato DB conservan advertencias/documentación, no implementación.

## DATABASE_PROPOSAL_CREATED

- database/live-schema/proposals/125_retire_hikvision_zkteco_only_precheck.sql
- database/live-schema/proposals/125_retire_hikvision_zkteco_only.sql

NO EJECUTADA, tampoco en DBREAL. Instalación esperada: cero filas de negocio.
Firma productiva conocida: request_device_registration con 7 parámetros,
no los 8 del archivo histórico117. Se fijan fingerprints del catálogo entregado.
La propuesta bloquea drift, sobrecargas, solicitudes legacy y datos por preservar;
no convierte ni borra nada. Sustituye ramas activas, límites y sincronización
que aún dependían del catálogo viejo; limita identidad/asignación a su empresa
y preserva terminales privados WEB_CLOCK. No DROP de tablas/columnas.
La nueva sincronización requiere ensayo/revisión DBREAL independiente antes de
autorizar esta propuesta; sus tests actuales sólo revisan contrato estático.
SQL029/117/124 y los cuatro SQL aprobados permanecen byte-idénticos.

## TEST_RESULTS

Hay solapamiento entre suites; estos conteos no son una suma de tests únicos.

| Suite | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Employee release / DBREAL | 235 | 0 | 0 |
| npm test root | 37 | 0 | 0 |
| runtime v3 host/persist + dispatcher | 37 | 0 | 0 |
| api-integracion | 11 | 0 | 0 |
| signum-api | 72 | 0 | 0 |
| historical SQL guards phases73-75 | 10 | 0 | 0 |
| new cleanup contracts | 10 | 0 | 0 |

DBREAL localhost54322: 59 tablas public/employee_private/auth.
Hash de datos antes/después: 49c295764331c8314e3b291e70b418f006d742f51d418bc3e38d9d2cc33d2e27.
Hash de catálogo antes/después: 03d2120ec97834803490737d605dab7eff2462a7c014bb1d708edcde7a6c702e.
DATA RESTORED = YES. CATALOG RESTORED = YES. Ninguna tabla cambió.
Motor/domain, servicios Workday, runtimev3/dispatcher y Employee: diff vacío.
El host viejo tenía 18 casos; 20 casos del hostv3 cubren HTTP, auth, read-only,
readiness, aislamiento, dedup y revisiones. Se retira sólo funcionalidad de
SHADOW/probes/hash/graceful-shutdown propia de v1/v2. Cuatro tests exclusivos
de releases viejos en fases73–75 se retiran; sus 10 tests SQL/seguridad permanecen.
Los tres failures baseline normalizeEmpleado no se corrigen: se retira el módulo
de sync completo por supersesión, no para ocultar una regresión.

## BUILD_RESULT / GIT_DIFF_CHECK

Frontend build: PASS (advertencia de chunk grande preexistente).
Signum API TypeScript build: PASS. git diff --check: PASS.
Vercel Function entrypoint preservado y delegado al handler común: tests PASS.
No se realizó deploy ni reconocimiento nuevo de plataforma Vercel.

## REMAINING_RISKS

1. Liberar frontend y propuesta125 coordinadamente, con nueva revisión/ensayo
   DBREAL del SQL. No está autorizada ni aplicada en ninguna DB.
2. No reutilizar imagen runtime congelada como si coincidiera con este source:
   los manifests compartidos cambiaron, aunque el runtime/calculador no cambió.
3. Los sentinels locales de probes históricos estaban en snapshots retirados
   por aprobación explícita. No ejecutar esos probes sin nueva revisión y
   autorización operativa. No se ejecutó dispatcher, persist, canary ni GCP.
4. Referencias documentales archivadas y tipos históricos no son soporte activo.

PACKAGE LOCK SHA256 (backend): d85a5c04c70ed7a2ce872435edfa9fa81c0fe053778d9f0dffd6e9e31b7d8d8b.
RUNTIME SOURCE HASH: 9798f7a4e6261e0fdd0bad52617c847b5230a86cb9e6c34bcbdf368c8878779b.
SAFE_TO_COMMIT = YES (limpieza local y propuesta SIN ejecutar).
SAFE_TO_DEPLOY/APPLY_DATABASE = NO. PRODUCTION_CHANGES = 0.

## FILES_CHANGED

- `backend/package-lock.json`
- `backend/package.json`
- `backend/scripts/generate-persist-canary-revision-shadow-manifest.js`
- `docs/CURRENT_STATE.md`
- `docs/compliance-mexico-2027/02-attendance-engine.md`
- `index.html`
- `scripts/validate-device-security-local.mjs`
- `src/central/pages/CentralDashboardPage.jsx`
- `src/central/pages/CentralTenantsPage.jsx`
- `src/central/pages/company-detail/CompanyDetailPage.jsx`
- `src/features/attendance/pages/ChecadasManualesPage.jsx`
- `src/features/attendance/pages/HistorialEventosPage.jsx`
- `src/features/biometrics/components/DeviceDetailModal.jsx`
- `src/features/biometrics/components/DeviceFormModal.jsx`
- `src/features/biometrics/components/DeviceRegistrationRequests.jsx`
- `src/features/biometrics/components/SendCommandModal.jsx`
- `src/features/biometrics/hooks/useFingerEnrollment.js`
- `src/features/biometrics/services/biometricsService.js`
- `src/features/biometrics/services/deviceRegistrationService.js`
- `src/features/biometrics/services/enrollmentService.js`
- `src/features/dashboard/components/DashboardPreview.jsx`
- `src/features/tenants/pages/EmpresasPage.jsx`
- `src/shared/components/Layout/Sidebar.jsx`
- `src/shared/hooks/useTenantLimits.js`
- `src/shared/providers/TenantProvider.jsx`
- `tests/compliance/phase-73-revision-resolver-active-readiness.test.js`
- `tests/compliance/phase-74-runtime-live-evidence.test.js`
- `tests/compliance/phase-75-final-active-readiness.test.js`

## FILES_ADDED

- `docs/current-stack-cleanup-report.md`
- `docs/current-stack-cleanup-inventory.json`
- `database/live-schema/proposals/125_retire_hikvision_zkteco_only.sql`
- `database/live-schema/proposals/125_retire_hikvision_zkteco_only_precheck.sql`
- `docs/archive/pre-zkteco-only/README.md`
- `docs/current-stack-zkteco.md`
- `tests/compliance/attendance-runtime-v3-host.test.js`
- `tests/compliance/zkteco-only-cleanup.test.js`

## FILES_DELETED

- `.runtime-evidence/vercel-audit-1eba261/source/backend/api-integracion/consolide-client.js`
- `.runtime-evidence/vercel-audit-1eba261/source/backend/api-integracion/employee-sync-service.js`
- `.runtime-evidence/vercel-audit-1eba261/source/backend/api-integracion/server.js`
- `backend/Dockerfile`
- `backend/attendance-runtime/.env.example`
- `backend/attendance-runtime/AttendanceRuntimeService.js`
- `backend/attendance-runtime/Dockerfile`
- `backend/attendance-runtime/Dockerfile.dockerignore`
- `backend/attendance-runtime/active-readiness-runtime-check.js`
- `backend/attendance-runtime/app.js`
- `backend/attendance-runtime/cloud-shell-active-runtime-live-check.sh`
- `backend/attendance-runtime/cloud-shell-build-only.sh`
- `backend/attendance-runtime/cloud-shell-runtime-live-evidence.sh`
- `backend/attendance-runtime/cloudbuild-build-only.yaml`
- `backend/attendance-runtime/config.js`
- `backend/attendance-runtime/package.json`
- `backend/attendance-runtime/postdeploy-readonly-check.js`
- `backend/attendance-runtime/readOnlySupabase.js`
- `backend/attendance-runtime/server.js`
- `backend/attendance-runtime/tenantFeature.js`
- `backend/attendance-runtime/verify-package-closure.js`
- `backend/consolide-client.js`
- `backend/employee-sync-service.js`
- `backend/isup_sdk/inc/AudioIntercom.h`
- `backend/isup_sdk/inc/HCEHomeAlarm.h`
- `backend/isup_sdk/inc/HCEHomeCMS.h`
- `backend/isup_sdk/inc/HCEHomePSS.h`
- `backend/isup_sdk/inc/HCEHomePublic.h`
- `backend/isup_sdk/inc/HCEHomeStream.h`
- `backend/isup_sdk/lib/AudioIntercom.dll`
- `backend/isup_sdk/lib/AudioIntercom.lib`
- `backend/isup_sdk/lib/AudioRender.dll`
- `backend/isup_sdk/lib/EHomeDemo.xml`
- `backend/isup_sdk/lib/HCAapSDKCom/OpenAL32.dll`
- `backend/isup_sdk/lib/HCAapSDKCom/SystemTransform.dll`
- `backend/isup_sdk/lib/HCAapSDKCom/libiconv2.dll`
- `backend/isup_sdk/lib/HCAapSDKCom/msvcr90.dll`
- `backend/isup_sdk/lib/HCEHomeAlarm.dll`
- `backend/isup_sdk/lib/HCEHomeAlarm.lib`
- `backend/isup_sdk/lib/HCEHomeCMS.dll`
- `backend/isup_sdk/lib/HCEHomeCMS.lib`
- `backend/isup_sdk/lib/HCEHomePSS.dll`
- `backend/isup_sdk/lib/HCEHomePSS.lib`
- `backend/isup_sdk/lib/HCEHomeStream.dll`
- `backend/isup_sdk/lib/HCEHomeStream.lib`
- `backend/isup_sdk/lib/HCNetUtils.dll`
- `backend/isup_sdk/lib/HCNetUtils.lib`
- `backend/isup_sdk/lib/OpenAL32.dll`
- `backend/isup_sdk/lib/PlayCtrl.dll`
- `backend/isup_sdk/lib/PlayCtrl.lib`
- `backend/isup_sdk/lib/SuperRender.dll`
- `backend/isup_sdk/lib/d3dx9_43.dll`
- `backend/isup_sdk/lib/msvcr90.dll`
- `backend/isup_sdk/lib/sqlite3.dll`
- `backend/isup_sdk/lib/sqlite3.lib`
- `backend/migrate-emails.js`
- `backend/server.js`
- `backend/sync-server.js`
- `backend/sync.test.js`
- `ehome_docs`
- `tests/compliance/attendance-runtime-host.test.js`

## FILES_MOVED

- `docs/attendance-runtime-v2-active-rollout.md → docs/archive/pre-zkteco-only/attendance-runtime-v2-active-rollout.md`
- `docs/compliance-mexico-2027-audit.md → docs/archive/pre-zkteco-only/compliance-mexico-2027-audit.md`
- `docs/compliance-mexico-2027/01-architecture.md → docs/archive/pre-zkteco-only/compliance-mexico-2027/01-architecture.md`
- `docs/compliance-mexico-2027/11-security.md → docs/archive/pre-zkteco-only/compliance-mexico-2027/11-security.md`
- `docs/compliance-mexico-2027/phase-1-hardening.md → docs/archive/pre-zkteco-only/compliance-mexico-2027/phase-1-hardening.md`
- `docs/compliance-mexico-2027/phase-1-validation.md → docs/archive/pre-zkteco-only/compliance-mexico-2027/phase-1-validation.md`
- `docs/compliance-mexico-2027/phase-2-independent-validation.md → docs/archive/pre-zkteco-only/compliance-mexico-2027/phase-2-independent-validation.md`
- `docs/compliance-mexico-2027/phase-2-workday-records.md → docs/archive/pre-zkteco-only/compliance-mexico-2027/phase-2-workday-records.md`
- `docs/phase-26-engine-integration-contract.md → docs/archive/pre-zkteco-only/phase-26-engine-integration-contract.md`
- `docs/phase-31-local-shadow-canary.md → docs/archive/pre-zkteco-only/phase-31-local-shadow-canary.md`
- `docs/phase-59-revision-resolver-activation-gate.md → docs/archive/pre-zkteco-only/phase-59-revision-resolver-activation-gate.md`
- `docs/phase-60-attendance-runtime-host.md → docs/archive/pre-zkteco-only/phase-60-attendance-runtime-host.md`
- `docs/phase-61-attendance-runtime-container-gate.md → docs/archive/pre-zkteco-only/phase-61-attendance-runtime-container-gate.md`
- `docs/signum-api-current-architecture-map.md → docs/archive/pre-zkteco-only/signum-api-current-architecture-map.md`
- `docs/signum-api-phase-api-1-report.md → docs/archive/pre-zkteco-only/signum-api-phase-api-1-report.md`
