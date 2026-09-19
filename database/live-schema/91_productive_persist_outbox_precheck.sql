-- Phase 91: read-only gate for the permanent, backend-only persistence flow.
BEGIN TRANSACTION READ ONLY;
WITH checks AS (
  SELECT
    to_regclass('public.registro_asistencia') IS NOT NULL AS registro_exists,
    to_regclass('public.attendance_source_events') IS NOT NULL AS source_events_exists,
    to_regclass('public.tenant_features') IS NOT NULL AS tenant_features_exists,
    to_regclass('public.workday_records') IS NOT NULL AS workdays_exists,
    to_regclass('public.workday_record_history') IS NOT NULL AS history_exists,
    to_regclass('public.attendance_persist_outbox') IS NULL AS outbox_absent_before_change,
    to_regprocedure('public.link_attendance_source_event(uuid)') IS NOT NULL AS canonical_link_rpc_exists,
    to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)') IS NOT NULL AS persistence_rpc_exists,
    EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled) AS pilot_resolver_active,
    NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') AS temporary_canary_closed,
    NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled) AS productive_authorization_closed,
    NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND cliente_id <> '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid) AS no_nonpilot_productive_authorization,
    EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.link_attendance_source_event(uuid)'::regprocedure AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) AS canonical_link_service_role_only
), flattened AS (
  SELECT entry.key, entry.value FROM checks CROSS JOIN LATERAL jsonb_each_text(to_jsonb(checks)) AS entry(key,value)
), failed AS (
  SELECT COALESCE(jsonb_agg(key ORDER BY key) FILTER (WHERE value <> 'true'), '[]'::jsonb) AS value FROM flattened
)
SELECT jsonb_build_object('phase','91_productive_persist_outbox_precheck','read_only',current_setting('transaction_read_only'),'checks',(SELECT to_jsonb(checks) FROM checks),'failed_checks',(SELECT value FROM failed),'pass',(SELECT value='[]'::jsonb FROM failed)) AS productive_persist_precheck;
ROLLBACK;
