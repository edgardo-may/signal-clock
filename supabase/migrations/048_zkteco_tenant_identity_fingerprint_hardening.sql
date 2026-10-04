-- ================================================================
-- SIGNUM-CLOCK · Migración 048
-- ZKTeco Tenant Identity & Fingerprint Hardening
--
-- Objetivos:
-- 1. Unificar canónicamente empleados.device_userid (idempotente).
-- 2. Autoincremento secuencial de device_userid por tenant con bloqueo transaccional.
-- 3. Aislamiento multi-tenant ZKTeco puro (public.devices, sin public.dispositivos).
-- 4. Soporte para biometric_templates por dispositivo físico (device_id).
-- 5. RLS estricto para devices, assignments, commands y templates.
-- 6. Actualización de triggers de auditoría, sincronización y workday_record.
-- ================================================================

-- ── 1. UNIFICACIÓN IDEMPOTENTE DE empleados.device_userid ─────────────────────
DO $$
DECLARE
  v_has_hik BOOLEAN;
  v_has_dev BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'hikvision_device_userid'
  ) INTO v_has_hik;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'device_userid'
  ) INTO v_has_dev;

  IF v_has_hik AND NOT v_has_dev THEN
    -- Caso 1: Solo existe hikvision_device_userid -> renombrar
    ALTER TABLE public.empleados RENAME COLUMN hikvision_device_userid TO device_userid;
    RAISE NOTICE 'Renombrada columna empleados.hikvision_device_userid a device_userid';
  ELSIF v_has_dev AND NOT v_has_hik THEN
    -- Caso 2: Ya existe device_userid y no hikvision -> estado deseado
    RAISE NOTICE 'Columna empleados.device_userid ya existe correctamente';
  ELSIF v_has_hik AND v_has_dev THEN
    -- Caso 3: Existen ambas -> migrar valores faltantes sin sobrescribir
    UPDATE public.empleados
       SET device_userid = hikvision_device_userid
     WHERE (device_userid IS NULL OR TRIM(device_userid) = '')
       AND hikvision_device_userid IS NOT NULL
       AND TRIM(hikvision_device_userid) <> '';
    RAISE NOTICE 'Ambas columnas detectadas; sincronizados valores no nulos a device_userid';
  ELSE
    -- Caso 4: No existe ninguna -> error crítico
    RAISE EXCEPTION 'No se encontró ni device_userid ni hikvision_device_userid en public.empleados';
  END IF;
END $$;

-- ── 2. ÍNDICE ÚNICO PARCIAL: (cliente_id, device_userid) ──────────────────────
-- Asegurar que ningún tenant repita un device_userid entre sus empleados
CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_cliente_device_userid 
  ON public.empleados (cliente_id, device_userid) 
  WHERE device_userid IS NOT NULL AND device_userid <> '';

-- ── 3. TRIGGER AUTOINCREMENTO NUMÉRICO CON BLOQUEO POR TENANT ─────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_assign_biometric_id()
RETURNS TRIGGER AS $$
DECLARE
  v_next_id INT;
BEGIN
  -- Bloqueo consultivo transaccional por tenant para serializar inserciones concurrentes
  PERFORM pg_advisory_xact_lock(hashtext('device_userid_' || NEW.cliente_id::text));

  IF NEW.device_userid IS NULL OR TRIM(NEW.device_userid) = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(device_userid, '\D', '', 'g'), '')::INT), 0) + 1
      INTO v_next_id
      FROM public.empleados
     WHERE cliente_id = NEW.cliente_id;

    NEW.device_userid := v_next_id::TEXT;
  ELSE
    -- Validar que el valor provisto sea estrictamente numérico
    IF NEW.device_userid !~ '^\d+$' THEN
      RAISE EXCEPTION 'device_userid debe ser estrictamente numérico para compatibilidad ZKTeco. Recibido: %', NEW.device_userid;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_biometric_id ON public.empleados;
CREATE TRIGGER trg_auto_assign_biometric_id
BEFORE INSERT OR UPDATE OF device_userid ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_assign_biometric_id();

-- ── 4. EXTENSIÓN Y BACKFILL DE biometric_templates (device_id) ────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'biometric_templates' AND column_name = 'device_id'
  ) THEN
    ALTER TABLE public.biometric_templates 
      ADD COLUMN device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE;
    RAISE NOTICE 'Columna device_id añadida a biometric_templates';
  END IF;
