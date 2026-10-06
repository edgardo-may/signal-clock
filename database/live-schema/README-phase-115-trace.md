# Phase B database trace

These files are explicitly selected operational artifacts, not an automatically executable migration chain. No runner that enumerates all SQL in `database/live-schema` was found during consolidation. The repository's glob-based migration runners use `supabase/migrations`; the live-schema history-hotfix runner selects specific filenames.

| File | Classification | Source |
| --- | --- | --- |
| `115_scoped_workday_persist_authorization.sql` | MIGRATION | Exact Git blob from `39da4ef4885d0d8637ebf1c7c032e4984f2afa04` at this path |
| `115_scoped_workday_persist_authorization_preflight.sql` | READ-ONLY OPERATIONAL CHECK | Exact Git blob from `cc3545f73f3e30078bbb7514edaaa67d2a704f0a`, originally under `database/live-schema/repairs/` |
| `115_scoped_workday_persist_authorization_repair.sql` | IDEMPOTENT PRODUCTION REPAIR | Exact Git blob from `cc3545f73f3e30078bbb7514edaaa67d2a704f0a`, originally under `database/live-schema/repairs/` |
| `115_scoped_workday_persist_authorization_postcheck.sql` | READ-ONLY OPERATIONAL CHECK | Exact Git blob from `cc3545f73f3e30078bbb7514edaaa67d2a704f0a`, originally under `database/live-schema/repairs/` |
| `116_schedule_employee_guard_change.sql` | NEXT MIGRATION / HORARIOS | Byte-exact snapshot of the uncommitted Horarios draft in `.worktrees/horarios-phase1/database/live-schema/`; not a historical Git recovery |

Repair SHA256: `7CD8036A90FEDA1E465804BD4874DB48EF96FF7793571B9E750C7A849888A27F`.

The original migration 115 is not idempotent. Its presence is traceability, not authorization to reapply it to production. For the known partial-production drift, use only the separately authorized repair, with its preflight and postcheck.

Migration 116 remains unapplied and requires completion of Attendance production closure and separate authorization. Its consolidation does not certify subsequent Horarios draft changes. SQL contents were not edited; no SQL was executed as part of consolidation. The source commits and worktrees remain intact.
