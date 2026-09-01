-- ================================================================
-- SIGNUM-CLOCK · Migración 040
-- Fix: Alinear trigger proc_sync_employee_assignment con el esquema de device_commands (Migración 029)
-- ================================================================

CREATE OR REPLACE FUNCTION public.proc_sync_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  var_serial TEXT;
  var_nombre TEXT;
  var_tarjeta TEXT;
  var_cmd TEXT;
  var_cmd_id UUID;
BEGIN
  -- 1. Obtener el número de serie del biométrico
  SELECT serial_number INTO var_serial FROM public.devices WHERE id = NEW.device_id;
  
  -- 2. Obtener datos del colaborador
  SELECT (COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')), tarjeta 
    INTO var_nombre, var_tarjeta 
    FROM public.empleados 
   WHERE id = NEW.employee_id;

  -- 3. Construir el comando según el estado activo
  IF NEW.activo = TRUE THEN
    var_cmd := 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || 
               E'\tName=' || NULLIF(TRIM(var_nombre), '') || 
               E'\tPri=0' || 
               CASE WHEN var_tarjeta IS NOT NULL AND var_tarjeta <> '' THEN E'\tCardNo=' || var_tarjeta ELSE '' END;
  ELSE
    var_cmd := 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id;
  END IF;

  -- 4. DEDUPLICACIÓN
  DELETE FROM public.device_commands
   WHERE numero_serie = var_serial
     AND cliente_id = NEW.cliente_id
     AND is_executed = FALSE
     AND (command_string LIKE 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || '%'
          OR command_string LIKE 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id || '%');

  -- 5. Insertar el nuevo comando en la cola
  var_cmd_id := gen_random_uuid();
  INSERT INTO public.device_commands (id, cliente_id, numero_serie, command_string, is_executed)
  VALUES (var_cmd_id, NEW.cliente_id, var_serial, var_cmd, FALSE);

  -- 6. Reiniciar estados de sincronización
  NEW.sync_status := 'PENDING';
  NEW.last_error := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
