# Database

**Status:** source includes migrations and candidate SQL; installed Production contract is not fully verified.

Historical Supabase migrations live under `supabase/migrations/`; live-schema operational SQL and proposals live under `database/live-schema/`. Read [migration workflow](../migrations/README.md) before use. Never replay historical migrations against an upgraded database.

Employee SQL 1/2/3, their dependencies, security assessment, read-only catalog queries, proposed install/stop procedure, and Directory/Session acceptance criteria are in the [Employee contract install plan](employee-contract-install-plan.md). The operator reports `public.fn_employee_portal` absent in Production; no other object status is inferred. SQL 125 ZKTeco-only is operator-reported as applied with postcheck PASS; it was not revalidated here.

The Employee proposals have DBREAL-only guards and broader ACL, policy, outbox, and Attendance effects. They are not ready for direct Production application. **READY TO APPLY: NO.** SQL4 default privileges remains excluded/hold. Do not execute candidates based only on this documentation.
