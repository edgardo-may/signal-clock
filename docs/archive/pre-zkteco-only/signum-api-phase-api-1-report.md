# SIGNUM API RESTRUCTURING — PHASE API-1 REPORT

Status: implemented locally, **acceptance incomplete**. Canary disabled by default.
Updated 2026-09-24. No production database connection or write was performed.

## 1. Architecture

Created an isolated TypeScript/Express package in `backend/signum-api` with auth
and tenant ports, employee repository, PostgreSQL adapter, service, controller,
routes, input validation, pagination, rate limiting and structured logging.

This location deliberately preserves the existing backend manifests: Attendance
release hashes include those files. The existing `backend/Dockerfile` belongs
to ISUP and is also preserved. The new package owns its Dockerfile and lockfile.

The audit was delivered before edits and is retained in
`docs/signum-api-current-architecture-map.md`. No empty modules or fictitious
SQL Server implementation were added.

## 2. Files Created

Source/configuration/documentation files created by this task; generated build
output, dependency folders and temporary execution logs are not source deliverables.

```text
.env.employee-api.example
compose.yaml
backend/signum-api/.dockerignore
backend/signum-api/.env.example
backend/signum-api/Dockerfile
backend/signum-api/README.md
backend/signum-api/package.json
backend/signum-api/package-lock.json
backend/signum-api/tsconfig.json
backend/signum-api/src/app.ts
backend/signum-api/src/errors.ts
backend/signum-api/src/server.ts
backend/signum-api/src/auth/AuthProvider.ts
backend/signum-api/src/auth/SupabaseAuthProvider.ts
backend/signum-api/src/auth/TenantResolver.ts
backend/signum-api/src/config/env.ts
backend/signum-api/src/controllers/EmployeeController.ts
backend/signum-api/src/db/DatabaseProvider.ts
backend/signum-api/src/db/postgres/connection.ts
backend/signum-api/src/db/postgres/PostgresTenantResolver.ts
backend/signum-api/src/db/postgres/repositories/PostgresEmployeeRepository.ts
backend/signum-api/src/domain/employees/Employee.ts
backend/signum-api/src/middleware/auth.ts
backend/signum-api/src/middleware/errorHandler.ts
backend/signum-api/src/middleware/rateLimit.ts
backend/signum-api/src/middleware/requestContext.ts
backend/signum-api/src/middleware/roles.ts
backend/signum-api/src/middleware/tenant.ts
backend/signum-api/src/middleware/validation.ts
backend/signum-api/src/repositories/EmployeeRepository.ts
backend/signum-api/src/routes/employees.routes.ts
backend/signum-api/src/services/EmployeeService.ts
backend/signum-api/src/types/RequestContext.ts
backend/signum-api/tests/api.test.cjs
backend/signum-api/tests/canary.test.cjs
backend/signum-api/tests/postgres.test.cjs
src/features/employees/services/employeeApi.js
docs/signum-api-current-architecture-map.md
docs/signum-api-phase-api-1-report.md
```

## 3. Files Modified

```text
.gitignore
src/features/employees/pages/EmpleadosPage.jsx
src/shared/hooks/useTenantLimits.js
```

`.gitignore` only gains the employee API environment-example exception from this
task. Employee UI retains prior local edits and the legacy branches.
`useTenantLimits` accepts an optional API loader; all existing callers retain the
default behavior. The parent backend manifests were restored after discovering
the runtime hash dependency and have no final diff.

## 4. Employee Flow

```text
Frontend (employeeApi.js, feature flag)
  -> HTTP /api/v1/employees
  -> Route + auth/tenant/role middleware
  -> EmployeeController
  -> EmployeeService
  -> EmployeeRepository
  -> PostgresEmployeeRepository
  -> pooled PostgreSQL transaction with authenticated role + RLS
  -> existing functions/triggers where applicable
```

Implemented list/get/create/update, explicit deactivate/reactivate and preserved
the UI's guarded lifecycle check/delete. CSV import is atomic, limited to 1000
rows and 1 MB. Capacity/count uses the API. Initial inactive creation is preserved;
PATCH rejects state changes so lifecycle cannot be bypassed through that endpoint.

List defaults to 50, permits at most 100 and rejects invalid/oversized limits.
The frontend walks bounded pages to preserve current local search/export/UI
pagination. This remains a large-directory performance limitation.

Global superadmins intentionally retain the legacy tenant-switching path. Existing
authentication and collaborator credential provisioning remain unchanged. Shared
auth/tenant providers and other modules still access Supabase directly.

## 5. Tenant Security

`AuthProvider.verifyToken` verifies with Supabase Auth. The resulting user ID is
the sole input to `TenantResolver`, which loads `usuarios_perfiles` under that
identity. It requires an active account and tenant and checks explicit employee
module denials. Browser metadata, localStorage and body/header/query tenant values
do not establish authority. Employee DTOs omit `cliente_id`.

PostgreSQL transactions use `SET LOCAL ROLE authenticated`, `row_security = on`
and transaction-local subject claims. All employee lookups/mutations also include
tenant predicates. Foreign resource lookup returns 404. Connections are pooled,
with configured timeouts; failed rollback discards the connection.

