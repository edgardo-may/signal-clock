-- Phase 36.1: read-only postcheck for the V3 persistence contract.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT 'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)'::text AS signature
), fn AS (
  SELECT p.*
  FROM pg_proc p CROSS JOIN expected e
  WHERE p.oid = to_regprocedure(e.signature)
), checks AS (
  SELECT
    to_regclass('public.workday_records') IS NOT NULL AS workday_records_exists,
    to_regclass('public.workday_record_history') IS NOT NULL AS history_exists,
    to_regclass('public.tenant_features') IS NOT NULL AS tenant_features_exists,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workday_records' AND column_name = 'calculation_version') AS calculation_version_exists,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records') AND conname = 'workday_records_calculation_version_check' AND convalidated) AS calculation_version_constraint_exists,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_record_history') AND conname = 'workday_record_history_identity_key' AND contype = 'u' AND convalidated) AS history_idempotency_constraint_exists,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_record_history') AND conname = 'workday_record_history_version_check' AND convalidated) AS history_version_constraint_exists,
    EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.workday_record_history') AND relrowsecurity) AS history_rls_enabled,
    EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.tenant_features') AND relrowsecurity) AS tenant_features_rls_enabled,
    EXISTS (SELECT 1 FROM fn WHERE NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public']) AS rpc_security_valid,
    EXISTS (SELECT 1 FROM fn WHERE NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE')) AS grants_valid,
    EXISTS (SELECT 1 FROM fn WHERE lower(pg_get_functiondef(oid)) LIKE '%workday_record_history%' AND lower(pg_get_functiondef(oid)) LIKE '%calculation_version%') AS atomic_history_version_path,
    NOT EXISTS (SELECT 1 FROM fn WHERE lower(pg_get_functiondef(oid)) LIKE '%incidencias%') AS no_incident_path
)
SELECT jsonb_build_object(
  'phase', '36_1_persist_contract_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'workday_records_exists', workday_records_exists,
  'history_exists', history_exists,
  'tenant_features_exists', tenant_features_exists,
  'calculation_version_exists', calculation_version_exists,
  'calculation_version_constraint_exists', calculation_version_constraint_exists,
  'history_idempotency_constraint_exists', history_idempotency_constraint_exists,
  'history_version_constraint_exists', history_version_constraint_exists,
  'history_rls_enabled', history_rls_enabled,
  'tenant_features_rls_enabled', tenant_features_rls_enabled,
  'rpc_security_valid', rpc_security_valid,
  'grants_valid', grants_valid,
  'atomic_history_version_path', atomic_history_version_path,
  'no_incident_path', no_incident_path,
  'postcheck_pass', workday_records_exists AND history_exists AND tenant_features_exists
    AND calculation_version_exists AND calculation_version_constraint_exists
    AND history_idempotency_constraint_exists AND history_version_constraint_exists
    AND history_rls_enabled AND tenant_features_rls_enabled
    AND rpc_security_valid AND grants_valid
    AND atomic_history_version_path AND no_incident_path
) AS persist_contract_postcheck
FROM checks;

ROLLBACK;
