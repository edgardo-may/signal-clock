# Phase 35.3 — Production SHADOW Validation V2

This phase replays only the fixed approved candidate with calculation version 2.
It is still SHADOW-only and does not authorize persistence, incidents, legacy
changes, backfill, ZKTeco changes, or automatic activation.

## Required manual sequence

1. Run `--check-env`; it must return `envReady: true` and destination guard
   PASS.
2. Immediately execute `database/live-schema/33_production_shadow_baseline.sql`
   and capture that new snapshot.
3. Execute:

   ```text
   node backend/scripts/run-production-workday-shadow-canary.js --engine-shadow --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948
   node backend/scripts/run-production-workday-shadow-canary.js --engine-shadow-trace --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948
   ```

4. Insert the immediate baseline into the Phase 34 read-only postcheck CTE and
   execute `database/live-schema/34_production_shadow_postcheck.sql`.

The expected structural result is 16 input/normalized events, 86 worked
minutes from WORK segments, 7 BREAK minutes, `INCOMPLETE`, and null `lastOut`.
The actual effective first-in, lateness and version-2 hash must be taken from
the production output; they must not be inferred from the version-1 result.

The trace must prove `WORK.includedInWorkedMinutes = true` and
`BREAK.includedInWorkedMinutes = false`, reconcile work/break totals, and
expose the four stable warning codes without sensitive content.
