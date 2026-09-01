-- ================================================================
--  SIGNUM-CLOCK · Migración 013 · PIN de Seguridad para Kiosco
--  Agrega columna 'pin' a public.empleados para autenticación en kiosco
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'pin'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN pin VARCHAR(10);
  END IF;
END;
$$;

COMMENT ON COLUMN public.empleados.pin IS 'PIN numérico de 4 a 6 dígitos para autenticación en el Kiosco Checador Web.';
