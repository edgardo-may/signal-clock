-- ================================================================
--  SIGNUM-CLOCK · Migración 008 · Nuevos campos para Empleados
--  Agrega: fecha_ingreso, sexo, tarjeta y fecha_cumpleanos
--  Idempotente: usa DO $$ con IF NOT EXISTS
-- ================================================================

DO $$
BEGIN
  -- fecha_ingreso (fecha de contratación / ingreso laboral)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'fecha_ingreso'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN fecha_ingreso DATE;
  END IF;

  -- sexo (género: M, F, Otro)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'sexo'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN sexo TEXT DEFAULT 'M';
  END IF;

  -- tarjeta (identificador de tarjeta RFID / Mifare / NFC para terminal Hikvision)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'tarjeta'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN tarjeta TEXT;
  END IF;

  -- fecha_cumpleanos (fecha de nacimiento / cumpleaños del colaborador)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'fecha_cumpleanos'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN fecha_cumpleanos DATE;
  END IF;
END;
$$;

COMMENT ON COLUMN public.empleados.fecha_ingreso    IS 'Fecha de ingreso / inicio de labores en la empresa.';
COMMENT ON COLUMN public.empleados.sexo             IS 'Género / Sexo del colaborador (M, F, Otro).';
COMMENT ON COLUMN public.empleados.tarjeta          IS 'Número de tarjeta RFID / Mifare asignada en la terminal Hikvision.';
COMMENT ON COLUMN public.empleados.fecha_cumpleanos IS 'Fecha de nacimiento / cumpleaños del empleado.';