Bootstrap rejects an effective superuser/BYPASSRLS/table-owner role or disabled
employee RLS. No policy or schema was modified. Installed RLS remains the final
authority for role rules, including any installed hardening from script 101.
The deployment of that script and live two-tenant behavior are not yet verified.

## 6. Database Independence

Domain, service and repository interfaces import no database driver, Supabase SDK
or Express. PostgreSQL-specific SQL and lifecycle RPC calls stay in the adapter;
the auth SDK is confined to `SupabaseAuthProvider`.

SQL Server requires an employee adapter, identity/profile resolver, connection
strategy and equivalent transactional lifecycle/security behavior. Select these
once in `DatabaseProvider`; controllers/services and HTTP contracts remain stable.
`DB_PROVIDER=sqlserver` currently fails explicitly during bootstrap.

The current lifecycle remains intentionally PostgreSQL-dependent behind the port.
An interface alone does not establish behavioral portability of SQL/RLS/triggers.

## 7. Docker

| Verification | Result |
| --- | --- |
| Multi-stage Dockerfile, non-root, production runtime, healthcheck | Created |
| Compose service | Created, requires environment variables |
| `docker build -t signum-api:local backend/signum-api` | BLOCKED: executable unavailable |
| `docker compose config --quiet` | BLOCKED: executable unavailable |
| `docker compose up -d signum-api` | BLOCKED: executable unavailable |
| Container health | NOT EXECUTED |
| Local HTTP app health | PASS through an actual ephemeral listener in tests |
| Full production-composition startup against PostgreSQL | PENDING isolated test configuration |

No PostgreSQL server executable was found; a PostgreSQL data directory alone is
not a runnable test server. No Supabase production replacement was attempted.

## 8. Tests

| Suite | Total | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: | ---: |
| New API/adapter/canary tests | 72 | 72 | 0 | 0 |
| Existing `tests/compliance/*.test.js` | 642 | 572 | 31 | 39 |
| Total | 714 | 644 | 31 | 39 |

Commands executed:

```text
npm test --prefix backend/signum-api
node --test tests/compliance/*.test.js
npm run build
VITE_USE_EMPLOYEE_API=true npm run build
git diff --check
```

Backend TypeScript build: PASS. Frontend build: PASS with flag off and on. Vite
reports a large bundle warning. The new package install audit reported zero
vulnerabilities at installation time.

New tests prove HTTP flow, auth error handling, tenant-A/B repository boundaries,
404 behavior, input allowlists, pagination, auditor write denial, lifecycle
delegation, transaction cleanup, atomic import and canary payload filtering.
The database and auth I/O use test doubles; these are not live RLS or device tests.

The 31 historical failures concern:

- Three employee device-removal source assertions against existing SQL/gateway.
- Two orchestrator persistence expectation tests.
- Twelve production-shadow fixture/context tests.
- Twelve sanitized trace fixture/context tests.
- One existing runtime release-hash expectation.
- One toast-singleton assertion finding an extra Toaster in Schedules.

These tests' relevant existing module sources were not changed by this task.
The full suite still fails after restoring the parent manifests. DBREAL tests
remain skipped without isolated configuration. They were not redirected to production.

Global `git diff --check`: FAIL on pre-existing whitespace in Attendance,
authService, Reports and Schedules. Scoped check for this task's modified files:
PASS. New files were separately checked for trailing whitespace: PASS.

Temporary local logs: `.tmp/signum-api-tests.log` and
`.tmp/api-regression-final.log` (not committed deliverables).

### Performance baseline

Local HTTP -> controller -> service -> real adapter, **simulated PostgreSQL I/O**:
20 requests, one returned employee, 13 driver queries per request including
identity lookup and transaction/setup commands; recorded server duration p50
0 ms and p95 1 ms (rounded). These figures exclude real network/database latency
and are a logging/overhead baseline, not a production performance claim.

Real database response-time baseline remains pending. Runtime logs expose
queryCount, rowsReturned, normalized endpoint, tenant and duration; slow queries
and HTTP 500 responses are detectable without logging JWTs, PINs, passwords,
service keys or biometric payloads.

## 9. Production Changes

```text
PRODUCTION DB WRITES: NO
```

No production database connection, migration, schema/RLS change or deployment.
No service-role key was added to the API or frontend. No runtime environment file
was modified to enable the canary.

## 10. Existing Modules

Relative to the working tree at the start of this task:

```text
Attendance Engine: UNCHANGED
Workday: UNCHANGED
Schedules: UNCHANGED
ZKTeco: UNCHANGED
DB schema: UNCHANGED
```

The shared tenant-limit hook has a backward-compatible optional loader for the
employee canary. Existing callers are unchanged. Workday extraction is only a
proposal in the audit document; no code moved.

## 11. Safety Verdict

Pending gates: isolated PostgreSQL/RLS/role/lifecycle integration; complete server
startup against that database; Docker build/start/health; resolution of historical
regression failures and global whitespace findings. The user indicated a test
configuration exists; its location was requested and was not yet supplied when
this report was written.

```text
EMPLOYEE API CANARY READY: NO
SAFE TO MIGRATE NEXT MODULE: NO
SAFE TO REMOVE SUPABASE DIRECT ACCESS: NO
```
