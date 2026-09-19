-- Phase 74: READ ONLY DB non-regression check immediately after runtime live evidence.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,'6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,'5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid registro_id,'2026-09-09'::date workday_date,'668e4ccfa75a027b5fcc47d4963a06d1'::text workday_fingerprint,'0f87f945e84a9747e5bc275660bc7c0a'::text history_fingerprint
), state AS (
  SELECT
    (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.workday_date) target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.workday_date) target_history_rows,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',w.id::text,w.cliente_id::text,w.empleado_id::text,w.workday_date::text,w.schedule_id::text,w.integrity_hash,w.calculation_version::text),'|' ORDER BY w.id::text),'')) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.workday_date) workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(concat_ws('|',h.workday_record_id::text,h.cliente_id::text,h.empleado_id::text,h.workday_date::text,h.integrity_hash,h.calculation_version::text,h.action),'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.workday_date) history_fingerprint,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') persist_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) active_tenant_count
)
SELECT jsonb_build_object('phase','74_runtime_live_evidence_postcheck','read_only',current_setting('transaction_read_only'),'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,'workday_fingerprint',s.workday_fingerprint,'history_fingerprint',s.history_fingerprint,'persist_authorization_rows',s.persist_authorization_rows,'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',s.active_tenant_count,'runtime_live_non_regression_pass',s.target_workday_rows=1 AND s.target_history_rows=1 AND s.workday_fingerprint=e.workday_fingerprint AND s.history_fingerprint=e.history_fingerprint AND s.persist_authorization_rows=0 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0) AS runtime_live_evidence_postcheck
FROM expected e CROSS JOIN state s;

ROLLBACK;
