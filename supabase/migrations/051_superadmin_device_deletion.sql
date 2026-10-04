-- ============================================================================
-- SIGNUM-CLOCK · Migración 051
-- Arquitectura SaaS: Control de Terminales Biométricas (ADMS)
-- 1. Solo SuperAdmin en Central puede ELIMINAR definitivamente (DELETE).
-- 2. Los Admins de empresa pueden ACTIVAR/DESACTIVAR su hardware (UPDATE).
-- 3. Las checadas históricas de los colaboradores quedan 100% preservadas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BLINDAJE DE POLÍTICAS RLS EN public.devices
-- ----------------------------------------------------------------------------
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- A) Eliminar cualquier política que antes permitiera DELETE a los clientes
DROP POLICY IF EXISTS "devices: DELETE propio" ON public.devices;
DROP POLICY IF EXISTS "devices_delete_superadmin" ON public.devices;

-- B) Exclusividad de DELETE: Únicamente SuperAdmin autenticado
CREATE POLICY "devices_delete_superadmin"
ON public.devices
FOR DELETE
TO authenticated
USING (
  public.auth_is_superadmin()
);

-- C) Asegurar que los Admins de empresa puedan ACTIVAR / DESACTIVAR (UPDATE) sus propios equipos
DROP POLICY IF EXISTS "devices: UPDATE propio" ON public.devices;
CREATE POLICY "devices: UPDATE propio"
ON public.devices
FOR UPDATE
TO authenticated
USING (
  public.auth_is_superadmin() 
  OR cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
)
WITH CHECK (
  public.auth_is_superadmin() 
  OR cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
);

-- ----------------------------------------------------------------------------
-- 2. FUNCIÓN RPC SEGURA PARA PURGADO DEFINITIVO DE TERMINALES (SUPERADMIN)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_delete_device_superadmin(p_device_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device RECORD;
  v_punches_count INT := 0;
  v_assignments_count INT := 0;
  v_commands_count INT := 0;
BEGIN
  -- A. Validar estrictamente rol SuperAdmin y cuenta activa
  IF NOT public.auth_is_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: Solo el usuario superadmin desde la consola Central puede eliminar dispositivos biométricos.';
  END IF;

  -- B. Verificar que el dispositivo existe
  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispositivo no encontrado (ID: %)', p_device_id;
  END IF;

  -- C. Contar y desacoplar checadas de registro_asistencia
  -- REGLA CRÍTICA: Las checadas, horas trabajadas e historial NO SE BORRAN.
  -- Se desvinculan del hardware (dispositivo_id = NULL) manteniendo íntegro el historial.
  SELECT COUNT(*) INTO v_punches_count
  FROM public.registro_asistencia
  WHERE dispositivo_id = p_device_id;

  IF v_punches_count > 0 THEN
    UPDATE public.registro_asistencia
    SET dispositivo_id = NULL
    WHERE dispositivo_id = p_device_id;
  END IF;

  -- D. Desvincular plantillas biométricas del hardware
  UPDATE public.biometric_templates
  SET device_id = NULL
  WHERE device_id = p_device_id;

  -- E. Contar y eliminar asignaciones de empleados al checador
  SELECT COUNT(*) INTO v_assignments_count
  FROM public.device_employee_assignments
  WHERE device_id = p_device_id;

  DELETE FROM public.device_employee_assignments
  WHERE device_id = p_device_id;

  -- F. Eliminar comandos en cola pendientes de este dispositivo
  DELETE FROM public.device_commands
  WHERE device_id = p_device_id
     OR numero_serie = v_device.serial_number
     OR device_serial = v_device.serial_number;
  GET DIAGNOSTICS v_commands_count = ROW_COUNT;

  -- G. Eliminar físicamente el dispositivo de public.devices (libera el serial)
  DELETE FROM public.devices
  WHERE id = p_device_id;

  -- H. Registrar evento de auditoría
  IF to_regprocedure('public.log_audit_event(text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public.log_audit_event(
      'DEVICE_DELETED_BY_SUPERADMIN',
      'devices',
      p_device_id::text,
      jsonb_build_object(
        'serial_number', v_device.serial_number,
        'name', v_device.name,
        'cliente_id', v_device.cliente_id,
        'punches_preserved', v_punches_count,
        'assignments_removed', v_assignments_count,
        'commands_cleared', v_commands_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', true,
    'device_id', p_device_id,
    'serial_number', v_device.serial_number,
    'punches_preserved', v_punches_count,
    'assignments_removed', v_assignments_count,
    'commands_cleared', v_commands_count
  );
END;
$$;

-- Permisos de ejecución
GRANT EXECUTE ON FUNCTION public.fn_delete_device_superadmin(UUID) TO authenticated, service_role;
