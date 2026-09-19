-- Phase 92: install only the permanent contract.  It creates no authorization
-- row and therefore cannot start productive persistence on its own.
BEGIN;
DO $preflight$
BEGIN
  IF to_regclass('public.attendance_persist_outbox') IS NOT NULL THEN RAISE EXCEPTION 'PRODUCTIVE_OUTBOX_ALREADY_EXISTS'; END IF;
  IF to_regclass('public.registro_asistencia') IS NULL OR to_regclass('public.attendance_source_events') IS NULL OR to_regclass('public.tenant_features') IS NULL OR to_regclass('public.workday_records') IS NULL OR to_regclass('public.workday_record_history') IS NULL THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_REQUIRED_RELATION_MISSING'; END IF;
  IF to_regprocedure('public.link_attendance_source_event(uuid)') IS NULL OR to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)') IS NULL THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_REQUIRED_RPC_MISSING'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key IN ('WORKDAY_PERSIST_CANARY','WORKDAY_PERSIST_ACTIVE') AND enabled) THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_AUTHORIZATION_MUST_START_CLOSED'; END IF;
END $preflight$;

ALTER TABLE public.tenant_features DROP CONSTRAINT IF EXISTS tenant_features_canary_scope_check;
ALTER TABLE public.tenant_features ADD CONSTRAINT tenant_features_persist_scope_check CHECK (
  (mode <> 'PERSIST_CANARY' OR (enabled AND feature_key='WORKDAY_PERSIST_CANARY' AND canary_registro_id IS NOT NULL AND canary_empleado_id IS NOT NULL AND canary_schedule_id IS NOT NULL AND canary_workday_date IS NOT NULL))
  AND (mode <> 'PERSIST_ACTIVE' OR (enabled AND feature_key='WORKDAY_PERSIST_ACTIVE' AND canary_registro_id IS NULL AND canary_empleado_id IS NULL AND canary_schedule_id IS NULL AND canary_workday_date IS NULL))
);
ALTER TABLE public.tenant_features DROP CONSTRAINT IF EXISTS tenant_features_mode_check;
ALTER TABLE public.tenant_features ADD CONSTRAINT tenant_features_mode_check CHECK (mode IN ('OFF','SHADOW','PERSIST_CANARY','ACTIVE','PERSIST_ACTIVE'));