END $$;

-- Backfill seguro donde la relación sea inequívoca (cliente con un único dispositivo registrado)
UPDATE public.biometric_templates bt
   SET device_id = (
     SELECT d.id FROM public.devices d 
      WHERE d.cliente_id = bt.cliente_id
      LIMIT 1
   )
 WHERE bt.device_id IS NULL
   AND (SELECT COUNT(*) FROM public.devices d2 WHERE d2.cliente_id = bt.cliente_id) = 1;

-- Índice único para templates ligados a dispositivo físico específico: (empleado_id, device_id, tipo, indice)
CREATE UNIQUE INDEX IF NOT EXISTS uq_biometric_templates_device_finger
  ON public.biometric_templates (empleado_id, device_id, tipo, indice)
  WHERE device_id IS NOT NULL;

-- ── 5. COMPATIBILIDAD Y COLA device_commands ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'device_commands' AND column_name = 'device_serial'
  ) THEN
    ALTER TABLE public.device_commands ADD COLUMN device_serial TEXT;
    UPDATE public.device_commands SET device_serial = numero_serie WHERE device_serial IS NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'device_commands' AND column_name = 'numero_serie'
  ) THEN
    ALTER TABLE public.device_commands ADD COLUMN numero_serie TEXT;
    UPDATE public.device_commands SET numero_serie = device_serial WHERE numero_serie IS NULL;
  END IF;
END $$;

-- Trigger bidireccional para mantener sincronizados device_serial y numero_serie en device_commands
CREATE OR REPLACE FUNCTION public.fn_sync_device_commands_serials()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.device_serial IS NULL AND NEW.numero_serie IS NOT NULL THEN
    NEW.device_serial := UPPER(TRIM(NEW.numero_serie));
  ELSIF NEW.numero_serie IS NULL AND NEW.device_serial IS NOT NULL THEN
    NEW.numero_serie := UPPER(TRIM(NEW.device_serial));
  ELSIF NEW.device_serial IS NOT NULL THEN
    NEW.device_serial := UPPER(TRIM(NEW.device_serial));
    NEW.numero_serie := NEW.device_serial;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_device_commands_serials ON public.device_commands;
CREATE TRIGGER trg_sync_device_commands_serials
BEFORE INSERT OR UPDATE ON public.device_commands
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_device_commands_serials();

-- ── 6. TRIGGER DE ASIGNACIÓN: proc_sync_employee_assignment (ZKTeco puro) ─────
CREATE OR REPLACE FUNCTION public.proc_sync_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  var_serial TEXT;
  var_nombre TEXT;
  var_tarjeta TEXT;
  var_cmd TEXT;
  var_cmd_id UUID;
