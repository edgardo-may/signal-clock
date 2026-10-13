-- LOCAL/DBREAL validation first. Additive authorization lifecycle; no historical data UPDATE.
BEGIN;
DO $preflight$
BEGIN
  IF to_regclass('public.devices') IS NULL OR to_regclass('public.dispositivos') IS NULL
    OR to_regclass('public.device_commands') IS NULL
    OR to_regprocedure('public.auth_is_superadmin()') IS NULL THEN
    RAISE EXCEPTION 'DEVICE_APPROVAL_SCHEMA_INCOMPATIBLE';
  END IF;
  IF EXISTS(SELECT 1 FROM public.devices GROUP BY upper(btrim(serial_number)) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'DEVICE_APPROVAL_DUPLICATE_SERIAL';
  END IF;
END $preflight$;

CREATE TABLE public.device_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  requested_by uuid NOT NULL REFERENCES public.usuarios_perfiles(id),
  serial_number text NOT NULL CHECK(serial_number=upper(btrim(serial_number)) AND length(serial_number) BETWEEN 1 AND 50),
  protocol text NOT NULL CHECK(protocol IN ('ZKTECO_ADMS','HIKVISION_ISUP')),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
  location text,
  timezone text NOT NULL,
  device_type text NOT NULL DEFAULT 'general' CHECK(device_type IN ('general','entrada','salida','comedor','rh','acceso')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  request_reason text CHECK(length(request_reason)<=1000),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.usuarios_perfiles(id),
  reason text,
  device_id uuid,
  CHECK ((status='PENDING' AND resolved_at IS NULL AND resolved_by IS NULL AND device_id IS NULL)
    OR (status='APPROVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND device_id IS NOT NULL)
    OR (status IN ('REJECTED','CANCELLED') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND device_id IS NULL)),
  CHECK(status<>'REJECTED' OR nullif(btrim(reason),'') IS NOT NULL)
);
CREATE UNIQUE INDEX device_request_active_serial ON public.device_registration_requests(serial_number)
WHERE status IN ('PENDING','APPROVED');
CREATE INDEX device_request_tenant_status ON public.device_registration_requests(cliente_id,status,requested_at);
CREATE TABLE public.device_registration_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.device_registration_requests(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  actor_id uuid NOT NULL REFERENCES public.usuarios_perfiles(id),
  decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED','CANCELLED')),
  reason text,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id)
);

CREATE FUNCTION public.device_request_can_manage(p_cliente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.usuarios_perfiles p WHERE p.id=auth.uid()
 AND p.estatus_cuenta='activo' AND (p.rol='superadmin' OR (p.rol='admin' AND p.cliente_id=p_cliente_id)))
$fn$;
CREATE FUNCTION public.device_request_can_read(p_cliente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.usuarios_perfiles p WHERE p.id=auth.uid()
 AND p.estatus_cuenta='activo' AND (p.rol='superadmin' OR p.cliente_id=p_cliente_id))
$fn$;
CREATE FUNCTION public.device_request_serial_taken(p_serial text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.devices WHERE upper(btrim(serial_number))=p_serial)
 OR EXISTS(SELECT 1 FROM public.dispositivos WHERE upper(btrim(numero_serie))=p_serial OR upper(btrim(device_id_hikvision))=p_serial)
$fn$;
REVOKE ALL ON FUNCTION public.device_request_serial_taken(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.request_device_registration(p_serial text,p_name text,p_protocol text,
 p_timezone text,p_location text DEFAULT NULL,p_device_type text DEFAULT 'general',p_target_cliente_id uuid DEFAULT NULL,p_request_reason text DEFAULT NULL)
RETURNS public.device_registration_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor public.usuarios_perfiles%ROWTYPE; tenant uuid; serial text; result public.device_registration_requests%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM public.usuarios_perfiles WHERE id=auth.uid();
 IF actor.id IS NULL OR actor.estatus_cuenta<>'activo' OR actor.rol NOT IN ('admin','superadmin') THEN
  RAISE EXCEPTION 'DEVICE_REQUEST_DENIED' USING ERRCODE='42501'; END IF;
 tenant:=CASE WHEN actor.rol='superadmin' THEN p_target_cliente_id ELSE actor.cliente_id END;
 IF tenant IS NULL OR (actor.rol='admin' AND p_target_cliente_id IS NOT NULL AND p_target_cliente_id<>tenant)
 OR NOT EXISTS(SELECT 1 FROM public.clientes WHERE id=tenant) THEN
  RAISE EXCEPTION 'DEVICE_REQUEST_TENANT_DENIED' USING ERRCODE='42501'; END IF;
 serial:=upper(btrim(p_serial));
 IF serial IS NULL OR serial !~ '^[A-Z0-9_-]{1,50}$' OR nullif(btrim(p_name),'') IS NULL
 OR p_protocol IS NULL OR p_protocol NOT IN ('ZKTECO_ADMS','HIKVISION_ISUP')
 OR p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)
 OR p_device_type IS NULL OR p_device_type NOT IN ('general','entrada','salida','comedor','rh','acceso') THEN
  RAISE EXCEPTION 'DEVICE_REQUEST_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('device-registration:'||serial,0));
 IF public.device_request_serial_taken(serial) OR EXISTS(SELECT 1 FROM public.device_registration_requests
 WHERE serial_number=serial AND status IN ('PENDING','APPROVED')) THEN
  RAISE EXCEPTION 'DEVICE_SERIAL_UNAVAILABLE' USING ERRCODE='23505'; END IF;
 INSERT INTO public.device_registration_requests(cliente_id,requested_by,serial_number,name,protocol,timezone,location,device_type,request_reason)
 VALUES(tenant,actor.id,serial,btrim(p_name),p_protocol,p_timezone,nullif(btrim(p_location),''),p_device_type,nullif(btrim(p_request_reason),'')) RETURNING * INTO result;
 RETURN result;
END $fn$;

CREATE FUNCTION public.resolve_device_registration(p_request_id uuid,p_decision text,p_reason text DEFAULT NULL)
RETURNS public.device_registration_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE request public.device_registration_requests%ROWTYPE; previous jsonb; new_device uuid;
BEGIN
 IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'DEVICE_APPROVAL_DENIED' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'DEVICE_DECISION_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO request FROM public.device_registration_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_REQUEST_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF request.status=p_decision THEN
  IF p_decision='APPROVED' AND NOT (
   (request.protocol='ZKTECO_ADMS' AND EXISTS(SELECT 1 FROM public.devices WHERE id=request.device_id
    AND cliente_id=request.cliente_id AND upper(btrim(serial_number))=request.serial_number))
   OR (request.protocol='HIKVISION_ISUP' AND EXISTS(SELECT 1 FROM public.dispositivos WHERE id=request.device_id
    AND cliente_id=request.cliente_id AND upper(btrim(numero_serie))=request.serial_number AND marca='hikvision'))
  ) THEN RAISE EXCEPTION 'DEVICE_APPROVAL_ASSOCIATION_MISSING' USING ERRCODE='55000'; END IF;
  RETURN request;
 END IF;
 IF request.status<>'PENDING' THEN RAISE EXCEPTION 'DEVICE_REQUEST_ALREADY_RESOLVED' USING ERRCODE='55000'; END IF;
 IF p_decision='REJECTED' AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'DEVICE_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
 previous:=to_jsonb(request);
 PERFORM pg_advisory_xact_lock(hashtextextended('device-registration:'||request.serial_number,0));
 IF p_decision='APPROVED' THEN
  IF public.device_request_serial_taken(request.serial_number) THEN RAISE EXCEPTION 'DEVICE_SERIAL_UNAVAILABLE' USING ERRCODE='23505'; END IF;
  IF request.protocol='ZKTECO_ADMS' THEN
   INSERT INTO public.devices(cliente_id,serial_number,name,location,timezone,device_type,is_active,last_activity,port)
   VALUES(request.cliente_id,request.serial_number,request.name,request.location,request.timezone,request.device_type,true,NULL,7660)
   RETURNING id INTO new_device;
  ELSE
   -- Catalog association only. Real ISUP authentication/handshake must be separately validated.
   INSERT INTO public.dispositivos(cliente_id,device_id_hikvision,numero_serie,nombre_ubicacion,marca,estatus,timezone,puerto)
   VALUES(request.cliente_id,request.serial_number,request.serial_number,request.name,'hikvision','activo',request.timezone,7660)
   RETURNING id INTO new_device;
  END IF;
 END IF;
 UPDATE public.device_registration_requests SET status=p_decision,resolved_at=now(),resolved_by=auth.uid(),
 reason=nullif(btrim(p_reason),''),device_id=new_device WHERE id=request.id RETURNING * INTO request;
 INSERT INTO public.device_registration_request_audit(request_id,cliente_id,actor_id,decision,reason,before_state,after_state)
 VALUES(request.id,request.cliente_id,auth.uid(),p_decision,request.reason,previous,to_jsonb(request));
 RETURN request;
END $fn$;

CREATE FUNCTION public.cancel_device_registration(p_request_id uuid,p_reason text DEFAULT NULL)
RETURNS public.device_registration_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE request public.device_registration_requests%ROWTYPE; previous jsonb;
BEGIN
 SELECT * INTO request FROM public.device_registration_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR NOT public.device_request_can_manage(request.cliente_id) THEN
  RAISE EXCEPTION 'DEVICE_CANCELLATION_DENIED' USING ERRCODE='42501'; END IF;
 IF request.status='CANCELLED' THEN RETURN request; END IF;
 IF request.status<>'PENDING' THEN RAISE EXCEPTION 'DEVICE_REQUEST_ALREADY_RESOLVED' USING ERRCODE='55000'; END IF;
 previous:=to_jsonb(request);
 UPDATE public.device_registration_requests SET status='CANCELLED',resolved_at=now(),resolved_by=auth.uid(),reason=nullif(btrim(p_reason),'')
 WHERE id=request.id RETURNING * INTO request;
 INSERT INTO public.device_registration_request_audit(request_id,cliente_id,actor_id,decision,reason,before_state,after_state)
 VALUES(request.id,request.cliente_id,auth.uid(),'CANCELLED',request.reason,previous,to_jsonb(request));
 RETURN request;
END $fn$;
CREATE FUNCTION public.reject_device_decision_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN RAISE EXCEPTION 'DEVICE_DECISION_IMMUTABLE' USING ERRCODE='55000'; END $fn$;
CREATE TRIGGER device_decision_immutable BEFORE UPDATE OR DELETE ON public.device_registration_request_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_device_decision_mutation();
ALTER TABLE public.device_registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_registration_request_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_requests_read ON public.device_registration_requests FOR SELECT TO authenticated
USING(public.device_request_can_read(cliente_id));
CREATE POLICY device_request_audit_read ON public.device_registration_request_audit FOR SELECT TO authenticated
USING(public.device_request_can_read(cliente_id));
REVOKE ALL ON public.device_registration_requests,public.device_registration_request_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.device_registration_requests,public.device_registration_request_audit TO authenticated;

-- Revoke table and column mutation privileges; RPCs alone create operational associations.
REVOKE INSERT,UPDATE,DELETE ON public.devices,public.dispositivos FROM PUBLIC,authenticated,anon;
DO $columns$
DECLARE item record;
BEGIN
 FOR item IN SELECT table_name,string_agg(quote_ident(column_name),',') columns FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN ('devices','dispositivos','device_commands') GROUP BY table_name LOOP
  EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.%I FROM PUBLIC, authenticated, anon',item.columns,item.columns,item.table_name);
 END LOOP;
END $columns$;
GRANT UPDATE(name,location,ip_address,port,timezone,device_type) ON public.devices TO authenticated;
GRANT UPDATE(nombre_ubicacion,ip_local,descripcion,timezone,puerto) ON public.dispositivos TO authenticated;
DO $policies$
DECLARE item record;
BEGIN
 FOR item IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('devices','dispositivos','device_commands') LOOP
  EXECUTE format('DROP POLICY %I ON public.%I',item.policyname,item.tablename);
 END LOOP;
END $policies$;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_read ON public.devices FOR SELECT TO authenticated USING(public.device_request_can_read(cliente_id));
CREATE POLICY devices_metadata_update ON public.devices FOR UPDATE TO authenticated
USING(public.device_request_can_manage(cliente_id)) WITH CHECK(public.device_request_can_manage(cliente_id));
CREATE POLICY dispositivos_read ON public.dispositivos FOR SELECT TO authenticated USING(public.device_request_can_read(cliente_id));
CREATE POLICY dispositivos_metadata_update ON public.dispositivos FOR UPDATE TO authenticated
USING(public.device_request_can_manage(cliente_id)) WITH CHECK(public.device_request_can_manage(cliente_id));

CREATE FUNCTION public.device_command_can_access(p_serial text,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.devices d WHERE upper(btrim(d.serial_number))=upper(btrim(p_serial))
 AND CASE WHEN p_write THEN d.is_active AND public.device_request_can_manage(d.cliente_id)
 ELSE public.device_request_can_read(d.cliente_id) END)
$fn$;
REVOKE ALL ON public.device_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.device_commands TO authenticated;
CREATE POLICY device_commands_read ON public.device_commands FOR SELECT TO authenticated
USING(public.device_command_can_access(device_serial,false));
CREATE POLICY device_commands_insert ON public.device_commands FOR INSERT TO authenticated
WITH CHECK(public.device_command_can_access(device_serial,true) AND is_executed=false);
CREATE FUNCTION public.set_device_operational_state(p_device_id uuid,p_active boolean) RETURNS public.devices
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result public.devices%ROWTYPE;
BEGIN
 IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'DEVICE_ACTIVATION_DENIED' USING ERRCODE='42501'; END IF;
 IF p_active IS NULL THEN RAISE EXCEPTION 'DEVICE_STATE_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE public.devices SET is_active=p_active WHERE id=p_device_id RETURNING * INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $fn$;

-- No clients can forge an association to another tenant's operational equipment.
CREATE FUNCTION public.guard_device_assignment_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.devices d JOIN public.empleados e ON e.id=NEW.employee_id
 WHERE d.id=NEW.device_id AND d.cliente_id=NEW.cliente_id AND e.cliente_id=NEW.cliente_id
 AND (NOT NEW.activo OR d.is_active)) THEN RAISE EXCEPTION 'DEVICE_ASSIGNMENT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF auth.uid() IS NOT NULL AND NOT public.device_request_can_manage(NEW.cliente_id) THEN
  RAISE EXCEPTION 'DEVICE_ASSIGNMENT_DENIED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER device_assignment_scope_guard BEFORE INSERT OR UPDATE OF device_id,employee_id,cliente_id,activo
ON public.device_employee_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_device_assignment_scope();

DO $grants$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('device_request_can_manage','device_request_can_read',
 'request_device_registration','resolve_device_registration','cancel_device_registration',
 'device_command_can_access','set_device_operational_state') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $grants$;
NOTIFY pgrst,'reload schema';
COMMIT;
