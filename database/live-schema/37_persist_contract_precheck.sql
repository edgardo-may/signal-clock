-- Phase 36.1: read-only precheck for the V3 persistence contract change.
BEGIN TRANSACTION READ ONLY;

DO $preflight$
BEGIN
  IF to_regclass('public.workday_records') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.workday_records is absent';
  END IF;
END
$preflight$;

WITH expected AS (
  SELECT
    'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text)'::text AS legacy_signature,
    'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)'::text AS v3_signature
),
state AS (
  SELECT
    to_regclass('public.workday_records') IS NOT NULL AS workday_records_exists,
    to_regclass('public.workday_record_history') IS NOT NULL AS history_exists,
    to_regclass('public.tenant_features') IS NOT NULL AS tenant_features_exists,
    to_regprocedure(expected.legacy_signature) IS NOT NULL AS legacy_rpc_exists,
    to_regprocedure(expected.v3_signature) IS NOT NULL AS v3_rpc_exists,
    (SELECT count(*) FROM public.workday_records) AS workday_rows
  FROM expected
)
SELECT jsonb_build_object(
  'phase', '36_1_persist_contract_precheck',
  'read_only', current_setting('transaction_read_only'),
  'workday_records_exists', state.workday_records_exists,
  'workday_rows', state.workday_rows,
  'history_exists', state.history_exists,
  'tenant_features_exists', state.tenant_features_exists,
  'legacy_rpc_exists', state.legacy_rpc_exists,
  'v3_rpc_exists', state.v3_rpc_exists,
  'change_required', NOT (
    state.history_exists AND state.tenant_features_exists AND state.v3_rpc_exists
  ),
  'safe_to_change', state.workday_records_exists
    AND state.legacy_rpc_exists
    AND NOT state.v3_rpc_exists
    AND state.workday_rows >= 0
) AS persist_contract_precheck
FROM state;

ROLLBACK;
