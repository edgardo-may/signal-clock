# Phase 58 — ScheduleResolver immutable revision audit

Status: local code and read-only evidence preparation only. Production writes: 0. Resolver activation: no. Persist Canary: no. Engine activation: no.

## Current audit

`src/services/attendance/WorkdayReprocessService.ts` is a legacy browser-reachable compatibility path. It reads `empleados_horarios`, joins `horarios(*)`, then reads live `h.dias_config`, `h.tolerancia_minutos`, and the selected day’s `activo`, `entrada`, `salida`, `descanso_inicio` and `descanso_fin`. It computes the day key from the supplied `workdayDate` in UTC and gives that same date to the engine as `operativeDate`. It does not guard a versioned revision and is not a permitted path for the revision resolver. It remains unactivated and must not be used for the Phase 58 shadow.

`backend/services/attendance/AttendanceEngineOrchestrator.js` is server-only and explicitly invoked. Its read repository obtains active assignments and then only their non-null revision IDs in two tenant-filtered, bounded set queries (not per-assignment queries); `ScheduleResolver` consumes only those records. It does not read `horarios` calculation fields. The source attendance tenant originates from the server-read `registro_asistencia`, then device and employee tenant equality are checked before schedule resolution; it is not a frontend-provided tenant.

`ScheduleResolver` filters only active assignments for the requested employee, validates their tenant and date ranges, and selects exactly one applicable assignment for `candidateDate`. It distinguishes no applicable assignment (`UNSCHEDULED`) from an applicable corrupt assignment (typed error). It never has a `horarios`, `dias_config`, `tolerancia_minutos`, or live `activo` input.

`ScheduleRevisionAdapter` parses only `calculation_contract_version = 1`, validates all seven day entries, enforces entry/exit for active days, validates paired breaks, validates non-negative integer tolerance, validates revision tenant/schedule identity, and recomputes the integrity SHA-256. An active revision with `horario_activo=false`, malformed range, absent revision, duplicated returned revision, future contract version, or bad hash fails closed. Night shifts are represented by `endTime <= startTime`; `ShiftMatcher` owns the next-calendar-day end boundary while the assignment date remains the operative date.

`AttendanceNormalizer` only validates, normalizes, sorts and deduplicates punches. It does not read schedules. `ShiftMatcher` turns the resolved `ShiftWindowConfig` into a local-time scheduled window; for a night shift it derives the end date as the next calendar date. `WorkdayCalculator` retains the V3 canonical policy: first normalized `ENTRY`, then first normalized `EXIT` strictly after it; all other events are supplemental evidence and do not change canonical metrics. `AttendanceEngine` passes the resolved shift into `ShiftMatcher`; it does not construct a schedule or inspect `horarios` fields.

## Revision resolution flow

1. The backend derives tenant and employee identity from its authenticated/server-read context, never from a frontend tenant parameter.
2. It loads active `empleados_horarios` for that tenant and employee and the relevant revision fields in bounded set reads. A production optimization may use the composite FK relation `empleados_horarios_schedule_revision_tenant_fkey` to fetch assignment plus revision in one joined PostgREST query; there must be no per-assignment lookup.
3. `ScheduleResolver` applies `fecha_inicio <= operativeDate` and `(fecha_fin IS NULL OR fecha_fin >= operativeDate)`. Zero matches is the sole legitimate `UNSCHEDULED` result; more than one is `AMBIGUOUS_SCHEDULE`.
4. The selected assignment must have one revision. Revision tenant and `horario_id` must match the assignment; the backend hash must equal `integrity_hash`.
5. `parseScheduleRevisionV1` adapts the immutable snapshot to `ShiftWindowConfig`. No live parent configuration is consulted.

The VOIDED A/B rows remain ignored because `activo=false`; they must remain without a revision and cannot become `UNSCHEDULED` corruption.

## Hash parity

The database function hashes `jsonb_build_object(calculation_contract_version, dias_config, tolerancia_minutos, horario_activo)::text`. The adapter reproduces PostgreSQL JSONB key ordering (UTF-8 byte length, then bytes) and its spaces before UTF-8 SHA-256. `scripts/verify-schedule-revision-hash-parity.mjs` reads C and calls only the immutable DB hash function to compare DB, stored, and backend values. A mismatch is exit code 3 and blocks all progression.

## Shadow behavior

`scripts/run-schedule-revision-shadow.mjs` reads C’s assignment, revision and parent schedule with fixed SELECTs, compares Monday/Saturday/Sunday semantic tuples, and exits 3 on divergence. The legacy parent is only passed to `legacyLiveScheduleToShadowShift`; it cannot reach `ScheduleResolver`, engine execution, or persistence. It makes no DML, no write RPC, no canary selection and no deployment.

## Required manual evidence before any deployment discussion

Run the SQL precheck first. Stop if it returns no row, `safe_to_run_revision_resolver_shadow` is not `true`, the computed hash differs, or any expected C field differs.

```powershell
Get-Content database/live-schema/58_schedule_resolver_revision_precheck.sql -Raw | psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1
```

Expected: one read-only row with C’s assignment/revision IDs, version `1`, hash `77ee…4866`, Monday `09:00`–`18:00`, Saturday/Sunday inactive, and `safe_to_run_revision_resolver_shadow = t`.

Then, from the repository root, with the approved production read credentials already present only in `backend/.env`:

```powershell
node scripts/verify-schedule-revision-hash-parity.mjs
node scripts/run-schedule-revision-shadow.mjs
```

Expected from both: exit code `0`; the first reports identical `storedHash`, `dbHash`, and `backendHash`; the second reports `parity: true` and three equal comparisons. Stop on exit code `3` or any `*_MISMATCH` / `*_FAILED` error. Neither command changes data.
