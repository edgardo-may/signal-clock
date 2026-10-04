-- Canonical ZKTeco ADMS command producer.
-- device_employee_assignments is the sole producer of employee sync commands.

CREATE OR REPLACE FUNCTION public.proc_sync_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  var_serial TEXT;
  var_nombre TEXT;
  var_cmd TEXT;
BEGIN
  -- Resolve the ZKTeco serial only from the tenant-owned device.
  SELECT UPPER(TRIM(serial_number))
    INTO var_serial
    FROM public.devices
   WHERE id = NEW.device_id
     AND cliente_id = NEW.cliente_id;

  IF var_serial IS NULL THEN
    RAISE EXCEPTION 'Dispositivo % no encontrado para tenant % en public.devices', NEW.device_id, NEW.cliente_id;
  END IF;

  SELECT TRIM(COALESCE(nombre, '') || ' ' || COALESCE(apellido, ''))
    INTO var_nombre
    FROM public.empleados
   WHERE id = NEW.employee_id
     AND cliente_id = NEW.cliente_id;

  IF var_nombre IS NULL THEN
    RAISE EXCEPTION 'Empleado % no encontrado para tenant % en public.empleados', NEW.employee_id, NEW.cliente_id;
  END IF;

  IF NEW.activo = TRUE THEN
    -- Confirmed by terminal SYZ8243400788. Keep this payload minimal.
    var_cmd :=
      'DATA UPDATE USERINFO PIN=' || NEW.biometric_user_id ||
      E'\tName=' || COALESCE(NULLIF(TRIM(var_nombre), ''), 'User') ||
      E'\tPrivilege=0';
  ELSE
    -- DELETE wire syntax is intentionally unchanged pending physical validation.
    var_cmd := 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id;
  END IF;

  -- Remove only pending employee-sync commands for this device and exact PIN.
  -- The transition recognizes legacy and canonical UPDATE formats, plus the
  -- previously issued DATA USER form. DELETE remains in its legacy form.
  DELETE FROM public.device_commands
   WHERE device_serial = var_serial
     AND is_executed = FALSE
     AND (
       substring(command_string FROM '^DATA UPDATE USERINFO [Pp][Ii][Nn]=([^[:space:]]+)') = NEW.biometric_user_id
       OR substring(command_string FROM '^DATA USER [Pp][Ii][Nn]=([^[:space:]]+)') = NEW.biometric_user_id
       OR substring(command_string FROM '^DATA DELETE USERINFO [Pp][Ii][Nn]=([^[:space:]]+)') = NEW.biometric_user_id
     );

  INSERT INTO public.device_commands (
    id,
    device_serial,
    command_string,
    is_executed
  ) VALUES (
    gen_random_uuid(),
    var_serial,
    var_cmd,
    FALSE
  );

  NEW.sync_status := 'PENDING';
  NEW.last_error := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
