-- Phase 75: final database-only diagnostic gate before any future SHADOW -> ACTIVE decision.
-- Compatible with Supabase SQL Editor. It performs no DML and leaves the
-- runtime-capability decision blocked until an ACTIVE-capable artifact exists.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid AS registro_id,
    '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AS assignment_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AS schedule_id,
    '2026-09-09'::date AS operative_date,
    '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid AS revision_id,
    '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text AS revision_hash,
    '5fe7ef34-7699-474b-b312-d0c5031a1fbe'::uuid AS workday_id,
    'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49'::text AS workday_hash,
    '668e4ccfa75a027b5fcc47d4963a06d1'::text AS workday_fingerprint,
    '0f87f945e84a9747e5bc275660bc7c0a'::text AS history_fingerprint,
    'a66376e83b8162084b2219d17ebdaadd'::text AS rpc_fingerprint,
    '16338'::text AS registro_xmin
), rpc AS (
  SELECT md5(pg_get_functiondef(p.oid)) AS fingerprint
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)')
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features f, expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) AS revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) AS active_tenant_count,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') AS persist_authorization_rows,
    (SELECT count(*) FROM public.empleados_horarios eh, expected e WHERE eh.cliente_id=e.cliente_id AND eh.empleado_id=e.empleado_id AND eh.activo IS TRUE AND eh.fecha_inicio<=e.operative_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=e.operative_date)) AS applicable_assignment_count,
    (SELECT count(*) FROM public.empleados_horarios a JOIN public.empleados_horarios b ON b.cliente_id=a.cliente_id AND b.empleado_id=a.empleado_id AND b.id>a.id AND a.activo IS TRUE AND b.activo IS TRUE AND daterange(a.fecha_inicio,COALESCE(a.fecha_fin,'infinity'::date),'[]') && daterange(b.fecha_inicio,COALESCE(b.fecha_fin,'infinity'::date),'[]'), expected e WHERE a.cliente_id=e.cliente_id AND a.empleado_id=e.empleado_id) AS ambiguous_historic_assignment_pairs,
    (SELECT count(*) FROM public.workday_records w, expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) AS target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h, expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) AS target_history_rows,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',w.id::text,w.cliente_id::text,w.empleado_id::text,w.workday_date::text,w.schedule_id::text,w.integrity_hash,w.calculation_version::text),'|' ORDER BY w.id::text),'')) FROM public.workday_records w, expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) AS workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',h.workday_record_id::text,h.cliente_id::text,h.empleado_id::text,h.workday_date::text,h.integrity_hash,h.calculation_version::text,h.action),'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h, expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) AS history_fingerprint,
    (SELECT count(*) FROM public.registro_asistencia r, expected e WHERE r.id=e.registro_id AND r.cliente_id=e.cliente_id AND r.empleado_id=e.empleado_id) AS canary_registro_rows,
    (SELECT xmin::text FROM public.registro_asistencia r, expected e WHERE r.id=e.registro_id AND r.cliente_id=e.cliente_id AND r.empleado_id=e.empleado_id) AS source_registro_xmin,
    (SELECT count(*) FROM public.incidencias) AS incidencias_count,
    (SELECT count(*) FROM public.registro_asistencia) AS registro_asistencia_count,
    (SELECT count(*) FROM public.attendance_source_events) AS attendance_source_events_count
), target AS (
  SELECT
    eh.id AS assignment_id,eh.cliente_id AS assignment_cliente_id,eh.empleado_id AS assignment_empleado_id,eh.horario_id,eh.schedule_revision_id,eh.activo,eh.fecha_inicio,eh.fecha_fin,
    sr.id AS revision_id,sr.cliente_id AS revision_cliente_id,sr.horario_id AS revision_schedule_id,sr.version AS revision_version,sr.integrity_hash AS revision_integrity_hash,sr.config_snapshot,
    w.id AS workday_id,w.integrity_hash AS workday_hash,w.calculation_version AS workday_calculation_version,
    h.workday_record_id AS history_workday_id,h.integrity_hash AS history_integrity_hash,h.calculation_version AS history_calculation_version,h.action AS history_action
  FROM expected e
  LEFT JOIN public.empleados_horarios eh ON eh.id=e.assignment_id AND eh.cliente_id=e.cliente_id
  LEFT JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id
  LEFT JOIN public.workday_records w ON w.id=e.workday_id AND w.cliente_id=e.cliente_id
  LEFT JOIN public.workday_record_history h ON h.workday_record_id=e.workday_id AND h.cliente_id=e.cliente_id
), checks AS (
  SELECT jsonb_build_object(
    'canary_registro_exists',s.canary_registro_rows=1,
    'canary_registro_xmin_match',s.source_registro_xmin=e.registro_xmin,
    'target_workday_count_match',s.target_workday_rows=1,
    'target_history_count_match',s.target_history_rows=1,
    'workday_fingerprint_match',s.workday_fingerprint=e.workday_fingerprint,
    'history_fingerprint_match',s.history_fingerprint=e.history_fingerprint,
    'assignment_count_match',s.applicable_assignment_count=1 AND t.assignment_id=e.assignment_id AND t.assignment_cliente_id=e.cliente_id AND t.assignment_empleado_id=e.empleado_id AND t.horario_id=e.schedule_id AND t.activo IS TRUE AND t.fecha_inicio<=e.operative_date AND (t.fecha_fin IS NULL OR t.fecha_fin>=e.operative_date),
    'historic_ambiguity_clear',s.ambiguous_historic_assignment_pairs=0,
    'revision_exists',t.revision_id=e.revision_id AND t.schedule_revision_id=e.revision_id AND t.revision_cliente_id=e.cliente_id AND t.revision_schedule_id=e.schedule_id,
    'revision_version_match',t.revision_version=1,
    'revision_integrity_hash_match',t.revision_integrity_hash=e.revision_hash AND public.schedule_revision_calculation_hash(t.config_snapshot)=e.revision_hash,
    'revision_feature_shadow',s.revision_shadow_rows=1,
    'active_tenants_zero',s.active_tenant_count=0,
    'persist_authorization_absent',s.persist_authorization_rows=0,
    'rpc_fingerprint_match',(SELECT fingerprint FROM rpc)=e.rpc_fingerprint,
    'calculation_version_match',t.workday_id=e.workday_id AND t.workday_hash=e.workday_hash AND t.workday_calculation_version=3 AND t.history_workday_id=e.workday_id AND t.history_integrity_hash=e.workday_hash AND t.history_calculation_version=3 AND t.history_action='INSERTED',
    -- 44/14 are legitimate later activity. Counts are monotonic safety floors;
    -- the exact canary record and xmin above are the immutable source evidence.
    'source_activity_policy_pass',s.incidencias_count>=7 AND s.registro_asistencia_count>=41 AND s.attendance_source_events_count>=12
  ) AS database_checks
  FROM expected e CROSS JOIN state s CROSS JOIN target t
), failed AS (
  SELECT COALESCE(jsonb_agg(key ORDER BY key) FILTER (WHERE value='false'),'[]'::jsonb) AS failed_database_checks
  FROM checks c CROSS JOIN LATERAL jsonb_each_text(c.database_checks)
)
SELECT jsonb_build_object(
  'phase','75_revision_resolver_final_active_precheck',
  'read_only',current_setting('transaction_read_only'),
  'identity',jsonb_build_object('cliente_id',e.cliente_id,'empleado_id',e.empleado_id,'registro_id',e.registro_id,'assignment_id',e.assignment_id,'schedule_id',e.schedule_id,'operative_date',e.operative_date,'revision_id',e.revision_id),
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,
  'active_tenants',s.active_tenant_count,'persist_authorization_rows',s.persist_authorization_rows,
  'applicable_assignment_count',s.applicable_assignment_count,'ambiguous_historic_assignment_pairs',s.ambiguous_historic_assignment_pairs,
  'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,'workday_fingerprint',s.workday_fingerprint,'history_fingerprint',s.history_fingerprint,
  'rpc_fingerprint',(SELECT fingerprint FROM rpc),'source_registro_xmin',s.source_registro_xmin,
  'source_counts',jsonb_build_object('incidencias',s.incidencias_count,'registro_asistencia',s.registro_asistencia_count,'attendance_source_events',s.attendance_source_events_count),
  'database_checks',c.database_checks,'failed_database_checks',f.failed_database_checks,
  'database_final_active_precheck_pass',current_setting('transaction_read_only')='on' AND f.failed_database_checks='[]'::jsonb,
  'runtime_active_compatibility_required',true,
  'active_precheck_pass',false,
  'active_precheck_blocker','ACTIVE_RUNTIME_COMPATIBILITY_NOT_IMPLEMENTED',
  'active_readiness','NO_GO_UNTIL_ACTIVE_CAPABLE_RUNTIME_IS_DEPLOYED'
) AS revision_resolver_final_active_precheck
FROM expected e CROSS JOIN state s CROSS JOIN checks c CROSS JOIN failed f;

ROLLBACK;
