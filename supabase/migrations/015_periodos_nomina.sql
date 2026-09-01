-- 015_periodos_nomina.sql
-- Creación de tabla para configurar los periodos de nómina

CREATE TABLE IF NOT EXISTS public.periodos_nomina (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL,
  nombre VARCHAR(255) NOT NULL, -- ej. "1ra Quincena Enero 2026"
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(50) DEFAULT 'Abierto', -- Abierto, Cerrado
  creado_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  actualizado_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_periodos_nomina_cliente ON public.periodos_nomina(cliente_id);
CREATE INDEX IF NOT EXISTS idx_periodos_nomina_fechas ON public.periodos_nomina(fecha_inicio, fecha_fin);

-- Trigger para updated_at
CREATE TRIGGER trg_periodos_nomina_updated_at
  BEFORE UPDATE ON public.periodos_nomina
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.periodos_nomina ENABLE ROW LEVEL SECURITY;

-- Política de lectura: todos los del mismo cliente pueden leer
CREATE POLICY "Lectura de periodos por cliente"
  ON public.periodos_nomina
  FOR SELECT
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
  );

-- Política de modificación: solo admin o rh
CREATE POLICY "Modificacion de periodos de nomina"
  ON public.periodos_nomina
  FOR ALL
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
    AND (
      (SELECT rol FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1) IN ('admin', 'rh')
    )
  );
