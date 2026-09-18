# Phase 35.1 — Sanitized Calculation Trace

## Purpose and manual command

This diagnostic command executes the same fixed, production `ENGINE_SHADOW`
candidate twice and returns a deterministic, sanitized explanation of the
existing calculation. It is observational: it does not change normalization,
ShiftMatcher, pairing, WorkdayCalculator, persistence, incidents, legacy, or
database state.

```text
node backend/scripts/run-production-workday-shadow-canary.js --engine-shadow-trace --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948
```

It retains all destination and candidate guards from Phase 35 and continues to
block writes, RPCs and incident writers.

## Trace sections

The output contains no raw payload, biometric content, names, credentials, or
tokens. Its stable sections are:

- `eventTrace`: source ID, UTC/local timestamp, verification type, normalized
  type/timestamp, normalization disposition and pairing actions, ordered by
  `(verificado_at, id)`.
- `scheduleTrace`: local/UTC schedule boundary, break configuration, tolerance,
  effective ShiftMatcher window and night flag.
- `pairingTrace` and `pairingIncidents`: the existing direction-aware pairing
  evidence. Actions such as `OPEN_INTERVAL`, `CLOSE_INTERVAL`,
  `UNMATCHED_ENTRY`, `UNMATCHED_EXIT`, `DISCARDED_CONSECUTIVE_ENTRY`,
  `DUPLICATE` and `OUTSIDE_WINDOW` are observations of current code, not a new
  policy.
- `intervals`: exact WORK and BREAK segments emitted by WorkdayCalculator.
- `reconciliations`: `workedMinutes` equals the rounded span from the first to
  last matched punch; `breakMinutes` equals the sum of BREAK segments. Work
  segment totals are presented separately because the existing calculator
  defines worked minutes as elapsed first-to-last span.
- `finalState`: missing-entry/missing-exit evidence and first/last provenance.

## Existing calculation semantics being audited

The engine sorts normalized punches chronologically. `firstIn` is the timestamp
of `matchedPunches[0]`; it is not selected merely because it was the candidate
anchor. For multiple punches, `lastOut` becomes null when the existing
direction-aware pairing leaves `orphanEntry`; then `missingExit = true`, and
the Phase 30 state derivation returns `INCOMPLETE`.

`lateMinutes` is the rounded difference from scheduled start (not from the end
of tolerance) when first matched punch exceeds `scheduledStart + tolerance`.

Pairing incidents currently remain in `metrics.pairingIncidents`, while the
orchestrator deliberately emits `calculation.warnings = []` and does not write
incidents. The trace marks `WARNING COVERAGE = GAP` if unmatched evidence or
pairing incidents exist but calculation warnings remain empty. This is an audit
finding only; it does not alter the behavior.

The actual 16-event trace must be reviewed before deciding whether the Phase 35
calculation is semantically acceptable. PERSIST remains disabled.
