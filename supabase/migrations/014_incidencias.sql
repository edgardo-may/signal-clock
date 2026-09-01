-- 014_incidencias.sql
-- Creación de tabla para el módulo de Incidencias

CREATE TABLE IF NOT EXISTS public.incidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL,
  empleado_id UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
  tipo_incidencia VARCHAR(255) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  descripcion TEXT,
  estado VARCHAR(50) DEFAULT 'Pendiente', -- Pendiente, Aprobado, Rechazado
  autorizado_por UUID REFERENCES public.usuarios_perfiles(id) ON DELETE SET NULL,
  creado_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  actualizado_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_incidencias_cliente ON public.incidencias(cliente_id);
CREATE INDEX IF NOT EXISTS idx_incidencias_empleado ON public.incidencias(empleado_id);
CREATE INDEX IF NOT EXISTS idx_incidencias_estado ON public.incidencias(estado);

-- Trigger para updated_at
CREATE TRIGGER trg_incidencias_updated_at
  BEFORE UPDATE ON public.incidencias
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.incidencias ENABLE ROW LEVEL SECURITY;

-- Política de lectura: todos los del mismo cliente pueden leer
CREATE POLICY "Lectura de incidencias por cliente"
  ON public.incidencias
  FOR SELECT
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
  );

-- Política de inserción: todos los del mismo cliente pueden crear incidencias
CREATE POLICY "Inserción de incidencias por cliente"
  ON public.incidencias
  FOR INSERT
  WITH CHECK (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
  );

-- Política de actualización: solo admin o rh pueden autorizar/rechazar, o el creador puede editar si está pendiente
CREATE POLICY "Actualización de incidencias"
  ON public.incidencias
  FOR UPDATE
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
    AND (
      (SELECT rol FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1) IN ('admin', 'rh')
      OR
      estado = 'Pendiente'
    )
  );

-- Política de borrado: solo admin
CREATE POLICY "Borrado de incidencias"
  ON public.incidencias
  FOR DELETE
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
    AND (
      (SELECT rol FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1) = 'admin'
    )
  );
