-- Signum Clock: capa RAW universal para fuentes de asistencia.
-- PREPARADO, NO APLICADO. Ejecutar solamente después de que 07 confirme el
-- contrato real y con una ventana de cambio aprobada.
--
-- Este script no toca attendance_logs, registro_asistencia, funciones
-- instaladas, datos históricos ni migraciones históricas. La transición de
-- ZKTeco y el vínculo source_event_id son una fase posterior.
--
-- ROLLBACK: antes de COMMIT, ejecutar ROLLBACK. Después de COMMIT no se elimina
-- la tabla ni su auditoría: se revierte el despliegue que la consume y la tabla
-- queda inerte con RLS activo hasta una decisión de conservación aprobada.

BEGIN;

-- PRECHECK: falla cerrado ante cualquier contrato distinto al auditado.
DO $$
DECLARE
  required_relation text;
  required_column record;
BEGIN
  IF to_regclass('public.attendance_source_events') IS NOT NULL THEN
    RAISE EXCEPTION
      'attendance_source_events ya existe; detener para auditar su contrato real antes de cambiarlo';
  END IF;

  FOREACH required_relation IN ARRAY ARRAY[
    'public.clientes',
    'public.empleados',
    'public.devices',
    'public.attendance_logs',
    'public.registro_asistencia'
  ] LOOP
    IF to_regclass(required_relation) IS NULL THEN
      RAISE EXCEPTION 'falta la relación requerida: %', required_relation;
    END IF;
  END LOOP;

  FOR required_column IN
    SELECT *
    FROM (VALUES
      ('clientes', 'id', 'uuid'),
      ('empleados', 'id', 'uuid'),
      ('empleados', 'cliente_id', 'uuid'),
      ('devices', 'id', 'uuid'),
      ('devices', 'cliente_id', 'uuid'),
      ('devices', 'serial_number', 'text'),
      ('attendance_logs', 'id', 'uuid'),
      ('attendance_logs', 'device_serial', 'text'),
      ('registro_asistencia', 'id', 'uuid'),
      ('registro_asistencia', 'cliente_id', 'uuid')
    ) AS expected(table_name, column_name, udt_name)
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

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'gen_random_uuid() no está disponible';
  END IF;
END
$$;

-- CHANGE: evento RAW común. El source_reference es UUID para que ZKTeco pueda
-- referir attendance_logs.id y Web/App puedan referir request_id sin añadir
-- columnas específicas por origen a registro_asistencia.
CREATE TABLE public.attendance_source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  employee_id uuid NULL REFERENCES public.empleados(id) ON DELETE RESTRICT,
  device_id uuid NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_reference uuid NULL,
  request_id uuid NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  processing_status text NOT NULL DEFAULT 'PENDING',
  processing_error text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT chk_attendance_source_events_source_type
    CHECK (source_type IN ('ZKTECO', 'WEB', 'MOBILE_APP', 'API', 'IMPORT', 'MANUAL')),
  CONSTRAINT chk_attendance_source_events_processing_status
    CHECK (processing_status IN ('PENDING', 'PROCESSED', 'UNCHANGED', 'ERROR', 'IGNORED')),
  CONSTRAINT chk_attendance_source_events_raw_payload_object
    CHECK (jsonb_typeof(raw_payload) = 'object'),
  CONSTRAINT chk_attendance_source_events_safe_error_length
    CHECK (processing_error IS NULL OR char_length(processing_error) <= 512),
  CONSTRAINT chk_attendance_source_events_zkteco_reference
    CHECK (
      source_type <> 'ZKTECO'
      OR (source_reference IS NOT NULL AND device_id IS NOT NULL AND request_id IS NULL)
    ),
  CONSTRAINT chk_attendance_source_events_web_mobile_request
    CHECK (
      source_type NOT IN ('WEB', 'MOBILE_APP')
      OR (request_id IS NOT NULL AND source_reference = request_id)
    )
);

-- Integridad de Empresa y referencia física. No se usa un lookup global por
-- PIN, clave_empleado, pin funcional ni device_userid.
CREATE FUNCTION public.fn_validate_attendance_source_event_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  employee_company_id uuid;
  device_company_id uuid;
  raw_device_serial text;
  registered_device_serial text;
