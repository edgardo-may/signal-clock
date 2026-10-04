-- Signum Clock: Fase 15, RPC atomica para enlazar un source event ZKTeco con
-- su unico registro normalizado demostrado por source_log_id.
--
-- Este script instala la RPC, pero no la invoca. En particular, no enlaza el
-- canary ni hace backfill de registros historicos.
--
-- La unica entrada de la RPC es p_source_event_id uuid. Empresa, colaborador,
-- dispositivo, ATTLOG y registro se resuelven exclusivamente desde el evento.

BEGIN;

-- PRECHECK: detener ante un contrato distinto del validado en las fases 13 y
-- 14. No se crea ningun objeto si falta una relacion, columna, FK, indice o
-- rol requerido.
DO $precheck$
DECLARE
  required_column record;
  source_event_id_attnum smallint;
  source_event_id_fk_attnum smallint;
BEGIN
  FOR required_column IN
    SELECT *
    FROM (VALUES
      ('attendance_source_events', 'id', 'uuid'),
      ('attendance_source_events', 'cliente_id', 'uuid'),
      ('attendance_source_events', 'employee_id', 'uuid'),
      ('attendance_source_events', 'device_id', 'uuid'),
      ('attendance_source_events', 'source_type', 'text'),
      ('attendance_source_events', 'source_reference', 'uuid'),
      ('attendance_source_events', 'processing_status', 'text'),
      ('attendance_source_events', 'processing_error', 'text'),
      ('attendance_logs', 'id', 'uuid'),
      ('registro_asistencia', 'id', 'uuid'),
      ('registro_asistencia', 'cliente_id', 'uuid'),
      ('registro_asistencia', 'empleado_id', 'uuid'),
      ('registro_asistencia', 'dispositivo_id', 'uuid'),
      ('registro_asistencia', 'es_manual', 'bool'),
      ('registro_asistencia', 'raw_payload', 'jsonb'),
      ('registro_asistencia', 'source_event_id', 'uuid')
    ) AS required(table_name, column_name, udt_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = required_column.table_name
        AND c.column_name = required_column.column_name
        AND c.udt_name = required_column.udt_name
    ) THEN
      RAISE EXCEPTION
        'contrato incompatible: public.%.% debe existir con tipo %',
        required_column.table_name,
        required_column.column_name,
        required_column.udt_name;
    END IF;
  END LOOP;

  IF to_regclass('public.attendance_source_events') IS NULL
    OR to_regclass('public.attendance_logs') IS NULL
    OR to_regclass('public.registro_asistencia') IS NULL THEN
    RAISE EXCEPTION 'falta una relacion requerida para Fase 15';
  END IF;

  IF to_regprocedure('public.link_attendance_source_event(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION
      'la RPC link_attendance_source_event(uuid) ya existe; auditarla antes de reemplazarla';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
  ) THEN
    RAISE EXCEPTION 'el rol backend requerido service_role no existe';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'faltan roles Supabase requeridos para revocar EXECUTE';
  END IF;

  IF NOT has_schema_privilege('service_role', 'public', 'USAGE')
    OR NOT has_table_privilege('service_role', 'public.attendance_source_events', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.attendance_source_events', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.attendance_logs', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.registro_asistencia', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.registro_asistencia', 'UPDATE') THEN
    RAISE EXCEPTION
      'service_role no tiene los privilegios de backend requeridos por la RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'registro_asistencia'
      AND c.column_name = 'source_event_id'
      AND c.is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'registro_asistencia.source_event_id debe ser nullable';
  END IF;

  SELECT a.attnum
  INTO source_event_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.registro_asistencia'::regclass
    AND a.attname = 'source_event_id'
    AND NOT a.attisdropped;

  SELECT a.attnum
  INTO source_event_id_fk_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.attendance_source_events'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.conrelid = 'public.registro_asistencia'::regclass
      AND con.confrelid = 'public.attendance_source_events'::regclass
      AND con.confdeltype = 'r'
      AND con.conkey = ARRAY[source_event_id_attnum]
      AND con.confkey = ARRAY[source_event_id_fk_attnum]
  ) THEN
    RAISE EXCEPTION
      'falta FK RESTRICT desde registro_asistencia.source_event_id a attendance_source_events.id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.registro_asistencia'::regclass
      AND i.indisunique
      AND i.indpred IS NOT NULL
      AND array_length(i.indkey::smallint[], 1) = 1
      AND (i.indkey::smallint[])[1] = source_event_id_attnum
      AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%source_event_id IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION
      'falta indice UNIQUE parcial para registro_asistencia.source_event_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'public.attendance_source_events'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid, true) ILIKE '%processing_status%'
      AND pg_get_constraintdef(con.oid, true) ILIKE '%PROCESSED%'
  ) THEN
    RAISE EXCEPTION
      'attendance_source_events no admite confirmar el estado PROCESSED';
  END IF;
END
$precheck$;

