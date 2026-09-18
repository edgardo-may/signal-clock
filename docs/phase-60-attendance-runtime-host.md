# Phase 60 — Attendance Runtime host

## Decision

Architecture selected: an isolated **Node HTTP server-only service** in `backend/attendance-runtime/`, deployable as a private container service. It imports the existing `AttendanceEngineOrchestrator` and domain; it does not duplicate attendance calculation and is not part of the SPA, API integration, ADMS or `zkteco-push-ta`.

Recommended target: **private Cloud Run service** (or an equivalent private Node container service on the existing platform). It is appropriate because this runtime exposes HTTP health and one internal HTTP command, needs no TCP device listener, and has an explicit Docker image. There is no evidence in this repository of an existing Cloud Run service or a deployable Vercel function for this engine; no target is assumed or deployed.

## Execution model

Selected model: **A — authenticated internal command after normalization**.

```text
device/integration -> attendance_logs RAW -> existing normalization -> registro_asistencia
  -> POST /internal/attendance/shadow (server-to-server only) -> AttendanceEngineOrchestrator
  -> ScheduleResolver -> schedule_revisions.config_snapshot
```

The command accepts only `registro_id`; it never accepts `cliente_id`, employee, schedule, revision, mode or persistence intent from a caller. The runtime obtains tenant identity from `registro_asistencia`, then validates all downstream tenant-scoped relations through the existing orchestrator.

There is intentionally no polling, webhook listener, queue consumer or automatic ADMS integration in this phase. A future normalizer/queue producer may invoke the internal command only after RAW normalization has committed. Explicit reprocesing uses the same command with a known `registro_id`.

## Zero-write boundary

The public execution path is permanently constructed with `AttendanceEngineOrchestrator({ mode: 'SHADOW' })`. No request parameter can change it. Its Supabase client proxy rejects `insert`, `update`, `delete`, `upsert` and `rpc` before they reach the database.

Successful output proves `databaseWrites=0`, `persistenceCalls=0`, `rpcWriteCalls=0`, and `incidentWriteCalls=0`. In-memory de-duplication shares concurrent same-process requests for a `registro_id`; multi-instance repeats are also safe in this phase because every execution is read-only. Persist-mode leasing/idempotency is explicitly out of scope until a later approved phase.

## Feature enforcement

`REVISION_SCHEDULE_RESOLVER` is read using the trusted tenant ID before calling the engine:

| Flag state | Runtime behavior |
| --- | --- |
| Missing / disabled / `OFF` | Return `SKIPPED_FLAG_OFF`; invoke neither legacy nor revision calculation. |
| `SHADOW` | Execute revision-based calculation, emit structured observability, no writes. |
| `ACTIVE` | Treat the immutable revision resolver as the official schedule source, still no writes in this release. |
| Any other mode | Fail closed with `FEATURE_MODE_UNSUPPORTED`. |

There is no legacy live-schedule fallback in any active path. `PERSIST_CANARY` is unsupported for this feature.

## Security and observability

- The process uses `SUPABASE_SECRET_KEY` only from server environment/secret storage. It is absent from HTTP responses and frontend variables.
- Internal execution requires a constant-time checked Bearer token. Production target should additionally use private ingress and workload identity/IAM between the caller and Cloud Run.
- Request JSON is capped at 4 KB and permits exactly `registro_id`, a UUID. No browser CORS policy is installed.
- `/health` is non-sensitive liveness; `/ready` performs only a small tenant-feature `SELECT` to validate DB access.
- Runtime logs include tenant, employee, operative date, assignment, revision/version/hash, resolution mode/result, Engine V3, calculation version 3, safe error code and duration. They exclude RAW payloads, service-role keys and bearer tokens.

## Runtime package

Runtime entrypoint: [server.js](/C:/Users/Edgar/signal-clock/backend/attendance-runtime/server.js).

The deployment image is defined by [Dockerfile](/C:/Users/Edgar/signal-clock/backend/attendance-runtime/Dockerfile) and copies only:

```text
backend/attendance-runtime/
backend/services/attendance/
src/domain/attendance/
backend/package.json + backend/package-lock.json
```

It excludes the frontend, tests, documentation, scratch material, ADMS server and `zkteco-push-ta`.

Required names are in [.env.example](/C:/Users/Edgar/signal-clock/backend/attendance-runtime/.env.example): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ATTENDANCE_RUNTIME_INTERNAL_TOKEN`, `ATTENDANCE_RUNTIME_PORT`, `RUNTIME_VERSION`, and `BUILD_SHA`. `/health` returns only the two release identifiers, never secrets.

## Post-deploy read-only check

[postdeploy-readonly-check.js](/C:/Users/Edgar/signal-clock/backend/attendance-runtime/postdeploy-readonly-check.js) checks the deployed health/readiness version plus direct read-only C revision resolution and hash parity. It never calls the internal execution endpoint, engine persistence, incidents or RPC.

It requires `ATTENDANCE_RUNTIME_URL`, `ATTENDANCE_RUNTIME_EXPECTED_VERSION`, `ATTENDANCE_RUNTIME_EXPECTED_BUILD_SHA`, `ATTENDANCE_RUNTIME_EXPECTED_SHA256`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. `BUILD_SHA` must equal the package SHA calculated from the staged image source, not copied from a development machine.

## Explicit non-actions

No deploy, push, database write, Phase 59 flag transition, Phase 60 transition, resolver activation, global engine activation, workday persistence or Persist Canary selection has occurred.
