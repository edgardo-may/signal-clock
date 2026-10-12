-- CANDIDATE ONLY. No production authorization. Caller owns BEGIN/ROLLBACK.
-- Structural installation changes ZERO pre-existing business rows.
DO $guard$ BEGIN
 IF current_setting('signum.employee_design',true) IS DISTINCT FROM 'DBREAL_ROLLBACK_ONLY'
 THEN RAISE EXCEPTION 'EMPLOYEE_DBREAL_CONTEXT_REQUIRED'; END IF;
 IF to_regprocedure('extensions.crypt(text,text)') IS NULL
 THEN RAISE EXCEPTION 'EXISTING_PGCRYPTO_REQUIRED'; END IF;
END $guard$;

CREATE SCHEMA employee_private;
REVOKE ALL ON SCHEMA employee_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA employee_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA employee_private REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE employee_private.credentials (
 empleado_id uuid PRIMARY KEY REFERENCES public.empleados(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 pin_hash text NOT NULL CHECK(pin_hash LIKE '$2a$%' OR pin_hash LIKE '$2b$%'),
 version uuid NOT NULL DEFAULT gen_random_uuid(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE employee_private.sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 cliente_id uuid NOT NULL REFERENCES public.clientes(id), empleado_id uuid NOT NULL REFERENCES public.empleados(id),
 credential_version uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL, last_used_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '8 hours')
);
CREATE TABLE employee_private.company_authorizations (
 cliente_id uuid PRIMARY KEY REFERENCES public.clientes(id), enabled boolean NOT NULL DEFAULT false,
 authorized_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE employee_private.web_clocks (
 device_id uuid PRIMARY KEY REFERENCES public.devices(id), cliente_id uuid NOT NULL REFERENCES public.clientes(id),
 slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'), active boolean NOT NULL DEFAULT true
);
DO $rls$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['credentials','sessions','company_authorizations','web_clocks'] LOOP
  EXECUTE format('ALTER TABLE employee_private.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON employee_private.%I FROM PUBLIC,anon,authenticated,service_role',n);
 END LOOP;
END $rls$;

-- Capture only future credential changes. No plaintext backfill during installation.
-- BEFORE the existing AFTER audit trigger: NEW.pin is already NULL when audited.
CREATE FUNCTION employee_private.capture_pin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
BEGIN
 IF NEW.pin IS NOT NULL AND btrim(NEW.pin)<>'' THEN
  IF NEW.pin !~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'PIN_REQUIRES_FIVE_DIGITS' USING ERRCODE='22023'; END IF;
  INSERT INTO employee_private.credentials(empleado_id,pin_hash)
  VALUES(NEW.id,extensions.crypt(NEW.pin,extensions.gen_salt('bf',10)))
  ON CONFLICT(empleado_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,version=gen_random_uuid(),updated_at=clock_timestamp();
 END IF;
 NEW.pin:=NULL;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION employee_private.capture_pin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER employee_pin_capture BEFORE INSERT OR UPDATE OF pin ON public.empleados
 FOR EACH ROW EXECUTE FUNCTION employee_private.capture_pin();

CREATE FUNCTION public.manage_web_clock(p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE actor public.usuarios_perfiles%ROWTYPE; company uuid; device uuid;
BEGIN
 SELECT * INTO actor FROM public.usuarios_perfiles WHERE id=auth.uid();
 IF actor.id IS NULL OR actor.estatus_cuenta<>'activo' OR actor.rol NOT IN ('admin','superadmin')
 THEN RAISE EXCEPTION 'WEB_CLOCK_MANAGEMENT_DENIED' USING ERRCODE='42501'; END IF;
 company:=CASE WHEN actor.rol='superadmin' THEN (p_input->>'cliente_id')::uuid ELSE actor.cliente_id END;
 IF company IS NULL OR (p_input ? 'cliente_id' AND (p_input->>'cliente_id')::uuid<>company)
 OR NOT EXISTS(SELECT 1 FROM public.clientes WHERE id=company AND estatus='activo')
 THEN RAISE EXCEPTION 'WEB_CLOCK_COMPANY_DENIED' USING ERRCODE='42501'; END IF;
 IF p_action='AUTHORIZE' THEN
  IF actor.rol<>'superadmin' THEN RAISE EXCEPTION 'WEB_CLOCK_CENTRAL_REQUIRED' USING ERRCODE='42501'; END IF;
  INSERT INTO employee_private.company_authorizations(cliente_id,enabled,authorized_by)
  VALUES(company,COALESCE((p_input->>'enabled')::boolean,false),actor.id)
  ON CONFLICT(cliente_id) DO UPDATE SET enabled=EXCLUDED.enabled,authorized_by=actor.id,updated_at=clock_timestamp();
 ELSIF p_action='TERMINAL' THEN
  IF NOT EXISTS(SELECT 1 FROM employee_private.company_authorizations WHERE cliente_id=company AND enabled)
  THEN RAISE EXCEPTION 'WEB_CLOCK_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  IF COALESCE(p_input->>'slug','') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
  OR nullif(btrim(p_input->>'name'),'') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_input->>'timezone')
  THEN RAISE EXCEPTION 'WEB_CLOCK_INVALID_CONTEXT' USING ERRCODE='22023'; END IF;
  -- No legacy dispositivos row or biometric assignment is created.
  INSERT INTO public.devices(cliente_id,serial_number,name,timezone,location,is_active)
  VALUES(company,'WEB-'||gen_random_uuid()::text,left(p_input->>'name',100),p_input->>'timezone',left(p_input->>'location',200),true)
  RETURNING id INTO device;
  INSERT INTO employee_private.web_clocks(device_id,cliente_id,slug) VALUES(device,company,p_input->>'slug');
 ELSE RAISE EXCEPTION 'WEB_CLOCK_ACTION_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_logs(cliente_id,actor_user_id,actor_role,action,resource_type,resource_id,result,metadata)
 VALUES(company,actor.id,actor.rol,'WEB_CLOCK_'||p_action,'WEB_CLOCK',COALESCE(device::text,company::text),'SUCCESS','{}');
 RETURN jsonb_build_object('success',true,'device_id',device);
END $fn$;
REVOKE ALL ON FUNCTION public.manage_web_clock(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_web_clock(text,jsonb) TO authenticated;

CREATE FUNCTION public.fn_employee_portal(p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE
 employee public.empleados%ROWTYPE; company public.clientes%ROWTYPE;
 session employee_private.sessions%ROWTYPE; credential employee_private.credentials%ROWTYPE;
 terminal record; schedule jsonb; profile jsonb; logs jsonb; clocks jsonb; result jsonb;
 stamp timestamptz:=clock_timestamp(); company_id uuid; employee_id uuid; digest text;
 key text; origin_key text; n integer; day date; weekday text; latest text; expected text; has_break boolean;
 event_id uuid; record_id uuid; request uuid; existing public.attendance_source_events%ROWTYPE;
 evidence jsonb;
BEGIN
 IF p_action='DIRECTORY' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'nombre_empresa',nombre_empresa) ORDER BY nombre_empresa),'[]') INTO result
  FROM public.clientes WHERE estatus='activo';
  RETURN jsonb_build_object('success',true,'companies',result);
 END IF;
 digest:=p_input->>'token_hash';
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('success',false,'error','SESSION_DENIED'); END IF;
 IF p_action='LOGIN' THEN
  company_id:=(p_input->>'cliente_id')::uuid;
  SELECT * INTO company FROM public.clientes WHERE id=company_id AND estatus='activo';
  key:='COLLAB_LOGIN:'||COALESCE(company_id::text,'unknown')||':'||encode(extensions.digest(lower(btrim(COALESCE(p_input->>'clave',''))),'sha256'),'hex');
  origin_key:=key||':'||COALESCE(p_input->>'source_hash','unknown');
  PERFORM pg_advisory_xact_lock(hashtextextended(key,0));
  SELECT count(*) INTO n FROM public.rate_limits_logs WHERE operacion=key AND creado_at>stamp-interval '15 minutes';
  IF n<10 THEN
   SELECT count(*) INTO n FROM public.rate_limits_logs WHERE operacion=origin_key AND creado_at>stamp-interval '5 minutes';
  END IF;
  IF n>=5 THEN
   INSERT INTO public.audit_logs(cliente_id,actor_role,action,resource_type,result,metadata)
   VALUES(company.id,'empleado','EMPLOYEE_LOGIN_DENIED','SESSION','DENIED','{"reason":"RATE_LIMIT"}');
   RETURN jsonb_build_object('success',false,'error','LOGIN_DENIED','rate_limited',true);
  END IF;
  INSERT INTO public.rate_limits_logs(cliente_id,operacion,ip_address,creado_at)
  VALUES(company.id,key,COALESCE(p_input->>'source_hash','unknown'),stamp),
        (company.id,origin_key,COALESCE(p_input->>'source_hash','unknown'),stamp);
  SELECT count(*),min(id::text)::uuid INTO n,employee_id FROM public.empleados
  WHERE cliente_id=company.id AND lower(btrim(clave_empleado))=lower(btrim(p_input->>'clave'));
  SELECT * INTO employee FROM public.empleados WHERE id=employee_id AND activo IS TRUE;
  SELECT * INTO credential FROM employee_private.credentials WHERE empleado_id=employee.id;
  IF n<>1 OR employee.id IS NULL OR credential.empleado_id IS NULL
  OR COALESCE(p_input->>'pin','') !~ '^[0-9]{5}$'
  OR extensions.crypt(p_input->>'pin',credential.pin_hash) IS DISTINCT FROM credential.pin_hash THEN
   INSERT INTO public.audit_logs(cliente_id,actor_role,action,resource_type,result,metadata)
   VALUES(company.id,'empleado','EMPLOYEE_LOGIN_DENIED','SESSION','DENIED','{}');
   RETURN jsonb_build_object('success',false,'error','LOGIN_DENIED');
  END IF;
  INSERT INTO employee_private.sessions(token_hash,cliente_id,empleado_id,credential_version,created_at,expires_at,last_used_at)
  VALUES(digest,company.id,employee.id,credential.version,stamp,stamp+interval '8 hours',stamp) RETURNING * INTO session;
  INSERT INTO public.audit_logs(cliente_id,actor_role,action,resource_type,resource_id,result,metadata)
  VALUES(company.id,'empleado','EMPLOYEE_LOGIN_SUCCESS','SESSION',session.id::text,'SUCCESS','{}');
 ELSE
  SELECT s.* INTO session FROM employee_private.sessions s
  JOIN employee_private.credentials c ON c.empleado_id=s.empleado_id AND c.version=s.credential_version
  JOIN public.empleados e ON e.id=s.empleado_id AND e.cliente_id=s.cliente_id AND e.activo IS TRUE
  JOIN public.clientes cl ON cl.id=s.cliente_id AND cl.estatus='activo'
  WHERE s.token_hash=digest AND s.revoked_at IS NULL AND s.expires_at>stamp
   AND s.last_used_at>stamp-interval '30 minutes' FOR UPDATE OF s;
  IF session.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','SESSION_DENIED'); END IF;
  SELECT * INTO employee FROM public.empleados WHERE id=session.empleado_id;
  SELECT * INTO company FROM public.clientes WHERE id=session.cliente_id;
  IF (p_input ? 'empleado_id' AND p_input->>'empleado_id'<>employee.id::text)
  OR (p_input ? 'employee_id' AND p_input->>'employee_id'<>employee.id::text)
  OR (p_input ? 'cliente_id' AND p_input->>'cliente_id'<>company.id::text)
  THEN RETURN jsonb_build_object('success',false,'error','IDENTITY_DENIED'); END IF;
  IF p_action='LOGOUT' THEN
   UPDATE employee_private.sessions SET revoked_at=stamp WHERE id=session.id;
   INSERT INTO public.audit_logs(cliente_id,actor_role,action,resource_type,resource_id,result,metadata)
   VALUES(company.id,'empleado','EMPLOYEE_SESSION_REVOKED','SESSION',session.id::text,'SUCCESS','{}');
   RETURN jsonb_build_object('success',true);
  END IF;
  UPDATE employee_private.sessions SET last_used_at=stamp WHERE id=session.id;
 END IF;

 IF p_action='PUNCH' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('web-punch:'||employee.id::text,0));
  stamp:=clock_timestamp();
  IF session.expires_at<=stamp THEN RETURN jsonb_build_object('success',false,'error','SESSION_DENIED'); END IF;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('slug',w.slug,'name',d.name,'location',d.location,'timezone',d.timezone) ORDER BY w.slug),'[]')
 INTO clocks FROM employee_private.web_clocks w JOIN public.devices d ON d.id=w.device_id AND d.cliente_id=w.cliente_id
 JOIN employee_private.company_authorizations a ON a.cliente_id=w.cliente_id AND a.enabled
 WHERE w.cliente_id=company.id AND w.active AND d.is_active;
 SELECT d.*,w.slug INTO terminal FROM employee_private.web_clocks w
 JOIN public.devices d ON d.id=w.device_id AND d.cliente_id=w.cliente_id
 JOIN employee_private.company_authorizations a ON a.cliente_id=w.cliente_id AND a.enabled
 WHERE w.cliente_id=company.id AND w.active AND d.is_active
 AND w.slug=COALESCE(nullif(p_input->>'clock_slug',''),CASE WHEN jsonb_array_length(clocks)=1 THEN clocks->0->>'slug' END);
 IF p_action<>'LOGIN' AND nullif(p_input->>'clock_slug','') IS NOT NULL AND terminal.id IS NULL THEN
  RETURN jsonb_build_object('success',false,'error','WEB_CLOCK_DENIED'); END IF;
 day:=(stamp AT TIME ZONE COALESCE(terminal.timezone,'UTC'))::date;
 weekday:=(ARRAY['dom','lun','mar','mie','jue','vie','sab'])[extract(dow FROM day)::integer+1];
 SELECT count(*) INTO n FROM public.empleados_horarios eh
 WHERE eh.empleado_id=employee.id AND eh.cliente_id=company.id AND eh.activo
 AND eh.fecha_inicio<=day AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=day);
 IF n>1 THEN RETURN jsonb_build_object('success',false,'error','AMBIGUOUS_SCHEDULE'); END IF;
 SELECT to_jsonb(h) INTO schedule FROM public.empleados_horarios eh JOIN public.horarios h ON h.id=eh.horario_id AND h.cliente_id=eh.cliente_id
 WHERE eh.empleado_id=employee.id AND eh.cliente_id=company.id AND eh.activo
 AND eh.fecha_inicio<=day AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=day);
 IF p_action='PUNCH' THEN
  IF terminal.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','WEB_CLOCK_DENIED'); END IF;
  request:=(p_input->>'request_id')::uuid;
  IF request IS NULL THEN RETURN jsonb_build_object('success',false,'error','REQUEST_ID_REQUIRED'); END IF;
  SELECT * INTO existing FROM public.attendance_source_events
  WHERE cliente_id=company.id AND source_type='WEB' AND request_id=request;
  IF existing.id IS NOT NULL THEN
   IF existing.employee_id<>employee.id OR existing.device_id<>terminal.id
   OR existing.raw_payload->>'direction' IS DISTINCT FROM p_input->>'direction'
   THEN RETURN jsonb_build_object('success',false,'error','REQUEST_SCOPE_DENIED'); END IF;
   SELECT id INTO record_id FROM public.registro_asistencia WHERE source_event_id=existing.id;
   IF record_id IS NULL THEN RAISE EXCEPTION 'WEB_CLOCK_LINK_MISSING'; END IF;
  ELSE
   SELECT tipo_verificacion INTO latest FROM public.registro_asistencia
   WHERE cliente_id=company.id AND empleado_id=employee.id
   AND verificado_at>=day::timestamp AT TIME ZONE terminal.timezone
   AND verificado_at<(day+1)::timestamp AT TIME ZONE terminal.timezone ORDER BY verificado_at DESC,id DESC LIMIT 1;
   has_break:=COALESCE((schedule->'dias_config'->weekday->>'tiene_descanso')::boolean,(schedule->>'tiene_descanso')::boolean,false);
   expected:=CASE WHEN latest IS NULL THEN 'entrada' WHEN latest='entrada' THEN CASE WHEN has_break THEN 'descanso_inicio' ELSE 'salida' END
    WHEN latest='descanso_inicio' THEN 'descanso_fin' WHEN latest='descanso_fin' THEN 'salida' END;
   IF expected IS NULL OR p_input->>'direction' IS DISTINCT FROM expected
   THEN RETURN jsonb_build_object('success',false,'error','DIRECTION_DENIED'); END IF;
   evidence:=COALESCE(p_input->'evidence','{}');
   IF jsonb_typeof(evidence)<>'object' OR octet_length(evidence::text)>200000
   OR (evidence - ARRAY['ubicacion_gps','snapshot','foto_tomada'])<>'{}'
   THEN RETURN jsonb_build_object('success',false,'error','EVIDENCE_INVALID'); END IF;
   evidence:=evidence||jsonb_build_object('source','WEB_CLOCK','direction',expected,'session_id',session.id,'hora_servidor',stamp,'timezone',terminal.timezone);
   INSERT INTO public.attendance_source_events(cliente_id,employee_id,device_id,source_type,source_reference,request_id,occurred_at,raw_payload,processing_status)
   VALUES(company.id,employee.id,terminal.id,'WEB',request,request,stamp,evidence,'PROCESSED') RETURNING id INTO event_id;
   INSERT INTO public.registro_asistencia(cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload,source_event_id)
   VALUES(company.id,employee.id,terminal.id,stamp,expected,'web',false,evidence,event_id) RETURNING id INTO record_id;
   INSERT INTO public.audit_logs(cliente_id,actor_role,action,resource_type,resource_id,result,metadata)
   VALUES(company.id,'empleado','WEB_CLOCK_ATTENDANCE_CREATED','registro_asistencia',record_id::text,'SUCCESS',jsonb_build_object('source_event_id',event_id,'device_id',terminal.id));
  END IF;
  SELECT jsonb_build_object('id',id,'verificado_at',verificado_at,'tipo_verificacion',tipo_verificacion,'source_event_id',source_event_id,'metodo',metodo)
  INTO result FROM public.registro_asistencia WHERE id=record_id;
  RETURN jsonb_build_object('success',true,'registro',result);
 END IF;
 IF p_action NOT IN ('STATE','LOGIN') THEN RETURN jsonb_build_object('success',false,'error','ACTION_DENIED'); END IF;
 profile:=jsonb_build_object('empleadoId',employee.id,'clienteId',company.id,'nombre',employee.nombre,'apellido',employee.apellido,
  'claveEmpleado',employee.clave_empleado,'departamento',employee.departamento,'puesto',employee.puesto,'avatarUrl',employee.avatar_url,
  'nombreEmpresa',company.nombre_empresa,'timezone',terminal.timezone);
 SELECT COALESCE(jsonb_agg(r ORDER BY r->>'verificado_at' DESC),'[]') INTO logs FROM (
  SELECT jsonb_build_object('id',id,'verificado_at',verificado_at,'tipo_verificacion',tipo_verificacion,'metodo',metodo,'source_event_id',source_event_id,
   'raw_payload',jsonb_build_object('foto_tomada',raw_payload->'foto_tomada','ubicacion_gps',raw_payload->'ubicacion_gps')) r
  FROM public.registro_asistencia WHERE cliente_id=company.id AND empleado_id=employee.id
  AND verificado_at>=stamp-interval '14 days' ORDER BY verificado_at DESC,id DESC LIMIT 200
 ) own_rows;
 RETURN jsonb_build_object('success',true,'session',profile,'expires_at',session.expires_at,'server_time',stamp,
  'clock',CASE WHEN terminal.id IS NOT NULL THEN terminal.slug END,'clocks',clocks,'horario',schedule,'attendance',logs);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employee_portal(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_employee_portal(text,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_login_colaborador(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_registrar_asistencia_colaborador(uuid,uuid,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_login_colaborador(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_registrar_asistencia_colaborador(uuid,uuid,text,timestamptz,jsonb) TO service_role;
DROP POLICY anon_colaborador_select ON public.registro_asistencia;
DROP POLICY anon_colaborador_insert ON public.registro_asistencia;
REVOKE ALL ON public.registro_asistencia FROM anon;
-- Remove PUBLIC row grants too, without changing service_role's explicit grants.
REVOKE SELECT,INSERT,UPDATE,DELETE ON public.registro_asistencia FROM PUBLIC;
DO $columns$ DECLARE cols text; BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute
 WHERE attrelid='public.registro_asistencia'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s) ON public.registro_asistencia FROM PUBLIC,anon',cols,cols,cols);
END $columns$;
-- Narrow only this table, never the global authorization helpers.
ALTER POLICY role_read ON public.registro_asistencia TO authenticated USING (
 public.auth_cuenta_activa() AND (public.auth_is_superadmin() OR
  (cliente_id=public.auth_current_cliente_id() AND public.auth_current_role() IN ('admin','rh','supervisor','auditor')))
);
-- Browser attendance is produced only through the verified-session endpoint.
-- Existing staff manual correction policies retain their row contracts.
CREATE POLICY employee_no_generic_insert ON public.registro_asistencia AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(public.auth_cuenta_activa() AND (public.auth_is_superadmin() OR
 (cliente_id=public.auth_current_cliente_id() AND public.auth_current_role() IN ('admin','rh') AND es_manual IS TRUE
  AND EXISTS(SELECT 1 FROM public.empleados e WHERE e.id=empleado_id AND e.cliente_id=registro_asistencia.cliente_id))));
CREATE POLICY employee_no_generic_update ON public.registro_asistencia AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(public.auth_cuenta_activa() AND (public.auth_is_superadmin() OR public.auth_current_role() IN ('admin','rh')))
 WITH CHECK(public.auth_cuenta_activa() AND (public.auth_is_superadmin() OR
 (cliente_id=public.auth_current_cliente_id() AND public.auth_current_role() IN ('admin','rh') AND es_manual IS TRUE
 AND EXISTS(SELECT 1 FROM public.empleados e WHERE e.id=empleado_id AND e.cliente_id=registro_asistencia.cliente_id))));
CREATE POLICY employee_no_generic_delete ON public.registro_asistencia AS RESTRICTIVE FOR DELETE TO authenticated
 USING(public.auth_cuenta_activa() AND (public.auth_is_superadmin() OR public.auth_current_role() IN ('admin','rh')));
