-- Signum Clock — Fase 27: RPC nueva de persistencia backend-controlled.
-- No activa consumidores runtime, no crea filas ni modifica objetos fuera de esta función.

BEGIN;

DO $preflight$
DECLARE
  expected_column text;
BEGIN
  IF to_regclass('public.workday_records') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.workday_records no existe';
  END IF;

  FOREACH expected_column IN ARRAY ARRAY[
    'id', 'cliente_id', 'empleado_id', 'workday_date', 'schedule_id', 'timezone',
    'first_in', 'last_out', 'worked_minutes', 'break_minutes', 'overtime_minutes',
    'late_minutes', 'early_leave_minutes', 'status', 'integrity_hash',
    'created_at', 'updated_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'workday_records'
        AND c.column_name = expected_column
    ) THEN
      RAISE EXCEPTION 'FAIL CLOSED: falta public.workday_records.%', expected_column;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.workday_records'::regclass
      AND c.conname = 'workday_records_logical_identity_key'
      AND c.contype = 'u'
      AND c.convalidated
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.workday_records'::regclass AND attname = 'cliente_id'),
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.workday_records'::regclass AND attname = 'empleado_id'),
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.workday_records'::regclass AND attname = 'workday_date')
      ]
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: UNIQUE(cliente_id, empleado_id, workday_date) no coincide';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.workday_records'::regclass
      AND t.tgname = 'trg_workday_records_tenant_integrity'
      AND t.tgenabled <> 'D'
      AND t.tgfoid = to_regprocedure('public.enforce_workday_record_tenant_integrity()')
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: falta el trigger de integridad Empresa de workday';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.workday_records'::regclass
      AND t.tgname = 'trg_workday_records_set_updated_at'
      AND t.tgenabled <> 'D'
      AND t.tgfoid = to_regprocedure('public.set_workday_updated_at()')
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: falta el trigger updated_at de workday';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.workday_records'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: RLS no está habilitado en public.workday_records';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'workday_records'
      AND p.policyname = 'workday_records_select_tenant'
      AND p.cmd = 'SELECT'
      AND p.roles = ARRAY['authenticated'::name]
      AND regexp_replace(
            lower(COALESCE(p.qual, '')),
            '(public[.]|workday_records[.]|[[:space:]()]|::uuid)',
            '',
            'g'
          ) = 'auth_can_read_tenantcliente_id'
  ) OR (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = 'workday_records') <> 1
     OR EXISTS (
       SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename = 'workday_records'
         AND p.roles @> ARRAY['authenticated'::name]
         AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: RLS de workday_records no coincide con SELECT authenticated tenant-scoped único';
  END IF;

  IF (SELECT count(*) FROM public.workday_records) <> 0 THEN
    RAISE EXCEPTION 'FAIL CLOSED: workday_records debe estar vacío antes de instalar la RPC';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.workday_records', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.workday_records', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL CLOSED: service_role no tiene INSERT/UPDATE sobre public.workday_records';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'upsert_workday_record'
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: ya existe public.upsert_workday_record; no reutilizar ni sobreescribir RPC histórica';
  END IF;

  IF (
    SELECT count(*) FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  ) <> 3 THEN
    RAISE EXCEPTION 'FAIL CLOSED: faltan uno o más roles Supabase requeridos';
  END IF;
END
$preflight$;

CREATE FUNCTION public.upsert_workday_record(
  p_cliente_id uuid,
  p_empleado_id uuid,
  p_workday_date date,
  p_schedule_id uuid,
  p_timezone text,
  p_first_in timestamptz,
  p_last_out timestamptz,
  p_worked_minutes integer,
  p_break_minutes integer,
  p_overtime_minutes integer,
  p_late_minutes integer,
  p_early_leave_minutes integer,
  p_status text,
  p_integrity_hash text
)
RETURNS TABLE (
  workday_id uuid,
  persistence_result text,
  integrity_hash text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $upsert_workday_record$
DECLARE
  v_workday_id uuid;
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'p_cliente_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_empleado_id IS NULL THEN
    RAISE EXCEPTION 'p_empleado_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_workday_date IS NULL THEN
    RAISE EXCEPTION 'p_workday_date es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_timezone IS NULL OR btrim(p_timezone) = '' THEN
    RAISE EXCEPTION 'p_timezone es obligatorio y no puede estar vacío' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN (
    'COMPLETE', 'INCOMPLETE', 'ABSENT', 'UNSCHEDULED', 'INVALID'
  ) THEN
    RAISE EXCEPTION 'p_status no pertenece a WorkdayState permitido' USING ERRCODE = '22023';
  END IF;
  IF p_worked_minutes IS NULL OR p_break_minutes IS NULL
     OR p_overtime_minutes IS NULL OR p_late_minutes IS NULL
     OR p_early_leave_minutes IS NULL THEN
    RAISE EXCEPTION 'todos los valores de minutos son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_worked_minutes < 0 OR p_break_minutes < 0
     OR p_overtime_minutes < 0 OR p_late_minutes < 0
     OR p_early_leave_minutes < 0 THEN
    RAISE EXCEPTION 'los valores de minutos no pueden ser negativos' USING ERRCODE = '22023';
  END IF;
  IF p_first_in IS NOT NULL AND p_last_out IS NOT NULL
     AND p_last_out < p_first_in THEN
    RAISE EXCEPTION 'p_last_out no puede ser anterior a p_first_in' USING ERRCODE = '22023';
  END IF;

  -- La UNIQUE instalada es la autoridad ante concurrencia. No existe SELECT
  -- previo para decidir insertar; la primera operación usa ON CONFLICT.
  INSERT INTO public.workday_records (
    cliente_id,
    empleado_id,
    workday_date,
    schedule_id,
    timezone,
    first_in,
    last_out,
    worked_minutes,
    break_minutes,
    overtime_minutes,
    late_minutes,
    early_leave_minutes,
    status,
    integrity_hash
  )
  VALUES (
    p_cliente_id,
    p_empleado_id,
    p_workday_date,
    p_schedule_id,
    p_timezone,
    p_first_in,
    p_last_out,
    p_worked_minutes,
    p_break_minutes,
    p_overtime_minutes,
    p_late_minutes,
    p_early_leave_minutes,
    p_status,
    p_integrity_hash
  )
  ON CONFLICT (cliente_id, empleado_id, workday_date) DO NOTHING
  RETURNING id INTO v_workday_id;

  IF FOUND THEN
    RETURN QUERY
    SELECT v_workday_id, 'INSERTED'::text, p_integrity_hash;
    RETURN;
  END IF;

  -- El WHERE NULL-safe evita una actualización vacía: por ello no dispara el
  -- trigger updated_at cuando todos los campos persistidos son idénticos.
  UPDATE public.workday_records AS target
  SET
    schedule_id = p_schedule_id,
    timezone = p_timezone,
    first_in = p_first_in,
    last_out = p_last_out,
    worked_minutes = p_worked_minutes,
    break_minutes = p_break_minutes,
    overtime_minutes = p_overtime_minutes,
    late_minutes = p_late_minutes,
    early_leave_minutes = p_early_leave_minutes,
    status = p_status,
    integrity_hash = p_integrity_hash
  WHERE target.cliente_id = p_cliente_id
    AND target.empleado_id = p_empleado_id
    AND target.workday_date = p_workday_date
    AND (
      target.schedule_id IS DISTINCT FROM p_schedule_id
      OR target.timezone IS DISTINCT FROM p_timezone
      OR target.first_in IS DISTINCT FROM p_first_in
      OR target.last_out IS DISTINCT FROM p_last_out
      OR target.worked_minutes IS DISTINCT FROM p_worked_minutes
      OR target.break_minutes IS DISTINCT FROM p_break_minutes
      OR target.overtime_minutes IS DISTINCT FROM p_overtime_minutes
      OR target.late_minutes IS DISTINCT FROM p_late_minutes
      OR target.early_leave_minutes IS DISTINCT FROM p_early_leave_minutes
      OR target.status IS DISTINCT FROM p_status
      OR target.integrity_hash IS DISTINCT FROM p_integrity_hash
    )
  RETURNING target.id INTO v_workday_id;

  IF FOUND THEN
    RETURN QUERY
    SELECT v_workday_id, 'UPDATED'::text, p_integrity_hash;
    RETURN;
  END IF;

  -- Un conflicto sin diferencias representa el estado existente. La lectura
  -- ocurre sólo después de que ON CONFLICT protegió la identidad estructural.
  SELECT target.id
    INTO v_workday_id
  FROM public.workday_records AS target
  WHERE target.cliente_id = p_cliente_id
    AND target.empleado_id = p_empleado_id
    AND target.workday_date = p_workday_date;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'la jornada en conflicto desapareció; reintentar la operación'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  SELECT v_workday_id, 'UNCHANGED'::text, p_integrity_hash;
END
$upsert_workday_record$;

REVOKE ALL ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text
) TO service_role;

DO $postcheck$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text)'
  );
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: la RPC no existe con la firma esperada';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_function_oid) THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: la RPC debe ser SECURITY INVOKER';
  END IF;

  IF NOT (
    SELECT COALESCE(proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
    FROM pg_proc
    WHERE oid = v_function_oid
  ) THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: search_path de la RPC no es pg_catalog, public';
  END IF;

  IF has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: permisos anon/authenticated/service_role no coinciden';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.workday_records', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.workday_records', 'UPDATE') THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: service_role no puede INSERT/UPDATE workday_records';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid = v_function_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: PUBLIC conserva EXECUTE sobre la RPC';
  END IF;
END
$postcheck$;

SELECT
  p.oid::regprocedure AS function_name,
  pg_get_function_result(p.oid) AS return_contract,
  NOT p.prosecdef AS security_invoker,
  p.proconfig AS function_config,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
WHERE p.oid = to_regprocedure(
  'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text)'
);

COMMIT;