BEGIN
  -- 1. Obtener el número de serie directamente desde public.devices (NUNCA desde public.dispositivos)
  SELECT UPPER(TRIM(serial_number)) INTO var_serial 
    FROM public.devices 
   WHERE id = NEW.device_id AND cliente_id = NEW.cliente_id;
  
  IF var_serial IS NULL THEN
    RAISE EXCEPTION 'Dispositivo % no encontrado para tenant % en public.devices', NEW.device_id, NEW.cliente_id;
  END IF;

  -- 2. Obtener datos del colaborador
  SELECT (COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')), tarjeta 
    INTO var_nombre, var_tarjeta 
    FROM public.empleados 
   WHERE id = NEW.employee_id AND cliente_id = NEW.cliente_id;

  IF var_nombre IS NULL THEN
    RAISE EXCEPTION 'Empleado % no encontrado para tenant % en public.empleados', NEW.employee_id, NEW.cliente_id;
  END IF;

  -- 3. Construir comando ADMS con nombre real acotado a 20 caracteres
  IF NEW.activo = TRUE THEN
    var_cmd := 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || 
               E'\tName=' || SUBSTRING(TRIM(var_nombre) FROM 1 FOR 20) || 
               E'\tPri=0' || 
               CASE WHEN var_tarjeta IS NOT NULL AND TRIM(var_tarjeta) <> '' THEN E'\tCardNo=' || TRIM(var_tarjeta) ELSE '' END;
  ELSE
    var_cmd := 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id;
  END IF;

  -- 4. Deduplicación de comandos idénticos no ejecutados
  DELETE FROM public.device_commands
   WHERE (numero_serie = var_serial OR device_serial = var_serial)
     AND cliente_id = NEW.cliente_id
     AND is_executed = FALSE
     AND (command_string LIKE 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || '%'
          OR command_string LIKE 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id || '%');

  -- 5. Insertar en cola de comandos
  var_cmd_id := gen_random_uuid();
  INSERT INTO public.device_commands (id, cliente_id, numero_serie, device_serial, command_string, is_executed)
  VALUES (var_cmd_id, NEW.cliente_id, var_serial, var_serial, var_cmd, FALSE);

  -- 6. Reiniciar estados
  NEW.sync_status := 'PENDING';
  NEW.last_error := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 7. ACTUALIZACIÓN DEL TRIGGER DE AUDITORÍA EN empleados ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_empleados_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.cliente_id,
      'EMPLOYEE_CREATED',
      'Empleado',
      NEW.id::TEXT,
      'SUCCESS',
      jsonb_build_object('empleado_nombre', NEW.nombre || ' ' || NEW.apellido)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.activo IS DISTINCT FROM NEW.activo THEN
      PERFORM public.log_audit_event(
        NEW.cliente_id,
        CASE WHEN NEW.activo THEN 'EMPLOYEE_ACTIVATED' ELSE 'EMPLOYEE_DEACTIVATED' END,
        'Empleado',
        NEW.id::TEXT,
        'SUCCESS',
        jsonb_build_object('empleado_nombre', NEW.nombre || ' ' || NEW.apellido)
      );
    ELSIF OLD.nombre IS DISTINCT FROM NEW.nombre OR OLD.apellido IS DISTINCT FROM NEW.apellido OR OLD.device_userid IS DISTINCT FROM NEW.device_userid THEN
      PERFORM public.log_audit_event(
        NEW.cliente_id,
        'EMPLOYEE_UPDATED',
        'Empleado',
        NEW.id::TEXT,
        'SUCCESS',
        jsonb_build_object(
          'empleado_nombre', NEW.nombre || ' ' || NEW.apellido,
          'changes', jsonb_build_object(
            'nombre', CASE WHEN OLD.nombre IS DISTINCT FROM NEW.nombre THEN jsonb_build_object('before', OLD.nombre, 'after', NEW.nombre) ELSE NULL END,
            'apellido', CASE WHEN OLD.apellido IS DISTINCT FROM NEW.apellido THEN jsonb_build_object('before', OLD.apellido, 'after', NEW.apellido) ELSE NULL END,
            'device_userid', CASE WHEN OLD.device_userid IS DISTINCT FROM NEW.device_userid THEN jsonb_build_object('before', OLD.device_userid, 'after', NEW.device_userid) ELSE NULL END
          )
        )
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- ── 8. ACTUALIZACIÓN DE trg_process_attendance_log (ZKTeco First) ─────────────
CREATE OR REPLACE FUNCTION public.trg_process_attendance_log()
RETURNS TRIGGER AS $$
DECLARE
    v_empleado_id UUID;
    v_dispositivo_id UUID;
BEGIN
    -- Encontrar el dispositivo en public.devices
    SELECT id INTO v_dispositivo_id 
      FROM public.devices 
     WHERE UPPER(TRIM(serial_number)) = UPPER(TRIM(NEW.numero_serie)) 
       AND cliente_id = NEW.cliente_id 
     LIMIT 1;
    
    -- Encontrar el empleado (primero por asignación oficial)
    IF v_dispositivo_id IS NOT NULL THEN
      SELECT employee_id INTO v_empleado_id 
        FROM public.device_employee_assignments 
       WHERE device_id = v_dispositivo_id 
         AND biometric_user_id = NEW.biometric_user_id 
         AND cliente_id = NEW.cliente_id
         AND activo = TRUE
       LIMIT 1;
    END IF;

    -- Si no, por fallback directo en empleados usando device_userid canónico
    IF v_empleado_id IS NULL THEN
      SELECT id INTO v_empleado_id 
        FROM public.empleados 
       WHERE device_userid = NEW.biometric_user_id 
         AND cliente_id = NEW.cliente_id 
         AND activo = TRUE
       LIMIT 1;
    END IF;

    -- Insertar en la tabla registro_asistencia si existe
    IF v_empleado_id IS NOT NULL AND v_dispositivo_id IS NOT NULL THEN
      INSERT INTO public.registro_asistencia (
          cliente_id,
          empleado_id, 
          dispositivo_id, 
          verificado_at, 
          tipo_verificacion, 
          metodo
      ) VALUES (
          NEW.cliente_id,
          v_empleado_id, 
          v_dispositivo_id, 
          NEW.timestamp, 
          'entrada',
          'huella'
      ) ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 9. ACTUALIZACIÓN DE upsert_workday_record PARA USAR device_userid ─────────
CREATE OR REPLACE FUNCTION public.upsert_workday_record(p_record JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cliente_id UUID := (p_record->>'cliente_id')::UUID;
    v_empleado_id UUID := (p_record->>'empleado_id')::UUID;
    v_workday_date DATE := (p_record->>'workday_date')::DATE;
    v_assignment_id UUID := NULLIF(p_record->>'schedule_assignment_id', '')::UUID;
    v_current_hash TEXT := p_record->>'integrity_hash';
    v_record_id UUID;
    v_existing_hash TEXT;
    v_existing_version INTEGER;
    v_new_version INTEGER;
    v_result_status TEXT;
    v_biometric_id TEXT;
    v_log_count INTEGER;
    v_canonical_snapshot JSONB;
BEGIN
    -- Validar Empleado y obtener Biometric ID (usando device_userid)
    SELECT device_userid INTO v_biometric_id 
      FROM public.empleados 
     WHERE id = v_empleado_id AND cliente_id = v_cliente_id;

    IF v_biometric_id IS NULL THEN
      RAISE EXCEPTION 'Empleado no pertenece al tenant o no existe';
    END IF;
    
    IF v_assignment_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.empleados_horarios 
         WHERE id = v_assignment_id AND cliente_id = v_cliente_id AND empleado_id = v_empleado_id
      ) THEN
        RAISE EXCEPTION 'Asignación de horario no pertenece al tenant/empleado o no existe';
      END IF;
    END IF;

    -- Validar campos obligatorios
    IF v_cliente_id IS NULL OR v_empleado_id IS NULL OR v_workday_date IS NULL OR v_current_hash IS NULL THEN
      RAISE EXCEPTION 'Payload inválido: cliente_id, empleado_id, workday_date y integrity_hash son obligatorios';
    END IF;

    -- Bloqueo pesimista y búsqueda de registro existente
    IF v_assignment_id IS NULL THEN
      SELECT id, integrity_hash, version INTO v_record_id, v_existing_hash, v_existing_version
        FROM public.workday_records
       WHERE cliente_id = v_cliente_id 
         AND empleado_id = v_empleado_id 
         AND workday_date = v_workday_date 
         AND schedule_assignment_id IS NULL
       FOR UPDATE;
    ELSE
      SELECT id, integrity_hash, version INTO v_record_id, v_existing_hash, v_existing_version
        FROM public.workday_records
       WHERE cliente_id = v_cliente_id 
         AND empleado_id = v_empleado_id 
         AND workday_date = v_workday_date 
         AND schedule_assignment_id = v_assignment_id
       FOR UPDATE;
    END IF;

    v_log_count := jsonb_array_length(COALESCE(p_record->'source_log_ids', '[]'::jsonb));

    -- Snapshot canónico
    v_canonical_snapshot := jsonb_build_object(
      'workday_date', v_workday_date,
      'schedule_assignment_id', v_assignment_id,
      'workday_state', p_record->>'workday_state',
      'total_work_minutes', (p_record->>'total_work_minutes')::INTEGER,
      'effective_work_minutes', (p_record->>'effective_work_minutes')::INTEGER,
      'late_minutes', (p_record->>'late_minutes')::INTEGER,
      'early_leave_minutes', (p_record->>'early_leave_minutes')::INTEGER,
      'total_break_minutes', (p_record->>'total_break_minutes')::INTEGER,
      'overtime_minutes', (p_record->>'overtime_minutes')::INTEGER,
      'source_log_count', v_log_count,
      'integrity_hash', v_current_hash
    );

    IF v_record_id IS NULL THEN
      -- INSERT NUEVO
      v_new_version := 1;
      INSERT INTO public.workday_records (
        cliente_id, empleado_id, schedule_assignment_id, workday_date,
        shift_id, scheduled_start, scheduled_end,
        first_punch, last_punch, total_work_minutes, effective_work_minutes,
        late_minutes, early_leave_minutes, total_break_minutes, overtime_minutes,
        workday_state, integrity_hash, source_log_ids, calculation_metadata,
        version, segments, punch_dispositions, incidents
      ) VALUES (
        v_cliente_id, v_empleado_id, v_assignment_id, v_workday_date,
        (p_record->>'shift_id')::UUID, (p_record->>'scheduled_start')::TIMESTAMPTZ, (p_record->>'scheduled_end')::TIMESTAMPTZ,
        (p_record->>'first_punch')::TIMESTAMPTZ, (p_record->>'last_punch')::TIMESTAMPTZ,
        (p_record->>'total_work_minutes')::INTEGER, (p_record->>'effective_work_minutes')::INTEGER,
        (p_record->>'late_minutes')::INTEGER, (p_record->>'early_leave_minutes')::INTEGER,
        (p_record->>'total_break_minutes')::INTEGER, (p_record->>'overtime_minutes')::INTEGER,
        p_record->>'workday_state', v_current_hash, COALESCE(p_record->'source_log_ids', '[]'::jsonb),
        COALESCE(p_record->'calculation_metadata', '{}'::jsonb),
        v_new_version, COALESCE(p_record->'segments', '[]'::jsonb),
        COALESCE(p_record->'punch_dispositions', '[]'::jsonb),
        COALESCE(p_record->'incidents', '[]'::jsonb)
      ) RETURNING id INTO v_record_id;

      INSERT INTO public.workday_record_history (
        workday_record_id, cliente_id, version, integrity_hash, reason,
        changed_by, snapshot, event_metadata
      ) VALUES (
        v_record_id, v_cliente_id, v_new_version, v_current_hash,
        'INITIAL_CALCULATION', NULL, v_canonical_snapshot,
        jsonb_build_object('source', 'backend_reprocess', 'logs_evaluated', v_log_count)
      );

      v_result_status := 'CREATED';
    ELSIF v_existing_hash = v_current_hash THEN
      v_result_status := 'UNCHANGED';
      v_new_version := v_existing_version;
    ELSE
      -- UPDATE NUEVA VERSIÓN
      v_new_version := v_existing_version + 1;

      UPDATE public.workday_records SET
        shift_id = (p_record->>'shift_id')::UUID,
        scheduled_start = (p_record->>'scheduled_start')::TIMESTAMPTZ,
        scheduled_end = (p_record->>'scheduled_end')::TIMESTAMPTZ,
        first_punch = (p_record->>'first_punch')::TIMESTAMPTZ,
        last_punch = (p_record->>'last_punch')::TIMESTAMPTZ,
        total_work_minutes = (p_record->>'total_work_minutes')::INTEGER,
        effective_work_minutes = (p_record->>'effective_work_minutes')::INTEGER,
        late_minutes = (p_record->>'late_minutes')::INTEGER,
        early_leave_minutes = (p_record->>'early_leave_minutes')::INTEGER,
        total_break_minutes = (p_record->>'total_break_minutes')::INTEGER,
        overtime_minutes = (p_record->>'overtime_minutes')::INTEGER,
        workday_state = p_record->>'workday_state',
        integrity_hash = v_current_hash,
        source_log_ids = COALESCE(p_record->'source_log_ids', '[]'::jsonb),
        calculation_metadata = COALESCE(p_record->'calculation_metadata', '{}'::jsonb),
        version = v_new_version,
        segments = COALESCE(p_record->'segments', '[]'::jsonb),
        punch_dispositions = COALESCE(p_record->'punch_dispositions', '[]'::jsonb),
        incidents = COALESCE(p_record->'incidents', '[]'::jsonb),
        updated_at = NOW()
      WHERE id = v_record_id;

      INSERT INTO public.workday_record_history (
        workday_record_id, cliente_id, version, integrity_hash, reason,
        changed_by, snapshot, event_metadata
      ) VALUES (
        v_record_id, v_cliente_id, v_new_version, v_current_hash,
        'RECALCULATION_INPUTS_CHANGED', NULL, v_canonical_snapshot,
        jsonb_build_object('source', 'backend_reprocess', 'logs_evaluated', v_log_count, 'prev_version', v_existing_version)
      );

      v_result_status := 'UPDATED_VERSION';
    END IF;

    RETURN jsonb_build_object(
      'status', v_result_status,
      'workday_record_id', v_record_id,
      'version', v_new_version,
      'integrity_hash', v_current_hash
    );
END;
$$;

-- ── 10. POLÍTICAS RLS AISLADAS Y ACTUALIZADAS (SIN TABLA dispositivos) ────────

-- A) TABLA public.devices
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devices: SELECT propio" ON public.devices;
CREATE POLICY "devices: SELECT propio"
  ON public.devices FOR SELECT TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "devices: INSERT propio" ON public.devices;
CREATE POLICY "devices: INSERT propio"
  ON public.devices FOR INSERT TO authenticated
  WITH CHECK (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "devices: UPDATE propio" ON public.devices;
CREATE POLICY "devices: UPDATE propio"
  ON public.devices FOR UPDATE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()))
  WITH CHECK (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "devices: DELETE propio" ON public.devices;
CREATE POLICY "devices: DELETE propio"
  ON public.devices FOR DELETE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

-- B) TABLA public.device_employee_assignments (ELIMINANDO JOIN CON dispositivos)
ALTER TABLE public.device_employee_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_employee_assignments: SELECT propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: SELECT propio"
  ON public.device_employee_assignments FOR SELECT TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "device_employee_assignments: INSERT propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: INSERT propio"
  ON public.device_employee_assignments FOR INSERT TO authenticated
  WITH CHECK (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.empleados e 
       WHERE e.id = employee_id AND e.cliente_id = device_employee_assignments.cliente_id
    )
    AND EXISTS (
      SELECT 1 FROM public.devices d 
       WHERE d.id = device_id AND d.cliente_id = device_employee_assignments.cliente_id
    )
  );

