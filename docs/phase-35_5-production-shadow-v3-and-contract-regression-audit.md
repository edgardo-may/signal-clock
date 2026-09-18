# Phase 35.5 - Production SHADOW V3 and Contract Regression Audit

## Gate A: production SHADOW V3

The manual `--check-env` guard was run without opening a database connection.
It returned `SHADOW_ENV_MISSING`; therefore ENGINE_SHADOW V3, trace, baseline,
and postcheck were deliberately not run.

Presence-only review found these backend configuration states (no values were
printed):

| Variable | State |
| --- | --- |
| `SUPABASE_URL` | PRESENT |
| `SUPABASE_SERVICE_ROLE_KEY` | PRESENT |
| `SHADOW_CANARY_ALLOWED_HOST` | MISSING |
| `SHADOW_CANARY_ENVIRONMENT` | MISSING |
| `SHADOW_CANARY_CONFIRMATION` | MISSING |

The runner must remain blocked until all three non-secret guards are supplied
server-side with their approved values. No fallback destination is allowed.

## Gate B: historical regression classification

The complete compliance command was executed read-only. Its baseline was
**352 tests: 264 pass, 65 fail, 23 skipped, 0 todo, 0 cancelled**. The count
reconciles exactly: `264 + 65 + 23 = 352`.

The 23 skips are not unclassified failures: they are the guarded DBREAL
coverage in `db-real.test.js` (22 isolated-DB subtests plus the enclosing
suite as reported by Node). They require isolated non-production credentials
and `ALLOW_DESTRUCTIVE_TEST_DB=true`; none was enabled here. No test was
disabled, deleted, commented out, or weakened.

| Classification | Count | Files / rationale |
| --- | ---: | --- |
| VALID REGRESSION | 3 | `employee-deactivation-device-removal.test.js`: A, C, F. These assert the separate device-command lifecycle and require a dedicated investigation; Phase 35.5 must not change ZKTeco. |
| SUPERSEDED CONTRACT | 43 | `adversarial.test.js` (20), `attendance-engine.test.js` (17), `hardening.test.js` (6). They either make directionless/positional pairing a workday authority, expect multiple WORK/BREAK intervals from every punch, or classify tail punches as a missing canonical exit. These conflict with Phase 35.4. Useful fixtures must be retained and rewritten with explicit normalized ENTRY/EXIT evidence and canonical assertions. |
| OBSOLETE SIMULATION CONTRACT | 19 | `persistence-simulated.test.js` (3), `persistence.test.js` (15), `stabilization.test.js` STAB-003 (1). These use the retired frontend/in-memory persistence model or fields outside the approved backend-only `upsert_workday_record` contract. They must be reconciled against Phase 27's RPC contract before they are edited. |

The classification accounts for all 65 failures. It is an audit only: `TESTS_UPDATED = 0` and `TESTS_DISABLED = 0`.

## Reconciliation sequence

1. Restore the three server-side production SHADOW guard variables and obtain
   a passing no-network `--check-env`.
2. Run the approved V3 baseline, ENGINE_SHADOW, trace, and immediate read-only
   postcheck manually.
3. Preserve the 3 valid ZKTeco regressions for their separately authorized
   remediation.
4. Rewrite only the 43 superseded attendance assertions to explicitly test
   first ENTRY, first later EXIT, supplemental evidence, canonical metrics,
   and deterministic ordering.
5. Replace only the 19 obsolete simulated persistence tests with fixtures that
   invoke the approved server-only RPC service contract; no production writer
   may be introduced for test convenience.

Until both the V3 production replay and this reconciliation pass, PERSIST and
engine activation remain prohibited.
