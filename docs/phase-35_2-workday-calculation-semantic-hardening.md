# Phase 35.2 — Workday Calculation Semantic Hardening

## Corrected metric contract

The former multiple-punch calculation used the rounded elapsed span from the
first to the last matched punch as `workedMinutes`. Phase 35.1 demonstrated the
problem: a 315-minute span had only 86 minutes of valid WORK segments and a
7-minute BREAK segment.

`workedMinutes` now means the sum of valid `WORK` segments only. `BREAK`
segments do not contribute to it, and `breakMinutes` remains the sum of BREAK
segments. The gross first-to-last span remains trace-only evidence; no database
field or schema was added.

For the confirmed real shape, the expected recalculated worked metric is:

```text
21 + 65 = 86 minutes
```

This is derived from segments, never hardcoded. Overtime uses the corrected
effective work metric, not gross span.

## First/last contract

`firstIn` / `actualStart` is now the first ENTRY retained in a valid WORK
segment. A prior consecutive entry discarded by pairing remains observed trace
evidence but cannot become the persisted work start or determine lateness.
`lateMinutes` is measured from that effective first entry to scheduled start;
tolerance remains a gate: at or within tolerance gives zero, above it yields
the full scheduled-start difference (not difference minus tolerance).

`lastOut` remains null when the terminal event is an orphan ENTRY. This makes
`missingExit = true` and preserves `INCOMPLETE`. Extra orphan EXITs are warnings
when at least one valid pair exists; they do not turn the workday `INVALID`.
`INVALID` remains reserved for contradictory/corrupt data that cannot be
determined, not a deterministic incomplete sequence.

## Warning and integrity contract

The SHADOW orchestrator now exposes deterministic, deduplicated calculation
evidence codes, without creating HR incidents:

- `CONSECUTIVE_ENTRY`
- `CONSECUTIVE_EXIT`
- `UNMATCHED_ENTRY`
- `UNMATCHED_EXIT`

These warning codes form part of the integrity-protected snapshot. The
calculation version is 2, so the Phase 35 hash is intentionally superseded by a
new deterministic hash after recalculation. No persisted workday exists and no
hash was written to production.

## Regression fixture

The test fixture is sanitized and contains no live identifiers or raw payload.
It preserves the confirmed semantic shape: 16 events, 7 ENTRY, 9 EXIT, four
consecutive-entry warnings, seven consecutive-exit warnings, two WORK segments
(21 and 65), one seven-minute BREAK, and a terminal orphan entry. The exact
physical event table remains production trace evidence and must be supplied
separately if an exact ID/timestamp fixture is required.

## Scope

This phase changes only domain/runtime calculation behavior and observability.
It performs no database operation, persistence RPC, incident write, legacy
change, backfill, ZKTeco change, or automatic activation. A new production
SHADOW trace is the next validation gate; PERSIST remains disabled.
