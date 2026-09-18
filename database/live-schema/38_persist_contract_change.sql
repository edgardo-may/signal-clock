-- Phase 36.1: V3 persistence contract change.
-- Prepared only; do not execute until 37_persist_contract_precheck.sql is reviewed.
-- This transaction creates no tenant authorization row and writes no business data.
BEGIN;

DO $preflight$
DECLARE
  v_workday_rows bigint;
  v_history_regclass regclass;
  v_tenant_features_regclass regclass;
BEGIN
  v_history_regclass := to_regclass('public.workday_record_history');
  v_tenant_features_regclass := to_regclass('public.tenant_features');
  IF to_regclass('public.workday_records') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: workday_records is absent';
  END IF;
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: legacy persistence RPC signature is absent';
  END IF;
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: V3 RPC already exists; do not overwrite it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workday_records'
      AND column_name = 'calculation_version' AND udt_name <> 'int4'
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: workday_records.calculation_version has an incompatible type';
  END IF;
  IF v_history_regclass IS NOT NULL AND EXISTS (
    SELECT 1 FROM (VALUES
      ('workday_record_id'), ('cliente_id'), ('empleado_id'), ('workday_date'),
      ('calculation_version'), ('integrity_hash'), ('action'), ('persisted_at')
    ) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'workday_record_history'
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: existing workday_record_history shape is incompatible';
  END IF;
  IF v_tenant_features_regclass IS NOT NULL AND EXISTS (
    SELECT 1 FROM (VALUES
      ('cliente_id'), ('feature_key'), ('mode'), ('enabled'),
      ('canary_registro_id'), ('canary_empleado_id'), ('canary_schedule_id'), ('canary_workday_date')
    ) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'tenant_features'
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: existing tenant_features shape is incompatible';
  END IF;
  IF v_history_regclass IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = v_history_regclass
      AND conname = 'workday_record_history_identity_key'
      AND contype = 'u' AND convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: existing history lacks the approved idempotency constraint';
  END IF;
  IF v_tenant_features_regclass IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = v_tenant_features_regclass
      AND contype = 'p' AND convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: existing tenant_features lacks a primary key';
  END IF;
  SELECT count(*) INTO v_workday_rows FROM public.workday_records;
  IF v_workday_rows < 0 THEN
    RAISE EXCEPTION 'FAIL CLOSED: impossible workday row count';
  END IF;
END
$preflight$;

ALTER TABLE public.workday_records
  ADD COLUMN IF NOT EXISTS calculation_version integer;

CREATE TABLE IF NOT EXISTS public.workday_record_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workday_record_id uuid NOT NULL REFERENCES public.workday_records(id) ON DELETE RESTRICT,
  cliente_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  workday_date date NOT NULL,
  schedule_id uuid NULL,
  timezone text NOT NULL,
  first_in timestamptz NULL,
  last_out timestamptz NULL,
  worked_minutes integer NOT NULL,
  break_minutes integer NOT NULL,
  overtime_minutes integer NOT NULL,
  late_minutes integer NOT NULL,
  early_leave_minutes integer NOT NULL,
  status text NOT NULL,
  calculation_version integer NOT NULL,
  integrity_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERTED')),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workday_record_history_identity_key
    UNIQUE (workday_record_id, integrity_hash, action),
  CONSTRAINT workday_record_history_version_check
    CHECK (calculation_version = 3)
);

CREATE TABLE IF NOT EXISTS public.tenant_features (
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  feature_key text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('OFF', 'SHADOW', 'PERSIST_CANARY', 'ACTIVE')),
  enabled boolean NOT NULL DEFAULT false,
  canary_registro_id uuid NULL,
  canary_empleado_id uuid NULL,
  canary_schedule_id uuid NULL,
  canary_workday_date date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, feature_key),
  CONSTRAINT tenant_features_canary_scope_check CHECK (
    mode <> 'PERSIST_CANARY'
    OR (enabled AND feature_key = 'WORKDAY_PERSIST_CANARY'
        AND canary_registro_id IS NOT NULL
        AND canary_empleado_id IS NOT NULL
        AND canary_schedule_id IS NOT NULL
        AND canary_workday_date IS NOT NULL)
  )
);

DO $constraints$
BEGIN
  -- The preflight above establishes that workday_records exists before this cast.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.workday_records'::regclass
      AND conname = 'workday_records_calculation_version_check'
  ) THEN
    ALTER TABLE public.workday_records
      ADD CONSTRAINT workday_records_calculation_version_check
      CHECK (calculation_version IS NULL OR calculation_version >= 1);
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS workday_record_history_logical_identity_idx
  ON public.workday_record_history (cliente_id, empleado_id, workday_date, persisted_at);

