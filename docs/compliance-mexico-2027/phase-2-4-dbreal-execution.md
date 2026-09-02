# Phase 2.4 DBREAL Completion & Execution

## Verdict

**PHASE 2.4 IMPLEMENTATION: PASS**

**READY FOR DBREAL EXECUTION: NO**

The harness and guarded execution path are implemented, but this workspace has no isolated PostgreSQL/Supabase credentials and no known-good schema from which to generate the required baseline. No production system was contacted. This is not Phase 2 final validation and does not authorize Phase 3.

## DB environment

No DBREAL environment was configured or contacted. `.env.test.local` is ignored by Git (`.gitignore` rule `.env.*`); it is absent from the repository. The execution gate requires all of the following without printing their values:

- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_ANON_KEY`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `PHASE2_AUDIT_DATABASE_URL`
- `PHASE2_AUDIT_DB_LABEL=local|test|staging`
- `ALLOW_DESTRUCTIVE_TEST_DB=true`

`PHASE2_PRODUCTION_HOST` may additionally identify the known production host. Every DBREAL, bootstrap, generator, and catalog command rejects a production-like or production-matching host.

Run `npm run test:dbreal:preflight` before mutation. It reports only `configured`/`missing`, REST reachability, PostgreSQL version, database name, and RPC grant booleans. It does not mutate data or print secrets.

## Baseline and historical migration route

Historical migrations are unchanged. `029` created canonical `attendance_logs(numero_serie, biometric_user_id, timestamp)` while `041` expects `device_serial,user_id`, with no repository rename in between. The historical-chain tool is therefore explicitly diagnostic evidence, not the fresh-install route: `npm run db:migrations:historical-diagnostic`.

The supported fresh route is:

1. From an isolated known-good TEST/STAGING schema, set `PHASE2_BASELINE_GENERATED_DATE=YYYY-MM-DD` and run `npm run db:baseline:generate`.
2. Review the generated `supabase/baseline/000_current_schema_baseline.sql`; it is `pg_dump --schema-only --no-owner --no-privileges` plus fixed metadata `SIGNUM_SCHEMA_BASELINE_2026_09`, schema revision `047`, and reviewed date.
3. The generator rejects data in `clientes`, `empleados`, `attendance_logs`, `biometric_templates`, or `auth.users`, and secret-like assignments.
4. Bootstrap an empty guarded DB with `npm run db:baseline:bootstrap`, which applies the baseline and only migrations with revision greater than 047.
5. Compare the known-good and fresh databases with `npm run db:baseline:compare` using `PHASE2_BASELINE_DATABASE_URL`. The comparator covers tables, columns/types/defaults, PK/FK/unique/check constraints, indexes, functions/security-definer/search path configuration, triggers, RLS and policies. It returns `MATCH` or exact `DIFF` entries.

No baseline SQL has been generated in this workspace: generating one without an actual known-good schema would fabricate evidence.

## DBREAL harness

`tests/helpers/testDb.js` uses separate anonymous, authenticated, service-role, and direct PostgreSQL clients. It creates random, disposable Tenant A/B, admin and employee users, active employee links, schedules, assignments, flags, and raw logs; cleanup removes test tenants and auth users.

`tests/compliance/db-real.test.js` contains setup, action, assertion, and cleanup for all required live cases; it contains no `assert.fail`, TODO, dummy expectation, or mock substitute:

| Coverage | Live assertion |
|---|---|
| DBREAL-001–003 | anon/authenticated RPC denied; service-role creates v1 plus history |
| DBREAL-004–006 | tenant and employee RLS; JWT metadata tampering does not change link-based identity |
| DBREAL-007–009 | foreign provenance rejected; authenticated update and service-role delete of history rejected |
| DBREAL-010–012 | ten concurrent create/same hash/different hash calls with contiguous history assertions |
| DBREAL-013 | TEST_ONLY temporary trigger faults history insert and verifies record version/hash/history all roll back; trigger/function are dropped in `finally` |
| DBREAL-014–015 | UNSCHEDULED→assigned and assignment A→B supersession without deletion |
| DBREAL-016–017 | Merida 22:00–06:00 bounded raw-window retrieval and explicit ambiguous assignment error/no persistence |
| DBREAL-018–019B | both flags OFF blocks service; SHADOW and ACTIVE persist only, with no `registro_asistencia` side effect from reprocessing |
| DBREAL-020–022 | canonical snapshot agreement, cross-tenant employee link rejection, and out-of-window source-log rejection |

The TEST_ONLY fault trigger is dynamically created only by the direct PostgreSQL test connection after safety guards pass. It is not a migration, not a production RPC path, and is removed even when the assertion fails.

## RPC grants, RLS, history, and source windows

Static adversarial checks now inspect the final 045→047 state rather than the obsolete 045-only definition. They verify the fixed `public, pg_temp` search path, backend-only RPC grant, append-only trigger, advisory transaction lock, active logical identity, versioned supersession, bounded provenance, JSON validation, and link tenant trigger. Real permission/RLS/concurrency results remain unverified until DBREAL runs.

`auth_current_employee_id()` has a safe search path, revokes `PUBLIC`, and grants only `authenticated`. Workday source logs are checked in PostgreSQL against tenant, the employee biometric identity, and backend-provided operational window. Night shift retrieval obtains the tenant timezone from `clientes.timezone`, using the documented legacy fallback only when absent.

## Test results in this workspace

| Gate | Result |
|---|---|
| Phase 1 original + adversarial + hardening | 75/75 PASS |
| Phase 2 mocks | 15/15 PASS |
| Phase 2 simulated | 3/3 PASS |
| Stabilization | 14/14 PASS |
| Final static persistence adversarial checks | 20/20 PASS |
| DBREAL harness | 23 implemented, 23 skipped because guarded TEST configuration is absent |
| Typecheck | PASS |
| Build | PASS; existing Vite chunk-size warning (>500 kB) |

`npm audit --omit=dev --audit-level=high` reports one existing high-severity advisory in `xlsx` (prototype-pollution/ReDoS; no upstream fix available). It is unrelated to the DBREAL harness but remains a repository dependency finding.

## Required execution sequence

1. Create or identify an isolated TEST/STAGING/local Supabase/PostgreSQL target; never use production.
2. Put the required values in ignored `.env.test.local` and run preflight.
3. Generate the known-good baseline, bootstrap a fresh empty test DB, and run catalog comparison.
4. Run `npm run test:dbreal`; all 23 must pass with zero critical skips.
5. Re-run the local suites, typecheck, and build.

Only after those executions can the project issue **PHASE 2 FINAL VALIDATION**. Until then: **READY FOR PHASE 3: NO**.
