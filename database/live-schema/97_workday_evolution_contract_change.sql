-- Phase 97: evolves only the persistence contract. Run only while the tenant
-- gate is closed. It does not create a workday, history fact, or authorization.
BEGIN;
LOCK TABLE public.workday_records,public.workday_record_history,public.attendance_persist_outbox,public.tenant_features,public.empleados_horarios,public.schedule_revisions IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled) THEN RAISE EXCEPTION 'WORKDAY_EVOLUTION_GATE_MUST_BE_CLOSED'; END IF;
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid)') IS NULL THEN RAISE EXCEPTION 'WORKDAY_EVOLUTION_LEGACY_RPC_MISSING'; END IF;
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer)') IS NOT NULL THEN RAISE EXCEPTION 'WORKDAY_EVOLUTION_RPC_ALREADY_EXISTS'; END IF;
END $preflight$;

ALTER TABLE public.workday_records ADD COLUMN source_observed_at timestamptz NULL;
ALTER TABLE public.workday_records ADD COLUMN source_event_count integer NULL CHECK (source_event_count IS NULL OR source_event_count>=1);
ALTER TABLE public.workday_record_history ADD COLUMN source_observed_at timestamptz NULL;
ALTER TABLE public.workday_record_history ADD COLUMN source_event_count integer NULL CHECK (source_event_count IS NULL OR source_event_count>=1);
ALTER TABLE public.workday_record_history DROP CONSTRAINT IF EXISTS workday_record_history_action_check;
ALTER TABLE public.workday_record_history ADD CONSTRAINT workday_record_history_action_check CHECK (action IN ('INSERTED','UPDATED'));
ALTER TABLE public.attendance_persist_outbox DROP CONSTRAINT IF EXISTS attendance_persist_outbox_persistence_result_check;
ALTER TABLE public.attendance_persist_outbox ADD CONSTRAINT attendance_persist_outbox_persistence_result_check CHECK (persistence_result IS NULL OR persistence_result IN ('INSERTED','UPDATED','UNCHANGED','STALE'));

CREATE OR REPLACE FUNCTION public.complete_attendance_persist_outbox(p_outbox_id uuid,p_worker_id text,p_terminal_status text,p_error_code text,p_runtime_result text,p_workday_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_rows integer;
BEGIN
  IF p_outbox_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id)='' OR p_terminal_status NOT IN ('SUCCEEDED','RETRY','DENIED') OR (p_error_code IS NOT NULL AND char_length(p_error_code)>120) OR (p_terminal_status='SUCCEEDED' AND (p_runtime_result NOT IN ('INSERTED','UPDATED','UNCHANGED','STALE') OR p_workday_id IS NULL)) OR (p_terminal_status<>'SUCCEEDED' AND (p_runtime_result IS NOT NULL OR p_workday_id IS NOT NULL)) THEN RAISE EXCEPTION 'PRODUCTIVE_OUTBOX_COMPLETE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.attendance_persist_outbox SET status=p_terminal_status,last_error_code=p_error_code,persistence_result=p_runtime_result,workday_id=p_workday_id,completed_at=CASE WHEN p_terminal_status IN ('SUCCEEDED','DENIED') THEN transaction_timestamp() ELSE NULL END,locked_by=NULL,locked_at=NULL,updated_at=transaction_timestamp() WHERE id=p_outbox_id AND status='PROCESSING' AND locked_by=p_worker_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'PRODUCTIVE_OUTBOX_ACK_OWNERSHIP_INVALID' USING ERRCODE='42501'; END IF;
END $fn$;

