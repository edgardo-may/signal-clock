-- ================================================================
-- SIGNUM-CLOCK · Migración 044
-- Operational Audit Triggers
-- ================================================================

-- 1. Función genérica para insertar logs
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_cliente_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_result TEXT,
  p_metadata JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_actor_role TEXT;
BEGIN
  -- Intentar obtener el actor desde auth.uid()
  v_actor_user_id := auth.uid();
  
  IF v_actor_user_id IS NOT NULL THEN
    -- En postgres, select current role from function
    SELECT lower(rol) INTO v_actor_role
    FROM public.usuarios_perfiles
    WHERE id = v_actor_user_id
    LIMIT 1;
  ELSE
    v_actor_role := 'system';
  END IF;

  INSERT INTO public.audit_logs (
    cliente_id, actor_user_id, actor_role, action, resource_type, resource_id, result, metadata
  ) VALUES (
    p_cliente_id, v_actor_user_id, v_actor_role, p_action, p_resource_type, p_resource_id, p_result, p_metadata
  );
END;
$$;

-- 2. Triggers para Horarios
CREATE OR REPLACE FUNCTION public.trg_audit_horarios()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.cliente_id,
      'SCHEDULE_CREATED',
      'Horario',
      NEW.id::TEXT,
      'SUCCESS',
      jsonb_build_object('horario_nombre', NEW.nombre)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.nombre IS DISTINCT FROM NEW.nombre OR OLD.tolerancia_minutos IS DISTINCT FROM NEW.tolerancia_minutos THEN
      PERFORM public.log_audit_event(
        NEW.cliente_id,
        'SCHEDULE_UPDATED',
        'Horario',
        NEW.id::TEXT,
        'SUCCESS',
        jsonb_build_object(
          'horario_nombre', NEW.nombre,
          'changes', jsonb_build_object(
            'nombre', CASE WHEN OLD.nombre IS DISTINCT FROM NEW.nombre THEN jsonb_build_object('before', OLD.nombre, 'after', NEW.nombre) ELSE NULL END,
            'tolerancia_minutos', CASE WHEN OLD.tolerancia_minutos IS DISTINCT FROM NEW.tolerancia_minutos THEN jsonb_build_object('before', OLD.tolerancia_minutos, 'after', NEW.tolerancia_minutos) ELSE NULL END
          )
        )
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit_event(
      OLD.cliente_id,
      'SCHEDULE_DELETED',
      'Horario',
      OLD.id::TEXT,
      'SUCCESS',
      jsonb_build_object('horario_nombre', OLD.nombre)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_horarios_changes ON public.horarios;
CREATE TRIGGER trg_audit_horarios_changes
AFTER INSERT OR UPDATE OR DELETE ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_horarios();

-- 3. Triggers para Asignaciones de Horarios
CREATE OR REPLACE FUNCTION public.trg_audit_empleados_horarios()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_horario_nombre TEXT;
  v_empleado_nombre TEXT;
  v_cliente_id UUID;
  v_horario_id UUID;
  v_empleado_id UUID;
  v_op TEXT;
  v_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_cliente_id := NEW.cliente_id;
    v_horario_id := NEW.horario_id;
    v_empleado_id := NEW.empleado_id;
    v_op := 'INSERT';
    v_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_cliente_id := OLD.cliente_id;
    v_horario_id := OLD.horario_id;
    v_empleado_id := OLD.empleado_id;
    v_op := 'DELETE';
    v_id := OLD.id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.activo = TRUE AND NEW.activo = FALSE THEN
      v_cliente_id := NEW.cliente_id;
      v_horario_id := NEW.horario_id;
      v_empleado_id := NEW.empleado_id;
      v_op := 'DELETE';
      v_id := NEW.id;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Resolver nombres para snapshot
  SELECT nombre INTO v_horario_nombre FROM public.horarios WHERE id = v_horario_id;
  SELECT (nombre || ' ' || apellido) INTO v_empleado_nombre FROM public.empleados WHERE id = v_empleado_id;

  IF v_op = 'INSERT' THEN
    PERFORM public.log_audit_event(
      v_cliente_id,
      'SCHEDULE_ASSIGNED',
      'Asignación Horario',
      v_id::TEXT,
      'SUCCESS',
      jsonb_build_object(
        'horario_id', v_horario_id,
        'horario_nombre', COALESCE(v_horario_nombre, 'Desconocido'),
        'empleado_id', v_empleado_id,
        'empleado_nombre', COALESCE(v_empleado_nombre, 'Desconocido')
      )
    );
  ELSIF v_op = 'DELETE' THEN
    PERFORM public.log_audit_event(
      v_cliente_id,
      'SCHEDULE_UNASSIGNED',
      'Asignación Horario',
      v_id::TEXT,
      'SUCCESS',
      jsonb_build_object(
        'horario_id', v_horario_id,
        'horario_nombre', COALESCE(v_horario_nombre, 'Desconocido'),
        'empleado_id', v_empleado_id,
        'empleado_nombre', COALESCE(v_empleado_nombre, 'Desconocido')
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_empleados_horarios_changes ON public.empleados_horarios;
CREATE TRIGGER trg_audit_empleados_horarios_changes
AFTER INSERT OR UPDATE OR DELETE ON public.empleados_horarios
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_empleados_horarios();

-- 4. Triggers para Empleados
CREATE OR REPLACE FUNCTION public.trg_audit_empleados()
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
    IF OLD.activo = TRUE AND NEW.activo = FALSE THEN
      PERFORM public.log_audit_event(
        NEW.cliente_id,
        'EMPLOYEE_DEACTIVATED',
        'Empleado',
        NEW.id::TEXT,
        'SUCCESS',
        jsonb_build_object('empleado_nombre', NEW.nombre || ' ' || NEW.apellido)
      );
    ELSIF OLD.activo = FALSE AND NEW.activo = TRUE THEN
      PERFORM public.log_audit_event(
        NEW.cliente_id,
        'EMPLOYEE_REACTIVATED',
        'Empleado',
        NEW.id::TEXT,
        'SUCCESS',
        jsonb_build_object('empleado_nombre', NEW.nombre || ' ' || NEW.apellido)
      );
    ELSIF OLD.nombre IS DISTINCT FROM NEW.nombre OR OLD.apellido IS DISTINCT FROM NEW.apellido OR OLD.hikvision_device_userid IS DISTINCT FROM NEW.hikvision_device_userid THEN
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
            'hikvision_device_userid', CASE WHEN OLD.hikvision_device_userid IS DISTINCT FROM NEW.hikvision_device_userid THEN jsonb_build_object('before', OLD.hikvision_device_userid, 'after', NEW.hikvision_device_userid) ELSE NULL END
          )
        )
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_empleados_changes ON public.empleados;
CREATE TRIGGER trg_audit_empleados_changes
AFTER INSERT OR UPDATE ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_empleados();
