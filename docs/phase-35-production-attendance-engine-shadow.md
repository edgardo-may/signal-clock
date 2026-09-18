# Phase 35 — Production Attendance Engine SHADOW Canary

## Manual-only execution

The first production engine execution is isolated from READ_SMOKE:

```text
node backend/scripts/run-production-workday-shadow-canary.js --engine-shadow --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948
```

The runner accepts only this reviewed UUID. It has no mode selector and rejects
PERSIST, ACTIVE, WRITE, UPSERT, or any alternate candidate. Its mode is always
`SHADOW`.

Before the command, capture a fresh baseline with
`database/live-schema/33_production_shadow_baseline.sql`. After the command,
copy that immediate baseline into the read-only CTE in
`database/live-schema/34_production_shadow_postcheck.sql` and execute the
postcheck. Do not use an older baseline as proof for this run.

## Engine input and output contract

The runner reuses `AttendanceEngineOrchestrator` and its approved pure adapters.
It requires the real tenant, employee, device/timezone, schedule, operative
date, and ShiftMatcher window to equal the reviewed candidate context:

- `schedule_id`: `be4035c8-042c-473b-b25d-b5bf3fb99701`
- `operative_date`: `2026-09-03`
- timezone: `America/Cancun`
- window: `2026-09-03T09:00:00.000Z` through
  `2026-09-03T22:00:00.000Z`

It passes the entire returned event window to the orchestrator, ordered by
`verificado_at, id`; it does not preselect an entry or exit. The runner executes
the exact same candidate twice and fails closed unless state, first/last event,
metrics, and integrity hash are identical.

The sanitized output includes input and normalized event counts/types, workday
result, integrity hash, warnings, and the zero-write counters. It contains no
raw payload, biometric data, token, or credential.

## Zero-write boundary

The production Supabase client is wrapped to reject `insert`, `update`,
`delete`, `upsert`, and every RPC. The runner omits a persistence service and
has no incident writer. It asserts all of these values are zero:

- `writeCalls`
- `persistenceCalls`
- `rpcWriteCalls`
- `incidentWriteCalls`

The dependency graph contains neither `WorkdayPersistenceService` nor
`upsert_workday_record`. SHADOW therefore does not mutate `workday_records`,
`registro_asistencia`, `attendance_source_events`, `incidencias`, schedules,
assignments, or legacy objects.

`trg_evaluar_retardo` and `fn_evaluar_retardo_asistencia` remain untouched.
No legacy trigger fires because no attendance row is inserted.

## Gate

Passing the runner proves only a read-only SHADOW calculation. The actual
calculated result—especially its interpretation of the 16-event, 7-entry,
9-exit production window—must be reviewed before a later persistence decision.
PERSIST, incidents, automatic runtime activation, ZKTeco changes, and backfill
remain out of scope and unauthorized.
