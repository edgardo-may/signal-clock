-- ================================================================
--  SIGNUM-CLOCK · Migración 003 · Columnas extendidas: Empleados
--  Agrega departamento, puesto y email a la tabla empleados.
--  Idempotente: usa IF NOT EXISTS / DO $$ para cada columna.
-- ================================================================

DO $$
BEGIN
  -- departamento
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'departamento'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN departamento TEXT;
  END IF;

  -- puesto
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'puesto'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN puesto TEXT;
  END IF;

  -- email (opcional, distinto del auth email)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'email'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN email TEXT;
  END IF;
END;
$$;

COMMENT ON COLUMN public.empleados.departamento IS 'Área o departamento al que pertenece el empleado.';
COMMENT ON COLUMN public.empleados.puesto       IS 'Cargo o puesto de trabajo del empleado.';
COMMENT ON COLUMN public.empleados.email        IS 'Correo de contacto del empleado (no el de Auth).';