ALTER TABLE public.workday_record_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workday_record_history, public.tenant_features FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.workday_record_history TO service_role;
GRANT SELECT ON TABLE public.tenant_features TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_workday_record(
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
  p_integrity_hash text,
  p_calculation_version integer,
  p_registro_id uuid
)
RETURNS TABLE (workday_id uuid, persistence_result text, integrity_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $v3$
DECLARE
  v_id uuid;
BEGIN
  IF p_calculation_version <> 3 OR p_integrity_hash IS NULL OR btrim(p_integrity_hash) = '' OR p_registro_id IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: only V3 payloads with integrity hash are accepted' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.registro_asistencia
    WHERE id = p_registro_id AND cliente_id = p_cliente_id AND empleado_id = p_empleado_id
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: registro identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.empleados
    WHERE id = p_empleado_id AND cliente_id = p_cliente_id
  ) OR (p_schedule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.horarios
    WHERE id = p_schedule_id AND cliente_id = p_cliente_id
  )) THEN
    RAISE EXCEPTION 'FAIL CLOSED: tenant identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_features
    WHERE cliente_id = p_cliente_id
      AND feature_key = 'WORKDAY_PERSIST_CANARY'
      AND mode = 'PERSIST_CANARY'
      AND enabled = true
      AND canary_empleado_id = p_empleado_id
      AND canary_registro_id = p_registro_id
      AND canary_schedule_id IS NOT DISTINCT FROM p_schedule_id
      AND canary_workday_date = p_workday_date
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: persist canary is not authorized for this identity' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.workday_records (
    cliente_id, empleado_id, workday_date, schedule_id, timezone,
    first_in, last_out, worked_minutes, break_minutes, overtime_minutes,
    late_minutes, early_leave_minutes, status, integrity_hash, calculation_version
  ) VALUES (
    p_cliente_id, p_empleado_id, p_workday_date, p_schedule_id, p_timezone,
    p_first_in, p_last_out, p_worked_minutes, p_break_minutes, p_overtime_minutes,
    p_late_minutes, p_early_leave_minutes, p_status, p_integrity_hash, p_calculation_version
  ) ON CONFLICT (cliente_id, empleado_id, workday_date) DO NOTHING
  RETURNING id INTO v_id;

  IF FOUND THEN
    INSERT INTO public.workday_record_history (
      workday_record_id, cliente_id, empleado_id, workday_date, schedule_id,
      timezone, first_in, last_out, worked_minutes, break_minutes, overtime_minutes,
      late_minutes, early_leave_minutes, status, calculation_version, integrity_hash, action
    ) VALUES (
      v_id, p_cliente_id, p_empleado_id, p_workday_date, p_schedule_id,
      p_timezone, p_first_in, p_last_out, p_worked_minutes, p_break_minutes, p_overtime_minutes,
      p_late_minutes, p_early_leave_minutes, p_status, p_calculation_version, p_integrity_hash, 'INSERTED'
    );
    RETURN QUERY SELECT v_id, 'INSERTED'::text, p_integrity_hash;
    RETURN;
  END IF;

  SELECT id INTO v_id FROM public.workday_records
  WHERE cliente_id = p_cliente_id AND empleado_id = p_empleado_id AND workday_date = p_workday_date;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL CLOSED: logical workday disappeared' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workday_records w
    WHERE w.id = v_id AND (
      w.schedule_id IS DISTINCT FROM p_schedule_id OR w.timezone IS DISTINCT FROM p_timezone
      OR w.first_in IS DISTINCT FROM p_first_in OR w.last_out IS DISTINCT FROM p_last_out
      OR w.worked_minutes IS DISTINCT FROM p_worked_minutes OR w.break_minutes IS DISTINCT FROM p_break_minutes
      OR w.overtime_minutes IS DISTINCT FROM p_overtime_minutes OR w.late_minutes IS DISTINCT FROM p_late_minutes
      OR w.early_leave_minutes IS DISTINCT FROM p_early_leave_minutes OR w.status IS DISTINCT FROM p_status
      OR w.integrity_hash IS DISTINCT FROM p_integrity_hash OR w.calculation_version IS DISTINCT FROM p_calculation_version
    )
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: existing snapshot differs; UPDATE is not authorized' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT v_id, 'UNCHANGED'::text, p_integrity_hash;
END
$v3$;

REVOKE EXECUTE ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text
) FROM service_role;
REVOKE ALL ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text, integer, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text, integer, uuid
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(
  uuid, uuid, date, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, integer, text, text, integer, uuid
) TO service_role;

COMMIT;
