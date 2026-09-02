-- ================================================================
--  SIGNUM-CLOCK · Migración 046 · FASE 2.1 Security & Persistence Hardening
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- 1. employee_user_links: Mapeo estricto auth.users -> empleados
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_user_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
    auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_emp_user_link_empleado UNIQUE (empleado_id),
    CONSTRAINT uq_emp_user_link_auth UNIQUE (auth_user_id)
);

CREATE OR REPLACE FUNCTION public.auth_current_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empleado_id
  FROM public.employee_user_links
  WHERE auth_user_id = auth.uid()
    AND active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.auth_current_employee_id() TO authenticated, service_role;

-- RLS de employee_user_links
ALTER TABLE public.employee_user_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emp_user_links: admin can manage"
ON public.employee_user_links
FOR ALL
USING (
  auth.role() = 'authenticated' AND
  cliente_id = public.auth_current_cliente_id() AND
  public.auth_current_role() IN ('admin', 'superadmin')
);

-- ──────────────────────────────────────────────────────────────
-- 2. Modificaciones a workday_records (P2-003, Identity, Constraints)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.workday_records
  ADD COLUMN IF NOT EXISTS schedule_assignment_id UUID REFERENCES public.empleados_horarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS record_state TEXT NOT NULL DEFAULT 'ACTIVE' 
    CHECK (record_state IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.workday_records(id) ON DELETE SET NULL;

-- Restricciones de Dominio
ALTER TABLE public.workday_records 
  ADD CONSTRAINT chk_workday_state CHECK (workday_state IN ('COMPLETE', 'INCOMPLETE', 'ABSENT', 'UNSCHEDULED', 'INVALID')),
  ADD CONSTRAINT chk_punch_disp_json CHECK (jsonb_typeof(punch_dispositions) = 'array'),
  ADD CONSTRAINT chk_incidents_json CHECK (jsonb_typeof(incidents) = 'array'),
  ADD CONSTRAINT chk_warnings_json CHECK (jsonb_typeof(warnings) = 'array');

-- Identidad Lógica Fuerte
DROP INDEX IF EXISTS public.idx_workday_records_identity;

CREATE UNIQUE INDEX idx_workday_records_identity
ON public.workday_records (
    cliente_id,
    empleado_id,
    workday_date,
    COALESCE(schedule_assignment_id::text, 'UNSCHEDULED')
) WHERE record_state = 'ACTIVE';

-- ──────────────────────────────────────────────────────────────
-- 3. RLS Reparado (P2-004)
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "workday_records_select" ON public.workday_records;

CREATE POLICY "workday_records: SELECT"
ON public.workday_records FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    (cliente_id = public.auth_current_cliente_id() AND public.auth_current_role() IN ('superadmin', 'admin', 'auditor', 'rh'))
    OR
    (cliente_id = public.auth_current_cliente_id() AND empleado_id = public.auth_current_employee_id())
  )
);

DROP POLICY IF EXISTS "workday_record_history_select" ON public.workday_record_history;

CREATE POLICY "workday_record_history: SELECT"
ON public.workday_record_history FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND cliente_id = public.auth_current_cliente_id() 
  AND public.auth_current_role() IN ('superadmin', 'admin', 'rh')
);

-- ──────────────────────────────────────────────────────────────
-- 4. History Inmutable Verdadero (P2-010)
-- ──────────────────────────────────────────────────────────────

DROP RULE IF EXISTS prevent_update_workday_history ON public.workday_record_history;
DROP RULE IF EXISTS prevent_delete_workday_history ON public.workday_record_history;

CREATE OR REPLACE FUNCTION public.fn_prevent_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION 'workday_record_history is append-only. UPDATE and DELETE are strictly forbidden.';
END;
$$;

CREATE TRIGGER trg_prevent_history_mutation
BEFORE UPDATE OR DELETE ON public.workday_record_history
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_history_mutation();

