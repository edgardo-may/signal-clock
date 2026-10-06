-- Minimal repair derived from commit 39da4ef4885d0d8637ebf1c7c032e4984f2afa04.
-- Source SHA256: B6FD7CB059AE7DDB0B518B26313452FE878CA902960C3813AB29062F30235759
-- Only helper creation becomes CREATE OR REPLACE; canonical bodies and grants are unchanged.
-- Historical migration 115 and migration 116 are not modified.
-- Phase 115: scoped Phase B persist authorization; no gate is enabled by this migration.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer,jsonb,jsonb)') IS NULL
     OR to_regclass('public.workday_calculation_revisions') IS NULL
     OR to_regclass('public.workday_revision_promotions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenant_features'::regclass AND conname='tenant_features_persist_scope_check')
  THEN RAISE EXCEPTION 'PHASE_115_REQUIRED_CONTRACT_MISSING'; END IF;
END $preflight$;
-- Read-only fail-closed checks; no tenant gate is changed.
DO $repair_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key IN ('WORKDAY_PERSIST_ACTIVE','WORKDAY_PERSIST_CANARY') AND enabled)
    OR EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND (mode<>'OFF' OR enabled IS DISTINCT FROM false))
    OR EXISTS (SELECT 1 FROM public.attendance_persist_outbox WHERE status IN ('PENDING','RETRY') OR (status='PROCESSING' AND locked_at<transaction_timestamp()-interval '10 minutes'))
    OR EXISTS (SELECT 1 FROM public.workday_calculation_revisions)
    OR EXISTS (SELECT 1 FROM public.workday_revision_promotions)
  THEN RAISE EXCEPTION 'PHASE_115_REPAIR_QUIET_PRECHECK_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE NOT (
  (mode <> 'PERSIST_CANARY' OR (enabled AND feature_key IN ('WORKDAY_PERSIST_CANARY','WORKDAY_PERSIST_ACTIVE')
    AND canary_registro_id IS NOT NULL AND canary_empleado_id IS NOT NULL
    AND canary_schedule_id IS NOT NULL AND canary_workday_date IS NOT NULL))
  AND (mode <> 'PERSIST_ACTIVE' OR (enabled AND feature_key='WORKDAY_PERSIST_ACTIVE'
    AND canary_registro_id IS NULL AND canary_empleado_id IS NULL
    AND canary_schedule_id IS NULL AND canary_workday_date IS NULL))
))
  THEN RAISE EXCEPTION 'PHASE_115_REPAIR_INCOMPATIBLE_TENANT_FEATURE_ROWS'; END IF;
END $repair_guard$;


ALTER TABLE public.tenant_features DROP CONSTRAINT tenant_features_persist_scope_check;
ALTER TABLE public.tenant_features ADD CONSTRAINT tenant_features_persist_scope_check CHECK (
  (mode <> 'PERSIST_CANARY' OR (enabled AND feature_key IN ('WORKDAY_PERSIST_CANARY','WORKDAY_PERSIST_ACTIVE')
    AND canary_registro_id IS NOT NULL AND canary_empleado_id IS NOT NULL
    AND canary_schedule_id IS NOT NULL AND canary_workday_date IS NOT NULL))
  AND (mode <> 'PERSIST_ACTIVE' OR (enabled AND feature_key='WORKDAY_PERSIST_ACTIVE'
    AND canary_registro_id IS NULL AND canary_empleado_id IS NULL
    AND canary_schedule_id IS NULL AND canary_workday_date IS NULL))
);

CREATE OR REPLACE FUNCTION public.workday_persist_authorized(
  p_cliente_id uuid, p_empleado_id uuid, p_registro_id uuid,
  p_schedule_id uuid, p_workday_date date
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $authorized$
  SELECT p_cliente_id IS NOT NULL AND p_empleado_id IS NOT NULL
    AND p_registro_id IS NOT NULL AND p_schedule_id IS NOT NULL AND p_workday_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_features f
      WHERE f.cliente_id=p_cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.enabled IS TRUE
        AND (
          (f.mode='PERSIST_ACTIVE' AND f.canary_registro_id IS NULL
            AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL
            AND f.canary_workday_date IS NULL)
          OR
          (f.mode='PERSIST_CANARY' AND f.canary_registro_id=p_registro_id
            AND f.canary_empleado_id=p_empleado_id AND f.canary_schedule_id=p_schedule_id
            AND f.canary_workday_date=p_workday_date
            AND f.canary_registro_id IS NOT NULL AND f.canary_empleado_id IS NOT NULL
            AND f.canary_schedule_id IS NOT NULL AND f.canary_workday_date IS NOT NULL)
        )
    );
