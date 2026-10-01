# Phase B compatible runtime rollback

Use the same schema-114-aware image for both deployment capabilities:

- `ACTIVE_PERSIST_CAPABLE`: normal ordinary v3 runtime.
- `REVISION_AWARE_V3_ONLY`: rollback runtime, ordinary v3 persistence enabled.

Configuration must explicitly select one of these two values. Missing or unknown
values fail startup. Both use the real production v3 registry and the same
orchestrator and persistence service. Neither HTTP surface offers candidate or
promotion operations, and neither registers v4. CURRENT v4 fails closed with
`CALCULATION_VERSION_UNAVAILABLE`, classified as terminal DENIED by the dispatcher.

`/health.runtime_capability` reports deployment capability. Ordinary persistence
responses retain `runtime_capability=ACTIVE_PERSIST_CAPABLE`, the existing
dispatcher wire contract, and add `runtime_deployment_capability` to identify the
configured mode without changing dispatcher authorization or tenant gates.

Legacy NULL provenance is not backfilled. A genuine ordinary calculation with
new evidence can establish a current revision. Evidence advances on CURRENT v3
append an immutable revision and an INITIAL/EVIDENCE_UPDATE audit entry, then
atomically advance the pointer and projection. This is not an explicit semantic
promotion. Replay/stale requests do not advance the pointer. Existing revision
and audit rows are never updated or deleted.

Do not roll back to a pre-Phase-B 18-argument writer after versioning data.
Keep schema 114 and all revision/audit data. Before rollout, build/tag and validate
the compatible image, retain its immutable digest, and retain a dispatcher image
with terminal version-error classification. Production baseline and closed-gate
requirements remain a separate read-only deployment precheck. No schema downgrade
is part of runtime rollback.
