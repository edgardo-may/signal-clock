-- Phase 65b: READ ONLY proof that the sole canary authorization is the exact
-- obsolete 2026-09-03 identity. This script never retires or creates a flag.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid AS legacy_registro_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid AS legacy_schedule_id,
    '2026-09-03'::date AS legacy_workday_date,
    '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid AS new_registro_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AS new_schedule_id,
    '2026-09-09'::date AS new_workday_date
), state AS (
  SELECT
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') AS total_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f, expected e
      WHERE f.feature_key='WORKDAY_PERSIST_CANARY' AND f.cliente_id=e.cliente_id AND f.mode='PERSIST_CANARY' AND f.enabled IS TRUE
        AND f.canary_registro_id=e.legacy_registro_id AND f.canary_empleado_id=e.empleado_id
        AND f.canary_schedule_id=e.legacy_schedule_id AND f.canary_workday_date=e.legacy_workday_date) AS exact_legacy_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f, expected e
      WHERE f.feature_key='WORKDAY_PERSIST_CANARY' AND f.canary_registro_id=e.new_registro_id
        AND f.canary_schedule_id=e.new_schedule_id AND f.canary_workday_date=e.new_workday_date) AS new_authorization_rows,
    (SELECT count(*) FROM public.tenant_features f, expected e
      WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.mode='SHADOW' AND f.enabled IS TRUE) AS revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) AS active_tenant_count,
    (SELECT count(*) FROM public.workday_records w, expected e
      WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.legacy_workday_date) AS legacy_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h, expected e
      WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.legacy_workday_date) AS legacy_history_rows,
    (SELECT md5(COALESCE(string_agg(to_jsonb(w)::text,'|' ORDER BY w.id::text),'')) FROM public.workday_records w, expected e
      WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.legacy_workday_date) AS legacy_workday_fingerprint,
    (SELECT md5(COALESCE(string_agg(to_jsonb(h)::text,'|' ORDER BY h.id::text),'')) FROM public.workday_record_history h, expected e
      WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.legacy_workday_date) AS legacy_history_fingerprint
)
SELECT jsonb_build_object(
  'phase','65b_legacy_persist_authorization_retirement_precheck',
  'read_only',current_setting('transaction_read_only'),
  'legacy_identity',jsonb_build_object('cliente_id',e.cliente_id,'registro_id',e.legacy_registro_id,'empleado_id',e.empleado_id,'schedule_id',e.legacy_schedule_id,'operative_date',e.legacy_workday_date),
  'total_authorization_rows',s.total_authorization_rows,
  'exact_legacy_authorization_rows',s.exact_legacy_authorization_rows,
  'new_authorization_rows',s.new_authorization_rows,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,
  'active_tenants',s.active_tenant_count,
  'legacy_workday_rows',s.legacy_workday_rows,
  'legacy_history_rows',s.legacy_history_rows,
  'legacy_workday_fingerprint',s.legacy_workday_fingerprint,
  'legacy_history_fingerprint',s.legacy_history_fingerprint,
  'safe_to_retire_legacy_authorization',s.total_authorization_rows=1 AND s.exact_legacy_authorization_rows=1
    AND s.new_authorization_rows=0 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0
) AS legacy_persist_authorization_retirement_precheck
FROM expected e CROSS JOIN state s;

ROLLBACK;