-- ──────────────────────────────────────────────────────────────
-- 5. P2-001 / P2-002: RPC Segura y Concurrencia
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_workday_record(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cliente_id UUID := (payload->>'cliente_id')::UUID;
    v_empleado_id UUID := (payload->>'empleado_id')::UUID;
    v_assignment_id UUID := (payload->>'schedule_assignment_id')::UUID;
    v_workday_date DATE := (payload->>'workday_date')::DATE;
    v_integrity_hash TEXT := payload->>'integrity_hash';
    v_change_reason TEXT := payload->>'change_reason';
    v_creado_por UUID := (payload->>'creado_por')::UUID;
    
    v_existing_id UUID;
    v_existing_hash TEXT;
    v_existing_version INTEGER;
    v_new_version INTEGER;
    v_result_status TEXT;
    v_biometric_id TEXT;
    v_log_count INTEGER;
    v_canonical_snapshot JSONB;
BEGIN
    -- Validar autenticación/autorización backend. Sólo permitir a roles backend (service_role no aplica a claims JWT de forma directa, pero limitamos vía GRANT)
    
    -- Validar Empleado y obtener Biometric ID
    SELECT hikvision_device_userid INTO v_biometric_id FROM public.empleados WHERE id = v_empleado_id AND cliente_id = v_cliente_id;
    IF v_biometric_id IS NULL THEN
        RAISE EXCEPTION 'Empleado no pertenece al tenant o no existe';
    END IF;
    
    IF v_assignment_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.empleados_horarios WHERE id = v_assignment_id AND cliente_id = v_cliente_id AND empleado_id = v_empleado_id) THEN
            RAISE EXCEPTION 'Asignación de horario no pertenece al tenant/empleado o no existe';
        END IF;
    END IF;

    -- Validar source_log_ids
    IF payload->>'source_log_ids' IS NOT NULL AND jsonb_array_length(payload->'source_log_ids') > 0 THEN
        SELECT count(*) INTO v_log_count FROM public.attendance_logs 
        WHERE id IN (SELECT (jsonb_array_elements_text(payload->'source_log_ids'))::uuid)
          AND cliente_id = v_cliente_id 
          AND biometric_user_id = v_biometric_id;
          
        IF v_log_count <> jsonb_array_length(payload->'source_log_ids') THEN
            RAISE EXCEPTION 'Uno o más source_log_ids no pertenecen al empleado o tenant';
        END IF;
    END IF;

    -- Reconciliación: Si se pasa un assignment_id, invalidar cualquier jornada UNSCHEDULED previa
    IF v_assignment_id IS NOT NULL THEN
        UPDATE public.workday_records
        SET record_state = 'SUPERSEDED'
        WHERE cliente_id = v_cliente_id 
          AND empleado_id = v_empleado_id 
          AND workday_date = v_workday_date 
          AND schedule_assignment_id IS NULL
          AND record_state = 'ACTIVE';
    END IF;

    -- Upsert transaccional
    SELECT id, integrity_hash, current_version 
    INTO v_existing_id, v_existing_hash, v_existing_version
    FROM public.workday_records
    WHERE cliente_id = v_cliente_id 
      AND empleado_id = v_empleado_id 
      AND workday_date = v_workday_date 
      AND COALESCE(schedule_assignment_id::text, 'UNSCHEDULED') = COALESCE(v_assignment_id::text, 'UNSCHEDULED')
      AND record_state = 'ACTIVE'
    FOR UPDATE;
    
    IF FOUND THEN
        IF v_existing_hash = v_integrity_hash THEN
            v_result_status := 'UNCHANGED';
            v_new_version := v_existing_version;
        ELSE
            v_new_version := v_existing_version + 1;
            v_result_status := 'UPDATED_VERSION';
            
            UPDATE public.workday_records
            SET
                timezone = payload->>'timezone',
                scheduled_start = (payload->>'scheduled_start')::TIMESTAMPTZ,
                scheduled_end = (payload->>'scheduled_end')::TIMESTAMPTZ,
                actual_start = (payload->>'actual_start')::TIMESTAMPTZ,
                actual_end = (payload->>'actual_end')::TIMESTAMPTZ,
                worked_minutes = COALESCE((payload->>'worked_minutes')::INTEGER, 0),
                break_minutes = COALESCE((payload->>'break_minutes')::INTEGER, 0),
                effective_minutes = COALESCE((payload->>'effective_minutes')::INTEGER, 0),
                late_minutes = COALESCE((payload->>'late_minutes')::INTEGER, 0),
                early_leave_minutes = COALESCE((payload->>'early_leave_minutes')::INTEGER, 0),
                ordinary_minutes = COALESCE((payload->>'ordinary_minutes')::INTEGER, 0),
                overtime_minutes = COALESCE((payload->>'overtime_minutes')::INTEGER, 0),
                workday_state = payload->>'workday_state',
                calculation_version = payload->>'calculation_version',
                integrity_hash = v_integrity_hash,
                current_version = v_new_version,
                source_log_ids = (SELECT COALESCE(array_agg(x::uuid), '{}'::uuid[]) FROM jsonb_array_elements_text(payload->'source_log_ids') x),
                punch_dispositions = payload->'punch_dispositions',
                incidents = payload->'incidents',
                warnings = payload->'warnings',
                actualizado_at = NOW()
            WHERE id = v_existing_id;
            
            -- Construcción de snapshot canónico desde BD, no confiando en payload RAW.
            SELECT to_jsonb(wr) INTO v_canonical_snapshot FROM public.workday_records wr WHERE wr.id = v_existing_id;
            
            INSERT INTO public.workday_record_history (
                workday_record_id, cliente_id, empleado_id, version,
                snapshot, integrity_hash, change_reason, creado_por
            ) VALUES (
                v_existing_id, v_cliente_id, v_empleado_id, v_new_version,
                v_canonical_snapshot, v_integrity_hash, COALESCE(v_change_reason, 'SYSTEM_UPDATE'), v_creado_por
            );
        END IF;
    ELSE
        BEGIN
            v_result_status := 'CREATED';
            v_new_version := 1;
            
            INSERT INTO public.workday_records (
                cliente_id, empleado_id, schedule_assignment_id, workday_date, timezone,
                scheduled_start, scheduled_end, actual_start, actual_end,
                worked_minutes, break_minutes, effective_minutes,
                late_minutes, early_leave_minutes, ordinary_minutes, overtime_minutes,
                workday_state, calculation_version, integrity_hash, current_version,
                source_log_ids, punch_dispositions, incidents, warnings, record_state
            ) VALUES (
                v_cliente_id, v_empleado_id, v_assignment_id, v_workday_date, payload->>'timezone',
                (payload->>'scheduled_start')::TIMESTAMPTZ, (payload->>'scheduled_end')::TIMESTAMPTZ, 
                (payload->>'actual_start')::TIMESTAMPTZ, (payload->>'actual_end')::TIMESTAMPTZ,
                COALESCE((payload->>'worked_minutes')::INTEGER, 0), COALESCE((payload->>'break_minutes')::INTEGER, 0), COALESCE((payload->>'effective_minutes')::INTEGER, 0),
                COALESCE((payload->>'late_minutes')::INTEGER, 0), COALESCE((payload->>'early_leave_minutes')::INTEGER, 0), 
                COALESCE((payload->>'ordinary_minutes')::INTEGER, 0), COALESCE((payload->>'overtime_minutes')::INTEGER, 0),
                payload->>'workday_state', payload->>'calculation_version', v_integrity_hash, v_new_version,
                (SELECT COALESCE(array_agg(x::uuid), '{}'::uuid[]) FROM jsonb_array_elements_text(payload->'source_log_ids') x), 
                payload->'punch_dispositions', payload->'incidents', payload->'warnings', 'ACTIVE'
            ) RETURNING id INTO v_existing_id;
            
            SELECT to_jsonb(wr) INTO v_canonical_snapshot FROM public.workday_records wr WHERE wr.id = v_existing_id;
            
            INSERT INTO public.workday_record_history (
                workday_record_id, cliente_id, empleado_id, version,
                snapshot, integrity_hash, change_reason, creado_por
            ) VALUES (
                v_existing_id, v_cliente_id, v_empleado_id, v_new_version,
                v_canonical_snapshot, v_integrity_hash, COALESCE(v_change_reason, 'INITIAL_CALCULATION'), v_creado_por
            );
            
        EXCEPTION WHEN unique_violation THEN
            -- No reintento infinito, delegar al cliente/caller para reintentar transaccionalmente
            RAISE EXCEPTION 'Concurrency conflict on workday_records upsert. Please retry.';
        END;
    END IF;
    
    RETURN jsonb_build_object(
        'status', v_result_status,
        'workday_record_id', v_existing_id,
        'version', COALESCE(v_new_version, v_existing_version)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_workday_record(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_workday_record(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_workday_record(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workday_record(JSONB) TO service_role;
