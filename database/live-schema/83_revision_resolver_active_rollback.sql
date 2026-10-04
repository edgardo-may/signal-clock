-- Phase 83: emergency rollback only. It changes exactly the pilot ACTIVE flag back to SHADOW.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.registro_asistencia,public.workday_records,public.workday_record_history IN SHARE MODE;

DO $rollback_pilot$
DECLARE v_updated bigint; v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff'; v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa'; v_registro uuid := '5707fc4d-833a-48ab-bf49-90f5b30e0174'; v_workday uuid := '5fe7ef34-7699-474b-b312-d0c5031a1fbe'; v_date date := '2026-09-09'; v_hash text := 'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49';
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) <> 1 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_GLOBAL_ACTIVE_COUNT_INVALID'; END IF;
  IF (SELECT count(*) FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) <> 1 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_PILOT_IDENTITY_INVALID'; END IF;
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') <> 0 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_PERSIST_AUTHORIZATION_EXISTS'; END IF;
  IF (SELECT count(*) FROM public.registro_asistencia WHERE id=v_registro AND cliente_id=v_tenant AND empleado_id=v_employee AND xmin::text='16338') <> 1 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_CANARY_IDENTITY_OR_XMIN_INVALID'; END IF;
  IF (SELECT count(*) FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR NOT EXISTS (SELECT 1 FROM public.workday_records WHERE id=v_workday AND cliente_id=v_tenant AND integrity_hash=v_hash AND calculation_version=3) THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_WORKDAY_EVIDENCE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR NOT EXISTS (SELECT 1 FROM public.workday_record_history WHERE workday_record_id=v_workday AND cliente_id=v_tenant AND integrity_hash=v_hash AND calculation_version=3 AND action='INSERTED') THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_HISTORY_EVIDENCE_INVALID'; END IF;
  IF (SELECT md5(COALESCE(string_agg(concat_ws('|',id::text,cliente_id::text,empleado_id::text,workday_date::text,schedule_id::text,integrity_hash,calculation_version::text),'|' ORDER BY id::text),'')) FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> '668e4ccfa75a027b5fcc47d4963a06d1' THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_WORKDAY_FINGERPRINT_INVALID'; END IF;
  IF (SELECT md5(COALESCE(string_agg(concat_ws('|',workday_record_id::text,cliente_id::text,empleado_id::text,workday_date::text,integrity_hash,calculation_version::text,action),'|' ORDER BY id::text),'')) FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> '0f87f945e84a9747e5bc275660bc7c0a' THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_HISTORY_FINGERPRINT_INVALID'; END IF;
  UPDATE public.tenant_features SET mode='SHADOW' WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_AFFECTED_ROWS_INVALID: %',v_updated; END IF;
END
$rollback_pilot$;

COMMIT;