CREATE TABLE public.attendance_persist_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL UNIQUE REFERENCES public.registro_asistencia(id) ON DELETE RESTRICT,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  empleado_id uuid NOT NULL REFERENCES public.empleados(id) ON DELETE RESTRICT,
  source_event_id uuid NOT NULL UNIQUE REFERENCES public.attendance_source_events(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','RETRY','SUCCEEDED','DENIED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_by text NULL, locked_at timestamptz NULL, completed_at timestamptz NULL,
  last_error_code text NULL CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  persistence_result text NULL CHECK (persistence_result IS NULL OR persistence_result IN ('INSERTED','UNCHANGED')),
  workday_id uuid NULL REFERENCES public.workday_records(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT attendance_persist_outbox_terminal_shape CHECK ((status='SUCCEEDED') = (persistence_result IS NOT NULL AND workday_id IS NOT NULL))
);
CREATE INDEX attendance_persist_outbox_claim_idx ON public.attendance_persist_outbox(status, created_at) WHERE status IN ('PENDING','RETRY','PROCESSING');
ALTER TABLE public.attendance_persist_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_persist_outbox FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.enqueue_attendance_persist_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW.source_event_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features f WHERE f.cliente_id=NEW.cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.mode='PERSIST_ACTIVE' AND f.enabled AND f.canary_registro_id IS NULL AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL AND f.canary_workday_date IS NULL) THEN RETURN NEW; END IF;
  IF NEW.es_manual IS TRUE OR NOT EXISTS (SELECT 1 FROM public.attendance_source_events e WHERE e.id=NEW.source_event_id AND e.cliente_id=NEW.cliente_id AND e.employee_id=NEW.empleado_id AND e.device_id=NEW.dispositivo_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED') THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_CANONICAL_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO public.attendance_persist_outbox(registro_id,cliente_id,empleado_id,source_event_id) VALUES(NEW.id,NEW.cliente_id,NEW.empleado_id,NEW.source_event_id) ON CONFLICT(registro_id) DO NOTHING;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_enqueue_attendance_persist_outbox AFTER INSERT OR UPDATE OF source_event_id ON public.registro_asistencia FOR EACH ROW EXECUTE FUNCTION public.enqueue_attendance_persist_outbox();

CREATE FUNCTION public.claim_attendance_persist_outbox(p_limit integer,p_worker_id text) RETURNS TABLE(outbox_id uuid,registro_id uuid,cliente_id uuid,empleado_id uuid,source_event_id uuid,attempt_count integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_worker_id IS NULL OR btrim(p_worker_id)='' THEN RAISE EXCEPTION 'PRODUCTIVE_OUTBOX_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH candidates AS (SELECT o.id FROM public.attendance_persist_outbox o WHERE o.status IN ('PENDING','RETRY') OR (o.status='PROCESSING' AND o.locked_at < transaction_timestamp()-interval '10 minutes') ORDER BY o.created_at FOR UPDATE SKIP LOCKED LIMIT p_limit), claimed AS (UPDATE public.attendance_persist_outbox o SET status='PROCESSING',attempt_count=o.attempt_count+1,locked_by=p_worker_id,locked_at=transaction_timestamp(),updated_at=transaction_timestamp() FROM candidates c WHERE o.id=c.id RETURNING o.id,o.registro_id,o.cliente_id,o.empleado_id,o.source_event_id,o.attempt_count) SELECT c.id,c.registro_id,c.cliente_id,c.empleado_id,c.source_event_id,c.attempt_count FROM claimed c;
END $fn$;

CREATE FUNCTION public.complete_attendance_persist_outbox(p_outbox_id uuid,p_worker_id text,p_terminal_status text,p_error_code text,p_runtime_result text,p_workday_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_rows integer;
BEGIN
  IF p_outbox_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id)='' OR p_terminal_status NOT IN ('SUCCEEDED','RETRY','DENIED') OR (p_error_code IS NOT NULL AND char_length(p_error_code)>120) OR (p_terminal_status='SUCCEEDED' AND (p_runtime_result NOT IN ('INSERTED','UNCHANGED') OR p_workday_id IS NULL)) OR (p_terminal_status<>'SUCCEEDED' AND (p_runtime_result IS NOT NULL OR p_workday_id IS NOT NULL)) THEN RAISE EXCEPTION 'PRODUCTIVE_OUTBOX_COMPLETE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.attendance_persist_outbox SET status=p_terminal_status,last_error_code=p_error_code,persistence_result=p_runtime_result,workday_id=p_workday_id,completed_at=CASE WHEN p_terminal_status IN ('SUCCEEDED','DENIED') THEN transaction_timestamp() ELSE NULL END,locked_by=NULL,locked_at=NULL,updated_at=transaction_timestamp() WHERE id=p_outbox_id AND status='PROCESSING' AND locked_by=p_worker_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'PRODUCTIVE_OUTBOX_ACK_OWNERSHIP_INVALID' USING ERRCODE='42501'; END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.claim_attendance_persist_outbox(integer,text),public.complete_attendance_persist_outbox(uuid,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_persist_outbox(integer,text),public.complete_attendance_persist_outbox(uuid,text,text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_workday_record(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_schedule_id uuid,p_timezone text,p_first_in timestamptz,p_last_out timestamptz,p_worked_minutes integer,p_break_minutes integer,p_overtime_minutes integer,p_late_minutes integer,p_early_leave_minutes integer,p_status text,p_integrity_hash text,p_calculation_version integer,p_registro_id uuid) RETURNS TABLE(workday_id uuid,persistence_result text,integrity_hash text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_id uuid; v_source uuid; v_revision uuid; v_assignments integer;
BEGIN
  IF p_calculation_version<>3 OR NULLIF(btrim(p_integrity_hash),'') IS NULL OR p_registro_id IS NULL OR p_schedule_id IS NULL OR p_workday_date IS NULL THEN RAISE EXCEPTION 'PERSIST_PAYLOAD_INVALID' USING ERRCODE='22023'; END IF;
  SELECT r.source_event_id INTO v_source FROM public.registro_asistencia r WHERE r.id=p_registro_id AND r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id FOR KEY SHARE;
  IF v_source IS NULL OR NOT EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED') THEN RAISE EXCEPTION 'PERSIST_SOURCE_EVENT_DENIED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_features f WHERE f.cliente_id=p_cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.mode='PERSIST_ACTIVE' AND f.enabled AND f.canary_registro_id IS NULL AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL AND f.canary_workday_date IS NULL) THEN RAISE EXCEPTION 'PERSIST_AUTHORIZATION_DENIED' USING ERRCODE='42501'; END IF;
  SELECT count(*),min(eh.schedule_revision_id) INTO v_assignments,v_revision FROM public.empleados_horarios eh WHERE eh.cliente_id=p_cliente_id AND eh.empleado_id=p_empleado_id AND eh.horario_id=p_schedule_id AND eh.activo AND eh.fecha_inicio<=p_workday_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=p_workday_date);
  IF v_assignments<>1 OR v_revision IS NULL OR NOT EXISTS(SELECT 1 FROM public.schedule_revisions sr WHERE sr.id=v_revision AND sr.cliente_id=p_cliente_id AND sr.horario_id=p_schedule_id AND public.schedule_revision_calculation_hash(sr.config_snapshot)=sr.integrity_hash) THEN RAISE EXCEPTION 'PERSIST_REVISION_RESOLUTION_DENIED' USING ERRCODE='23514'; END IF;
  INSERT INTO public.workday_records(cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version) VALUES(p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_integrity_hash,p_calculation_version) ON CONFLICT(cliente_id,empleado_id,workday_date) DO NOTHING RETURNING id INTO v_id;
  IF FOUND THEN INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action) VALUES(v_id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'INSERTED'); RETURN QUERY SELECT v_id,'INSERTED'::text,p_integrity_hash; RETURN; END IF;
  SELECT w.id INTO v_id FROM public.workday_records w WHERE w.cliente_id=p_cliente_id AND w.empleado_id=p_empleado_id AND w.workday_date=p_workday_date FOR KEY SHARE;
  IF v_id IS NULL OR EXISTS(SELECT 1 FROM public.workday_records w WHERE w.id=v_id AND (w.schedule_id IS DISTINCT FROM p_schedule_id OR w.timezone IS DISTINCT FROM p_timezone OR w.first_in IS DISTINCT FROM p_first_in OR w.last_out IS DISTINCT FROM p_last_out OR w.worked_minutes IS DISTINCT FROM p_worked_minutes OR w.break_minutes IS DISTINCT FROM p_break_minutes OR w.overtime_minutes IS DISTINCT FROM p_overtime_minutes OR w.late_minutes IS DISTINCT FROM p_late_minutes OR w.early_leave_minutes IS DISTINCT FROM p_early_leave_minutes OR w.status IS DISTINCT FROM p_status OR w.integrity_hash IS DISTINCT FROM p_integrity_hash OR w.calculation_version IS DISTINCT FROM p_calculation_version)) THEN RAISE EXCEPTION 'PERSIST_EXISTING_WORKDAY_MISMATCH' USING ERRCODE='40001'; END IF;
  RETURN QUERY SELECT v_id,'UNCHANGED'::text,p_integrity_hash;
END $fn$;
REVOKE ALL ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid) TO service_role;
COMMIT;
