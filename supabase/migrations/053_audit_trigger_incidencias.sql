-- ================================================================
-- SIGNUM-CLOCK · Migración 053
-- Audit Triggers para Incidencias
--
-- Registra automáticamente en public.audit_logs cualquier evento de:
-- 1. Creación / Asignación de Incidencia (INCIDENCE_CREATED)
-- 2. Modificación de Incidencia (INCIDENCE_UPDATED)
-- 3. Eliminación de Incidencia (INCIDENCE_DELETED)
-- Capturando actor, rol, colaborador afectado, tipo de incidencia,
-- periodo (fechas), estado y notas.
-- ================================================================

CREATE OR REPLACE FUNCTION public.trg_audit_incidencias()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_empleado_nombre TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT (nombre || ' ' || COALESCE(apellido, '')) INTO v_empleado_nombre
    FROM public.empleados WHERE id = NEW.empleado_id;

    PERFORM public.log_audit_event(
      NEW.cliente_id,
      'INCIDENCE_CREATED',
      'Incidencia',
      NEW.id::TEXT,
      'SUCCESS',
      jsonb_build_object(
        'empleado_id', NEW.empleado_id,
        'empleado_nombre', COALESCE(trim(v_empleado_nombre), 'Colaborador'),
        'tipo_incidencia', NEW.tipo_incidencia,
        'fecha_inicio', NEW.fecha_inicio,
        'fecha_fin', NEW.fecha_fin,
        'estado', NEW.estado,
        'descripcion', NEW.descripcion
      )
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT (nombre || ' ' || COALESCE(apellido, '')) INTO v_empleado_nombre
    FROM public.empleados WHERE id = NEW.empleado_id;

    PERFORM public.log_audit_event(
      NEW.cliente_id,
      'INCIDENCE_UPDATED',
      'Incidencia',
      NEW.id::TEXT,
      'SUCCESS',
      jsonb_build_object(
        'empleado_id', NEW.empleado_id,
        'empleado_nombre', COALESCE(trim(v_empleado_nombre), 'Colaborador'),
        'tipo_incidencia', NEW.tipo_incidencia,
        'fecha_inicio', NEW.fecha_inicio,
        'fecha_fin', NEW.fecha_fin,
        'estado', NEW.estado,
        'descripcion', NEW.descripcion,
        'changes', jsonb_build_object(
          'tipo_incidencia', CASE WHEN OLD.tipo_incidencia IS DISTINCT FROM NEW.tipo_incidencia THEN jsonb_build_object('before', OLD.tipo_incidencia, 'after', NEW.tipo_incidencia) ELSE NULL END,
          'estado', CASE WHEN OLD.estado IS DISTINCT FROM NEW.estado THEN jsonb_build_object('before', OLD.estado, 'after', NEW.estado) ELSE NULL END,
          'fecha_inicio', CASE WHEN OLD.fecha_inicio IS DISTINCT FROM NEW.fecha_inicio THEN jsonb_build_object('before', OLD.fecha_inicio, 'after', NEW.fecha_inicio) ELSE NULL END,
          'fecha_fin', CASE WHEN OLD.fecha_fin IS DISTINCT FROM NEW.fecha_fin THEN jsonb_build_object('before', OLD.fecha_fin, 'after', NEW.fecha_fin) ELSE NULL END
        )
      )
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT (nombre || ' ' || COALESCE(apellido, '')) INTO v_empleado_nombre
    FROM public.empleados WHERE id = OLD.empleado_id;

    PERFORM public.log_audit_event(
      OLD.cliente_id,
      'INCIDENCE_DELETED',
      'Incidencia',
      OLD.id::TEXT,
      'SUCCESS',
      jsonb_build_object(
        'empleado_id', OLD.empleado_id,
        'empleado_nombre', COALESCE(trim(v_empleado_nombre), 'Colaborador'),
        'tipo_incidencia', OLD.tipo_incidencia,
        'fecha_inicio', OLD.fecha_inicio,
        'fecha_fin', OLD.fecha_fin,
        'estado', OLD.estado
      )
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_incidencias_changes ON public.incidencias;
CREATE TRIGGER trg_audit_incidencias_changes
AFTER INSERT OR UPDATE OR DELETE ON public.incidencias
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_incidencias();
