-- Phase 65c: retire exactly one obsolete authorization row, and nothing else.
-- Execute only after an independently reviewed Phase 65b PASS.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;

DO $retire_legacy$
DECLARE
  v_deleted bigint;
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') <> 1 THEN
    RAISE EXCEPTION 'LEGACY_RETIRE_EXPECTS_EXACTLY_ONE_GLOBAL_AUTHORIZATION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_features
    WHERE cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
      AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE
      AND canary_registro_id='7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid
      AND canary_empleado_id='6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
      AND canary_schedule_id='be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid
      AND canary_workday_date='2026-09-03'::date
  ) THEN
    RAISE EXCEPTION 'LEGACY_RETIRE_IDENTITY_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenant_features
    WHERE feature_key='WORKDAY_PERSIST_CANARY'
      AND canary_registro_id='5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid
      AND canary_schedule_id='5a753368-f019-4230-89e2-79beaa39ff0f'::uuid
      AND canary_workday_date='2026-09-09'::date
  ) THEN
    RAISE EXCEPTION 'LEGACY_RETIRE_NEW_AUTHORIZATION_ALREADY_PRESENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='SHADOW' AND enabled IS TRUE)
     OR EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) THEN
    RAISE EXCEPTION 'LEGACY_RETIRE_REVISION_RESOLVER_STATE_INVALID';
  END IF;

  DELETE FROM public.tenant_features
  WHERE cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE
    AND canary_registro_id='7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid
    AND canary_empleado_id='6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
    AND canary_schedule_id='be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid
    AND canary_workday_date='2026-09-03'::date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION 'LEGACY_RETIRE_AFFECTED_ROWS_INVALID: %',v_deleted; END IF;
END
$retire_legacy$;

COMMIT;
