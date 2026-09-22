-- Phase 99: confirm the canonical source before the registro UPDATE fires
-- trg_enqueue_attendance_persist_outbox. All validation precedes both writes;
-- both writes and their confirmations remain atomic in the calling transaction.
-- CREATE OR REPLACE preserves the existing owner and grants.
BEGIN;

CREATE OR REPLACE FUNCTION public.link_attendance_source_event(
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
    v_link_result := 'LINKED';
  ELSIF v_registro_source_event_id = p_source_event_id THEN
    v_link_result := 'ALREADY_LINKED';
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'registro_asistencia ya pertenece a otro source event';
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

  IF v_registro_source_event_id IS NULL THEN
    UPDATE public.registro_asistencia r
    SET source_event_id = p_source_event_id
    WHERE r.id = v_registro_id;
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

  RETURN QUERY
  SELECT p_source_event_id, v_registro_id, v_link_result;
END;
$function$;

COMMIT;
