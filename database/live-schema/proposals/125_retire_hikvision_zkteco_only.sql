-- PROPOSAL ONLY: NOT APPLIED, including DBREAL. Separate reviewed release required.
-- Source: user-supplied production catalog. No production connection was used.
-- Do not replay 029, 117 or 124. The installed request RPC has SEVEN arguments.
-- Expected installation business-row changes: ZERO. No table or column is dropped.
-- Deploy frontend reads of public.devices in coordination with this proposal.
-- Run the separate SELECT-only precheck first; data/dependencies require review.
-- Guarded one-time proposal: do not reapply after installation without a new catalog.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE item record;
BEGIN
 IF current_setting('signum.zkteco_only_release_reviewed',true) IS DISTINCT FROM 'approved' THEN
  RAISE EXCEPTION 'ZKTECO_ONLY_REVIEW_REQUIRED'; END IF;
 IF to_regclass('public.devices') IS NULL OR to_regclass('public.device_registration_requests') IS NULL
    OR to_regclass('public.dispositivos') IS NULL THEN
  RAISE EXCEPTION 'ZKTECO_ONLY_CATALOG_REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.device_registration_requests WHERE protocol IS DISTINCT FROM 'ZKTECO_ADMS') THEN
  RAISE EXCEPTION 'LEGACY_DEVICE_REQUESTS_REQUIRE_REVIEW'; END IF;
 IF EXISTS(SELECT 1 FROM public.dispositivos) THEN
  RAISE EXCEPTION 'LEGACY_DEVICE_ROWS_REQUIRE_PRESERVATION_PLAN'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname='request_device_registration' AND oid<>'public.request_device_registration(text,text,text,text,text,text,uuid)'::regprocedure) THEN
  RAISE EXCEPTION 'DEVICE_REQUEST_UNREVIEWED_OVERLOAD'; END IF;
 FOR item IN SELECT * FROM (VALUES
    ('public.device_request_serial_taken(text)','216420b109863cf299b54dd68bd0aec4'),
    ('public.request_device_registration(text, text, text, text, text, text, uuid)','4a6df4750c0dcb5a5cf970f7600923fa'),
    ('public.resolve_device_registration(uuid, text, text)','13383670ac96edd87a45cb70183ae3bb'),
    ('public.fn_obtener_limites_tenant(uuid)','8353999f226855ef04e671b2411f7c70'),
    ('public.fn_resumen_global_tenants()','ccb35a33d28bd72f88b3da4a7798ba76'),
    ('public.fn_validar_limite_dispositivos_tenant()','294b2595dd575569a1c9ec654346a45e'),
    ('public.sync_device_employee_assignments(uuid)','7014c6c2b002dfa22585fbd237f5e39a')
 ) AS expected(signature,previous_md5) LOOP
  IF to_regprocedure(item.signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc
    WHERE oid=to_regprocedure(item.signature) AND md5(pg_get_functiondef(oid))=item.previous_md5) THEN
   RAISE EXCEPTION 'ZKTECO_ONLY_ROUTINE_DRIFT: %',item.signature; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.devices'::regclass AND relrowsecurity)
    OR to_regprocedure('public.guard_device_assignment_scope()') IS NULL THEN
  RAISE EXCEPTION 'EXISTING_DEVICE_SECURITY_REQUIRED'; END IF;
END $preflight$;

-- Preserve all existing request history; abort above rather than converting/deleting.
DO $constraint$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.device_registration_requests'::regclass
   AND conname='device_requests_zkteco_only') THEN
  ALTER TABLE public.device_registration_requests ADD CONSTRAINT device_requests_zkteco_only
   CHECK(protocol='ZKTECO_ADMS');
 END IF;
END $constraint$;

CREATE OR REPLACE FUNCTION public.device_request_serial_taken(p_serial text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.devices WHERE upper(btrim(serial_number))=p_serial)
$function$
;

