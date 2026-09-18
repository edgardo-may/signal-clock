# Phase 59 — Revision ScheduleResolver activation gate

## Decision

Gate: **NO DEPLOY**. The revision resolver, its data contract and C parity are ready, but this repository has no deployed execution surface that can activate it safely.

`AttendanceEngineOrchestrator` is server-only and manual-only: it is not imported by a listener, webhook, queue, cron, Edge Function or HTTP route. A flag row would therefore be inert today. Deploying only the SPA cannot activate the resolver.

## Deployment surface audit

| Surface | Resolver/engine participation | Deploy needed for activation? |
| --- | --- | --- |
| Root Vercel SPA | None. `vercel.json` rewrites every path to `index.html`. | No. |
| `backend/api-integracion` | Consolide employee sync only; no engine/orchestrator import. | No. |
| `backend/server.js` / `backend/sync-server.js` | Raw biometric ingestion only; no engine/orchestrator import. | No. |
| Supabase Edge Functions | Only `create-user`; no attendance engine. | No. |
| `zkteco-push-ta` | Push ingestion/source linking only; no engine/orchestrator import. | No; do not touch. |
| `AttendanceEngineOrchestrator` | The only runtime composition that calls `ScheduleResolver`. Manual script only. | Yes, but its actual host/entrypoint is absent from this repository. |

The existing Vercel proxy target `signal-clock-api-integracion-test.vercel.app` corresponds to integration sync and is not evidence that the engine is deployed there.

## Activation model prepared

Use `tenant_features` with exactly one pilot row:

```text
cliente_id = 69095bd5-fee5-4237-a1a4-186dd88310ff
feature_key = REVISION_SCHEDULE_RESOLVER
mode = SHADOW | ACTIVE
enabled = true
```

`SHADOW` is observation only. `ACTIVE` means revision-only resolution for that tenant: a valid assignment uses its immutable revision; no assignment is `UNSCHEDULED`; a corrupt applicable assignment fails closed. It must never select live `horarios` as a fallback.

The current schema already supports `mode` and `enabled`; no DDL is needed. The flags are intentionally not effective until a server-only engine entrypoint is selected and made to enforce them. That entrypoint must derive tenant identity from its backend event/auth context, not from a frontend request field.

## Prepared operational SQL

- [59 precheck](/C:/Users/Edgar/signal-clock/database/live-schema/59_revision_resolver_activation_precheck.sql): read-only readiness evidence.
- [60 SHADOW change](/C:/Users/Edgar/signal-clock/database/live-schema/60_revision_resolver_shadow_change.sql): future, guarded pilot SHADOW transition.
- [61 ACTIVE change](/C:/Users/Edgar/signal-clock/database/live-schema/61_revision_resolver_active_change.sql): future, guarded pilot ACTIVE transition.
- [62 rollback](/C:/Users/Edgar/signal-clock/database/live-schema/62_revision_resolver_rollback.sql): ACTIVE back to SHADOW; it changes only `tenant_features`.
- [63 postcheck](/C:/Users/Edgar/signal-clock/database/live-schema/63_revision_resolver_activation_postcheck.sql): read-only database evidence.

None has been executed. The rollback leaves revisions, assignments, attendance and workday tables unchanged.

## Observability

`AttendanceEngineOrchestrator` now emits secret-free structured fields: `tenant_id`, `employee_id`, `operative_date`, `assignment_id`, `schedule_revision_id`, `revision_version`, `revision_integrity_hash`, `resolution_mode`, `resolution_result`, and `error_code`.

Error mapping is stable: `REVISION_MISSING`, `REVISION_HASH_MISMATCH`, `REVISION_TENANT_MISMATCH`, `REVISION_SCHEDULE_MISMATCH`, `REVISION_VERSION_UNSUPPORTED`, `REVISION_CONFIG_INVALID`, and `MULTIPLE_APPLICABLE_ASSIGNMENTS`. The raw domain code is retained separately for diagnosis. Snapshots and credentials are not logged.

## Runtime post-deploy evidence

[revision-resolver-runtime-postcheck.js](/C:/Users/Edgar/signal-clock/backend/scripts/revision-resolver-runtime-postcheck.js) must run **inside the deployed Node runtime**, not a workstation. It performs only guarded reads, checks the installed source SHA-256, the tenant flag, C’s immutable revision resolution and zero writes/RPCs. It does not invoke `AttendanceEngine`.

The expected SHA comes from the exact release artifact. Before deployment, compute it in the staged runtime with:

```powershell
node -e "require('./backend/scripts/revision-resolver-runtime-postcheck.js').runtimeSourceSha256().then(console.log)"
```

Set that output as `REVISION_RESOLVER_POSTCHECK_EXPECTED_SHA256` only for the one-off postcheck process. A mismatch is a hard stop.

## Minimal future deployment package

When the real Node engine host is named, its artifact needs only the server composition and pure domain dependencies:

```text
backend/services/attendance/AttendanceEngineOrchestrator.js
backend/services/attendance/WorkdayPersistenceContract.js
backend/scripts/revision-resolver-runtime-postcheck.js
src/domain/attendance/{AttendanceEngine,AttendanceNormalizer,AttendanceTypes,AttendanceErrors,
timezoneUtils,ShiftMatcher,WorkdayCalculator,IncidentDetector,WorkdayIntegrityHasher,index}.ts
src/domain/attendance/adapters/{RegistroAttendanceAdapter,ScheduleRevisionAdapter,ScheduleResolver,WorkdayRecordAdapter}.ts
```

Do not include frontend files, `zkteco-push-ta`, tests, docs, scratch data, or the temporary shadow comparator in a runtime image.

## Required decision before a deploy gate can be YES

Name the production host and entrypoint that will invoke the orchestrator (for example, a dedicated worker/queue consumer or an explicitly authenticated backend endpoint), and define its deployment mechanism. Then add the flag enforcement at that server-only entrypoint, deploy it in disabled mode, run runtime postcheck, enter SHADOW, and only then consider the guarded ACTIVE transition.

Until then: production writes = 0; resolver deploy = no; Persist Canary = no; engine activation = no; new persist-canary discovery = no.
