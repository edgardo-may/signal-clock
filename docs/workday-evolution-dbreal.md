# Workday Evolution DBREAL

`npm run test:dbreal:workday-evolution` is an integration harness for a future, isolated Supabase database. It is not a production migration runner and it never reads `SUPABASE_URL`, frontend variables, or unprefixed credentials.

## Required guardrails

All of the following must be configured before the suite opens a connection:

```text
SUPABASE_TEST_URL
SUPABASE_TEST_ANON_KEY
SUPABASE_TEST_SERVICE_ROLE_KEY
PHASE2_AUDIT_DATABASE_URL
PHASE2_AUDIT_DB_LABEL=local|test|staging
ALLOW_DESTRUCTIVE_TEST_DB=true
```

The shared `tests/helpers/testDb.js` guard rejects a missing value, labels other than `local`, `test`, or `staging`, a host containing `prod` or `production`, and a configured `PHASE2_PRODUCTION_HOST`. This harness additionally rejects a URL or direct PostgreSQL host containing `main`. The harness reports only variable names and never prints keys, passwords, or connection strings. Without the complete guardrail it registers every DBWE test as `SKIPPED` and opens no network connection.

## Isolated database procedure

1. Create and provision an isolated Supabase **TEST** database from the baseline immediately before Phase 97. Do not point these variables at production, main, or a shared development database.
2. Export the six required variables in the process that will run the test. `PHASE2_AUDIT_DB_LABEL` must identify the isolated target.
3. Run `npm run test:dbreal:workday-evolution`.

When the guard is satisfied, the suite uses direct PostgreSQL only for fixture setup, catalog assertions, the SQL phase files, and cleanup. It uses the TEST service-role key to invoke the actual PostgREST RPC. Its sequence is:

1. Verify no enabled `WORKDAY_PERSIST_ACTIVE` exists.
2. Run Phase 96 and require `pass=true`.
3. Apply Phase 97 to the isolated database only.
4. Run Phase 98 and require `pass=true`.
5. Create UUID-generated tenants, employee, devices, schedule, immutable revision whose hash is calculated by `public.schedule_revision_calculation_hash`, assignment, source events, and canonical `registro_asistencia` rows.
6. Enable `WORKDAY_PERSIST_ACTIVE` for the fixture tenant A only.
7. Execute DBWE-001 through DBWE-015.
8. Delete the fixture authorization, outbox/workday/history/source rows in dependency order, and the UUID-generated fixture tenants. Because `schedule_revisions` is intentionally immutable, the guarded audit role performs this final fixture-only cleanup in a local transaction with `session_replication_role=replica`; this is never available to or used by application/runtime code.

Phase 97 intentionally remains installed in the isolated database after a successful run; use a disposable branch/database for a fresh Phase 96 → 97 validation. The fixture cleanup does not alter Phase 96–98 or any non-fixture row.

## DBREAL coverage

| ID | PostgreSQL assertion |
|---|---|
| DBWE-001 | Phase 96, 97, and 98 PASS sequence in the guarded target. |
| DBWE-002 | New snapshot returns `INSERTED`; one logical workday and one `INSERTED` history row. |
| DBWE-003 | Exact first replay returns `UNCHANGED`; history stays at one row. |
| DBWE-004 | Later canonical event returns `UPDATED`, keeps the same workday identity, and appends history. |
| DBWE-005 | Exact updated replay is `UNCHANGED` without a new history row. |
| DBWE-006 | Earlier snapshot returns `STALE` and cannot regress state. |
| DBWE-007 | Equal watermark plus a greater source-event count returns `UPDATED`. |
| DBWE-008 | Equal source version with different content raises `PERSIST_SNAPSHOT_CONFLICT` and changes nothing. |
| DBWE-009 | Concurrent insert calls yield exactly one `INSERTED`, remaining `UNCHANGED`, one history identity. |
| DBWE-010 | Concurrent update calls yield exactly one `UPDATED`, remaining `UNCHANGED`, one appended history row. |
| DBWE-011 | Tenant B cannot use tenant A's canonical registro. |
| DBWE-012 | Revoking the tenant A gate denies persistence; restoring only that fixture tenant restores replay behavior. |
| DBWE-013 | Missing, foreign, manual/non-ZKTECO, and non-PROCESSED sources fail closed. |
| DBWE-014 | Invalid schedule and ambiguous assignment resolution fail closed. |
| DBWE-015 | Catalog grants: anon/authenticated/PUBLIC false, service_role true for 18 arguments; service_role false for the old 16-argument RPC. |

`SAFE_TO_REOPEN_WORKDAY_PERSIST_ACTIVE` remains **NO** until this suite runs against the isolated test database and all DBWE checks pass.
