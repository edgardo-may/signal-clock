# AUTO classification, phases 104-106

PostgreSQL `fn_sync_attendance_to_registro()` is the sole direction authority.
The connector transports the received status token unchanged, including an
empty string. Missing status becomes SQL NULL. Numeric explicit codes remain
numeric RAW; the existing database mappings accept both codes and aliases.

For `255`, `-1`, `auto`, `undefined`, empty or NULL (case/whitespace normalized
only for comparison), the function acquires a transaction advisory lock on a
64-bit hash of `attendance-auto-cycle-v1:<tenant UUID>:<employee UUID>`. It then
issues a separate SELECT for the last entrada/salida in
`[new timestamp - 18 hours, new timestamp)`, ordered by verificado_at, creado_at
and id descending. An entrada closes with salida; anything else opens entrada.
Breaks/extras, schedules, tolerances and calendar dates do not decide AUTO.

The function remains VOLATILE. READ COMMITTED gives the SELECT a fresh snapshot
after waiting for the lock. AUTO under REPEATABLE READ or SERIALIZABLE fails
closed with SQLSTATE 40001 / AUTO_CYCLE_REQUIRES_READ_COMMITTED, rather than
classifying against a stale snapshot. Retry requires a READ COMMITTED transaction.
Explicit status mappings and their existing behavior are unchanged.

## Scope and limits

- There is no backfill. P5/P9 and every historical row stay unchanged.
- The original employee/device lookup, biometric method, INSERT, trigger,
  ownership and grants are preserved. This is not an identity-resolution fix.
- The lock serializes AUTO ingestions for one tenant/employee; it does not
  synchronize unrelated writers or explicit punches with AUTO.
- A previous entry exactly 18 hours old qualifies; older entries do not.
- Events with the same timestamp as the new event are excluded. Tie-breaking
  applies to previous candidates, not to simultaneous target timestamps.
- The concurrency guarantee tested is that a later-timestamp AUTO, waiting
  behind an earlier-timestamp AUTO, sees the committed predecessor. An AUTO
  whose timestamp is equal to or older than the latest stored entrada/salida is
  rejected with SQLSTATE 22023 and `AUTO_CYCLE_OUT_OF_ORDER`; it is not inserted.
  The lock does not reorder event time, so callers must retry only with a valid
  later timestamp or handle the rejection explicitly.
- The 64-bit advisory hash has a theoretical collision risk (extra contention,
  not cross-tenant reads). No global classification lock is introduced.
- Workday grouping, UI grouping and schedule matching are separate, unchanged.

## Migration and verification

104 is read-only and validates a normalized fingerprint of the operator-supplied
function plus the enabled AFTER INSERT ROW trigger binding. 105 repeats these
guards, temporarily locks ATTLOG ingestion for the definition change and replaces
the function. It performs no attendance DML. 106 verifies the complete new body
and original binding in a read-only transaction. Drift aborts instead of silently
overwriting a different installed function. Historical migrations are untouched.

Run locally with an explicitly selected Supabase stack:

```text
node scripts/run-dbreal-auto-cycle.mjs LOCAL_WORKDIR SUPABASE_CLI
npm.cmd test
npm.cmd run build
cd zkteco-push-ta
npm.cmd test
npm.cmd run build
```

The runner rejects non-loopback DB/API URLs, uses only TEST credentials from
that stack and runs AUTO DBREAL plus the existing Phase 99 regression serially.
It never reads backend/.env. Tests use the actual ATTLOG trigger and two PostgreSQL
connections for lock waiting; parser-to-DB tests import the real TS parser.
UUID fixture rows are cleaned and the original local function is restored even
on failure. The migration test compares attendance/workday/history digests before
and after installation and verifies ownership/grants/function attributes.

Production and VM deployment were not performed. A future rollout must validate
104 on the target, apply 105 and verify 106 before deploying RAW preservation.
The previous VM still invents check_in for empty status until its update; deploy
coordination is therefore required. Readiness also needs an explicit decision on
the reverse-order/equal-timestamp limitation above; no historical reclassification
is included in this phase.

## Local validation (2026-09-24)

- `signum-dbreal-local`: 36/36 test-runner results passed, zero skips
  (AUTO cases plus Phase 99, including an explicit reverse-arrival limitation test).
- Root `npm.cmd test`: 22/22 passed; root build passed (existing chunk-size warning).
- Connector `npm.cmd test`: 79/79 passed; connector TypeScript build passed.
- Scoped diff/whitespace checks passed in both repositories, including new files.
- Equal and reverse-arrival AUTO rejection is covered by DBREAL.
- No production access, VM deployment, historical backfill, commit or push occurred.
