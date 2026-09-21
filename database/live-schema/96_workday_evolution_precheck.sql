-- Phase 96: read-only readiness for controlled INSERTED/UPDATED/UNCHANGED/STALE.
BEGIN TRANSACTION READ ONLY;
WITH checks AS (
  SELECT
    to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid)') IS NOT NULL AS legacy_16_arg_rpc_exists,
    to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer)') IS NULL AS evolution_rpc_absent,
    NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled) AS productive_gate_closed,
    NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') AS temporary_canary_closed,
    to_regclass('public.workday_records') IS NOT NULL AND to_regclass('public.workday_record_history') IS NOT NULL AND to_regclass('public.attendance_persist_outbox') IS NOT NULL AS persistence_relations_exist,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.workday_record_history'::regclass AND conname='workday_record_history_identity_key' AND convalidated) AS history_identity_constraint_valid,
    EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid)'::regprocedure AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) AS legacy_rpc_service_role_only
), entries AS (SELECT entry.key,entry.value FROM checks CROSS JOIN LATERAL jsonb_each_text(to_jsonb(checks)) AS entry(key,value)), failed AS (SELECT COALESCE(jsonb_agg(key ORDER BY key) FILTER (WHERE value<>'true'),'[]'::jsonb) AS value FROM entries)
SELECT jsonb_build_object('phase','96_workday_evolution_precheck','read_only',current_setting('transaction_read_only'),'checks',(SELECT to_jsonb(checks) FROM checks),'failed_checks',(SELECT value FROM failed),'pass',(SELECT value='[]'::jsonb FROM failed)) FROM checks;
ROLLBACK;
