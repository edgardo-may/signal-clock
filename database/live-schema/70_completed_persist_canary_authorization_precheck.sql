-- Phase 70: READ ONLY evidence before retiring the successfully completed V3 canary authorization.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,'6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,
    '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid registro_id,'5a753368-f019-4230-89e2-79beaa39ff0f'::uuid schedule_id,
    '2026-09-09'::date workday_date,'5fe7ef34-7699-474b-b312-d0c5031a1fbe'::uuid workday_id,
    'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49'::text integrity_hash,3::integer calculation_version,'16338'::text registro_xmin
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') total_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.mode='PERSIST_CANARY' AND f.enabled IS TRUE AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.workday_date) exact_authorization_rows,
    (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.workday_date) target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.workday_date) target_history_rows,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',w.id::text,w.cliente_id::text,w.empleado_id::text,w.workday_date::text,w.schedule_id::text,w.integrity_hash,w.calculation_version::text),'|' ORDER BY w.id::text),'')) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.workday_date) workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',h.workday_record_id::text,h.cliente_id::text,h.empleado_id::text,h.workday_date::text,h.integrity_hash,h.calculation_version::text,h.action),'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.workday_date) history_fingerprint,
    (SELECT xmin::text FROM public.registro_asistencia r,expected e WHERE r.id=e.registro_id AND r.cliente_id=e.cliente_id AND r.empleado_id=e.empleado_id) source_registro_xmin,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) active_tenant_count,
    (SELECT count(*) FROM public.incidencias) incidencias_count,(SELECT count(*) FROM public.registro_asistencia) registro_asistencia_count,(SELECT count(*) FROM public.attendance_source_events) attendance_source_events_count
)
SELECT jsonb_build_object(
  'phase','70_completed_persist_canary_authorization_precheck','read_only',current_setting('transaction_read_only'),
  'identity',jsonb_build_object('cliente_id',e.cliente_id,'empleado_id',e.empleado_id,'registro_id',e.registro_id,'schedule_id',e.schedule_id,'workday_date',e.workday_date,'workday_id',e.workday_id,'integrity_hash',e.integrity_hash,'calculation_version',e.calculation_version),
  'total_authorization_rows',s.total_authorization_rows,'exact_authorization_rows',s.exact_authorization_rows,
  'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,'workday_fingerprint',s.workday_fingerprint,'history_fingerprint',s.history_fingerprint,'source_registro_xmin',s.source_registro_xmin,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',s.active_tenant_count,
  'current_counts',jsonb_build_object('incidencias',s.incidencias_count,'registro_asistencia',s.registro_asistencia_count,'attendance_source_events',s.attendance_source_events_count),
  'safe_to_retire_completed_canary_authorization',s.total_authorization_rows=1 AND s.exact_authorization_rows=1 AND s.target_workday_rows=1 AND s.target_history_rows=1 AND s.source_registro_xmin=e.registro_xmin AND s.revision_shadow_rows=1 AND s.active_tenant_count=0 AND s.incidencias_count=7 AND s.registro_asistencia_count=41 AND s.attendance_source_events_count=12
    AND EXISTS(SELECT 1 FROM public.workday_records w WHERE w.id=e.workday_id AND w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.workday_date AND w.schedule_id=e.schedule_id AND w.integrity_hash=e.integrity_hash AND w.calculation_version=e.calculation_version)
    AND EXISTS(SELECT 1 FROM public.workday_record_history h WHERE h.workday_record_id=e.workday_id AND h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.workday_date AND h.integrity_hash=e.integrity_hash AND h.calculation_version=e.calculation_version AND h.action='INSERTED')
) AS completed_persist_canary_authorization_precheck
FROM expected e CROSS JOIN state s;

ROLLBACK;
