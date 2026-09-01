-- ================================================================
--  SIGNUM-CLOCK · Migración 011 · Módulo de Días Festivos y Asuetos
--  Crea: public.dias_festivos con RLS Multi-Tenant y Festivos LFT
-- ================================================================

CREATE TABLE IF NOT EXISTS public.dias_festivos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  fecha               DATE NOT NULL,
  tipo                TEXT NOT NULL DEFAULT 'oficial', -- 'oficial', 'empresa', 'bancario'
  remuneracion_extra  BOOLEAN NOT NULL DEFAULT true,   -- Considerar festivo trabajado si checa
  aplica_departamento TEXT,                            -- NULL = aplica a todos los colaboradores
  color               TEXT NOT NULL DEFAULT '#ec4899', -- Color distintivo para el calendario
  descripcion         TEXT,
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta rápida por fecha y tenant
CREATE INDEX IF NOT EXISTS idx_dias_festivos_cliente ON public.dias_festivos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_dias_festivos_fecha ON public.dias_festivos(fecha);
CREATE UNIQUE INDEX IF NOT EXISTS uq_festivo_cliente_fecha ON public.dias_festivos(cliente_id, fecha);

-- RLS Multi-Tenant
ALTER TABLE public.dias_festivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dias_festivos: SELECT" ON public.dias_festivos;
DROP POLICY IF EXISTS "dias_festivos: INSERT" ON public.dias_festivos;
DROP POLICY IF EXISTS "dias_festivos: UPDATE" ON public.dias_festivos;
DROP POLICY IF EXISTS "dias_festivos: DELETE" ON public.dias_festivos;

CREATE POLICY "dias_festivos: SELECT" ON public.dias_festivos FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());

CREATE POLICY "dias_festivos: INSERT" ON public.dias_festivos FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "dias_festivos: UPDATE" ON public.dias_festivos FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id())
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "dias_festivos: DELETE" ON public.dias_festivos FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dias_festivos TO authenticated;
GRANT ALL ON public.dias_festivos TO service_role;
