-- ============================================================================
-- SIGNUM-CLOCK · Migration 047 · Phase 2.2 stabilization
-- Canonical attendance_logs columns: numero_serie, biometric_user_id, timestamp.
-- The logical workday is currently one ACTIVE record per tenant/employee/date.
-- A future multiple-workday-per-date capability requires an explicit sequence model.
-- ============================================================================

-- Tenant-owned timezone used by reprocessing. It is intentionally explicit and
-- has a documented fallback for existing tenants.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City';

-- 041 used legacy names that do not exist in the canonical 029 schema. Keep a
-- compatible unique index for deployed databases after the clean-chain repair.
DROP INDEX IF EXISTS public.idx_attendance_logs_unique_event;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_unique_event
  ON public.attendance_logs (numero_serie, biometric_user_id, "timestamp");

-- employee_user_links must agree with the employee's tenant, not merely have
-- two independent foreign keys.
CREATE OR REPLACE FUNCTION public.fn_validate_employee_user_link_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.empleados e
    WHERE e.id = NEW.empleado_id AND e.cliente_id = NEW.cliente_id
  ) THEN
    RAISE EXCEPTION 'employee_user_links.cliente_id must match empleados.cliente_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_employee_user_link_tenant ON public.employee_user_links;
CREATE TRIGGER trg_validate_employee_user_link_tenant
BEFORE INSERT OR UPDATE OF cliente_id, empleado_id ON public.employee_user_links
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_employee_user_link_tenant();

CREATE OR REPLACE FUNCTION public.auth_current_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT empleado_id
  FROM public.employee_user_links
  WHERE auth_user_id = auth.uid() AND active = true
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_current_employee_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_current_employee_id() TO authenticated;

-- One unambiguous logical workday exists today for a tenant/employee/date.
-- This deliberately rejects a second independent ACTIVE workday until the
-- product introduces and documents a logical_sequence domain model.
DROP INDEX IF EXISTS public.idx_workday_records_identity;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workday_records_one_active_logical_workday
  ON public.workday_records (cliente_id, empleado_id, workday_date)
  WHERE record_state = 'ACTIVE';

