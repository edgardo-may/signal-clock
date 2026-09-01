-- ================================================================
--  SIGNUM-CLOCK · Migración 045 · Registro Electrónico de Jornada
--  Crea: workday_records, workday_record_history, tenant_features
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- 1. TABLA: tenant_features (Feature Flags)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_features (
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'OFF' CHECK (state IN ('OFF', 'SHADOW', 'ACTIVE')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cliente_id, feature_key)
);

CREATE OR REPLACE TRIGGER trg_tenant_features_updated_at
  BEFORE UPDATE ON public.tenant_features
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- 2. TABLA: workday_records (Estado Actual Materializado)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workday_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES public.horarios(id) ON DELETE SET NULL,
    
    workday_date DATE NOT NULL,
    timezone TEXT NOT NULL,
    
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    
    worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    effective_minutes INTEGER NOT NULL DEFAULT 0 CHECK (effective_minutes >= 0),
    
    late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
    early_leave_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_leave_minutes >= 0),
    
    ordinary_minutes INTEGER NOT NULL DEFAULT 0 CHECK (ordinary_minutes >= 0),
    overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
    
    workday_state TEXT NOT NULL,
    calculation_version TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    
    current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
    
    source_log_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
    punch_dispositions JSONB NOT NULL DEFAULT '[]'::jsonb,
    incidents JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_workday_records_updated_at
  BEFORE UPDATE ON public.workday_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índice lógico funcional para garantizar la idempotencia de jornada
CREATE UNIQUE INDEX IF NOT EXISTS idx_workday_records_identity
ON public.workday_records (
    cliente_id,
    empleado_id,
    workday_date,
    COALESCE(schedule_id::text, 'UNSCHEDULED')
);

CREATE INDEX IF NOT EXISTS idx_workday_records_empleado_date ON public.workday_records (empleado_id, workday_date);
CREATE INDEX IF NOT EXISTS idx_workday_records_cliente_date ON public.workday_records (cliente_id, workday_date);

-- ──────────────────────────────────────────────────────────────
-- 3. TABLA: workday_record_history (Histórico Inmutable)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workday_record_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workday_record_id UUID NOT NULL REFERENCES public.workday_records(id) ON DELETE CASCADE,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    
    snapshot JSONB NOT NULL,
    integrity_hash TEXT NOT NULL,
    change_reason TEXT NOT NULL,
    
    creado_por UUID, -- Puede ser nulo si fue procesado automáticamente por sistema
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_workday_history_version UNIQUE (workday_record_id, version)
);

-- Bloqueo de mutabilidad. Es una tabla de sólo anexar (append-only) para la historia.
CREATE OR REPLACE RULE prevent_update_workday_history AS 
    ON UPDATE TO public.workday_record_history DO INSTEAD NOTHING;
CREATE OR REPLACE RULE prevent_delete_workday_history AS 
    ON DELETE TO public.workday_record_history DO INSTEAD NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 4. RPC: upsert_workday_record
