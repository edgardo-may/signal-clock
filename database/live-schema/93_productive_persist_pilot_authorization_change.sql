-- Phase 93: the sole production authorization gate.  Do not run without the
-- deployed dispatcher/job and an approved release window.
BEGIN ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.tenant_features,public.attendance_persist_outbox IN SHARE ROW EXCLUSIVE MODE;
DO $gate$
DECLARE v_rows bigint; v_tenant uuid:='69095bd5-fee5-4237-a1a4-186dd88310ff';
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled)<>1 THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_RESOLVER_NOT_ACTIVE'; END IF;
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY')<>0 OR (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE')<>0 THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_AUTHORIZATION_NOT_CLOSED'; END IF;
  IF to_regclass('public.attendance_persist_outbox') IS NULL OR to_regprocedure('public.claim_attendance_persist_outbox(integer,text)') IS NULL OR to_regprocedure('public.complete_attendance_persist_outbox(uuid,text,text,text,text,uuid)') IS NULL THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_OUTBOX_CONTRACT_MISSING'; END IF;
  INSERT INTO public.tenant_features(cliente_id,feature_key,mode,enabled,canary_registro_id,canary_empleado_id,canary_schedule_id,canary_workday_date) VALUES(v_tenant,'WORKDAY_PERSIST_ACTIVE','PERSIST_ACTIVE',true,NULL,NULL,NULL,NULL);
  GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_AUTHORIZATION_ROW_COUNT_INVALID:%',v_rows; END IF;
END $gate$;
COMMIT;
