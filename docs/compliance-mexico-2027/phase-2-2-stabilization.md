# Phase 2.2 Stabilization & Clean Migration Readiness

## Verdict

**PHASE 2.2 STABILIZATION: FAIL**  
**READY FOR DBREAL: NO**

No Phase 3 work was started. Local regressions are fixed, but the repository is not yet clean-migration ready and DBREAL remains non-executable without a test database and a completed integration fixture suite.

## Regression fixes

`AttendanceEngine.process` again accepts and propagates the full `AttendanceEngineOptions` object. This restores `deduplication`, `laborRuleProvider`, timezone and other validated engine options. `operativeDate` was added as an explicit optional option and is authoritative for UNSCHEDULED processing.

The Phase 1 original, adversarial and hardening suites now pass: **75/75**. The Fase 2 persistence mock is **15/15**, and the simulated reprocesing suite is **3/3** with no hang. The mock now models `scheduleAssignmentId`, list-valued assignments and finite thenables.

## Migration reconciliation

The canonical `attendance_logs` contract is:

- `numero_serie`
- `biometric_user_id`
- `timestamp`

Migration 029 creates those columns. Migration 041 instead references `device_serial` and `user_id`; no intervening migration creates or renames them. A compatibility migration cannot repair this *after* 041 in a fresh chain because execution stops at 041 first. Per the instruction not to rewrite historically applied migrations, 041 was not edited.

Migration 047 records the canonical unique index for deployed databases, but it does **not** make 001–047 clean-applicable by itself. The next authorized action must decide between a corrected clean-baseline migration set or an explicit pre-041 compatibility bridge supported by the actual migration runner.

`scripts/verify-clean-migrations.mjs` is ready to run every SQL migration in filename order against an already-empty database. It requires all of: `PHASE2_AUDIT_DATABASE_URL`, `PHASE2_AUDIT_DB_LABEL=local|test|staging`, and `ALLOW_DESTRUCTIVE_TEST_DB=true`; it rejects production-like hostnames. It records per-file duration/result, but was not run because `psql` and a disposable database are absent.

## Logical identity and reconciliation

047 defines the current explicit domain decision: one ACTIVE logical workday per `(cliente_id, empleado_id, workday_date)`. A true second workday needs a future explicit `logical_sequence`; it is intentionally not inferred from a schedule assignment.

The replacement RPC uses a transaction-scoped advisory lock over that logical key. It updates same-assignment recalculations in place. A transition UNSCHEDULED→assignment or assignment A→B creates the definitive record, marks the old record SUPERSEDED, sets `superseded_by`, and writes a new history version with `UNSCHEDULED_RECONCILED` or `SCHEDULE_REASSIGNED`. No delete is used.

## Timezone and source logs

Tenant timezone is now read from `clientes.timezone` (047 adds the field with documented Mexico City fallback). Reprocessing derives its query window from that timezone rather than host time. The engine retains the caller-provided operative date for UNSCHEDULED workdays, avoiding UTC-midnight drift.

Persistence requires trusted `source_window_start_utc` and `source_window_end_utc`; each source log must match tenant, biometric user and timestamp window. JSON arrays are validated before writing.

## Employee links and history

047 adds a BEFORE INSERT/UPDATE trigger requiring `employee_user_links.cliente_id` to equal the linked employee's tenant. `auth_current_employee_id` now has an explicit safe search path, no PUBLIC execute grant, and only authenticated access.

The existing history trigger blocks UPDATE/DELETE; evidence deletion cascades were documented previously and were not changed blindly in this stabilization phase.

## Concurrency strategy

The old visible unique-conflict failure is replaced by `pg_advisory_xact_lock` on the stable workday key. The lock is transaction-scoped and finite; no retry loop is used. Real 10-client behavior still requires DBREAL validation.

## DBREAL readiness

`db-real.test.js` remains skipped because no isolated database/configuration exists. Its current placeholder bodies are not acceptable evidence and must be replaced with real setup/query/cleanup before DBREAL can be requested. No production system was contacted.

## Tests and quality gates

| Check | Result |
|---|---|
| Fase 1 original + adversarial + hardening | 75/75 PASS |
| Fase 2 persistence mock | 15/15 PASS |
| Fase 2 simulated | 3/3 PASS |
| STAB-001…STAB-014 | 14/14 PASS |
| Typecheck | PASS |
| Build | PASS, Vite chunk-size warning only |
| Clean migration application | NOT RUN / blocked by 041 |
| DBREAL | NOT RUN / placeholders still present |

## Remaining blockers

1. Resolve the 041 clean-chain incompatibility without violating deployed migration history.
2. Implement DBREAL setup, JWT/RLS, permissions, concurrency, rollback and cleanup bodies; skips must be zero.
3. Run `verify-clean-migrations.mjs` against a disposable local/test/staging PostgreSQL database.
4. Validate 047 reconciliation, source-window and employee-link behavior against PostgreSQL real.