CREATE OR REPLACE FUNCTION public.upsert_workday_record(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cliente_id UUID := (payload->>'cliente_id')::uuid;
  v_empleado_id UUID := (payload->>'empleado_id')::uuid;
  v_assignment_id UUID := (payload->>'schedule_assignment_id')::uuid;
  v_workday_date DATE := (payload->>'workday_date')::date;
  v_integrity_hash TEXT := payload->>'integrity_hash';
  v_change_reason TEXT := COALESCE(payload->>'change_reason', 'SYSTEM_UPDATE');
  v_creado_por UUID := (payload->>'creado_por')::uuid;
  v_window_start TIMESTAMPTZ := (payload->>'source_window_start_utc')::timestamptz;
  v_window_end TIMESTAMPTZ := (payload->>'source_window_end_utc')::timestamptz;
  v_biometric_id TEXT;
  v_schedule_id UUID;
  v_existing public.workday_records%ROWTYPE;
  v_new_id UUID;
  v_snapshot JSONB;
  v_next_version INTEGER;
  v_supersede_reason TEXT;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object'
     OR v_cliente_id IS NULL OR v_empleado_id IS NULL OR v_workday_date IS NULL
     OR NULLIF(payload->>'timezone', '') IS NULL OR NULLIF(v_integrity_hash, '') IS NULL
     OR v_window_start IS NULL OR v_window_end IS NULL OR v_window_end < v_window_start
  THEN
    RAISE EXCEPTION 'Invalid workday payload or source window';
  END IF;
  IF jsonb_typeof(COALESCE(payload->'source_log_ids', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(payload->'punch_dispositions', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(payload->'incidents', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(payload->'warnings', '[]'::jsonb)) <> 'array'
  THEN
    RAISE EXCEPTION 'source_log_ids, punch_dispositions, incidents and warnings must be arrays';
  END IF;

  SELECT hikvision_device_userid INTO v_biometric_id
  FROM public.empleados WHERE id = v_empleado_id AND cliente_id = v_cliente_id;
  IF v_biometric_id IS NULL THEN
    RAISE EXCEPTION 'Empleado no pertenece al tenant o no existe';
  END IF;

  IF v_assignment_id IS NOT NULL THEN
    SELECT horario_id INTO v_schedule_id
    FROM public.empleados_horarios
    WHERE id = v_assignment_id AND cliente_id = v_cliente_id AND empleado_id = v_empleado_id;
    IF v_schedule_id IS NULL THEN
      RAISE EXCEPTION 'Asignación de horario no pertenece al tenant/empleado o no existe';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(payload->'source_log_ids', '[]'::jsonb)) x(id)
    LEFT JOIN public.attendance_logs al ON al.id = x.id::uuid
    WHERE al.id IS NULL OR al.cliente_id <> v_cliente_id
       OR al.biometric_user_id <> v_biometric_id
       OR al."timestamp" < v_window_start OR al."timestamp" > v_window_end
  ) THEN
    RAISE EXCEPTION 'source_log_ids contain an invalid, foreign, or out-of-window attendance log';
  END IF;

  -- Serializes every identity transition for this logical workday without a retry loop.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_cliente_id::text || ':' || v_empleado_id::text || ':' || v_workday_date::text, 0));

  SELECT * INTO v_existing
  FROM public.workday_records
  WHERE cliente_id = v_cliente_id AND empleado_id = v_empleado_id
    AND workday_date = v_workday_date AND record_state = 'ACTIVE'
  FOR UPDATE;

  IF FOUND AND v_existing.schedule_assignment_id IS NOT DISTINCT FROM v_assignment_id THEN
    IF v_existing.integrity_hash = v_integrity_hash THEN
      RETURN jsonb_build_object('status', 'UNCHANGED', 'workday_record_id', v_existing.id, 'version', v_existing.current_version);
    END IF;
    v_next_version := v_existing.current_version + 1;
    UPDATE public.workday_records SET
      timezone = payload->>'timezone', scheduled_start = (payload->>'scheduled_start')::timestamptz,
      scheduled_end = (payload->>'scheduled_end')::timestamptz, actual_start = (payload->>'actual_start')::timestamptz,
      actual_end = (payload->>'actual_end')::timestamptz,
      worked_minutes = COALESCE((payload->>'worked_minutes')::integer, 0), break_minutes = COALESCE((payload->>'break_minutes')::integer, 0),
      effective_minutes = COALESCE((payload->>'effective_minutes')::integer, 0), late_minutes = COALESCE((payload->>'late_minutes')::integer, 0),
      early_leave_minutes = COALESCE((payload->>'early_leave_minutes')::integer, 0), ordinary_minutes = COALESCE((payload->>'ordinary_minutes')::integer, 0),
      overtime_minutes = COALESCE((payload->>'overtime_minutes')::integer, 0), workday_state = payload->>'workday_state',
      calculation_version = payload->>'calculation_version', integrity_hash = v_integrity_hash, current_version = v_next_version,
      source_log_ids = ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(payload->'source_log_ids','[]'::jsonb)) x),
      punch_dispositions = COALESCE(payload->'punch_dispositions','[]'::jsonb), incidents = COALESCE(payload->'incidents','[]'::jsonb), warnings = COALESCE(payload->'warnings','[]'::jsonb)
    WHERE id = v_existing.id;
    SELECT to_jsonb(wr) INTO v_snapshot FROM public.workday_records wr WHERE id = v_existing.id;
    INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,version,snapshot,integrity_hash,change_reason,creado_por)
    VALUES(v_existing.id,v_cliente_id,v_empleado_id,v_next_version,v_snapshot,v_integrity_hash,v_change_reason,v_creado_por);
    RETURN jsonb_build_object('status','UPDATED_VERSION','workday_record_id',v_existing.id,'version',v_next_version);
  END IF;

  -- A schedule transition creates a definitive record and preserves the previous
  -- materialization as a superseded, versioned fact.
  IF FOUND THEN
    INSERT INTO public.workday_records(cliente_id,empleado_id,schedule_id,schedule_assignment_id,workday_date,timezone,scheduled_start,scheduled_end,actual_start,actual_end,worked_minutes,break_minutes,effective_minutes,late_minutes,early_leave_minutes,ordinary_minutes,overtime_minutes,workday_state,calculation_version,integrity_hash,source_log_ids,punch_dispositions,incidents,warnings,record_state)
    VALUES(v_cliente_id,v_empleado_id,v_schedule_id,v_assignment_id,v_workday_date,payload->>'timezone',(payload->>'scheduled_start')::timestamptz,(payload->>'scheduled_end')::timestamptz,(payload->>'actual_start')::timestamptz,(payload->>'actual_end')::timestamptz,COALESCE((payload->>'worked_minutes')::integer,0),COALESCE((payload->>'break_minutes')::integer,0),COALESCE((payload->>'effective_minutes')::integer,0),COALESCE((payload->>'late_minutes')::integer,0),COALESCE((payload->>'early_leave_minutes')::integer,0),COALESCE((payload->>'ordinary_minutes')::integer,0),COALESCE((payload->>'overtime_minutes')::integer,0),payload->>'workday_state',payload->>'calculation_version',v_integrity_hash,ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(payload->'source_log_ids','[]'::jsonb)) x),COALESCE(payload->'punch_dispositions','[]'::jsonb),COALESCE(payload->'incidents','[]'::jsonb),COALESCE(payload->'warnings','[]'::jsonb),'ACTIVE') RETURNING id INTO v_new_id;
    v_next_version := v_existing.current_version + 1;
    v_supersede_reason := CASE WHEN v_existing.schedule_assignment_id IS NULL THEN 'UNSCHEDULED_RECONCILED' ELSE 'SCHEDULE_REASSIGNED' END;
    UPDATE public.workday_records SET record_state='SUPERSEDED', superseded_by=v_new_id, current_version=v_next_version WHERE id=v_existing.id;
    SELECT to_jsonb(wr) INTO v_snapshot FROM public.workday_records wr WHERE id=v_existing.id;
    INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,version,snapshot,integrity_hash,change_reason,creado_por)
    VALUES(v_existing.id,v_cliente_id,v_empleado_id,v_next_version,v_snapshot,v_existing.integrity_hash,v_supersede_reason,v_creado_por);
  ELSE
    INSERT INTO public.workday_records(cliente_id,empleado_id,schedule_id,schedule_assignment_id,workday_date,timezone,scheduled_start,scheduled_end,actual_start,actual_end,worked_minutes,break_minutes,effective_minutes,late_minutes,early_leave_minutes,ordinary_minutes,overtime_minutes,workday_state,calculation_version,integrity_hash,source_log_ids,punch_dispositions,incidents,warnings,record_state)
    VALUES(v_cliente_id,v_empleado_id,v_schedule_id,v_assignment_id,v_workday_date,payload->>'timezone',(payload->>'scheduled_start')::timestamptz,(payload->>'scheduled_end')::timestamptz,(payload->>'actual_start')::timestamptz,(payload->>'actual_end')::timestamptz,COALESCE((payload->>'worked_minutes')::integer,0),COALESCE((payload->>'break_minutes')::integer,0),COALESCE((payload->>'effective_minutes')::integer,0),COALESCE((payload->>'late_minutes')::integer,0),COALESCE((payload->>'early_leave_minutes')::integer,0),COALESCE((payload->>'ordinary_minutes')::integer,0),COALESCE((payload->>'overtime_minutes')::integer,0),payload->>'workday_state',payload->>'calculation_version',v_integrity_hash,ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(payload->'source_log_ids','[]'::jsonb)) x),COALESCE(payload->'punch_dispositions','[]'::jsonb),COALESCE(payload->'incidents','[]'::jsonb),COALESCE(payload->'warnings','[]'::jsonb),'ACTIVE') RETURNING id INTO v_new_id;
  END IF;
  SELECT to_jsonb(wr) INTO v_snapshot FROM public.workday_records wr WHERE id=v_new_id;
  INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,version,snapshot,integrity_hash,change_reason,creado_por)
  VALUES(v_new_id,v_cliente_id,v_empleado_id,1,v_snapshot,v_integrity_hash,CASE WHEN v_existing.id IS NULL THEN COALESCE(payload->>'change_reason','INITIAL_CALCULATION') ELSE 'SCHEDULE_ASSIGNED' END,v_creado_por);
  RETURN jsonb_build_object('status','CREATED','workday_record_id',v_new_id,'version',1);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_workday_record(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(JSONB) TO service_role;
