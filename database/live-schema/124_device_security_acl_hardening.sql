-- Reconciles device ACLs after the partially deployed 117 contract.
-- Does not replay 117, add request_reason, execute 116, or modify business rows.
-- Production execution requires a reviewed live catalog and separate approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['devices','dispositivos','device_commands',
    'device_employee_assignments','device_registration_requests','device_registration_request_audit']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=table_name AND c.relkind='r' AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'DEVICE_HARDENING_REQUIRES_EXISTING_RLS: %', table_name;
    END IF;
  END LOOP;
  IF to_regprocedure('public.device_request_can_manage(uuid)') IS NULL
    OR to_regprocedure('public.device_request_can_read(uuid)') IS NULL
    OR to_regprocedure('public.guard_device_assignment_scope()') IS NULL
    OR to_regprocedure('public.reject_device_decision_mutation()') IS NULL THEN
    RAISE EXCEPTION 'DEVICE_HARDENING_AUTHORIZATION_CONTRACT_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.device_employee_assignments'::regclass
      AND tgfoid='public.guard_device_assignment_scope()'::regprocedure
      AND NOT tgisinternal AND tgenabled IN ('O','A')
      AND (tgtype::integer & 7)=7 AND (tgtype::integer & 16)=16) THEN
    RAISE EXCEPTION 'DEVICE_HARDENING_ASSIGNMENT_GUARD_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.device_registration_request_audit'::regclass
      AND tgfoid='public.reject_device_decision_mutation()'::regprocedure
      AND NOT tgisinternal AND tgenabled IN ('O','A')
      AND (tgtype::integer & 27)=27) THEN
    RAISE EXCEPTION 'DEVICE_HARDENING_IMMUTABLE_AUDIT_GUARD_MISSING';
  END IF;
END $preflight$;

-- ALL also removes TRUNCATE/TRIGGER/REFERENCES/MAINTAIN where supported.
-- Removing table ACLs alone does not remove existing column ACLs.
REVOKE ALL PRIVILEGES ON TABLE public.devices,public.dispositivos,public.device_commands,
  public.device_employee_assignments,public.device_registration_requests,
  public.device_registration_request_audit FROM PUBLIC,anon,authenticated;
DO $columns$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.relname,string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relname IN ('devices','dispositivos','device_commands',
      'device_employee_assignments','device_registration_requests','device_registration_request_audit')
    GROUP BY c.relname
  LOOP
    EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.%2$I FROM PUBLIC,anon,authenticated',item.columns,item.relname);
  END LOOP;
END $columns$;

GRANT SELECT ON TABLE public.devices,public.dispositivos,public.device_commands,
  public.device_employee_assignments,public.device_registration_requests,
  public.device_registration_request_audit TO authenticated;
GRANT UPDATE(name,location,ip_address,port,timezone,device_type)
  ON public.devices TO authenticated;
GRANT UPDATE(nombre_ubicacion,ip_local,descripcion,timezone,puerto)
  ON public.dispositivos TO authenticated;
GRANT INSERT(device_serial,command_string,is_executed)
  ON public.device_commands TO authenticated;

-- Existing browser provisioning uses INSERT and UPDATE; deprovisioning sets activo=false.
-- No direct DELETE or mutation of id, creation timestamps or backend ACK fields.
GRANT INSERT(cliente_id,device_id,employee_id,biometric_user_id,activo,sync_status,
  last_attempt_at,last_error,actualizado_at)
  ON public.device_employee_assignments TO authenticated;
GRANT UPDATE(cliente_id,device_id,employee_id,biometric_user_id,activo,sync_status,
  last_attempt_at,last_error,actualizado_at)
  ON public.device_employee_assignments TO authenticated;

