-- Phase 73: READ ONLY database readiness gate for a future SHADOW -> ACTIVE decision.
-- It does not activate any feature. Cloud Run build/version is verified separately
-- by backend/attendance-runtime/active-readiness-runtime-check.js.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,'6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,'2984316c-1c93-4f66-853e-349f90b9f82c'::uuid assignment_id,'5a753368-f019-4230-89e2-79beaa39ff0f'::uuid schedule_id,'2026-09-09'::date operative_date,'09df6a75-e231-4654-ae70-8448bdf2c312'::uuid revision_id,'77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text revision_hash,'5fe7ef34-7699-474b-b312-d0c5031a1fbe'::uuid workday_id,'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49'::text workday_hash,'668e4ccfa75a027b5fcc47d4963a06d1'::text workday_fingerprint,'0f87f945e84a9747e5bc275660bc7c0a'::text history_fingerprint,'a66376e83b8162084b2219d17ebdaadd'::text rpc_fingerprint
), rpc AS (
  SELECT md5(pg_get_functiondef(p.oid)) fingerprint FROM pg_proc p WHERE p.oid=to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)')
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) active_tenant_count,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') persist_authorization_rows,
    (SELECT count(*) FROM public.empleados_horarios eh,expected e WHERE eh.cliente_id=e.cliente_id AND eh.empleado_id=e.empleado_id AND eh.activo IS TRUE AND eh.fecha_inicio<=e.operative_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=e.operative_date)) applicable_assignment_count,
    (SELECT count(*) FROM public.empleados_horarios a JOIN public.empleados_horarios b ON b.cliente_id=a.cliente_id AND b.empleado_id=a.empleado_id AND b.id>a.id AND b.activo IS TRUE AND a.activo IS TRUE AND daterange(a.fecha_inicio,COALESCE(a.fecha_fin,'infinity'::date),'[]') && daterange(b.fecha_inicio,COALESCE(b.fecha_fin,'infinity'::date),'[]') , expected e WHERE a.cliente_id=e.cliente_id AND a.empleado_id=e.empleado_id) ambiguous_historic_assignment_pairs,
    (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) target_history_rows,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',w.id::text,w.cliente_id::text,w.empleado_id::text,w.workday_date::text,w.schedule_id::text,w.integrity_hash,w.calculation_version::text),'|' ORDER BY w.id::text),'')) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',h.workday_record_id::text,h.cliente_id::text,h.empleado_id::text,h.workday_date::text,h.integrity_hash,h.calculation_version::text,h.action),'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) history_fingerprint
), target AS (
  SELECT eh.id assignment_id,eh.horario_id,eh.schedule_revision_id,eh.activo,eh.fecha_inicio,eh.fecha_fin,sr.cliente_id revision_cliente_id,sr.horario_id revision_schedule_id,sr.version,sr.integrity_hash,sr.config_snapshot,w.id workday_id,w.integrity_hash workday_hash,w.calculation_version
  FROM expected e LEFT JOIN public.empleados_horarios eh ON eh.id=e.assignment_id AND eh.cliente_id=e.cliente_id LEFT JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id LEFT JOIN public.workday_records w ON w.id=e.workday_id AND w.cliente_id=e.cliente_id
)
SELECT jsonb_build_object(
  'phase','73_revision_resolver_active_readiness_precheck','read_only',current_setting('transaction_read_only'),'runtime_live_evidence_required',true,'expected_runtime',jsonb_build_object('runtime_version','attendance-runtime-v1','build_sha','6a36e31633594c4b256b03b5d3ca02a72ed8874d8b941a37affa1723e34c6d66'),
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',s.active_tenant_count,'persist_authorization_rows',s.persist_authorization_rows,'applicable_assignment_count',s.applicable_assignment_count,'ambiguous_historic_assignment_pairs',s.ambiguous_historic_assignment_pairs,
  'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,'workday_fingerprint',s.workday_fingerprint,'history_fingerprint',s.history_fingerprint,'rpc_fingerprint',(SELECT fingerprint FROM rpc),
  'database_active_readiness_pass',s.revision_shadow_rows=1 AND s.active_tenant_count=0 AND s.persist_authorization_rows=0 AND s.applicable_assignment_count=1 AND s.ambiguous_historic_assignment_pairs=0 AND s.target_workday_rows=1 AND s.target_history_rows=1 AND s.workday_fingerprint=e.workday_fingerprint AND s.history_fingerprint=e.history_fingerprint AND (SELECT fingerprint FROM rpc)=e.rpc_fingerprint
    AND t.assignment_id=e.assignment_id AND t.horario_id=e.schedule_id AND t.activo IS TRUE AND t.fecha_inicio<=e.operative_date AND (t.fecha_fin IS NULL OR t.fecha_fin>=e.operative_date) AND t.schedule_revision_id=e.revision_id AND t.revision_cliente_id=e.cliente_id AND t.revision_schedule_id=e.schedule_id AND t.version=1 AND t.integrity_hash=e.revision_hash AND public.schedule_revision_calculation_hash(t.config_snapshot)=e.revision_hash
    AND t.workday_id=e.workday_id AND t.workday_hash=e.workday_hash AND t.calculation_version=3,
  'active_readiness','NO_GO_UNTIL_RUNTIME_LIVE_EVIDENCE'
) AS revision_resolver_active_readiness_precheck
FROM expected e CROSS JOIN state s CROSS JOIN target t;

ROLLBACK;