BEGIN
  IF NEW.employee_id IS NOT NULL THEN
    SELECT e.cliente_id
    INTO employee_company_id
    FROM public.empleados e
    WHERE e.id = NEW.employee_id;

    IF NOT FOUND OR employee_company_id IS DISTINCT FROM NEW.cliente_id THEN
      RAISE EXCEPTION 'attendance source event: colaborador fuera de la Empresa';
    END IF;
  END IF;

  IF NEW.device_id IS NOT NULL THEN
    SELECT d.cliente_id, d.serial_number
    INTO device_company_id, registered_device_serial
    FROM public.devices d
    WHERE d.id = NEW.device_id;

    IF NOT FOUND OR device_company_id IS DISTINCT FROM NEW.cliente_id THEN
      RAISE EXCEPTION 'attendance source event: dispositivo fuera de la Empresa';
    END IF;
  END IF;

  IF NEW.source_type = 'ZKTECO' THEN
    SELECT l.device_serial
    INTO raw_device_serial
    FROM public.attendance_logs l
    WHERE l.id = NEW.source_reference;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'attendance source event: ATTLOG de origen no existe';
    END IF;

    IF UPPER(BTRIM(raw_device_serial)) IS DISTINCT FROM UPPER(BTRIM(registered_device_serial)) THEN
      RAISE EXCEPTION 'attendance source event: ATTLOG y dispositivo no coinciden';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_validate_attendance_source_event_company
BEFORE INSERT OR UPDATE OF cliente_id, employee_id, device_id, source_type, source_reference
ON public.attendance_source_events
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_attendance_source_event_company();

CREATE FUNCTION public.fn_touch_attendance_source_event_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = transaction_timestamp();
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_touch_attendance_source_event_updated_at
BEFORE UPDATE ON public.attendance_source_events
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_attendance_source_event_updated_at();

-- PostgreSQL, no JavaScript, protege la idempotencia del origen.
CREATE UNIQUE INDEX uq_attendance_source_events_zkteco_attlog
  ON public.attendance_source_events (source_type, source_reference)
  WHERE source_type = 'ZKTECO';

CREATE UNIQUE INDEX uq_attendance_source_events_request_per_empresa
  ON public.attendance_source_events (cliente_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE UNIQUE INDEX uq_attendance_source_events_other_reference_per_empresa
  ON public.attendance_source_events (cliente_id, source_type, source_reference)
  WHERE source_type <> 'ZKTECO' AND source_reference IS NOT NULL;

CREATE INDEX idx_attendance_source_events_empresa_occurred_at
  ON public.attendance_source_events (cliente_id, occurred_at DESC);

CREATE INDEX idx_attendance_source_events_processing_pending
  ON public.attendance_source_events (processing_status, received_at)
  WHERE processing_status IN ('PENDING', 'ERROR');

CREATE INDEX idx_attendance_source_events_device_occurred_at
  ON public.attendance_source_events (device_id, occurred_at DESC)
  WHERE device_id IS NOT NULL;

CREATE INDEX idx_attendance_source_events_employee_occurred_at
  ON public.attendance_source_events (employee_id, occurred_at DESC)
  WHERE employee_id IS NOT NULL;

-- Ningún navegador o aplicación móvil obtiene acceso directo. La futura ruta
-- autenticada deberá usar un servicio de backend y una política explícita.
ALTER TABLE public.attendance_source_events ENABLE ROW LEVEL SECURITY;

-- POSTCHECK: confirma estructura vacía, RLS, índices y triggers sin tocar la
-- ingesta ZKTeco actual ni registro_asistencia.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS row_security_enabled,
  count(ase.id) AS event_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN public.attendance_source_events ase ON true
WHERE n.nspname = 'public'
  AND c.relname = 'attendance_source_events'
GROUP BY c.relname, c.relrowsecurity;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'attendance_source_events'
ORDER BY indexname;

SELECT trg.tgname AS trigger_name, pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
JOIN pg_class c ON c.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'attendance_source_events'
  AND NOT trg.tgisinternal
ORDER BY trg.tgname;

COMMIT;
