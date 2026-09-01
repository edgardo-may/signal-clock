-- ================================================================
--  SIGNUM-CLOCK · Migración 028 · Autoincremento ID Biométrico
--  Asigna el ID Biométrico (hikvision_device_userid) de forma
--  secuencial por tenant si no se proporciona al insertar.
-- ================================================================

CREATE OR REPLACE FUNCTION public.fn_auto_assign_biometric_id()
RETURNS TRIGGER AS $$
DECLARE
  next_id INT;
BEGIN
  -- Si no viene el ID biométrico o viene vacío, lo calculamos
  IF NEW.hikvision_device_userid IS NULL OR NEW.hikvision_device_userid = '' THEN
    -- Buscamos el mayor valor numérico en el cliente actual
    SELECT COALESCE(MAX(NULLIF(regexp_replace(hikvision_device_userid, '\D', '', 'g'), '')::INT), 0) + 1
      INTO next_id
      FROM public.empleados
     WHERE cliente_id = NEW.cliente_id;
     
    NEW.hikvision_device_userid := next_id::TEXT;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Por si ya existía el trigger, lo borramos
DROP TRIGGER IF EXISTS trg_auto_assign_biometric_id ON public.empleados;

-- Creamos el trigger
CREATE TRIGGER trg_auto_assign_biometric_id
BEFORE INSERT ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_assign_biometric_id();
