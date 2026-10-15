# 03 — Database

**Estado:** IMPLEMENTADO (versioned migrations and candidate SQL); current Production contract is not fully verified in this documentation pass.

Historical Supabase migrations are under `supabase/migrations/`; current/live-schema operational SQL and candidates are under `database/live-schema/`. Read [migration workflow](../migrations/README.md) before using either path. Never replay historical migrations against an already-upgraded database.

Candidate Employee/security/WEB_CLOCK SQL is in `database/live-schema/proposals/`. The operator reports SQL 1/2/3 pending review and `public.fn_employee_portal` absent in Production. SQL 125 ZKTeco-only application and postcheck are operator-reported; this work did not access Production. Do not treat source files as proof of installed catalog state.

Security documentation must distinguish schema grants, function EXECUTE, RLS, and PostgREST schema exposure; each has a separate source of truth.
