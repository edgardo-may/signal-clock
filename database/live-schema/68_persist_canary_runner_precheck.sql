-- Phase 68: read-only evidence immediately before one V3 canary RPC call.
-- Save the returned JSON intact. The writer requires its MD5 fingerprint.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid registro_id,'69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,'2984316c-1c93-4f66-853e-349f90b9f82c'::uuid assignment_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid schedule_id,'2026-09-09'::date operative_date,'America/Cancun'::text timezone,
    '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid revision_id,1::integer revision_version,
    '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text revision_integrity_hash,3::integer calculation_version
), rpc AS (
  SELECT md5(pg_get_functiondef(p.oid)) fingerprint FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)')
), baseline AS (
  SELECT jsonb_build_object(
    'workday_records',(SELECT count(*) FROM public.workday_records),
    'workday_record_history',(SELECT count(*) FROM public.workday_record_history),
    'tenant_features',(SELECT count(*) FROM public.tenant_features),
    'incidencias',(SELECT count(*) FROM public.incidencias),
    'registro_asistencia',(SELECT count(*) FROM public.registro_asistencia),
    'attendance_source_events',(SELECT count(*) FROM public.attendance_source_events)
  ) counts
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.mode='PERSIST_CANARY' AND f.enabled AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.operative_date) exact_authorization_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') all_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.enabled AND f.mode='SHADOW') revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='ACTIVE') active_tenant_count,
    (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) target_history_rows,
    (SELECT xmin::text FROM public.registro_asistencia r,expected e WHERE r.id=e.registro_id AND r.cliente_id=e.cliente_id AND r.empleado_id=e.empleado_id) source_registro_xmin
)
SELECT jsonb_build_object(
  'phase','68_persist_canary_runner_precheck','read_only',current_setting('transaction_read_only'),
  'identity',jsonb_build_object('registro_id',e.registro_id,'cliente_id',e.cliente_id,'empleado_id',e.empleado_id,'assignment_id',e.assignment_id,'schedule_id',e.schedule_id,'operative_date',e.operative_date,'timezone',e.timezone,'schedule_revision_id',e.revision_id,'revision_version',e.revision_version,'revision_integrity_hash',e.revision_integrity_hash,'calculation_version',e.calculation_version),
  'rpc_v3_available',EXISTS(SELECT 1 FROM rpc),'rpc_fingerprint',(SELECT fingerprint FROM rpc),
  'exact_authorization_rows',s.exact_authorization_rows,'all_authorization_rows',s.all_authorization_rows,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',jsonb_build_array() || COALESCE((SELECT jsonb_agg(cliente_id) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='ACTIVE'),'[]'::jsonb),
  'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,
  'global_baseline',jsonb_build_object('phase','68_persist_canary_global_baseline','read_only',current_setting('transaction_read_only'),'counts',b.counts,'candidate_registro_xmin',s.source_registro_xmin),
  'runner_precheck_pass',EXISTS(SELECT 1 FROM rpc) AND s.exact_authorization_rows=1 AND s.all_authorization_rows=1 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0
    AND ((s.target_workday_rows=0 AND s.target_history_rows=0) OR (s.target_workday_rows=1 AND s.target_history_rows=1)) AND s.source_registro_xmin IS NOT NULL
) AS persist_canary_runner_precheck
FROM expected e CROSS JOIN state s CROSS JOIN baseline b;

ROLLBACK;
