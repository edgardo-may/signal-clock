-- Phase 67: read-only verification of Phase 66. It does not invoke the RPC.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid registro_id,'69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,'5a753368-f019-4230-89e2-79beaa39ff0f'::uuid schedule_id,'2026-09-09'::date operative_date
)
SELECT jsonb_build_object(
  'phase','67_persist_canary_authorization_postcheck','read_only',current_setting('transaction_read_only'),
  'exact_authorization_rows',(SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.mode='PERSIST_CANARY' AND f.enabled AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.operative_date),
  'all_authorization_rows',(SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY'),
  'revision_feature_mode',(SELECT mode FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.enabled LIMIT 1),
  'active_tenants',(SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='ACTIVE'),
  'target_workday_rows',(SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date),
  'target_history_rows',(SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date),
  'authorization_postcheck_pass',
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.mode='PERSIST_CANARY' AND f.enabled AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.operative_date)=1
    AND (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY')=1
    AND (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.enabled AND f.mode='SHADOW')=1
    AND NOT EXISTS(SELECT 1 FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='ACTIVE')
    AND (SELECT count(*) FROM public.workday_records w,expected e WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date)=0
    AND (SELECT count(*) FROM public.workday_record_history h,expected e WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date)=0
) AS persist_canary_authorization_postcheck
FROM expected;

ROLLBACK;
