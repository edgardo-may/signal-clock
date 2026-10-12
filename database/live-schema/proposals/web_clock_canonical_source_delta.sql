-- CANDIDATE: apply after employee_web_clock_candidate.sql in caller transaction.
-- ZERO existing business-row changes. No production authorization.
DO $guard$ BEGIN
 IF current_setting('signum.employee_design',true) IS DISTINCT FROM 'DBREAL_ROLLBACK_ONLY'
 THEN RAISE EXCEPTION 'EMPLOYEE_DBREAL_CONTEXT_REQUIRED'; END IF;
END $guard$;

-- An ingestion receipt is authority; raw_payload.source is not.
CREATE TABLE employee_private.web_clock_receipts (
 source_event_id uuid PRIMARY KEY REFERENCES public.attendance_source_events(id),
 registro_id uuid UNIQUE NOT NULL REFERENCES public.registro_asistencia(id) DEFERRABLE INITIALLY DEFERRED,
 session_id uuid NOT NULL REFERENCES employee_private.sessions(id),
 cliente_id uuid NOT NULL REFERENCES public.clientes(id),
 empleado_id uuid NOT NULL REFERENCES public.empleados(id),
 device_id uuid NOT NULL REFERENCES public.devices(id),
 received_at timestamptz NOT NULL,
 direction text NOT NULL CHECK(direction IN ('entrada','salida','descanso_inicio','descanso_fin'))
);
ALTER TABLE employee_private.web_clock_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON employee_private.web_clock_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.is_canonical_web_clock_source(p_registro uuid,p_source uuid,p_company uuid,p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 SELECT EXISTS(
  SELECT 1 FROM employee_private.web_clock_receipts proof
  JOIN employee_private.sessions s ON s.id=proof.session_id
   AND s.cliente_id=proof.cliente_id AND s.empleado_id=proof.empleado_id
   AND s.created_at<=proof.received_at AND s.expires_at>proof.received_at
   AND (s.revoked_at IS NULL OR s.revoked_at>proof.received_at)
  JOIN public.empleados employee ON employee.id=proof.empleado_id AND employee.cliente_id=proof.cliente_id AND employee.activo
  JOIN public.clientes company ON company.id=proof.cliente_id AND company.estatus='activo'
  JOIN employee_private.web_clocks terminal ON terminal.device_id=proof.device_id AND terminal.cliente_id=proof.cliente_id AND terminal.active
  JOIN public.devices device ON device.id=terminal.device_id AND device.cliente_id=proof.cliente_id AND device.is_active
  JOIN employee_private.company_authorizations capability ON capability.cliente_id=proof.cliente_id AND capability.enabled
  JOIN public.attendance_source_events event ON event.id=proof.source_event_id
   AND event.cliente_id=proof.cliente_id AND event.employee_id=proof.empleado_id AND event.device_id=proof.device_id
   AND event.source_type='WEB' AND event.processing_status='PROCESSED'
   AND event.request_id IS NOT NULL AND event.source_reference=event.request_id
   AND event.occurred_at=proof.received_at
   AND event.raw_payload->>'source'='WEB_CLOCK' AND event.raw_payload->>'direction'=proof.direction
  JOIN public.registro_asistencia record ON record.id=proof.registro_id AND record.source_event_id=event.id
   AND record.cliente_id=proof.cliente_id AND record.empleado_id=proof.empleado_id AND record.dispositivo_id=proof.device_id
   AND record.verificado_at=proof.received_at AND record.tipo_verificacion=proof.direction
   AND record.es_manual IS FALSE AND record.metodo='web'
  WHERE proof.registro_id=p_registro AND proof.source_event_id=p_source AND proof.cliente_id=p_company AND proof.empleado_id=p_employee
 );
$fn$;
REVOKE ALL ON FUNCTION public.is_canonical_web_clock_source(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_canonical_web_clock_source(uuid,uuid,uuid,uuid) TO service_role;

-- Owner-backed read view; no session identifiers, token hashes or browser grants.
CREATE VIEW public.web_clock_canonical_sources AS
 SELECT registro_id,source_event_id,cliente_id,empleado_id,device_id
 FROM employee_private.web_clock_receipts proof
 WHERE public.is_canonical_web_clock_source(registro_id,source_event_id,cliente_id,empleado_id);
REVOKE ALL ON public.web_clock_canonical_sources FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.web_clock_canonical_sources TO service_role;

-- Extend the already-frozen portal body only at its canonical ingest boundary.
DO $portal$ DECLARE body text; old text; replacement text; BEGIN
 body:=pg_get_functiondef('public.fn_employee_portal(text,jsonb)'::regprocedure);
 old:='   INSERT INTO public.registro_asistencia(cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload,source_event_id)';
 replacement:='   record_id:=gen_random_uuid();
   INSERT INTO employee_private.web_clock_receipts(source_event_id,registro_id,session_id,cliente_id,empleado_id,device_id,received_at,direction)
   VALUES(event_id,record_id,session.id,company.id,employee.id,terminal.id,stamp,expected);
   INSERT INTO public.registro_asistencia(id,cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload,source_event_id)';
 IF position(old IN body)=0 OR position('VALUES(company.id,employee.id,terminal.id,stamp,expected' IN body)=0
 THEN RAISE EXCEPTION 'FROZEN_PORTAL_INGEST_CONTRACT_MISMATCH'; END IF;
 body:=replace(body,old,replacement);
 body:=replace(body,'VALUES(company.id,employee.id,terminal.id,stamp,expected','VALUES(record_id,company.id,employee.id,terminal.id,stamp,expected');
 -- Existing manifests compare millisecond effective timestamps to observed_at.
 -- Match that contract at server ingestion; do not change revision semantics.
 body:=replace(body,'stamp timestamptz:=clock_timestamp();','stamp timestamptz:=date_trunc(''milliseconds'',clock_timestamp());');
 body:=replace(body,'stamp:=clock_timestamp();','stamp:=date_trunc(''milliseconds'',clock_timestamp());');
 EXECUTE body;
END $portal$;

-- Preserve gate/canary checks and the physical predicate exactly.
CREATE OR REPLACE FUNCTION public.enqueue_attendance_persist_outbox()
 RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN
 IF NEW.source_event_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenant_features f WHERE f.cliente_id=NEW.cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.mode='PERSIST_ACTIVE' AND f.enabled AND f.canary_registro_id IS NULL AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL AND f.canary_workday_date IS NULL) THEN RETURN NEW; END IF;
 IF NEW.es_manual IS TRUE OR NOT (
  EXISTS (SELECT 1 FROM public.attendance_source_events e WHERE e.id=NEW.source_event_id AND e.cliente_id=NEW.cliente_id AND e.employee_id=NEW.empleado_id AND e.device_id=NEW.dispositivo_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED')
  OR public.is_canonical_web_clock_source(NEW.id,NEW.source_event_id,NEW.cliente_id,NEW.empleado_id)
 ) THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_CANONICAL_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 INSERT INTO public.attendance_persist_outbox(registro_id,cliente_id,empleado_id,source_event_id) VALUES(NEW.id,NEW.cliente_id,NEW.empleado_id,NEW.source_event_id) ON CONFLICT(registro_id) DO NOTHING;
 RETURN NEW;
END $function$;

-- RPC20 has the same independent source gate. Change only that predicate;
-- its signature, locks, authorization, revision/promotion and persistence body stay intact.
DO $rpc_source$ DECLARE body text; old text; replacement text; BEGIN
 body:=pg_get_functiondef('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer,jsonb,jsonb)'::regprocedure);
 old:='NOT EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type=''ZKTECO'' AND e.processing_status=''PROCESSED'')';
 replacement:='NOT (EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type=''ZKTECO'' AND e.processing_status=''PROCESSED'') OR public.is_canonical_web_clock_source(p_registro_id,v_source,p_cliente_id,p_empleado_id))';
 IF position(old IN body)=0 THEN RAISE EXCEPTION 'RPC20_SOURCE_GUARD_CONTRACT_MISMATCH'; END IF;
 EXECUTE replace(body,old,replacement);
END $rpc_source$;