CREATE OR REPLACE FUNCTION public.request_device_registration(p_serial text, p_name text, p_protocol text, p_timezone text, p_location text DEFAULT NULL::text, p_device_type text DEFAULT 'general'::text, p_target_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS device_registration_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
 OR p_protocol IS NULL OR p_protocol <> 'ZKTECO_ADMS'
 OR p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)
 OR p_device_type IS NULL OR p_device_type NOT IN ('general','entrada','salida','comedor','rh','acceso') THEN
  RAISE EXCEPTION 'DEVICE_REQUEST_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('device-registration:'||serial,0));
 IF public.device_request_serial_taken(serial) OR EXISTS(SELECT 1 FROM public.device_registration_requests
 WHERE serial_number=serial AND status IN ('PENDING','APPROVED')) THEN
  RAISE EXCEPTION 'DEVICE_SERIAL_UNAVAILABLE' USING ERRCODE='23505'; END IF;
 INSERT INTO public.device_registration_requests(cliente_id,requested_by,serial_number,name,protocol,timezone,location,device_type)
 VALUES(tenant,actor.id,serial,btrim(p_name),p_protocol,p_timezone,nullif(btrim(p_location),''),p_device_type) RETURNING * INTO result;
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.resolve_device_registration(p_request_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS device_registration_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE request public.device_registration_requests%ROWTYPE; previous jsonb; new_device uuid;
BEGIN
 IF NOT public.auth_is_superadmin() THEN RAISE EXCEPTION 'DEVICE_APPROVAL_DENIED' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'DEVICE_DECISION_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO request FROM public.device_registration_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_REQUEST_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF request.protocol <> 'ZKTECO_ADMS' THEN
  RAISE EXCEPTION 'DEVICE_PROTOCOL_RETIRED' USING ERRCODE='22023'; END IF;
 IF request.status=p_decision THEN
  IF p_decision='APPROVED' AND NOT EXISTS(SELECT 1 FROM public.devices
    WHERE id=request.device_id AND cliente_id=request.cliente_id
      AND upper(btrim(serial_number))=request.serial_number) THEN
   RAISE EXCEPTION 'DEVICE_APPROVAL_ASSOCIATION_MISSING' USING ERRCODE='55000'; END IF;
  RETURN request;
 END IF;
 IF request.status<>'PENDING' THEN RAISE EXCEPTION 'DEVICE_REQUEST_ALREADY_RESOLVED' USING ERRCODE='55000'; END IF;
 IF p_decision='REJECTED' AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'DEVICE_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
 previous:=to_jsonb(request);
 PERFORM pg_advisory_xact_lock(hashtextextended('device-registration:'||request.serial_number,0));
 IF p_decision='APPROVED' THEN
  IF public.device_request_serial_taken(request.serial_number) THEN RAISE EXCEPTION 'DEVICE_SERIAL_UNAVAILABLE' USING ERRCODE='23505'; END IF;
   INSERT INTO public.devices(cliente_id,serial_number,name,location,timezone,device_type,is_active,last_activity,port)
   VALUES(request.cliente_id,request.serial_number,request.name,request.location,request.timezone,request.device_type,true,NULL,7660)
   RETURNING id INTO new_device;
 END IF;
 UPDATE public.device_registration_requests SET status=p_decision,resolved_at=now(),resolved_by=auth.uid(),
 reason=nullif(btrim(p_reason),''),device_id=new_device WHERE id=request.id RETURNING * INTO request;
 INSERT INTO public.device_registration_request_audit(request_id,cliente_id,actor_id,decision,reason,before_state,after_state)
 VALUES(request.id,request.cliente_id,auth.uid(),p_decision,request.reason,previous,to_jsonb(request));
 RETURN request;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_obtener_limites_tenant(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente RECORD;
  v_empleados_count INTEGER;
  v_dispositivos_count INTEGER;
  v_vencido BOOLEAN;
BEGIN
  SELECT *
  INTO v_cliente
  FROM public.clientes
  WHERE id = p_cliente_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado');
  END IF;

  SELECT COUNT(*) INTO v_empleados_count
  FROM public.empleados
  WHERE cliente_id = p_cliente_id;

  SELECT COUNT(*) INTO v_dispositivos_count
  FROM public.devices
  WHERE cliente_id = p_cliente_id;

  v_vencido := (v_cliente.fecha_vencimiento IS NOT NULL AND v_cliente.fecha_vencimiento < CURRENT_DATE);

  RETURN jsonb_build_object(
    'cliente_id', v_cliente.id,
    'nombre_empresa', v_cliente.nombre_empresa,
    'plan_suscripcion', COALESCE(v_cliente.plan_suscripcion, 'starter'),
    'estatus', v_cliente.estatus,
    'fecha_vencimiento', v_cliente.fecha_vencimiento,
    'vencido', v_vencido,
    'bloqueado', (v_cliente.estatus IN ('suspendido', 'cancelado') OR v_vencido),
    'empleados_actuales', v_empleados_count,
    'limite_empleados', COALESCE(v_cliente.limite_empleados, 50),
    'empleados_disponibles', GREATEST(0, COALESCE(v_cliente.limite_empleados, 50) - v_empleados_count),
    'puede_crear_empleado', (v_cliente.estatus NOT IN ('suspendido', 'cancelado') AND NOT v_vencido AND v_empleados_count < COALESCE(v_cliente.limite_empleados, 50)),
    'dispositivos_actuales', v_dispositivos_count,
    'limite_dispositivos', COALESCE(v_cliente.limite_dispositivos, 5),
    'dispositivos_disponibles', GREATEST(0, COALESCE(v_cliente.limite_dispositivos, 5) - v_dispositivos_count),
    'puede_crear_dispositivo', (v_cliente.estatus NOT IN ('suspendido', 'cancelado') AND NOT v_vencido AND v_dispositivos_count < COALESCE(v_cliente.limite_dispositivos, 5))
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_resumen_global_tenants()
 RETURNS TABLE(id uuid, nombre_empresa text, rfc character varying, plan_suscripcion text, estatus text, limite_empleados integer, limite_dispositivos integer, fecha_vencimiento date, contacto_nombre text, contacto_email text, contacto_telefono character varying, ciudad text, estado text, pais text, direccion text, notas text, creado_at timestamp with time zone, empleados_actuales bigint, dispositivos_actuales bigint, vencido boolean, id_empresa character varying)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    c.nombre_empresa,
    c.rfc,
    COALESCE(c.plan_suscripcion, 'starter') AS plan_suscripcion,
    c.estatus,
    COALESCE(c.limite_empleados, 50) AS limite_empleados,
    COALESCE(c.limite_dispositivos, 5) AS limite_dispositivos,
    c.fecha_vencimiento,
    c.contacto_nombre,
    c.contacto_email,
    c.contacto_telefono,
    c.ciudad,
    c.estado,
    c.pais,
    c.direccion,
    c.notas,
    c.creado_at,
    COALESCE(emp.total, 0) AS empleados_actuales,
    COALESCE(dev.total, 0) AS dispositivos_actuales,
    (c.fecha_vencimiento IS NOT NULL AND c.fecha_vencimiento < CURRENT_DATE) AS vencido,
    c.id_empresa
  FROM public.clientes c
  LEFT JOIN (
    SELECT cliente_id, COUNT(*) AS total
    FROM public.empleados
    GROUP BY cliente_id
  ) emp ON emp.cliente_id = c.id
  LEFT JOIN (
    SELECT cliente_id, COUNT(*) AS total
    FROM public.devices
    GROUP BY cliente_id
  ) dev ON dev.cliente_id = c.id
  ORDER BY c.creado_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_validar_limite_dispositivos_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente RECORD;
  v_conteo_actual INTEGER;
BEGIN
  -- Obtener configuración y límites reales del tenant
  SELECT id, nombre_empresa, plan_suscripcion, limite_dispositivos, estatus, fecha_vencimiento
  INTO v_cliente
  FROM public.clientes
  WHERE id = NEW.cliente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tenant (cliente_id: %) especificado no existe.', NEW.cliente_id;
  END IF;

  -- 1. Validar estatus del tenant
  IF v_cliente.estatus IN ('suspendido', 'cancelado') THEN
    RAISE EXCEPTION 'Operación denegada: La empresa "%" se encuentra en estatus "%". No se permite el registro de nuevos dispositivos.',
      v_cliente.nombre_empresa, UPPER(v_cliente.estatus);
  END IF;

  -- 2. Validar fecha de vencimiento si existe
  IF v_cliente.fecha_vencimiento IS NOT NULL AND v_cliente.fecha_vencimiento < CURRENT_DATE THEN
    RAISE EXCEPTION 'Operación denegada: La suscripción de la empresa "%" venció el %. Contacte al administrador de Signum-Clock Central para renovar el servicio.',
      v_cliente.nombre_empresa, to_char(v_cliente.fecha_vencimiento, 'DD/MM/YYYY');
  END IF;

  -- 3. Contar dispositivos actuales de este tenant exclusivo
  SELECT COUNT(*)
  INTO v_conteo_actual
  FROM public.devices
  WHERE cliente_id = NEW.cliente_id;

  -- 4. Validar límite estricto de dispositivos
  IF v_cliente.limite_dispositivos IS NOT NULL AND v_conteo_actual >= v_cliente.limite_dispositivos THEN
    RAISE EXCEPTION 'Has alcanzado el límite de dispositivos de este tenant. Límite actual: %. Dispositivos registrados: %. Contacta al administrador de Signum-Clock Central para ampliar tu capacidad.',
      v_cliente.limite_dispositivos, v_conteo_actual;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_device_employee_assignments(p_cliente_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE
 policy text;
 employee public.empleados%ROWTYPE;
 device public.devices%ROWTYPE;
 virtual_devices uuid[] := ARRAY[]::uuid[];
BEGIN
 -- This is a backend/trigger-only routine. Preserve private virtual terminals:
 -- Employee SQL is optional at installation and must not be introduced here.
 SELECT biometric_sync_policy INTO policy FROM public.clientes WHERE id=p_cliente_id;
 IF policy IS NULL OR policy='PERSONALIZADA' THEN RETURN; END IF;
 IF policy NOT IN ('GLOBAL','EMPRESA','SUBEMPRESA') THEN
  RAISE EXCEPTION 'DEVICE_SYNC_POLICY_INVALID' USING ERRCODE='22023'; END IF;
 IF to_regclass('employee_private.web_clocks') IS NOT NULL THEN
  EXECUTE 'SELECT coalesce(array_agg(device_id),ARRAY[]::uuid[]) FROM employee_private.web_clocks'
    INTO virtual_devices;
 END IF;
 -- Physical identity never comes from an administrative key, a credential or UUID.
 -- 124's company/assignment guard remains installed and authoritative.
 FOR employee IN SELECT * FROM public.empleados WHERE cliente_id=p_cliente_id AND activo LOOP
  FOR device IN SELECT * FROM public.devices WHERE cliente_id=employee.cliente_id AND is_active
    AND NOT(id=ANY(virtual_devices)) LOOP
   IF nullif(btrim(employee.device_userid),'') IS NULL THEN
    RAISE EXCEPTION 'DEVICE_PHYSICAL_IDENTITY_REQUIRED' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM public.device_employee_assignments a WHERE a.device_id=device.id
     AND a.biometric_user_id=employee.device_userid AND a.employee_id<>employee.id) THEN
    RAISE EXCEPTION 'DEVICE_PHYSICAL_IDENTITY_CONFLICT' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM public.device_employee_assignments a WHERE a.device_id=device.id
     AND a.employee_id=employee.id AND a.cliente_id=employee.cliente_id
     AND a.biometric_user_id IS DISTINCT FROM employee.device_userid) THEN
    RAISE EXCEPTION 'DEVICE_PHYSICAL_IDENTITY_RECONCILIATION_REQUIRED' USING ERRCODE='23514'; END IF;
   INSERT INTO public.device_employee_assignments(cliente_id,device_id,employee_id,biometric_user_id,activo,sync_status)
   VALUES(employee.cliente_id,device.id,employee.id,employee.device_userid,true,'PENDING')
   ON CONFLICT(device_id,biometric_user_id) DO UPDATE SET activo=true,actualizado_at=now()
   WHERE device_employee_assignments.employee_id=EXCLUDED.employee_id
     AND device_employee_assignments.cliente_id=EXCLUDED.cliente_id
     AND device_employee_assignments.activo=false;
  END LOOP;
 END LOOP;
 UPDATE public.device_employee_assignments a SET activo=false,actualizado_at=now()
 WHERE a.cliente_id=p_cliente_id AND a.activo AND NOT(a.device_id=ANY(virtual_devices))
 AND (NOT EXISTS(SELECT 1 FROM public.empleados e WHERE e.id=a.employee_id
        AND e.cliente_id=a.cliente_id AND e.activo)
   OR NOT EXISTS(SELECT 1 FROM public.devices d WHERE d.id=a.device_id
        AND d.cliente_id=a.cliente_id AND d.is_active));
END;
$function$;

-- Shared helpers retain their installed privileges via CREATE OR REPLACE.
-- Automatic assignment is invoked only by existing owner-run triggers/backend.
REVOKE ALL ON FUNCTION public.sync_device_employee_assignments(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_device_employee_assignments(uuid) TO service_role;

-- Retire operational access to the EMPTY legacy table, preserving all information.
-- Both table AND column ACLs are revoked; never use DROP ... CASCADE.
REVOKE ALL ON TABLE public.dispositivos FROM PUBLIC,anon,authenticated,service_role;
DO $retire_columns$
DECLARE cols text;
BEGIN
 SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute
 WHERE attrelid='public.dispositivos'::regclass AND attnum>0 AND NOT attisdropped;
 IF cols IS NOT NULL THEN EXECUTE format(
  'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.dispositivos FROM PUBLIC,anon,authenticated,service_role',cols); END IF;
END $retire_columns$;
DROP TRIGGER IF EXISTS trg_dispositivos_sync_policy ON public.dispositivos;
DO $retire_rpc$
BEGIN
 IF to_regprocedure('public.proc_trg_dispositivos_sync_policy()') IS NOT NULL THEN
  REVOKE ALL ON FUNCTION public.proc_trg_dispositivos_sync_policy() FROM PUBLIC,anon,authenticated,service_role;
 END IF;
END $retire_rpc$;

-- No DROP TABLE / DROP COLUMN: aggregate counts and dependency review are prerequisites
-- to a later separately authorized removal. Preserve registro_asistencia/RAW/history.
DO $postcheck$
DECLARE signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'public.device_request_serial_taken(text)',
 'public.request_device_registration(text,text,text,text,text,text,uuid)',
 'public.resolve_device_registration(uuid,text,text)',
 'public.fn_obtener_limites_tenant(uuid)',
 'public.fn_resumen_global_tenants()',
 'public.fn_validar_limite_dispositivos_tenant()',
 'public.sync_device_employee_assignments(uuid)'] LOOP
  IF pg_get_functiondef(to_regprocedure(signature)) ~* 'public[.]dispositivos|HIKVISION_ISUP|hikvision_device_userid' THEN
   RAISE EXCEPTION 'ZKTECO_ONLY_ACTIVE_DEPENDENCY_REMAINS: %',signature; END IF;
 END LOOP;
 IF has_table_privilege('authenticated','public.dispositivos','SELECT')
   OR has_table_privilege('anon','public.dispositivos','SELECT') THEN
  RAISE EXCEPTION 'LEGACY_DEVICE_EFFECTIVE_GRANT_REMAINS'; END IF;
END $postcheck$;
NOTIFY pgrst,'reload schema';
COMMIT;
