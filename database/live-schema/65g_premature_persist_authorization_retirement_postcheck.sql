-- Phase 65g: READ ONLY postcheck after Phase 65f. Baseline is the reviewed
-- Phase 65e observation and is explicit for Supabase SQL Editor reproducibility.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,'5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid registro_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,'5a753368-f019-4230-89e2-79beaa39ff0f'::uuid schedule_id,'2026-09-09'::date operative_date
), baseline AS (
  SELECT 0::bigint target_workday_rows,0::bigint target_history_rows,
    'd41d8cd98f00b204e9800998ecf8427e'::text target_workday_fingerprint,
    'd41d8cd98f00b204e9800998ecf8427e'::text target_history_fingerprint
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') total_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.operative_date) premature_authorization_rows,
    (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) target_history_rows,
    (SELECT md5(COALESCE(string_agg(to_jsonb(w)::text,'|' ORDER BY w.id::text),'')) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) target_workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(to_jsonb(h)::text,'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) target_history_fingerprint,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) active_tenant_count
)
SELECT jsonb_build_object(
  'phase','65g_premature_persist_authorization_retirement_postcheck','read_only',current_setting('transaction_read_only'),
  'baseline_valid',b.target_workday_rows=0 AND b.target_history_rows=0 AND b.target_workday_fingerprint='d41d8cd98f00b204e9800998ecf8427e' AND b.target_history_fingerprint='d41d8cd98f00b204e9800998ecf8427e',
  'total_authorization_rows',s.total_authorization_rows,'premature_authorization_rows',s.premature_authorization_rows,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',s.active_tenant_count,
  'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,
  'target_workday_fingerprint',s.target_workday_fingerprint,'target_history_fingerprint',s.target_history_fingerprint,
  'business_records_unchanged',s.target_workday_rows=b.target_workday_rows AND s.target_history_rows=b.target_history_rows AND s.target_workday_fingerprint=b.target_workday_fingerprint AND s.target_history_fingerprint=b.target_history_fingerprint,
  'safe_to_rerun_phase_65',b.target_workday_rows=0 AND b.target_history_rows=0 AND b.target_workday_fingerprint='d41d8cd98f00b204e9800998ecf8427e' AND b.target_history_fingerprint='d41d8cd98f00b204e9800998ecf8427e'
    AND s.total_authorization_rows=0 AND s.premature_authorization_rows=0 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0
    AND s.target_workday_rows=b.target_workday_rows AND s.target_history_rows=b.target_history_rows AND s.target_workday_fingerprint=b.target_workday_fingerprint AND s.target_history_fingerprint=b.target_history_fingerprint
) AS premature_persist_authorization_retirement_postcheck
FROM state s CROSS JOIN baseline b;

ROLLBACK;
