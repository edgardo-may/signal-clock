# Phase 21 — Attendance, Workday, and Incidents Audit

Status: pending execution of the read-only production audit. The source of
truth is the PostgreSQL catalog returned by
`database/live-schema/21_attendance_workday_incidents_precheck.sql`.

This report does not treat `supabase/migrations` as evidence. It also does not
authorize a change, backfill, RPC invocation, or use of the Attendance Engine.

## Current verdicts

REGISTRO CONTRACT: BLOCKED
SCHEDULE CONTRACT: BLOCKED
WORKDAY TABLES EXIST: NO
WORKDAY CONTRACT USABLE: NO
INCIDENT TABLE EXISTS: YES
INCIDENT CONTRACT USABLE: BLOCKED
EMPRESA ISOLATION: BLOCKED
TIMEZONE AUTHORITY IDENTIFIED: PARTIAL
NIGHT SHIFT SUPPORT POSSIBLE: BLOCKED
ATTENDANCE ENGINE CODE REUSABLE: PARTIAL
READY FOR PHASE 22: NO

| Check | Verdict | Basis |
|---|---|---|
| REGISTRO CONTRACT | BLOCKED | Phase 21 must capture its full live catalog, including triggers, RLS and policies. |
| SCHEDULE CONTRACT | BLOCKED | The prior live audit identified `horarios` and `empleados_horarios`, but Phase 21 must revalidate their exact constraints, active-date semantics and tenant isolation. |
| WORKDAY TABLES EXIST | NO | The prior production-contract audit reported `workday_records`, `workday_record_history`, and `tenant_features` missing. Phase 21 rechecks this directly. |
| WORKDAY CONTRACT USABLE | NO | No current live workday contract has been revalidated. |
| INCIDENT TABLE EXISTS | YES | The prior production-contract audit identified `public.incidencias`; Phase 21 rechecks its full live contract. |
| INCIDENT CONTRACT USABLE | BLOCKED | Existing aggregate evidence does not establish source, workflow states, or a workday relation. |
| EMPRESA ISOLATION | BLOCKED | Requires the Phase 21 FK, column, RLS and policy output. |
| TIMEZONE AUTHORITY IDENTIFIED | PARTIAL | `devices.timezone` is confirmed for ZKTeco; tenant, schedule and workday authority remain to be audited. |
| NIGHT SHIFT SUPPORT POSSIBLE | BLOCKED | The pure engine can model midnight crossing, but the real schedule, timezone and persistence contracts are not yet validated together. |
| ATTENDANCE ENGINE CODE REUSABLE | PARTIAL | Its calculation code is reusable only as a pure domain candidate; its persistence/reprocess services assume unverified or missing live objects. |
| READY FOR PHASE 22 | NO | Phase 21 production output has not been attached and reviewed. |

## Read-only audit scope

The SQL script records, from `pg_catalog` and `information_schema`:

- `registro_asistencia`: columns, types, nullability, defaults, constraints,
  indexes, triggers, RLS and policies.
- Tables whose live names or columns indicate schedule, shift or employee
  assignment responsibility; including the columns needed to decide which
  assignment was active on an operative date.
- Expected and equivalent workday relations, their complete contracts and exact
  row counts when present.
- `incidencias`: complete contract, security, exact count and real distinct
  values for catalog columns that actually exist.
- Empresa and employee keys/FKs, plus all discovered timezone columns and real
  timezone values.

## Code review, not production authority

Reviewed direct code only:

- `src/domain/attendance/` is a pure calculation layer. `ShiftMatcher` assigns
  a cross-midnight shift to its supplied `operativeDate`, so it can express the
  Sep 4 22:00 to Sep 5 06:00 rule when the live schedule resolver supplies a
  verified date and IANA timezone.
- `src/services/attendance/WorkdayPersistenceService.ts` assumes the RPC
  `upsert_workday_record` and a particular workday payload. Do not use it until
  Phase 21 confirms that RPC and every target field exist in production.
- `src/services/attendance/WorkdayReprocessService.ts` assumes
  `tenant_features`, `workday_records`, historical ATTLOG columns and tenant
  timezone fields that may not exist in production. Do not use it yet.

## Phase 22 decision inputs

No schema or code change is proposed in Phase 21. Once the SQL output is
reviewed, Phase 22 can choose a contract-backed design for:

1. automatic engine-detected incidents, preserving detection evidence and a
   reviewable state;
2. manual HR incidents, preserving author and reason without overwriting the
   automatic finding;
3. a workflow vocabulary only if the live table/check/enum supports it, or an
   explicitly approved additive model when it does not.

The exact values for pending, approved and rejected, their capitalization, and
any workday relationship must come from the Phase 21 live catalog. They are not
introduced or normalized by this audit.
