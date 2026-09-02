# Clean baseline

`000_current_schema_baseline.sql` must be generated from a verified, isolated current schema using `scripts/generate-current-schema-baseline.mjs`; it must never be hand-authored from inferred migrations. It contains schema only, never tenant/auth/attendance data.

Its reviewed header is `SIGNUM_SCHEMA_BASELINE_2026_09`, `schema_revision: 047`, and an explicit `generated_at` date supplied to the generator. The generator uses `pg_dump --schema-only --no-owner --no-privileges` and refuses a production-like host or detected real data/secret-like assignment.

Fresh installation: baseline + migrations newer than its declared `schema_revision`.
Existing installation: historical migrations only. Never combine both routes.
