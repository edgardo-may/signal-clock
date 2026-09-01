-- ──────────────────────────────────────────────────────────────
-- MIGRATION: 038_employee_lifecycle_security
-- DESCRIPCIÓN: Implementa la gestión atómica del ciclo de vida
-- del empleado (Baja Lógica, Reactivación y Hard Delete), 
-- blindando la BD contra updates manuales y preservando
-- la identidad biométrica para futuros reingresos.
-- ──────────────────────────────────────────────────────────────

-- 0. Adición de columna para distinguir "Baja Laboral" vs "Desasignación Manual"
ALTER TABLE public.device_employee_assignments 
ADD COLUMN IF NOT EXISTS suspension_reason TEXT CHECK (
  suspension_reason IS NULL 
  OR suspension_reason IN ('EMPLOYEE_DEACTIVATED', 'MANUAL_UNASSIGN')
);

-- 0.5. Parche de seguridad para Trigger Biométrico (Deduplicación exacta por PIN)
CREATE OR REPLACE FUNCTION public.proc_sync_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  var_serial TEXT;
  var_cmd TEXT;
  var_cmd_id UUID;
  var_nombre TEXT;
  var_tarjeta TEXT;
BEGIN
  SELECT numero_serie INTO var_serial FROM public.dispositivos WHERE id = NEW.device_id;
  IF var_serial IS NULL THEN RETURN NEW; END IF;

  SELECT nombre || ' ' || apellido, tarjeta INTO var_nombre, var_tarjeta FROM public.empleados WHERE id = NEW.employee_id;

  IF NEW.activo = TRUE THEN
    var_cmd := 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || E'\tName=' || COALESCE(var_nombre, 'User') || E'\tPri=0' || CASE WHEN var_tarjeta IS NOT NULL AND var_tarjeta <> '' THEN E'\tCardNo=' || var_tarjeta ELSE '' END;
  ELSE
    var_cmd := 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id;
  END IF;

  -- 4. DEDUPLICACIÓN SEGURA: Tabulaciones y exactitud para evitar que Pin=12 afecte a Pin=123
  DELETE FROM public.device_commands
   WHERE device_serial = var_serial
     AND is_executed = FALSE
     AND (
       command_string LIKE 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || E'\t%'
       OR command_string = 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id
     );

  var_cmd_id := gen_random_uuid();
  INSERT INTO public.device_commands (id, device_serial, command_string, is_executed)
  VALUES (var_cmd_id, var_serial, var_cmd, FALSE);

  NEW.sync_status := 'PENDING';
  NEW.last_error := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 1. Trigger Defensivo para evitar baja lógica directa si hay turnos bloqueantes
CREATE OR REPLACE FUNCTION public.trg_prevent_employee_deactivation_with_shifts()
RETURNS TRIGGER AS $$
DECLARE
    v_has_active_shifts INT;
BEGIN
    -- Si el empleado está pasando de activo (true) a inactivo (false)
    IF OLD.activo = TRUE AND NEW.activo = FALSE THEN
        -- Verificar si tiene turnos vigentes o futuros
        SELECT count(*) INTO v_has_active_shifts 
        FROM public.empleados_horarios 
        WHERE empleado_id = NEW.id 
          AND activo = true 
          AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE);

        IF v_has_active_shifts > 0 THEN
            RAISE EXCEPTION 'No se puede dar de baja al empleado (%). Contiene % turnos activos o futuros. Finaliza los turnos primero.', NEW.id, v_has_active_shifts;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_employee_deactivation ON public.empleados;
CREATE TRIGGER trigger_prevent_employee_deactivation
BEFORE UPDATE OF activo ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_employee_deactivation_with_shifts();


