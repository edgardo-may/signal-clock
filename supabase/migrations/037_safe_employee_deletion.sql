-- ──────────────────────────────────────────────────────────────
-- MIGRATION: 037_safe_employee_deletion
-- DESCRIPCIÓN: Implementa la validación segura de eliminación
-- de empleados. Previene el borrado en cascada accidental
-- de incidencias y horarios futuros.
-- ──────────────────────────────────────────────────────────────

-- 1. Función RPC para evaluación estructurada de dependencias
CREATE OR REPLACE FUNCTION public.fn_delete_employee_safe(p_empleado_id UUID, p_simulate BOOLEAN DEFAULT false)
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
    -- 1. Verificar existencia del empleado
    SELECT cliente_id INTO v_cliente_id 
    FROM public.empleados 
    WHERE id = p_empleado_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'EMPLOYEE_NOT_FOUND');
    END IF;

    -- Validar que el usuario logueado pertenezca a la empresa o sea superadmin
    -- (Security Invoker de por sí restringe por RLS, pero para evitar inconsistencias)
    IF auth.uid() IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.usuarios_perfiles 
            WHERE id = auth.uid() 
            AND (cliente_id = v_cliente_id OR rol IN ('superadmin', 'auditor'))
        ) THEN
            RETURN jsonb_build_object('status', 'UNAUTHORIZED');
        END IF;
    END IF;

    -- 2. Verificar turnos activos/futuros
    SELECT count(*) INTO v_has_active_shifts 
    FROM public.empleados_horarios 
    WHERE empleado_id = p_empleado_id 
      AND activo = true 
      AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE);

    IF v_has_active_shifts > 0 THEN
        RETURN jsonb_build_object(
            'status', 'HAS_ACTIVE_SHIFTS', 
            'count', v_has_active_shifts
        );
    END IF;

    -- 3. Verificar asistencias históricas y checadas
    SELECT count(*) INTO v_has_attendance 
    FROM public.registro_asistencia 
    WHERE empleado_id = p_empleado_id;

    -- 4. Verificar incidencias
    SELECT count(*) INTO v_has_incidents 
    FROM public.incidencias 
    WHERE empleado_id = p_empleado_id;

    -- 4.b Verificar asignaciones biométricas
    SELECT count(*) INTO v_has_devices
    FROM public.device_employee_assignments
    WHERE employee_id = p_empleado_id;

    IF v_has_attendance > 0 OR v_has_incidents > 0 OR v_has_devices > 0 THEN
        RETURN jsonb_build_object(
            'status', 'HAS_HISTORY', 
            'attendance_count', v_has_attendance, 
            'incidents_count', v_has_incidents,
            'devices_count', v_has_devices
        );
    END IF;

    -- 5. Eliminación física o simulación (sin historial importante)
    -- Los triggers de Supabase (CASCADE) se encargarán de limpiar huellas y asignaciones menores.
    IF NOT p_simulate THEN
        DELETE FROM public.empleados WHERE id = p_empleado_id;
    END IF;
    
    RETURN jsonb_build_object('status', 'SUCCESS');
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message', SQLERRM
        );
END;
$$;

-- 2. Añadir Trigger defensivo en PostgreSQL para evitar DELETE directos
CREATE OR REPLACE FUNCTION public.trg_prevent_employee_deletion_with_history()
RETURNS TRIGGER AS $$
DECLARE
    v_has_attendance INT;
    v_has_incidents INT;
BEGIN
    SELECT count(*) INTO v_has_attendance FROM public.registro_asistencia WHERE empleado_id = OLD.id;
    SELECT count(*) INTO v_has_incidents FROM public.incidencias WHERE empleado_id = OLD.id;
    
    IF v_has_attendance > 0 OR v_has_incidents > 0 THEN
        RAISE EXCEPTION 'No se puede borrar este empleado (%). Contiene % asistencias y % incidencias. Utiliza baja logica (activo=false).', OLD.id, v_has_attendance, v_has_incidents;
    END IF;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_employee_deletion ON public.empleados;
CREATE TRIGGER trigger_prevent_employee_deletion
BEFORE DELETE ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_employee_deletion_with_history();
