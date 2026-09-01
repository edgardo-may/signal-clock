-- ================================================================
--  SIGNUM-CLOCK · Migración 012 · Checadas y Marcajes Manuales
--  Permite registrar incidencias, olvidos de checada y comisiones
-- ================================================================

-- 1. Permitir que dispositivo_id sea NULL en checadas manuales
ALTER TABLE public.asistencias ALTER COLUMN dispositivo_id DROP NOT NULL;

-- 2. Modificar constraint de metodo para aceptar 'manual' y 'web'
ALTER TABLE public.asistencias DROP CONSTRAINT IF EXISTS asistencias_metodo_check;
ALTER TABLE public.asistencias ADD CONSTRAINT asistencias_metodo_check 
  CHECK (metodo IN ('rostro', 'huella', 'tarjeta', 'pin', 'combinado', 'manual', 'web'));

-- 3. Agregar columnas para trazabilidad de checadas manuales
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asistencias' AND column_name='es_manual') THEN
    ALTER TABLE public.asistencias ADD COLUMN es_manual BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asistencias' AND column_name='motivo_manual') THEN
    ALTER TABLE public.asistencias ADD COLUMN motivo_manual TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asistencias' AND column_name='autorizado_por') THEN
    ALTER TABLE public.asistencias ADD COLUMN autorizado_por TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asistencias' AND column_name='notas') THEN
    ALTER TABLE public.asistencias ADD COLUMN notas TEXT;
  END IF;
END;
$$;

-- 4. Habilitar UPDATE y DELETE para checadas en RLS
DROP POLICY IF EXISTS "asistencias: UPDATE" ON public.asistencias;
DROP POLICY IF EXISTS "asistencias: DELETE" ON public.asistencias;

CREATE POLICY "asistencias: UPDATE" ON public.asistencias FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id())
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "asistencias: DELETE" ON public.asistencias FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- 5. Índices de optimización para checadas manuales
CREATE INDEX IF NOT EXISTS idx_asistencias_es_manual ON public.asistencias(cliente_id, es_manual);
CREATE INDEX IF NOT EXISTS idx_asistencias_motivo ON public.asistencias(cliente_id, motivo_manual);