-- 2. Función RPC atómica para gestionar todo el ciclo (incluyendo ACTIVATE)
CREATE OR REPLACE FUNCTION public.fn_employee_lifecycle(p_empleado_id UUID, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_cliente_id UUID;
    v_has_active_shifts INT;
    v_has_attendance INT;
    v_has_incidents INT;
    v_has_devices INT;
BEGIN
    -- Validar que la acción sea permitida
    IF p_action NOT IN ('CHECK', 'DEACTIVATE', 'DELETE', 'ACTIVATE') THEN
        RETURN jsonb_build_object('status', 'ERROR', 'message', 'Invalid action');
    END IF;

    -- 1. Verificar existencia del empleado
    SELECT cliente_id INTO v_cliente_id 
    FROM public.empleados 
    WHERE id = p_empleado_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'EMPLOYEE_NOT_FOUND');
    END IF;

    -- Validar que el usuario logueado pertenezca a la empresa o sea superadmin
    IF auth.uid() IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.usuarios_perfiles 
            WHERE id = auth.uid() 
            AND (cliente_id = v_cliente_id OR rol IN ('superadmin', 'auditor'))
        ) THEN
            RETURN jsonb_build_object('status', 'UNAUTHORIZED');
        END IF;
    END IF;

    -- Contadores comunes
    SELECT count(*) INTO v_has_active_shifts 
    FROM public.empleados_horarios 
    WHERE empleado_id = p_empleado_id 
      AND activo = true 
      AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE);

    SELECT count(*) INTO v_has_attendance 
    FROM public.registro_asistencia 
    WHERE empleado_id = p_empleado_id;

    SELECT count(*) INTO v_has_incidents 
    FROM public.incidencias 
    WHERE empleado_id = p_empleado_id;

    SELECT count(*) INTO v_has_devices
    FROM public.device_employee_assignments
    WHERE employee_id = p_empleado_id;

    -- ==========================================
    -- LOGICA DE DIAGNÓSTICO (CHECK)
    -- ==========================================
    IF p_action = 'CHECK' THEN
        IF v_has_active_shifts > 0 THEN
            RETURN jsonb_build_object('status', 'HAS_ACTIVE_SHIFTS', 'count', v_has_active_shifts);
        END IF;

        IF v_has_attendance > 0 OR v_has_incidents > 0 THEN
            RETURN jsonb_build_object(
                'status', 'CAN_DEACTIVATE', 
                'attendance_count', v_has_attendance, 
                'incidents_count', v_has_incidents,
                'devices_count', v_has_devices
            );
        END IF;

        IF v_has_devices > 0 THEN
            RETURN jsonb_build_object(
                'status', 'DEVICE_REMOVAL_REQUIRED', 
                'devices_count', v_has_devices
            );
        END IF;

        RETURN jsonb_build_object('status', 'CAN_DELETE');
    END IF;

    -- ==========================================
    -- LOGICA DE DEACTIVATE (Baja Laboral)
    -- ==========================================
    IF p_action = 'DEACTIVATE' THEN
        IF v_has_active_shifts > 0 THEN
            RETURN jsonb_build_object('status', 'ERROR', 'message', 'Cannot deactivate with active shifts');
        END IF;

        -- 1. Desactivar empleado (Dispara el trigger de turnos para confirmar seguridad)
        UPDATE public.empleados SET activo = false WHERE id = p_empleado_id;

        -- 2. Desactivar dispositivos marcando el "Motivo" para poder reactivarlos despues
        -- Solo apagamos los que estaban activos (para no pisar un apagado manual previo).
        UPDATE public.device_employee_assignments
        SET activo = false,
            sync_status = 'PENDING',
            suspension_reason = 'EMPLOYEE_DEACTIVATED',
            actualizado_at = NOW()
        WHERE employee_id = p_empleado_id AND activo = true;

        RETURN jsonb_build_object('status', 'SUCCESS');
    END IF;

    -- ==========================================
    -- LOGICA DE ACTIVATE (Reingreso)
    -- ==========================================
    IF p_action = 'ACTIVATE' THEN
        -- 1. Reactivar empleado (El PIN, UUID y templates nunca fueron borrados)
        UPDATE public.empleados SET activo = true WHERE id = p_empleado_id;

        -- 2. Reactivar SOLO los dispositivos que fueron suspendidos por culpa de la baja
        UPDATE public.device_employee_assignments
        SET activo = true,
            sync_status = 'PENDING',
            suspension_reason = NULL,
            actualizado_at = NOW()
        WHERE employee_id = p_empleado_id AND suspension_reason = 'EMPLOYEE_DEACTIVATED';

        RETURN jsonb_build_object('status', 'SUCCESS');
    END IF;

    -- ==========================================
    -- LOGICA DE DELETE (Borrado Físico)
    -- ==========================================
    IF p_action = 'DELETE' THEN
        IF v_has_attendance > 0 OR v_has_incidents > 0 THEN
            RETURN jsonb_build_object('status', 'ERROR', 'message', 'Cannot delete employee with historical records');
        END IF;
        IF v_has_devices > 0 THEN
            RETURN jsonb_build_object('status', 'ERROR', 'message', 'Cannot delete employee with active devices');
        END IF;

        DELETE FROM public.empleados WHERE id = p_empleado_id;
        RETURN jsonb_build_object('status', 'SUCCESS');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message', SQLERRM
        );
END;
$$;

NOTIFY pgrst, 'reload schema';