-- Restrictive bounds preserve existing policies while preventing permissive policies
-- from authorizing non-managers, suspended actors or another company's assignments.
DROP POLICY IF EXISTS device_assignment_read_bound ON public.device_employee_assignments;
CREATE POLICY device_assignment_read_bound ON public.device_employee_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.device_request_can_read(cliente_id));
DROP POLICY IF EXISTS device_assignment_insert_bound ON public.device_employee_assignments;
CREATE POLICY device_assignment_insert_bound ON public.device_employee_assignments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.device_request_can_manage(cliente_id));
DROP POLICY IF EXISTS device_assignment_update_bound ON public.device_employee_assignments;
CREATE POLICY device_assignment_update_bound ON public.device_employee_assignments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.device_request_can_manage(cliente_id))
  WITH CHECK (public.device_request_can_manage(cliente_id));

-- Trigger invocation is verified in DBREAL after revocation. Owners retain their ACLs.
REVOKE EXECUTE ON FUNCTION public.guard_device_assignment_scope(),
  public.reject_device_decision_mutation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_device_assignment_scope(),
  public.reject_device_decision_mutation() TO service_role;

-- Fail closed on inherited grants as well as direct ACL entries.
DO $postcheck$
DECLARE role_name text; table_name text; privilege_name text; item record; expected boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH table_name IN ARRAY ARRAY['devices','dispositivos','device_commands',
      'device_employee_assignments','device_registration_requests','device_registration_request_audit'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES'] LOOP
        IF has_table_privilege(role_name,format('public.%I',table_name),privilege_name) THEN
          RAISE EXCEPTION 'DEVICE_HARDENING_EXCESS_EFFECTIVE_GRANT: % %.%',role_name,table_name,privilege_name;
        END IF;
      END LOOP;
      IF current_setting('server_version_num')::integer >= 170000
        AND has_table_privilege(role_name,format('public.%I',table_name),'MAINTAIN') THEN
        RAISE EXCEPTION 'DEVICE_HARDENING_EXCESS_EFFECTIVE_MAINTAIN: % %',role_name,table_name;
      END IF;
      FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
        IF has_table_privilege(role_name,format('public.%I',table_name),privilege_name) THEN
          RAISE EXCEPTION 'DEVICE_HARDENING_EXCESS_EFFECTIVE_TABLE_DML: % %.%',role_name,table_name,privilege_name;
        END IF;
      END LOOP;
      IF has_table_privilege(role_name,format('public.%I',table_name),'SELECT') <> (role_name='authenticated') THEN
        RAISE EXCEPTION 'DEVICE_HARDENING_UNEXPECTED_SELECT: % %',role_name,table_name;
      END IF;
    END LOOP;
    FOR item IN SELECT c.oid,c.relname,a.attnum,a.attname FROM pg_class c
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('devices','dispositivos',
        'device_commands','device_employee_assignments','device_registration_requests','device_registration_request_audit')
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES','SELECT'] LOOP
        expected := role_name='authenticated' AND (
          privilege_name='SELECT'
          OR (privilege_name='UPDATE' AND item.relname='devices'
            AND item.attname IN ('name','location','ip_address','port','timezone','device_type'))
          OR (privilege_name='UPDATE' AND item.relname='dispositivos'
            AND item.attname IN ('nombre_ubicacion','ip_local','descripcion','timezone','puerto'))
          OR (privilege_name='INSERT' AND item.relname='device_commands'
            AND item.attname IN ('device_serial','command_string','is_executed'))
          OR (privilege_name IN ('INSERT','UPDATE') AND item.relname='device_employee_assignments'
            AND item.attname IN ('cliente_id','device_id','employee_id','biometric_user_id','activo',
              'sync_status','last_attempt_at','last_error','actualizado_at')));
        IF has_column_privilege(role_name,item.oid,item.attnum,privilege_name) <> expected THEN
          RAISE EXCEPTION 'DEVICE_HARDENING_UNEXPECTED_COLUMN_GRANT: % %.% %',role_name,item.relname,item.attname,privilege_name;
        END IF;
      END LOOP;
    END LOOP;
    IF has_function_privilege(role_name,'public.guard_device_assignment_scope()','EXECUTE')
      OR has_function_privilege(role_name,'public.reject_device_decision_mutation()','EXECUTE') THEN
      RAISE EXCEPTION 'DEVICE_HARDENING_UNEXPECTED_TRIGGER_EXECUTE: %',role_name;
    END IF;
  END LOOP;
END $postcheck$;
COMMIT;
