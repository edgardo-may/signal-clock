-- ================================================================
--  SIGNUM-CLOCK · Migración · Todas las columnas de sincronización
--
--  Agrega de forma segura (idempotente) todas las columnas que
--  necesita el módulo de sincronización con Consolide.
--
--  Ejecuta este script en el SQL Editor de Supabase.
--  Es seguro ejecutarlo múltiples veces sin error.
-- ================================================================

DO $$
BEGIN

  -- apellido_paterno
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'apellido_paterno'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN apellido_paterno TEXT;
  END IF;

  -- apellido_materno
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'apellido_materno'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN apellido_materno TEXT;
  END IF;

  -- curp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'curp'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN curp TEXT;
  END IF;

  -- rfc
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'rfc'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN rfc TEXT;
  END IF;

END;
$$;
