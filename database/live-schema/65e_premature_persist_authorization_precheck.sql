-- Phase 65e: READ ONLY evidence for the prematurely-created NEW canary
-- authorization. It never retires, creates, or invokes persistence.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid AS registro_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AS schedule_id,
    '2026-09-09'::date AS operative_date
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') AS total_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f,expected e
      WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.mode='PERSIST_CANARY' AND f.enabled IS TRUE
        AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.operative_date) AS exact_authorization_rows,
    (SELECT count(*) FROM public.workday_records w,expected e
      WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) AS target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h,expected e
      WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) AS target_history_rows,
    (SELECT md5(COALESCE(string_agg(to_jsonb(w)::text,'|' ORDER BY w.id::text),'')) FROM public.workday_records w,expected e
      WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) AS target_workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(to_jsonb(h)::text,'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h,expected e
      WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) AS target_history_fingerprint,
    (SELECT count(*) FROM public.tenant_features f,expected e
      WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) AS revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) AS active_tenant_count
)
SELECT jsonb_build_object(
  'phase','65e_premature_persist_authorization_precheck',
  'read_only',current_setting('transaction_read_only'),
  'authorization_identity',jsonb_build_object('cliente_id',e.cliente_id,'registro_id',e.registro_id,'empleado_id',e.empleado_id,'schedule_id',e.schedule_id,'operative_date',e.operative_date),
  'total_authorization_rows',s.total_authorization_rows,'exact_authorization_rows',s.exact_authorization_rows,
  'target_workday_rows',s.target_workday_rows,'target_history_rows',s.target_history_rows,
  'target_workday_fingerprint',s.target_workday_fingerprint,'target_history_fingerprint',s.target_history_fingerprint,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,'active_tenants',s.active_tenant_count,
  'safe_to_retire_premature_authorization',s.total_authorization_rows=1 AND s.exact_authorization_rows=1
    AND s.target_workday_rows=0 AND s.target_history_rows=0 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0
) AS premature_persist_authorization_precheck
FROM expected e CROSS JOIN state s;

ROLLBACK;
