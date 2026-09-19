-- Phase 78: future emergency rollback only. It changes the pilot flag from
-- ACTIVE/enabled=true back to SHADOW/enabled=true and touches no business data.
-- Do not run unless a separately approved ACTIVE change has completed.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.workday_records IN SHARE MODE;
LOCK TABLE public.workday_record_history IN SHARE MODE;

DO $rollback_active$
DECLARE
  v_updated bigint;
  v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff';
  v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa';
  v_date date := '2026-09-09';
  v_workday uuid := '5fe7ef34-7699-474b-b312-d0c5031a1fbe';
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) <> 1 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_EXPECTS_EXACTLY_ONE_ACTIVE_TENANT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_PILOT_IDENTITY_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_PERSIST_CANARY_AUTHORIZATION_EXISTS'; END IF;
  IF (SELECT count(*) FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR NOT EXISTS (SELECT 1 FROM public.workday_records WHERE id=v_workday AND integrity_hash='ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49' AND calculation_version=3) THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_WORKDAY_EVIDENCE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR NOT EXISTS (SELECT 1 FROM public.workday_record_history WHERE workday_record_id=v_workday AND integrity_hash='ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49' AND calculation_version=3 AND action='INSERTED') THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_HISTORY_EVIDENCE_INVALID'; END IF;

  UPDATE public.tenant_features
  SET mode='SHADOW', enabled=true
  WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RAISE EXCEPTION 'ACTIVE_ROLLBACK_AFFECTED_ROWS_INVALID: %',v_updated; END IF;
END
$rollback_active$;

COMMIT;
