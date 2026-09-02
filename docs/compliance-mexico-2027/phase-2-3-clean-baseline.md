# Phase 2.3 Clean Baseline + DBREAL Harness

## Verdict

**PHASE 2.3: FAIL**  
**READY FOR DBREAL EXECUTION: NO**

No Phase 3 work was started. Historical migrations 001–047 were preserved.

## Baseline strategy

Two routes are now documented: existing installations retain their historical upgrade chain; clean TEST/CI/future installations use a schema-only baseline plus migrations newer than its declared revision. See `supabase/baseline/README.md` and `docs/migrations/README.md`.

The baseline itself is intentionally not fabricated. `scripts/generate-current-schema-baseline.mjs` generates it via `pg_dump --schema-only --no-owner --no-privileges` from an authorized isolated current database. The generated file must receive reviewed immutable metadata (`SIGNUM_SCHEMA_BASELINE_2026_09`, revision) before becoming the supported baseline. It exports no data, secrets or auth users.

## 041 drift

`docs/migrations/041-attendance-logs-schema-history.md` records the evidence: 029 uses `numero_serie` and `biometric_user_id`, while 041 expects `device_serial` and `user_id`; no repository rename exists. Cause is unknown. A later migration cannot repair a fresh chain that fails at 041, so new installations must use the generated baseline route until a supported pre-041 bridge is formally decided.

## Harness and safety

`tests/helpers/testDb.js` creates isolated tenants, auth users, profiles, employee links, schedule assignment, feature flag and raw log fixtures using the service client. It creates distinct anon/authenticated/service clients and cleans up fixture tenants/users.

`tests/compliance/db-real.test.js` has no `assert.fail` placeholders. It implements RPC permissions, RLS, metadata tampering, source tenant/window validation, history mutation, concurrent same/different hashes, reconciliation, snapshots and employee-link integrity. The remaining requested DBREAL cases (fault injection rollback, night-shift retrieval, ambiguous assignment, and feature OFF/SHADOW) still need implementation before this phase can pass. It skips unless all TEST-only settings are present:

- `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `PHASE2_AUDIT_DATABASE_URL`
- `PHASE2_AUDIT_DB_LABEL=local|test|staging`
- `ALLOW_DESTRUCTIVE_TEST_DB=true`

Production-like hostnames are rejected. No credentials are printed.

## Bootstrap and equivalence

`scripts/verify-clean-migrations.mjs` applies ordered migrations to an empty isolated DB and reports each duration/result. It is retained for historical-chain diagnostics. The baseline generator is the official clean-route precursor; a catalog equivalence report is still required after generation (tables, columns, constraints, indexes, functions, triggers, RLS and policies).

## Results

| Gate | Result |
|---|---|
| Fase 1 | 75/75 PASS |
| Fase 2 mocks | 15/15 PASS |
| Fase 2 simulated | 3/3 PASS |
| Stabilization | 14/14 PASS |
| DBREAL harness | 13 implemented, 13 skipped without TEST DB |
| Typecheck | PASS |
| Build | PASS; Vite chunk-size warning |

## Conditions before DBREAL

1. Provision an isolated local/test/staging Supabase database.
2. Generate and review the baseline from an actual known-good schema; add equivalence comparison output.
3. Set the required environment variables in ignored `.env.test.local`.
4. Implement the remaining DBREAL cases, then run bootstrap/baseline, post-baseline migrations, and DBREAL with zero critical skips.
