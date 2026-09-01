-- ================================================================
--  SIGNUM-CLOCK · Migración 010 · Módulo de Horarios y Asignación
--  Crea: public.horarios y public.empleados_horarios con RLS Multi-Tenant
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- 1. TABLA: public.horarios (Catálogo de Turnos y Jornadas)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.horarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  descripcion         TEXT,
  tolerancia_minutos  INTEGER NOT NULL DEFAULT 10,
  color               TEXT NOT NULL DEFAULT '#4f46e5',
  dias_config         JSONB NOT NULL DEFAULT '{
    "lun": {"activo": true,  "entrada": "08:00", "salida": "17:00", "descanso_inicio": "13:00", "descanso_fin": "14:00"},
    "mar": {"activo": true,  "entrada": "08:00", "salida": "17:00", "descanso_inicio": "13:00", "descanso_fin": "14:00"},
    "mie": {"activo": true,  "entrada": "08:00", "salida": "17:00", "descanso_inicio": "13:00", "descanso_fin": "14:00"},
    "jue": {"activo": true,  "entrada": "08:00", "salida": "17:00", "descanso_inicio": "13:00", "descanso_fin": "14:00"},
    "vie": {"activo": true,  "entrada": "08:00", "salida": "17:00", "descanso_inicio": "13:00", "descanso_fin": "14:00"},
    "sab": {"activo": false, "entrada": "08:00", "salida": "13:00", "descanso_inicio": "",      "descanso_fin": ""},
    "dom": {"activo": false, "entrada": "",      "salida": "",      "descanso_inicio": "",      "descanso_fin": ""}
  }'::jsonb,
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- 2. TABLA: public.empleados_horarios (Agenda / Asignación de Turnos)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empleados_horarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  empleado_id         UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
  horario_id          UUID NOT NULL REFERENCES public.horarios(id) ON DELETE CASCADE,
  fecha_inicio        DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin           DATE, -- NULL = horario permanente / indefinido
  activo              BOOLEAN NOT NULL DEFAULT true,
  notas               TEXT,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para optimizar consultas de asignación
CREATE INDEX IF NOT EXISTS idx_horarios_cliente ON public.horarios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_empleados_horarios_cliente ON public.empleados_horarios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_empleados_horarios_empleado ON public.empleados_horarios(empleado_id);
CREATE INDEX IF NOT EXISTS idx_empleados_horarios_horario ON public.empleados_horarios(horario_id);

-- ──────────────────────────────────────────────────────────────
-- 3. POLÍTICAS RLS MULTI-TENANT
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.horarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empleados_horarios ENABLE ROW LEVEL SECURITY;

-- Limpieza idempotente
DROP POLICY IF EXISTS "horarios: SELECT" ON public.horarios;
DROP POLICY IF EXISTS "horarios: INSERT" ON public.horarios;
DROP POLICY IF EXISTS "horarios: UPDATE" ON public.horarios;
DROP POLICY IF EXISTS "horarios: DELETE" ON public.horarios;

DROP POLICY IF EXISTS "empleados_horarios: SELECT" ON public.empleados_horarios;
DROP POLICY IF EXISTS "empleados_horarios: INSERT" ON public.empleados_horarios;
DROP POLICY IF EXISTS "empleados_horarios: UPDATE" ON public.empleados_horarios;
DROP POLICY IF EXISTS "empleados_horarios: DELETE" ON public.empleados_horarios;

-- RLS public.horarios
CREATE POLICY "horarios: SELECT" ON public.horarios FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());

CREATE POLICY "horarios: INSERT" ON public.horarios FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "horarios: UPDATE" ON public.horarios FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id())
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "horarios: DELETE" ON public.horarios FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- RLS public.empleados_horarios
CREATE POLICY "empleados_horarios: SELECT" ON public.empleados_horarios FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());

CREATE POLICY "empleados_horarios: INSERT" ON public.empleados_horarios FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "empleados_horarios: UPDATE" ON public.empleados_horarios FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id())
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "empleados_horarios: DELETE" ON public.empleados_horarios FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- Permisos de acceso
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empleados_horarios TO authenticated;
GRANT ALL ON public.horarios TO service_role;
GRANT ALL ON public.empleados_horarios TO service_role;
