# Phase 34.1 — Production environment and READ_SMOKE

## Scope

This phase prepares and manually validates a production read path for one reviewed record only. It does not execute the Attendance Engine, generate a workday, call the persistence service, invoke an RPC, or write any table.

The sole permitted candidate is `7f99cef9-4100-48ff-9aaf-68548c80c948`. Any other UUID fails closed.

## Manual commands

```text
node backend/scripts/run-production-workday-shadow-canary.js --check-env
node backend/scripts/run-production-workday-shadow-canary.js --read-smoke --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948
```

`--check-env` does not connect to Supabase. It validates the required backend variables by presence and guard semantics only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SHADOW_CANARY_ALLOWED_HOST`
- `SHADOW_CANARY_ENVIRONMENT` (`PRODUCTION_SHADOW`)
- `SHADOW_CANARY_CONFIRMATION` (`I_APPROVE_READ_ONLY_SHADOW`)

No value of a credential is printed, stored in this document, or exposed to a frontend bundle. The hostname is the only destination identifier emitted.

## Destination and zero-write guards

The runner requires an HTTPS URL whose hostname exactly equals the backend allowlisted host. It rejects the wrong environment, confirmation, host, or candidate before creating a database client.

READ_SMOKE wraps its Supabase client in a guard that fails closed on `insert`, `update`, `delete`, `upsert`, and any RPC. It tracks and asserts `writeCalls = 0`, `persistenceCalls = 0`, and `rpcWriteCalls = 0`.

The runner has no `WorkdayPersistenceService` dependency and no accessible `upsert_workday_record` path.

## Read contract

For the fixed approved candidate, READ_SMOKE performs only tenant-scoped reads:

1. `registro_asistencia` by exact ID, selecting no `raw_payload`.
2. `empleados` by `(id, cliente_id)`.
3. `devices` by `(id, cliente_id)`, requiring `America/Cancun`.
4. The real ScheduleResolver for 2026-09-03, requiring schedule `be4035c8-042c-473b-b25d-b5bf3fb99701`.
5. `registro_asistencia` constrained by tenant, employee and the UTC window `2026-09-03T09:00:00.000Z` through `2026-09-03T22:00:00.000Z`, ordered by `verificado_at, id`.

It emits only a sanitized summary: IDs, timezone, schedule/date, window, event count/types, destination result, and zero-write counters. It never emits raw payloads, biometrics, tokens, or credentials.

## Separation of stages

- **Baseline/postcheck integrity** compares structural counts and the legacy trigger fingerprint. It is not evidence of a successful smoke read.
- **READ_SMOKE** proves guarded production context reads only. It does not run the Attendance Engine.
- **Production SHADOW Canary** remains a later, separately authorized step: it will execute the engine in SHADOW and then use the immediate postcheck.
- **PERSIST** remains disabled and is not authorized by this phase.

Before any actual READ_SMOKE, run the Phase 33 baseline immediately before it. Afterwards, copy that just-captured baseline into the read-only Phase 34 postcheck CTE and run the postcheck. Do not treat older count values as a permanent production baseline.
