-- ================================================================
--  SIGNUM-CLOCK · Migración 027 · Deshabilitar email de empleados
--  Conserva el campo de correo por si se usa en el futuro, pero
--  remueve restricciones para que pueda ser nulo sin problemas.
-- ================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'email'
  ) THEN
    -- En lugar de eliminar la columna, solo le quitamos la restricción NOT NULL
    ALTER TABLE public.empleados ALTER COLUMN email DROP NOT NULL;
  END IF;
END;
$$;