CREATE FUNCTION public.upsert_workday_record(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_schedule_id uuid,p_timezone text,p_first_in timestamptz,p_last_out timestamptz,p_worked_minutes integer,p_break_minutes integer,p_overtime_minutes integer,p_late_minutes integer,p_early_leave_minutes integer,p_status text,p_integrity_hash text,p_calculation_version integer,p_registro_id uuid,p_source_observed_at timestamptz,p_source_event_count integer) RETURNS TABLE(workday_id uuid,persistence_result text,integrity_hash text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_existing public.workday_records%ROWTYPE; v_source uuid; v_revision uuid; v_assignments integer; v_snapshot_equal boolean;
BEGIN
  IF p_calculation_version<>3 OR NULLIF(btrim(p_integrity_hash),'') IS NULL OR p_registro_id IS NULL OR p_schedule_id IS NULL OR p_workday_date IS NULL OR p_source_observed_at IS NULL OR p_source_event_count IS NULL OR p_source_event_count<1 THEN RAISE EXCEPTION 'PERSIST_PAYLOAD_INVALID' USING ERRCODE='22023'; END IF;
  SELECT r.source_event_id INTO v_source FROM public.registro_asistencia r WHERE r.id=p_registro_id AND r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id FOR KEY SHARE;
  IF v_source IS NULL OR NOT EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED') THEN RAISE EXCEPTION 'PERSIST_SOURCE_EVENT_DENIED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_features f WHERE f.cliente_id=p_cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.mode='PERSIST_ACTIVE' AND f.enabled AND f.canary_registro_id IS NULL AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL AND f.canary_workday_date IS NULL) THEN RAISE EXCEPTION 'PERSIST_AUTHORIZATION_DENIED' USING ERRCODE='P0001'; END IF;
  SELECT count(*),(array_agg(eh.schedule_revision_id))[1] INTO v_assignments,v_revision FROM public.empleados_horarios eh WHERE eh.cliente_id=p_cliente_id AND eh.empleado_id=p_empleado_id AND eh.horario_id=p_schedule_id AND eh.activo AND eh.fecha_inicio<=p_workday_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=p_workday_date);
  IF v_assignments<>1 OR v_revision IS NULL OR NOT EXISTS(SELECT 1 FROM public.schedule_revisions sr WHERE sr.id=v_revision AND sr.cliente_id=p_cliente_id AND sr.horario_id=p_schedule_id AND public.schedule_revision_calculation_hash(sr.config_snapshot)=sr.integrity_hash) THEN RAISE EXCEPTION 'PERSIST_REVISION_RESOLUTION_DENIED' USING ERRCODE='P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO v_existing FROM public.workday_records w WHERE w.cliente_id=p_cliente_id AND w.empleado_id=p_empleado_id AND w.workday_date=p_workday_date FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.workday_records(cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version,source_observed_at,source_event_count) VALUES(p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_integrity_hash,p_calculation_version,p_source_observed_at,p_source_event_count) RETURNING * INTO v_existing;
    INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'INSERTED',p_source_observed_at,p_source_event_count);
    RETURN QUERY SELECT v_existing.id,'INSERTED'::text,p_integrity_hash; RETURN;
  END IF;
  IF v_existing.source_observed_at IS NULL OR v_existing.source_event_count IS NULL THEN RAISE EXCEPTION 'PERSIST_LEGACY_SNAPSHOT_UNVERSIONED' USING ERRCODE='P0001'; END IF;
  v_snapshot_equal := v_existing.schedule_id IS NOT DISTINCT FROM p_schedule_id AND v_existing.timezone IS NOT DISTINCT FROM p_timezone AND v_existing.first_in IS NOT DISTINCT FROM p_first_in AND v_existing.last_out IS NOT DISTINCT FROM p_last_out AND v_existing.worked_minutes IS NOT DISTINCT FROM p_worked_minutes AND v_existing.break_minutes IS NOT DISTINCT FROM p_break_minutes AND v_existing.overtime_minutes IS NOT DISTINCT FROM p_overtime_minutes AND v_existing.late_minutes IS NOT DISTINCT FROM p_late_minutes AND v_existing.early_leave_minutes IS NOT DISTINCT FROM p_early_leave_minutes AND v_existing.status IS NOT DISTINCT FROM p_status AND v_existing.integrity_hash IS NOT DISTINCT FROM p_integrity_hash AND v_existing.calculation_version IS NOT DISTINCT FROM p_calculation_version AND v_existing.source_observed_at IS NOT DISTINCT FROM p_source_observed_at AND v_existing.source_event_count IS NOT DISTINCT FROM p_source_event_count;
  IF v_snapshot_equal THEN RETURN QUERY SELECT v_existing.id,'UNCHANGED'::text,p_integrity_hash; RETURN; END IF;
  IF p_source_observed_at<v_existing.source_observed_at OR (p_source_observed_at=v_existing.source_observed_at AND p_source_event_count<v_existing.source_event_count) THEN RETURN QUERY SELECT v_existing.id,'STALE'::text,v_existing.integrity_hash; RETURN; END IF;
  IF p_source_observed_at=v_existing.source_observed_at AND p_source_event_count=v_existing.source_event_count THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing.schedule_id IS DISTINCT FROM p_schedule_id THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  UPDATE public.workday_records SET timezone=p_timezone,first_in=p_first_in,last_out=p_last_out,worked_minutes=p_worked_minutes,break_minutes=p_break_minutes,overtime_minutes=p_overtime_minutes,late_minutes=p_late_minutes,early_leave_minutes=p_early_leave_minutes,status=p_status,integrity_hash=p_integrity_hash,calculation_version=p_calculation_version,source_observed_at=p_source_observed_at,source_event_count=p_source_event_count WHERE id=v_existing.id;
  INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'UPDATED',p_source_observed_at,p_source_event_count);
  RETURN QUERY SELECT v_existing.id,'UPDATED'::text,p_integrity_hash;
END $fn$;
REVOKE ALL ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