-- ──────────────────────────────────────────────────────────────
-- Función segura para mantener la atomicidad e inmutabilidad en 1 solo paso.
CREATE OR REPLACE FUNCTION public.upsert_workday_record(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cliente_id UUID := (payload->>'cliente_id')::UUID;
    v_empleado_id UUID := (payload->>'empleado_id')::UUID;
    v_schedule_id UUID := (payload->>'schedule_id')::UUID;
    v_workday_date DATE := (payload->>'workday_date')::DATE;
    v_integrity_hash TEXT := payload->>'integrity_hash';
    v_change_reason TEXT := payload->>'change_reason';
    v_creado_por UUID := (payload->>'creado_por')::UUID;
    
    v_existing_id UUID;
    v_existing_hash TEXT;
    v_existing_version INTEGER;
    v_new_version INTEGER;
    v_result_status TEXT;
    
    v_valid_empleado BOOLEAN;
    v_valid_schedule BOOLEAN;
BEGIN
    -- Validaciones de pertenencia al tenant
    SELECT EXISTS (
        SELECT 1 FROM public.empleados WHERE id = v_empleado_id AND cliente_id = v_cliente_id
    ) INTO v_valid_empleado;
    IF NOT v_valid_empleado THEN
        RAISE EXCEPTION 'Empleado no pertenece al tenant o no existe';
    END IF;
    
    IF v_schedule_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.horarios WHERE id = v_schedule_id AND cliente_id = v_cliente_id
        ) INTO v_valid_schedule;
        IF NOT v_valid_schedule THEN
            RAISE EXCEPTION 'Horario no pertenece al tenant o no existe';
        END IF;
    END IF;

    -- Concurrencia: Retry-loop para Race Conditions de Upsert 
    LOOP
        SELECT id, integrity_hash, current_version 
        INTO v_existing_id, v_existing_hash, v_existing_version
        FROM public.workday_records
        WHERE cliente_id = v_cliente_id 
          AND empleado_id = v_empleado_id 
          AND workday_date = v_workday_date 
          AND COALESCE(schedule_id::text, 'UNSCHEDULED') = COALESCE(v_schedule_id::text, 'UNSCHEDULED')
        FOR UPDATE; -- Bloqueo de fila
        
        IF FOUND THEN
            IF v_existing_hash = v_integrity_hash THEN
                v_result_status := 'UNCHANGED';
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
                    worked_minutes = (payload->>'worked_minutes')::INTEGER,
                    break_minutes = (payload->>'break_minutes')::INTEGER,
                    effective_minutes = (payload->>'effective_minutes')::INTEGER,
                    late_minutes = (payload->>'late_minutes')::INTEGER,
                    early_leave_minutes = (payload->>'early_leave_minutes')::INTEGER,
                    ordinary_minutes = (payload->>'ordinary_minutes')::INTEGER,
                    overtime_minutes = (payload->>'overtime_minutes')::INTEGER,
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
                
                INSERT INTO public.workday_record_history (
                    workday_record_id, cliente_id, empleado_id, version,
                    snapshot, integrity_hash, change_reason, creado_por
                ) VALUES (
                    v_existing_id, v_cliente_id, v_empleado_id, v_new_version,
                    payload, v_integrity_hash, COALESCE(v_change_reason, 'SYSTEM_UPDATE'), v_creado_por
                );
            END IF;
            EXIT; -- Salimos del loop si procesamos exitosamente un registro existente
        ELSE
            BEGIN
                v_result_status := 'CREATED';
                v_new_version := 1;
                
                INSERT INTO public.workday_records (
                    cliente_id, empleado_id, schedule_id, workday_date, timezone,
                    scheduled_start, scheduled_end, actual_start, actual_end,
                    worked_minutes, break_minutes, effective_minutes,
                    late_minutes, early_leave_minutes, ordinary_minutes, overtime_minutes,
                    workday_state, calculation_version, integrity_hash, current_version,
                    source_log_ids, punch_dispositions, incidents, warnings
                ) VALUES (
                    v_cliente_id, v_empleado_id, v_schedule_id, v_workday_date, payload->>'timezone',
                    (payload->>'scheduled_start')::TIMESTAMPTZ, (payload->>'scheduled_end')::TIMESTAMPTZ, 
                    (payload->>'actual_start')::TIMESTAMPTZ, (payload->>'actual_end')::TIMESTAMPTZ,
                    COALESCE((payload->>'worked_minutes')::INTEGER, 0), COALESCE((payload->>'break_minutes')::INTEGER, 0), COALESCE((payload->>'effective_minutes')::INTEGER, 0),
                    COALESCE((payload->>'late_minutes')::INTEGER, 0), COALESCE((payload->>'early_leave_minutes')::INTEGER, 0), 
                    COALESCE((payload->>'ordinary_minutes')::INTEGER, 0), COALESCE((payload->>'overtime_minutes')::INTEGER, 0),
                    payload->>'workday_state', payload->>'calculation_version', v_integrity_hash, v_new_version,
                    (SELECT COALESCE(array_agg(x::uuid), '{}'::uuid[]) FROM jsonb_array_elements_text(payload->'source_log_ids') x), 
                    payload->'punch_dispositions', payload->'incidents', payload->'warnings'
                ) RETURNING id INTO v_existing_id;
                
                INSERT INTO public.workday_record_history (
                    workday_record_id, cliente_id, empleado_id, version,
                    snapshot, integrity_hash, change_reason, creado_por
                ) VALUES (
                    v_existing_id, v_cliente_id, v_empleado_id, v_new_version,
                    payload, v_integrity_hash, COALESCE(v_change_reason, 'INITIAL_CALCULATION'), v_creado_por
                );
                
                EXIT; -- Salimos del loop tras el insert
            EXCEPTION WHEN unique_violation THEN
                -- Concurrencia exacta: otra transacción insertó justo después de nuestro IF FOUND. 
                -- Repetimos el loop (ahora IF FOUND será true).
            END;
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object(
        'status', v_result_status,
        'workday_record_id', v_existing_id,
        'version', COALESCE(v_new_version, v_existing_version)
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. RLS (Row Level Security)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workday_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workday_record_history ENABLE ROW LEVEL SECURITY;

-- tenant_features: Lectura pública (restringida a tenant) para clientes autenticados
CREATE POLICY "tenant_features_read_admin" 
ON public.tenant_features FOR SELECT 
USING (
  auth.role() = 'authenticated' 
  AND (
    ((auth.jwt() -> 'app_metadata') ->> 'perfil' = 'superadmin') OR 
    (cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::uuid)
  )
);

-- workday_records RLS:
-- 1. superadmin global
-- 2. admin / rh tenant
-- 3. Empleado propio (requiere que user_metadata contenga empleado_id asignado)
CREATE POLICY "workday_records_select"
ON public.workday_records FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    ((auth.jwt() -> 'app_metadata') ->> 'perfil' = 'superadmin') OR 
    (cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::uuid AND ((auth.jwt() -> 'app_metadata') ->> 'perfil' IN ('admin', 'rh'))) OR
    (empleado_id = (auth.jwt() -> 'user_metadata' ->> 'empleado_id')::uuid)
  )
);

-- history RLS: más restrictivo, los colaboradores NO lo consultan por ahora
CREATE POLICY "workday_record_history_select"
ON public.workday_record_history FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    ((auth.jwt() -> 'app_metadata') ->> 'perfil' = 'superadmin') OR 
    (cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::uuid AND ((auth.jwt() -> 'app_metadata') ->> 'perfil' IN ('admin', 'rh')))
  )
);

-- NOTA: No exponemos INSERT / UPDATE / DELETE en RLS porque TODAS
-- las modificaciones se realizan de forma segura y exclusivamente mediante
-- la función `upsert_workday_record` (SECURITY DEFINER) ejecutada desde backend (Service Role)
-- o scripts. Ningún usuario web tiene permisos directos para modificar jornadas.