-- CHANGE: funcion transaccional por llamada. SECURITY INVOKER conserva RLS y
-- exige que service_role tenga los permisos ya establecidos por el backend.
CREATE FUNCTION public.link_attendance_source_event(
  p_source_event_id uuid
)
RETURNS TABLE (
  source_event_id uuid,
  registro_id uuid,
  link_result text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_event public.attendance_source_events%ROWTYPE;
  v_attendance_log_id uuid;
  v_registro_id uuid;
  v_registro_cliente_id uuid;
  v_registro_empleado_id uuid;
  v_registro_dispositivo_id uuid;
  v_registro_es_manual boolean;
  v_registro_source_event_id uuid;
  v_matching_registro_count integer;
  v_existing_registro_id uuid;
  v_existing_link_count integer;
  v_confirmed_source_event_id uuid;
  v_confirmed_processing_status text;
  v_confirmed_processing_error text;
  v_link_result text;
BEGIN
  IF p_source_event_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'p_source_event_id no puede ser NULL';
  END IF;

  -- Serialize la comprobacion de cardinalidad frente a ingresos concurrentes.
  LOCK TABLE public.registro_asistencia IN SHARE ROW EXCLUSIVE MODE;

  SELECT e.*
  INTO v_event
  FROM public.attendance_source_events e
  WHERE e.id = p_source_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'attendance_source_event no existe';
  END IF;

  IF v_event.source_type IS DISTINCT FROM 'ZKTECO' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'el source event no es de tipo ZKTECO';
  END IF;

  IF v_event.source_reference IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'el source event ZKTECO no tiene source_reference';
  END IF;

  IF v_event.device_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'el source event ZKTECO no tiene dispositivo';
  END IF;

  IF v_event.processing_status NOT IN ('PENDING', 'ERROR', 'PROCESSED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'el source event no esta en un estado enlazable';
  END IF;

  SELECT l.id
  INTO v_attendance_log_id
  FROM public.attendance_logs l
  WHERE l.id = v_event.source_reference
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'source_reference no corresponde a attendance_logs.id';
  END IF;

  SELECT count(*)
  INTO v_matching_registro_count
  FROM (
    SELECT r.id
    FROM public.registro_asistencia r
    WHERE NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '')
          = v_event.source_reference::text
    FOR UPDATE
  ) r;

  IF v_matching_registro_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0003',
      MESSAGE = 'source_reference debe resolver exactamente un registro_asistencia';
  END IF;

  SELECT
    r.id,
    r.cliente_id,
    r.empleado_id,
    r.dispositivo_id,
    r.es_manual,
    r.source_event_id
  INTO
    v_registro_id,
    v_registro_cliente_id,
    v_registro_empleado_id,
    v_registro_dispositivo_id,
    v_registro_es_manual,
    v_registro_source_event_id
  FROM public.registro_asistencia r
  WHERE NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '')
        = v_event.source_reference::text
  FOR UPDATE;

  IF v_registro_cliente_id IS DISTINCT FROM v_event.cliente_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Empresa distinta entre source event y registro_asistencia';
  END IF;

  IF v_registro_es_manual IS TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'un source event ZKTECO no puede enlazarse a un registro manual';
  END IF;

  IF v_event.employee_id IS NOT NULL
    AND v_registro_empleado_id IS DISTINCT FROM v_event.employee_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'colaborador distinto entre source event y registro_asistencia';
  END IF;

  IF v_registro_dispositivo_id IS DISTINCT FROM v_event.device_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'dispositivo distinto entre source event y registro_asistencia';
  END IF;

  SELECT count(*)
  INTO v_existing_link_count
  FROM public.registro_asistencia r
  WHERE r.source_event_id = p_source_event_id;

  IF v_existing_link_count > 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'invariante UNIQUE violada: source event enlazado a varios registros';
  END IF;

  IF v_existing_link_count = 1 THEN
    SELECT r.id
    INTO v_existing_registro_id
    FROM public.registro_asistencia r
    WHERE r.source_event_id = p_source_event_id;
  END IF;

  IF v_existing_link_count = 1
    AND v_existing_registro_id IS DISTINCT FROM v_registro_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'source event ya pertenece a otro registro_asistencia';
  END IF;

  IF v_registro_source_event_id IS NULL THEN
    UPDATE public.registro_asistencia r
    SET source_event_id = p_source_event_id
    WHERE r.id = v_registro_id;

    v_link_result := 'LINKED';
  ELSIF v_registro_source_event_id = p_source_event_id THEN
    v_link_result := 'ALREADY_LINKED';
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'registro_asistencia ya pertenece a otro source event';
  END IF;

  SELECT r.source_event_id
  INTO v_confirmed_source_event_id
  FROM public.registro_asistencia r
  WHERE r.id = v_registro_id;

  IF v_confirmed_source_event_id IS DISTINCT FROM p_source_event_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'el enlace source_event_id no quedo confirmado';
  END IF;

  UPDATE public.attendance_source_events e
  SET
    processing_status = 'PROCESSED',
    processing_error = NULL
  WHERE e.id = p_source_event_id;

  SELECT
    e.processing_status,
    e.processing_error
  INTO
    v_confirmed_processing_status,
    v_confirmed_processing_error
  FROM public.attendance_source_events e
  WHERE e.id = p_source_event_id;

  IF v_confirmed_processing_status IS DISTINCT FROM 'PROCESSED'
    OR v_confirmed_processing_error IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'el source event no quedo confirmado como PROCESSED';
  END IF;

  RETURN QUERY
  SELECT p_source_event_id, v_registro_id, v_link_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_attendance_source_event(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_attendance_source_event(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_attendance_source_event(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.link_attendance_source_event(uuid) TO service_role;

-- POSTCHECK: solo metadatos de la funcion instalada. No se invoca la RPC y no
-- se modifica ningun source event, registro historico ni attendance log.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_function_result(p.oid) AS return_type,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  p.proowner::regrole AS owner,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
WHERE p.oid = 'public.link_attendance_source_event(uuid)'::regprocedure;

COMMIT;