$authorized$;
REVOKE ALL ON FUNCTION public.workday_persist_authorized(uuid,uuid,uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workday_persist_authorized(uuid,uuid,uuid,uuid,date) TO service_role;

-- The 20-argument RPC definition below is copied byte-for-byte from 112 except
-- for its single authorization predicate, which invokes the scoped authority.
CREATE OR REPLACE FUNCTION public.upsert_workday_record(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_schedule_id uuid,p_timezone text,p_first_in timestamptz,p_last_out timestamptz,p_worked_minutes integer,p_break_minutes integer,p_overtime_minutes integer,p_late_minutes integer,p_early_leave_minutes integer,p_status text,p_integrity_hash text,p_calculation_version integer,p_registro_id uuid,p_source_observed_at timestamptz,p_source_event_count integer,p_evidence_manifest jsonb,p_context_manifest jsonb) RETURNS TABLE(workday_id uuid,persistence_result text,integrity_hash text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_existing public.workday_records%ROWTYPE; v_source uuid; v_revision uuid; v_assignments integer; v_snapshot_equal boolean; v_previous uuid; v_new uuid;
BEGIN
  LOCK TABLE public.registro_asistencia,public.attendance_source_events,public.devices,public.empleados_horarios IN SHARE MODE;
  IF p_calculation_version IS NULL OR p_calculation_version<1 OR NULLIF(btrim(p_integrity_hash),'') IS NULL OR p_registro_id IS NULL OR p_schedule_id IS NULL OR p_workday_date IS NULL OR p_source_observed_at IS NULL OR p_source_event_count IS NULL OR p_source_event_count<1 THEN RAISE EXCEPTION 'PERSIST_PAYLOAD_INVALID' USING ERRCODE='22023'; END IF;
  SELECT r.source_event_id INTO v_source FROM public.registro_asistencia r WHERE r.id=p_registro_id AND r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id FOR KEY SHARE;
  IF v_source IS NULL OR NOT EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED') THEN RAISE EXCEPTION 'PERSIST_SOURCE_EVENT_DENIED' USING ERRCODE='P0001'; END IF;
  IF NOT public.workday_persist_authorized(p_cliente_id,p_empleado_id,p_registro_id,p_schedule_id,p_workday_date) THEN RAISE EXCEPTION 'PERSIST_AUTHORIZATION_DENIED' USING ERRCODE='P0001'; END IF;
  SELECT count(*),(array_agg(eh.schedule_revision_id))[1] INTO v_assignments,v_revision FROM public.empleados_horarios eh WHERE eh.cliente_id=p_cliente_id AND eh.empleado_id=p_empleado_id AND eh.horario_id=p_schedule_id AND eh.activo AND eh.fecha_inicio<=p_workday_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=p_workday_date);
  IF v_assignments<>1 OR v_revision IS NULL OR NOT EXISTS(SELECT 1 FROM public.schedule_revisions sr WHERE sr.id=v_revision AND sr.cliente_id=p_cliente_id AND sr.horario_id=p_schedule_id AND public.schedule_revision_calculation_hash(sr.config_snapshot)=sr.integrity_hash) THEN RAISE EXCEPTION 'PERSIST_REVISION_RESOLUTION_DENIED' USING ERRCODE='P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO v_existing FROM public.workday_records w WHERE w.cliente_id=p_cliente_id AND w.empleado_id=p_empleado_id AND w.workday_date=p_workday_date FOR UPDATE;
  IF FOUND AND p_calculation_version IS DISTINCT FROM (CASE WHEN v_existing.current_revision_id IS NULL THEN 3 ELSE v_existing.calculation_version END) THEN
    RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',CASE WHEN v_existing.current_revision_id IS NULL THEN 3 ELSE v_existing.calculation_version END,'received_version',p_calculation_version)::text;
  END IF;
  IF NOT FOUND THEN
    IF p_calculation_version<>3 THEN RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',3,'received_version',p_calculation_version)::text; END IF;
    INSERT INTO public.workday_records(cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version,source_observed_at,source_event_count) VALUES(p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_integrity_hash,p_calculation_version,p_source_observed_at,p_source_event_count) RETURNING * INTO v_existing;
    INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'INSERTED',p_source_observed_at,p_source_event_count);

    PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest);
    v_new:=public.store_workday_calculation_revision(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest,public.workday_revision_snapshot(to_jsonb(v_existing)),p_integrity_hash,p_source_observed_at,p_source_event_count);
    INSERT INTO public.workday_revision_promotions(cliente_id,empleado_id,workday_date,previous_revision_id,promoted_revision_id,expected_current_revision_id,operation)
      VALUES(p_cliente_id,p_empleado_id,p_workday_date,v_previous,v_new,v_previous,CASE WHEN v_previous IS NULL THEN 'INITIAL' ELSE 'EVIDENCE_UPDATE' END);
    UPDATE public.workday_records SET current_revision_id=v_new WHERE id=v_existing.id;
    RETURN QUERY SELECT v_existing.id,'INSERTED'::text,p_integrity_hash; RETURN;
  END IF;
  IF v_existing.source_observed_at IS NULL OR v_existing.source_event_count IS NULL THEN RAISE EXCEPTION 'PERSIST_LEGACY_SNAPSHOT_UNVERSIONED' USING ERRCODE='P0001'; END IF;
  v_snapshot_equal := v_existing.schedule_id IS NOT DISTINCT FROM p_schedule_id AND v_existing.timezone IS NOT DISTINCT FROM p_timezone AND v_existing.first_in IS NOT DISTINCT FROM p_first_in AND v_existing.last_out IS NOT DISTINCT FROM p_last_out AND v_existing.worked_minutes IS NOT DISTINCT FROM p_worked_minutes AND v_existing.break_minutes IS NOT DISTINCT FROM p_break_minutes AND v_existing.overtime_minutes IS NOT DISTINCT FROM p_overtime_minutes AND v_existing.late_minutes IS NOT DISTINCT FROM p_late_minutes AND v_existing.early_leave_minutes IS NOT DISTINCT FROM p_early_leave_minutes AND v_existing.status IS NOT DISTINCT FROM p_status AND v_existing.integrity_hash IS NOT DISTINCT FROM p_integrity_hash AND v_existing.calculation_version IS NOT DISTINCT FROM p_calculation_version AND v_existing.source_observed_at IS NOT DISTINCT FROM p_source_observed_at AND v_existing.source_event_count IS NOT DISTINCT FROM p_source_event_count;
  IF v_snapshot_equal THEN RETURN QUERY SELECT v_existing.id,'UNCHANGED'::text,p_integrity_hash; RETURN; END IF;
  IF p_source_observed_at<v_existing.source_observed_at OR (p_source_observed_at=v_existing.source_observed_at AND p_source_event_count<v_existing.source_event_count) THEN RETURN QUERY SELECT v_existing.id,'STALE'::text,v_existing.integrity_hash; RETURN; END IF;
  IF p_source_observed_at=v_existing.source_observed_at AND p_source_event_count=v_existing.source_event_count THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing.schedule_id IS DISTINCT FROM p_schedule_id THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  v_previous:=v_existing.current_revision_id;
  UPDATE public.workday_records SET timezone=p_timezone,first_in=p_first_in,last_out=p_last_out,worked_minutes=p_worked_minutes,break_minutes=p_break_minutes,overtime_minutes=p_overtime_minutes,late_minutes=p_late_minutes,early_leave_minutes=p_early_leave_minutes,status=p_status,integrity_hash=p_integrity_hash,calculation_version=p_calculation_version,source_observed_at=p_source_observed_at,source_event_count=p_source_event_count WHERE id=v_existing.id RETURNING * INTO v_existing;
  INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'UPDATED',p_source_observed_at,p_source_event_count);

    PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest);
    v_new:=public.store_workday_calculation_revision(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest,public.workday_revision_snapshot(to_jsonb(v_existing)),p_integrity_hash,p_source_observed_at,p_source_event_count);
    INSERT INTO public.workday_revision_promotions(cliente_id,empleado_id,workday_date,previous_revision_id,promoted_revision_id,expected_current_revision_id,operation)
      VALUES(p_cliente_id,p_empleado_id,p_workday_date,v_previous,v_new,v_previous,CASE WHEN v_previous IS NULL THEN 'INITIAL' ELSE 'EVIDENCE_UPDATE' END);
    UPDATE public.workday_records SET current_revision_id=v_new WHERE id=v_existing.id;
  RETURN QUERY SELECT v_existing.id,'UPDATED'::text,p_integrity_hash;
END $fn$;

REVOKE ALL ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer,jsonb,jsonb) TO service_role;
COMMIT;
