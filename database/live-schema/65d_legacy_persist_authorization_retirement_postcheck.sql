-- Phase 65d: READ ONLY confirmation after Phase 65c.
-- This execution is deliberately bound to the approved, observed Phase 65b
-- baseline. Constants are used because Supabase SQL Editor cannot reliably
-- inject a prior result as a psql variable or session GUC.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,'6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,
    '2026-09-03'::date legacy_workday_date,'5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid new_registro_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid new_schedule_id,'2026-09-09'::date new_workday_date
), baseline AS (
  SELECT 0::bigint AS legacy_workday_rows,0::bigint AS legacy_history_rows,
    'd41d8cd98f00b204e9800998ecf8427e'::text AS legacy_workday_fingerprint,
    'd41d8cd98f00b204e9800998ecf8427e'::text AS legacy_history_fingerprint
), current_state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.feature_key='WORKDAY_PERSIST_CANARY' AND f.cliente_id=e.cliente_id AND f.canary_registro_id='7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid AND f.canary_schedule_id='be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid AND f.canary_workday_date=e.legacy_workday_date) legacy_authorization_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') total_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.feature_key='WORKDAY_PERSIST_CANARY' AND f.canary_registro_id=e.new_registro_id AND f.canary_schedule_id=e.new_schedule_id AND f.canary_workday_date=e.new_workday_date) new_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) active_tenant_count,
    (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.legacy_workday_date) legacy_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.legacy_workday_date) legacy_history_rows,
    (SELECT md5(COALESCE(string_agg(to_jsonb(w)::text,'|' ORDER BY w.id::text),'')) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.legacy_workday_date) legacy_workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(to_jsonb(h)::text,'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.legacy_workday_date) legacy_history_fingerprint
)
SELECT jsonb_build_object(
  'phase','65d_legacy_persist_authorization_retirement_postcheck','read_only',current_setting('transaction_read_only'),
  'baseline_valid',b.legacy_workday_rows=0 AND b.legacy_history_rows=0 AND b.legacy_workday_fingerprint='d41d8cd98f00b204e9800998ecf8427e' AND b.legacy_history_fingerprint='d41d8cd98f00b204e9800998ecf8427e','legacy_authorization_rows',s.legacy_authorization_rows,
  'total_authorization_rows',s.total_authorization_rows,'new_authorization_rows',s.new_authorization_rows,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',s.active_tenant_count,
  'legacy_workday_rows',s.legacy_workday_rows,'legacy_history_rows',s.legacy_history_rows,
  'legacy_workday_fingerprint',s.legacy_workday_fingerprint,'legacy_history_fingerprint',s.legacy_history_fingerprint,
  'legacy_business_records_unchanged',s.legacy_workday_rows=b.legacy_workday_rows AND s.legacy_history_rows=b.legacy_history_rows AND s.legacy_workday_fingerprint=b.legacy_workday_fingerprint AND s.legacy_history_fingerprint=b.legacy_history_fingerprint,
  'safe_to_rerun_phase_65',b.legacy_workday_rows=0 AND b.legacy_history_rows=0 AND b.legacy_workday_fingerprint='d41d8cd98f00b204e9800998ecf8427e' AND b.legacy_history_fingerprint='d41d8cd98f00b204e9800998ecf8427e'
    AND s.legacy_authorization_rows=0 AND s.total_authorization_rows=0 AND s.new_authorization_rows=0 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0
    AND s.legacy_workday_rows=b.legacy_workday_rows AND s.legacy_history_rows=b.legacy_history_rows AND s.legacy_workday_fingerprint=b.legacy_workday_fingerprint AND s.legacy_history_fingerprint=b.legacy_history_fingerprint
) AS legacy_persist_authorization_retirement_postcheck
FROM current_state s CROSS JOIN baseline b;

ROLLBACK;
