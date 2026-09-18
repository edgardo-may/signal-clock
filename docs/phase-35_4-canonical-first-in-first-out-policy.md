# Phase 35.4 - Canonical First-In / First-Out Policy

## Decision

The canonical workday is intentionally independent from punch-pairing analytics:

1. `firstIn` is the first normalized `ENTRY` in the already-resolved and
   deterministically ordered operational window (`timestamp ASC`, `id ASC`).
2. `lastOut` is the first normalized `EXIT` strictly after `firstIn`.
3. Every other normalized event is retained as sanitized supplemental evidence.

Pairing remains available in the trace for diagnosis only. It does not replace
the canonical pair and cannot change canonical state, work, late, early-leave,
or overtime metrics.

## Metrics and state

`workedMinutes` is the canonical UTC interval from `firstIn` to `lastOut`.
Supplemental punches never create WORK or BREAK segments. Consequently,
`breakMinutes` is zero unless a future, separate schedule contract provides a
canonical break interval that intersects the canonical pair. No inferred break
is taken from ENTRY/EXIT evidence.

A workday with both canonical events is `COMPLETE`; a later supplemental ENTRY
or EXIT cannot make it incomplete. `INCOMPLETE` remains for missing canonical
ENTRY or missing canonical subsequent EXIT.

`lateMinutes` uses scheduled entry versus canonical `firstIn`. `earlyLeave`
uses canonical `lastOut` versus scheduled exit. Overtime uses canonical worked
time only.

## Supplemental evidence

`supplementalEvents` is a result-only, sanitized collection; it does not
duplicate or mutate `registro_asistencia`. Each entry contains only log ID,
UTC timestamp, normalized type, and stable reason:

- `EXIT_BEFORE_FIRST_IN`
- `ADDITIONAL_ENTRY`
- `ADDITIONAL_EXIT`
- `UNCLASSIFIED_EVENT`

The observable warning codes distinguish pairing analytics from extra evidence:
`CONSECUTIVE_ENTRY`, `CONSECUTIVE_EXIT`, `ADDITIONAL_ENTRY`, and
`ADDITIONAL_EXIT`. They are warnings, not RH incidents and do not write data.

## Integrity and regression

Calculation version is now `3`; the integrity hash therefore changes
deterministically and protects the canonical snapshot and warning evidence.
The sanitized 16-event regression fixture asserts the production-shaped policy:
first entry at `2026-09-03T16:26:04.000Z`, first subsequent exit at
`2026-09-03T17:55:13.000Z`, 14 supplemental events, 89 worked minutes,
zero inferred break minutes, and a complete canonical day.

This document records a domain-policy change only. No database schema, workday
record, RPC, persistence service, incident, legacy trigger, production data,
or automatic runtime was changed. A fresh guarded production SHADOW replay is
required before any further gate is considered.
