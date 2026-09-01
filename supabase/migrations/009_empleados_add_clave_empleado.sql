-- ================================================================
--  SIGNUM-CLOCK · Migración 009 · Campo clave_empleado (Datos Laborales)
--  Separa la Clave de Colaborador corporativa del Device UserID del hardware
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'clave_empleado'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN clave_empleado TEXT;
  END IF;
END;
$$;

COMMENT ON COLUMN public.empleados.clave_empleado IS 'Clave interna / código de empleado corporativo en datos laborales.';
