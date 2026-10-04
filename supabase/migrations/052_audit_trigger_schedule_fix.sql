-- ================================================================
-- SIGNUM-CLOCK · Migración 052
-- Fix: Trigger de auditoría de horarios — detectar todos los cambios
--
-- Problema: El trigger trg_audit_horarios solo registraba cambios
-- en `nombre` y `tolerancia_minutos`. Cambios en `dias_config`
-- (entrada/salida), `color`, `descripcion` o `activo` no generaban
-- ningún evento de auditoría.
--
-- Solución: Ampliar la condición del trigger para capturar cualquier
-- cambio en los campos relevantes de la tabla horarios.
-- ================================================================

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
    -- Detectar cualquier cambio relevante (antes solo nombre y tolerancia)
    IF OLD.nombre               IS DISTINCT FROM NEW.nombre
    OR OLD.tolerancia_minutos   IS DISTINCT FROM NEW.tolerancia_minutos
    OR OLD.descripcion          IS DISTINCT FROM NEW.descripcion
    OR OLD.color                IS DISTINCT FROM NEW.color
    OR OLD.dias_config          IS DISTINCT FROM NEW.dias_config
    OR OLD.activo               IS DISTINCT FROM NEW.activo
    THEN
      PERFORM public.log_audit_event(
        NEW.cliente_id,
        'SCHEDULE_UPDATED',
        'Horario',
        NEW.id::TEXT,
        'SUCCESS',
        jsonb_build_object(
          'horario_nombre', NEW.nombre,
          'changes', jsonb_build_object(
            'nombre',             CASE WHEN OLD.nombre             IS DISTINCT FROM NEW.nombre             THEN jsonb_build_object('before', OLD.nombre,             'after', NEW.nombre)             ELSE NULL END,
            'tolerancia_minutos', CASE WHEN OLD.tolerancia_minutos IS DISTINCT FROM NEW.tolerancia_minutos THEN jsonb_build_object('before', OLD.tolerancia_minutos, 'after', NEW.tolerancia_minutos) ELSE NULL END,
            'descripcion',        CASE WHEN OLD.descripcion        IS DISTINCT FROM NEW.descripcion        THEN jsonb_build_object('before', OLD.descripcion,        'after', NEW.descripcion)        ELSE NULL END,
            'color',              CASE WHEN OLD.color              IS DISTINCT FROM NEW.color              THEN jsonb_build_object('before', OLD.color,              'after', NEW.color)              ELSE NULL END,
            'dias_config',        CASE WHEN OLD.dias_config        IS DISTINCT FROM NEW.dias_config        THEN jsonb_build_object('before', OLD.dias_config,        'after', NEW.dias_config)        ELSE NULL END,
            'activo',             CASE WHEN OLD.activo             IS DISTINCT FROM NEW.activo             THEN jsonb_build_object('before', OLD.activo,             'after', NEW.activo)             ELSE NULL END
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

-- Re-aplicar el trigger (ya existe, se recrea para tomar la función actualizada)
DROP TRIGGER IF EXISTS trg_audit_horarios_changes ON public.horarios;
CREATE TRIGGER trg_audit_horarios_changes
AFTER INSERT OR UPDATE OR DELETE ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_horarios();
