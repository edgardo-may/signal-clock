-- ================================================================
-- SIGNUM-CLOCK · Migración 030
-- Añadir columna finger_key a biometric_templates
-- Permite identificar el dedo por clave textual estable
-- en lugar de solo el índice numérico ZKTeco.
-- ================================================================

-- Añadir columna finger_key si no existe
ALTER TABLE public.biometric_templates
  ADD COLUMN IF NOT EXISTS finger_key TEXT;

-- Poblar finger_key para registros existentes (retrocompatibilidad)
UPDATE public.biometric_templates
SET finger_key = CASE indice
  WHEN 0 THEN 'left_thumb'
  WHEN 1 THEN 'left_index'
  WHEN 2 THEN 'left_middle'
  WHEN 3 THEN 'left_ring'
  WHEN 4 THEN 'left_pinky'
  WHEN 5 THEN 'right_thumb'
  WHEN 6 THEN 'right_index'
  WHEN 7 THEN 'right_middle'
  WHEN 8 THEN 'right_ring'
  WHEN 9 THEN 'right_pinky'
  ELSE NULL
END
WHERE tipo = 'huella' AND finger_key IS NULL;

-- Índice para búsquedas por empleado y finger_key
CREATE INDEX IF NOT EXISTS idx_biometric_templates_finger
  ON public.biometric_templates (empleado_id, tipo, finger_key);

-- Habilitar RLS si no estaba (tabla ya tiene RLS según migración 029)
-- Solo agregar política para templates de huella si falta
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'biometric_templates'
    AND policyname = 'biometric_templates: SELECT propio'
  ) THEN
    CREATE POLICY "biometric_templates: SELECT propio"
      ON public.biometric_templates FOR SELECT TO authenticated
      USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

    CREATE POLICY "biometric_templates: INSERT propio"
      ON public.biometric_templates FOR INSERT TO authenticated
      WITH CHECK (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

    CREATE POLICY "biometric_templates: UPDATE propio"
      ON public.biometric_templates FOR UPDATE TO authenticated
      USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

    CREATE POLICY "biometric_templates: DELETE propio"
      ON public.biometric_templates FOR DELETE TO authenticated
      USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));
  END IF;
END
$$;
