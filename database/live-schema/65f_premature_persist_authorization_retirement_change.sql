-- Phase 65f: retire exactly the premature NEW canary authorization, and only
-- after proving it has not been used to create workday/history evidence.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;

DO $retire_premature$
DECLARE
  v_deleted bigint;
  v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff';
  v_registro uuid := '5707fc4d-833a-48ab-bf49-90f5b30e0174';
  v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa';
  v_schedule uuid := '5a753368-f019-4230-89e2-79beaa39ff0f';
  v_date date := '2026-09-09';
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') <> 1 THEN
    RAISE EXCEPTION 'PREMATURE_RETIRE_EXPECTS_EXACTLY_ONE_GLOBAL_AUTHORIZATION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_features
    WHERE cliente_id=v_tenant AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE
      AND canary_registro_id=v_registro AND canary_empleado_id=v_employee AND canary_schedule_id=v_schedule AND canary_workday_date=v_date
  ) THEN RAISE EXCEPTION 'PREMATURE_RETIRE_IDENTITY_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='SHADOW' AND enabled IS TRUE)
     OR EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) THEN
    RAISE EXCEPTION 'PREMATURE_RETIRE_REVISION_RESOLVER_STATE_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) THEN
    RAISE EXCEPTION 'PREMATURE_RETIRE_WORKDAY_ALREADY_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) THEN
    RAISE EXCEPTION 'PREMATURE_RETIRE_HISTORY_ALREADY_EXISTS';
  END IF;

  DELETE FROM public.tenant_features
  WHERE cliente_id=v_tenant AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE
    AND canary_registro_id=v_registro AND canary_empleado_id=v_employee AND canary_schedule_id=v_schedule AND canary_workday_date=v_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION 'PREMATURE_RETIRE_AFFECTED_ROWS_INVALID: %',v_deleted; END IF;
END
$retire_premature$;

COMMIT;
