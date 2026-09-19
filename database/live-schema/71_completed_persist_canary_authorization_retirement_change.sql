-- Phase 71: retire only the completed canary authorization while preserving immutable business evidence.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.workday_records IN SHARE MODE;
LOCK TABLE public.workday_record_history IN SHARE MODE;

DO $retire_completed$
DECLARE
  v_deleted bigint;
  v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff'; v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa';
  v_registro uuid := '5707fc4d-833a-48ab-bf49-90f5b30e0174'; v_schedule uuid := '5a753368-f019-4230-89e2-79beaa39ff0f';
  v_date date := '2026-09-09'; v_workday uuid := '5fe7ef34-7699-474b-b312-d0c5031a1fbe';
  v_hash text := 'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49';
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') <> 1 THEN RAISE EXCEPTION 'COMPLETED_CANARY_EXPECTS_ONE_AUTHORIZATION'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE AND canary_registro_id=v_registro AND canary_empleado_id=v_employee AND canary_schedule_id=v_schedule AND canary_workday_date=v_date) THEN RAISE EXCEPTION 'COMPLETED_CANARY_AUTHORIZATION_IDENTITY_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='SHADOW' AND enabled IS TRUE) OR EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) THEN RAISE EXCEPTION 'COMPLETED_CANARY_REVISION_RESOLVER_STATE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR NOT EXISTS (SELECT 1 FROM public.workday_records WHERE id=v_workday AND cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date AND schedule_id=v_schedule AND integrity_hash=v_hash AND calculation_version=3) THEN RAISE EXCEPTION 'COMPLETED_CANARY_WORKDAY_EVIDENCE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR NOT EXISTS (SELECT 1 FROM public.workday_record_history WHERE workday_record_id=v_workday AND cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date AND integrity_hash=v_hash AND calculation_version=3 AND action='INSERTED') THEN RAISE EXCEPTION 'COMPLETED_CANARY_HISTORY_EVIDENCE_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.registro_asistencia WHERE id=v_registro AND cliente_id=v_tenant AND empleado_id=v_employee AND xmin::text='16338') THEN RAISE EXCEPTION 'COMPLETED_CANARY_SOURCE_XMIN_INVALID'; END IF;

  DELETE FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE AND canary_registro_id=v_registro AND canary_empleado_id=v_employee AND canary_schedule_id=v_schedule AND canary_workday_date=v_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION 'COMPLETED_CANARY_RETIRE_AFFECTED_ROWS_INVALID: %',v_deleted; END IF;
END
$retire_completed$;

COMMIT;