DROP POLICY IF EXISTS "device_employee_assignments: UPDATE propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: UPDATE propio"
  ON public.device_employee_assignments FOR UPDATE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.empleados e 
       WHERE e.id = employee_id AND e.cliente_id = device_employee_assignments.cliente_id
    )
    AND EXISTS (
      SELECT 1 FROM public.devices d 
       WHERE d.id = device_id AND d.cliente_id = device_employee_assignments.cliente_id
    )
  );

DROP POLICY IF EXISTS "device_employee_assignments: DELETE propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: DELETE propio"
  ON public.device_employee_assignments FOR DELETE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

-- C) TABLA public.device_commands
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_commands: SELECT propio" ON public.device_commands;
CREATE POLICY "device_commands: SELECT propio"
  ON public.device_commands FOR SELECT TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "device_commands: INSERT propio" ON public.device_commands;
CREATE POLICY "device_commands: INSERT propio"
  ON public.device_commands FOR INSERT TO authenticated
  WITH CHECK (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "device_commands: UPDATE propio" ON public.device_commands;
CREATE POLICY "device_commands: UPDATE propio"
  ON public.device_commands FOR UPDATE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()))
  WITH CHECK (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "device_commands: DELETE propio" ON public.device_commands;
CREATE POLICY "device_commands: DELETE propio"
  ON public.device_commands FOR DELETE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

-- D) TABLA public.biometric_templates
ALTER TABLE public.biometric_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "biometric_templates: SELECT propio" ON public.biometric_templates;
CREATE POLICY "biometric_templates: SELECT propio"
  ON public.biometric_templates FOR SELECT TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "biometric_templates: INSERT propio" ON public.biometric_templates;
CREATE POLICY "biometric_templates: INSERT propio"
  ON public.biometric_templates FOR INSERT TO authenticated
  WITH CHECK (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    AND (
      device_id IS NULL 
      OR EXISTS (
        SELECT 1 FROM public.devices d 
         WHERE d.id = device_id AND d.cliente_id = biometric_templates.cliente_id
      )
    )
  );

DROP POLICY IF EXISTS "biometric_templates: UPDATE propio" ON public.biometric_templates;
CREATE POLICY "biometric_templates: UPDATE propio"
  ON public.biometric_templates FOR UPDATE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()))
  WITH CHECK (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    AND (
      device_id IS NULL 
      OR EXISTS (
        SELECT 1 FROM public.devices d 
         WHERE d.id = device_id AND d.cliente_id = biometric_templates.cliente_id
      )
    )
  );

DROP POLICY IF EXISTS "biometric_templates: DELETE propio" ON public.biometric_templates;
CREATE POLICY "biometric_templates: DELETE propio"
  ON public.biometric_templates FOR DELETE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));
