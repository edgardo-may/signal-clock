-- ================================================================
--  SIGNUM-CLOCK · Migración 025 · apellido_paterno + apellido_materno
--
--  Agrega los apellidos separados a la tabla empleados.
--  El campo "apellido" existente se conserva tal cual (compatible).
--  
--  Idempotente: puede ejecutarse múltiples veces sin error.
-- ================================================================

DO $$
BEGIN
  -- 1. Agregar apellido_paterno
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'apellido_paterno'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN apellido_paterno TEXT;
    COMMENT ON COLUMN public.empleados.apellido_paterno
      IS 'Apellido paterno del colaborador (separado de apellido_materno).';
  END IF;

  -- 2. Agregar apellido_materno
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'apellido_materno'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN apellido_materno TEXT;
    COMMENT ON COLUMN public.empleados.apellido_materno
      IS 'Apellido materno del colaborador.';
  END IF;
END;
$$;
