# Signum Clock — arquitectura actual

## Vista resumida

Signum Clock es una aplicación web multiempresa con frontend React/Vite, datos y autorización tenant-scoped en Supabase/PostgreSQL, integraciones backend separadas y procesamiento de asistencia aislado del navegador. El gateway físico ZKTeco ADMS vive en el repositorio independiente `zkteco-push-ta`; este repositorio conserva el frontend biométrico y los contratos de datos/servicios que consume.

```text
Browser
  ├─ React/Vite: src/app, src/features, src/central
  ├─ Employee UI ── same-origin /api/employee (Vercel Function)
  │                    └─ backend/employee-portal/http.mjs
  │                         └─ Supabase RPC fn_employee_portal
  └─ /api/sync/* ── Vercel rewrite ── backend/api-integracion (Consolide)

ZKTeco devices ── ADMS gateway (external repo: zkteco-push-ta)
                         └─ canonical device/event contracts in Supabase

backend/signum-api ── employee API service/package (separate deployment unit)
backend/attendance-runtime-v3 ── internal runtime service
backend/attendance-persist-dispatcher ── separate persistence dispatcher
backend/services/attendance ── Attendance/Workday orchestration and contracts
```

## Tenancy and authorization

`public` is the application schema; tenant identity and access are enforced by PostgreSQL grants, RLS policies, and server-side authorization paths. Central/superadmin and tenant roles are represented in the existing profile/authorization model. Exact role-policy behavior must be sourced from the current SQL catalog and reviewed migrations; this overview does not replace that contract.

## Attendance and devices

The current repository stack documents `public.devices` as the canonical device catalog and `device_employee_assignments.biometric_user_id` as the authoritative physical biometric assignment. ZKTeco ADMS is the active device integration. Attendance calculation and Workday persistence are separate concerns: domain/service logic is under `backend/services/attendance`, runtime hosting under `backend/attendance-runtime-v3`, and persistence dispatch under `backend/attendance-persist-dispatcher`.

## Employee status and target

The Employee Vercel Function is stateless and delegates to the shared HTTP handler. The handler requires server-side `SUPABASE_SECRET_KEY`; sessions are designed to persist in `employee_private.sessions`. The operator reports the production RPC `public.fn_employee_portal` absent, so Employee API/UI are documented as **BLOQUEADO / mantenimiento**. The target Employee SQL contract is **PENDIENTE** and must not be inferred to exist from source code.

## Separate deployment units

The root Vercel project serves the frontend and `/api/employee`; its `vercel.json` rewrites `/api/sync/*` to the Consolide integration deployment. `backend/api-integracion`, `backend/signum-api`, the Attendance Runtime and the dispatcher have separate manifests/build inputs. Do not assume that promoting the root frontend deploys those independent services.

## Future state

Employee authentication and WEB_CLOCK depend on their approved database contract. WEB_CLOCK remains OFF per operator report. Runtime/dispatcher persistence activation and ZKTeco gateway operations are separate operational gates; this document does not authorize them.

See [module index](docs/04-modules/module-status.md), [deployment notes](docs/07-deployment/README.md), and [database notes](docs/03-database/README.md).
