-- Phase 90: retire exactly the temporary canary authorization; resolver ACTIVE is deliberately untouched.
BEGIN ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.workday_records,public.workday_record_history IN SHARE MODE;
DO $close_persist_authorization$
DECLARE v_rows bigint; v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff'; v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa'; v_registro uuid := '5707fc4d-833a-48ab-bf49-90f5b30e0174'; v_schedule uuid := '5a753368-f019-4230-89e2-79beaa39ff0f'; v_workday uuid := '5fe7ef34-7699-474b-b312-d0c5031a1fbe'; v_date date := '2026-09-09'; v_hash text := 'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49';
BEGIN
 IF (SELECT count(*) FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE)<>1 THEN RAISE EXCEPTION 'PERSIST_CLOSURE_ACTIVE_RESOLVER_INVALID'; END IF;
 IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY')<>1 OR (SELECT count(*) FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE AND canary_registro_id=v_registro AND canary_empleado_id=v_employee AND canary_schedule_id=v_schedule AND canary_workday_date=v_date)<>1 THEN RAISE EXCEPTION 'PERSIST_CLOSURE_AUTHORIZATION_INVALID'; END IF;
 IF (SELECT count(*) FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date)<>1 OR NOT EXISTS(SELECT 1 FROM public.workday_records WHERE id=v_workday AND integrity_hash=v_hash AND calculation_version=3) OR (SELECT count(*) FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date)<>1 OR NOT EXISTS(SELECT 1 FROM public.workday_record_history WHERE workday_record_id=v_workday AND integrity_hash=v_hash AND calculation_version=3 AND action='INSERTED') THEN RAISE EXCEPTION 'PERSIST_CLOSURE_EVIDENCE_INVALID'; END IF;
 DELETE FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='WORKDAY_PERSIST_CANARY' AND mode='PERSIST_CANARY' AND enabled IS TRUE AND canary_registro_id=v_registro AND canary_empleado_id=v_employee AND canary_schedule_id=v_schedule AND canary_workday_date=v_date;
 GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'PERSIST_CLOSURE_AFFECTED_ROWS_INVALID: %',v_rows; END IF;
END $close_persist_authorization$;
COMMIT;
