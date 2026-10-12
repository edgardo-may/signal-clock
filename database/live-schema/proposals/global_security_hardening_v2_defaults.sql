-- PROPOSAL, UNNUMBERED; caller owns transaction; no production authorization.
-- GLOBAL PUBLIC-function revocation has cross-schema impact. Separate review gate.
DO $guard$
BEGIN
  IF current_setting('signum.hardening_design', true) IS DISTINCT FROM 'DBREAL_ROLLBACK_ONLY'
     OR current_setting('signum.global_function_defaults_reviewed', true) IS DISTINCT FROM 'DBREAL_PROBE_ONLY' THEN
    RAISE EXCEPTION 'DEFAULTS_REQUIRE_SEPARATE_IMPACT_REVIEW';
  END IF;
END
$guard$;

DO $defaults$
DECLARE creator text;
BEGIN
  FOREACH creator IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    -- PUBLIC EXECUTE is a built-in GLOBAL default. IN SCHEMA REVOKE alone
    -- cannot remove it. This line affects NEW routines in ALL schemas by creator.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role', creator);
  END LOOP;
END
$defaults$;

-- Existing objects are unchanged by defaults. Future browser objects need an
-- explicit reviewed GRANT in their own change. Do not replay Supabase bootstrap.
