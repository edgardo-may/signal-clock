# Signum API employee canary

This package coexists with the existing backend. Its manifest and lockfile are
independent because Attendance runtime hashes include `backend/package.json`
and `backend/package-lock.json`. Do not merge these dependency manifests.

## Local use

Requires Node >=22.6 and a PostgreSQL connection to an existing compatible schema.
The bootstrap performs a read-only RLS check before listening. Health does not
query the database once the server is listening.

```sh
npm ci --prefix backend/signum-api
npm run build --prefix backend/signum-api
node --env-file=backend/signum-api/.env backend/signum-api/dist/server.js
```

Alternatively, from the package directory:

```sh
cd backend/signum-api
node --env-file=.env dist/server.js
```

Copy `.env.example` to `.env` and supply the values locally; never commit secrets.
Alternatively export the variables and run `npm start` in this directory.
`DATABASE_URL` must allow `SET LOCAL ROLE authenticated`. Prefer a dedicated
restricted login granted that role; do not disable RLS or grant BYPASSRLS to it.
The runtime checks that the effective role is neither superuser, BYPASSRLS nor
the employee table owner, and that employee RLS is enabled.

No schema installation/migration is performed by the application. An empty
PostgreSQL database is insufficient: the current profile, employee, authorization
and lifecycle contracts must exist. SQL Server intentionally fails at bootstrap.

## Docker

From the repository root, with variables exported or in a root `.env`:

```sh
docker build -t signum-api:local backend/signum-api
docker compose up --build -d
curl http://localhost:3001/api/v1/health
```

Compose contains only `signum-api`; it does not replace or initialize production
Supabase. A local database, if used, must be provisioned separately. The image
uses a multistage build, production dependencies, a non-root runtime and healthcheck.
Only source, configuration and manifests enter the build context. Secrets, tests,
existing gateways and runtimes are excluded.

## Authentication and authorization

Send `Authorization: Bearer <existing Supabase access token>`.
`AuthProvider` verifies the token using Supabase `getUser`. `TenantResolver` reads
`usuarios_perfiles` for that verified user under PostgreSQL `authenticated`.
It requires an active profile with a tenant, and respects explicit module denials.
It does not use `user_metadata`, browser-selected tenants or roles from the body.

Each repository operation starts a pooled transaction, sets a local authenticated
role and local subject claims, and includes an explicit tenant predicate. Commit
or rollback clears the local identity before releasing the connection. Failed
rollback discards the connection. Responses to foreign employee IDs are 404.

The historical 031 policy denies auditor writes; the middleware mirrors that
rule and installed RLS/RPC remains authoritative for additional role restrictions.
Script 101 describes a stricter matrix but is marked as prepared for review.
Its deployment must be established against the target database before rollout.
No policies are installed or relaxed by this package.

Global superadmins remain on the legacy frontend path; the API rejects global
superadmin context. Future delegated tenant selection needs a server-authorized
contract and is outside this canary.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/health` | Public `{ "status": "ok" }`, no request-time DB query |
| GET | `/api/v1/employees` | Default limit 50, max 100; offset 0..1000000 |
| GET | `/api/v1/employees/capacity` | Tenant employee count and plan information |
| GET | `/api/v1/employees/:id` | Employee or 404 |
| POST | `/api/v1/employees` | Create, including optional initial `activo` |
| PATCH | `/api/v1/employees/:id` | Administrative fields; rejects `activo` and tenant |
| POST | `/api/v1/employees/import` | `{ employees: [...] }`, 1..1000 rows, one transaction |
| POST | `/api/v1/employees/:id/lifecycle-check` | Existing RPC `CHECK` |
| POST | `/api/v1/employees/:id/deactivate` | Existing RPC `DEACTIVATE` |
| POST | `/api/v1/employees/:id/reactivate` | Existing RPC `ACTIVATE` |
| DELETE | `/api/v1/employees/:id` | Existing RPC `DELETE`, preserving legacy guarded delete |

List response: `{ data, limit, offset, hasMore }`. Employee DTOs omit `cliente_id`.
Import is bounded by 1000 rows and a 1 MB HTTP body; it is all-or-nothing. These
are explicit new transport limits, not silent partial imports. Lifecycle errors
return 409; validation 400; unauthenticated 401; denied 403; rate limiting 429.
Database details, PINs and JWTs are not logged or returned in errors.

## Canary

The repository-root `.env.employee-api.example` documents:

```env
VITE_USE_EMPLOYEE_API=false
VITE_SIGNUM_API_URL=http://localhost:3001
```

Set the flag to `true` and rebuild to opt tenant users in. Set it to `false` and
rebuild to roll back. The API path never silently retries a failed write through
Supabase. It filters outgoing input fields and sends no tenant selector.

Directory search, export and UI pagination remain local during the canary; the
client fetches sequential pages of at most 100 records. This preserves complete
directory behavior but is not an optimization for very large directories.
Capacity uses the API via an optional loader in `useTenantLimits`; callers in
other modules retain their existing behavior.

Existing login/session handling and collaborator credential provisioning through
the existing Edge Function remain unchanged. Shared tenant/auth providers and
other modules still use Supabase. The feature flag does not remove those accesses.

## Tests and operational metrics

```sh
npm test --prefix backend/signum-api
node --test tests/compliance/*.test.js
```

The new suite uses an actual ephemeral HTTP listener and injected repositories;
adapter tests simulate PostgreSQL I/O. It does **not** prove live RLS or physical
device effects. Do not point tests at production. Live database validation is a
separate acceptance gate requiring an explicitly isolated test configuration.

JSON request logs include request ID, normalized endpoint, status, tenant,
durationMs, queryCount and rowsReturned. Queries taking >=500ms emit a sanitized
slow-query record. Query counts include transaction/setup commands and exclude
SQL executed internally by triggers/RPC. Rate limiting is process-local and
defaults to 120 requests per IP per minute. `RateLimitStore` and the key function
allow future user/tenant/endpoint keys. Proxy trust is disabled; a deployment
behind a proxy must explicitly configure trusted infrastructure before rollout.
