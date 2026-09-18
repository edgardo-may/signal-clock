-- Signum Clock — Fase 23: baseline NUEVO de public.workday_records.
-- No usa migraciones históricas, no hace backfill y no activa el Attendance Engine.

BEGIN;

DO $preflight$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['workday_records', 'workday_record_history', 'tenant_features'] LOOP
    IF to_regclass('public.' || relation_name) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL CLOSED: public.% ya existe', relation_name;
    END IF;
  END LOOP;

  IF to_regprocedure('public.auth_can_read_tenant(uuid)') IS NULL
     OR to_regprocedure('public.auth_can_write_tenant(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: faltan funciones tenant con firma uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('clientes', 'id'), ('empleados', 'id'), ('empleados', 'cliente_id'),
      ('horarios', 'id'), ('horarios', 'cliente_id')
    ) AS expected(table_name, column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = expected.table_name
     AND c.column_name = expected.column_name
    WHERE c.udt_name IS DISTINCT FROM 'uuid'
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: las llaves requeridas de clientes/empleados/horarios deben ser uuid';
  END IF;

  IF to_regprocedure('public.enforce_workday_record_tenant_integrity()') IS NOT NULL
     OR to_regprocedure('public.set_workday_updated_at()') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: ya existe una función exclusiva de workday';
  END IF;
END
$preflight$;

CREATE TABLE public.workday_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  workday_date date NOT NULL,
  schedule_id uuid NULL,
  timezone text NOT NULL,
  first_in timestamptz NULL,
  last_out timestamptz NULL,
  worked_minutes integer NOT NULL DEFAULT 0,
  break_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  late_minutes integer NOT NULL DEFAULT 0,
  early_leave_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  integrity_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workday_records_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE RESTRICT,
  CONSTRAINT workday_records_empleado_id_fkey
    FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE RESTRICT,
  CONSTRAINT workday_records_schedule_id_fkey
    FOREIGN KEY (schedule_id) REFERENCES public.horarios(id) ON DELETE RESTRICT,

  -- Una jornada es Empresa + empleado + fecha. schedule_id conserva evidencia
  -- del horario resuelto, pero no permite una segunda jornada para la misma fecha.
  CONSTRAINT workday_records_logical_identity_key
    UNIQUE (cliente_id, empleado_id, workday_date),

  CONSTRAINT workday_records_minutes_nonnegative_check CHECK (
    worked_minutes >= 0
    AND break_minutes >= 0
    AND overtime_minutes >= 0
    AND late_minutes >= 0
    AND early_leave_minutes >= 0
  ),
  CONSTRAINT workday_records_timezone_nonempty_check CHECK (btrim(timezone) <> ''),
  CONSTRAINT workday_records_time_order_check CHECK (
    first_in IS NULL
    OR last_out IS NULL
    OR last_out >= first_in
  ),

  -- Vocabulario mínimo tomado del WorkdayState real de AttendanceTypes.ts.
  CONSTRAINT workday_records_status_check CHECK (
    status IN ('COMPLETE', 'INCOMPLETE', 'ABSENT', 'UNSCHEDULED', 'INVALID')
  )
);

-- FKs independientes no prueban que los tres UUID pertenezcan a la misma
-- Empresa. Este trigger falla cerradamente antes de INSERT/UPDATE si no existe
-- la relación exacta empleado/horario dentro de NEW.cliente_id.
CREATE FUNCTION public.enforce_workday_record_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $tenant_integrity$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.empleados e
    WHERE e.id = NEW.empleado_id
      AND e.cliente_id = NEW.cliente_id
  ) THEN
    RAISE EXCEPTION 'workday empleado_id % no pertenece a cliente_id %', NEW.empleado_id, NEW.cliente_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.schedule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.horarios h
    WHERE h.id = NEW.schedule_id
      AND h.cliente_id = NEW.cliente_id
  ) THEN
    RAISE EXCEPTION 'workday schedule_id % no pertenece a cliente_id %', NEW.schedule_id, NEW.cliente_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$tenant_integrity$;

CREATE TRIGGER trg_workday_records_tenant_integrity
BEFORE INSERT OR UPDATE ON public.workday_records
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workday_record_tenant_integrity();

-- public.set_updated_at() escribe NEW.actualizado_at y no es compatible con el
-- contrato de workday_records. Esta función es exclusiva y no altera la legacy.
CREATE FUNCTION public.set_workday_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $workday_updated_at$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$workday_updated_at$;

CREATE TRIGGER trg_workday_records_set_updated_at
BEFORE UPDATE ON public.workday_records
FOR EACH ROW
EXECUTE FUNCTION public.set_workday_updated_at();

ALTER TABLE public.workday_records ENABLE ROW LEVEL SECURITY;

-- Sólo lectura authenticated. No hay policies INSERT/UPDATE/DELETE: la futura
-- persistencia será backend-controlled; service_role mantiene el contrato de
-- bypass RLS propio de Supabase sin un bypass inventado en la policy.
CREATE POLICY workday_records_select_tenant
ON public.workday_records
FOR SELECT
TO authenticated
USING (public.auth_can_read_tenant(cliente_id));

COMMIT;
