-- ================================================================
--  SIGNUM-CLOCK · Migración 001 · Esquema Inicial
--  Arquitectura: Multi-tenant · DB única · Aislamiento lógico RLS
--  Plataforma: Supabase (PostgreSQL 15+)
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- 0. EXTENSIONES
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────────────────────────────
-- 1. FUNCIÓN AUXILIAR: trigger updated_at
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_at = NOW();
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2. TABLA: clientes (tenants)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_empresa   TEXT        NOT NULL,
  plan             TEXT        NOT NULL DEFAULT 'free'
                     CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- 3. TABLA: empleados
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empleados (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id              UUID    NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  hikvision_device_userid TEXT    NOT NULL,
  nombre                  TEXT    NOT NULL,
  apellido                TEXT    NOT NULL,
  avatar_url              TEXT,
  activo                  BOOLEAN NOT NULL DEFAULT TRUE,
  creado_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_empleado_hik_cliente UNIQUE (cliente_id, hikvision_device_userid)
);

CREATE OR REPLACE TRIGGER trg_empleados_updated_at
  BEFORE UPDATE ON public.empleados
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_empleados_cliente       ON public.empleados (cliente_id);
CREATE INDEX IF NOT EXISTS idx_empleados_cliente_activo ON public.empleados (cliente_id, activo);
CREATE INDEX IF NOT EXISTS idx_empleados_cliente_hik    ON public.empleados (cliente_id, hikvision_device_userid);

-- ──────────────────────────────────────────────────────────────
-- 4. TABLA: dispositivos
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dispositivos (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID    NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  device_id_hikvision TEXT    NOT NULL,
  nombre_ubicacion    TEXT    NOT NULL,
  estatus             TEXT    NOT NULL DEFAULT 'activo'
                        CHECK (estatus IN ('activo', 'inactivo', 'mantenimiento')),
  ip_local            INET,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_dispositivo_hik_cliente UNIQUE (cliente_id, device_id_hikvision)
);

CREATE OR REPLACE TRIGGER trg_dispositivos_updated_at
  BEFORE UPDATE ON public.dispositivos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_dispositivos_cliente        ON public.dispositivos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_dispositivos_cliente_estatus ON public.dispositivos (cliente_id, estatus);
CREATE INDEX IF NOT EXISTS idx_dispositivos_cliente_hik     ON public.dispositivos (cliente_id, device_id_hikvision);

-- ──────────────────────────────────────────────────────────────
-- 5. TABLA: asistencias
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asistencias (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        UUID        NOT NULL REFERENCES public.clientes(id)      ON DELETE CASCADE,
  empleado_id       UUID        NOT NULL REFERENCES public.empleados(id)     ON DELETE RESTRICT,
  dispositivo_id    UUID        NOT NULL REFERENCES public.dispositivos(id)  ON DELETE RESTRICT,
  verificado_at     TIMESTAMPTZ NOT NULL,
  tipo_verificacion TEXT        NOT NULL DEFAULT 'entrada'
                      CHECK (tipo_verificacion IN ('entrada','salida','descanso_inicio','descanso_fin','extra')),
  metodo            TEXT        NOT NULL DEFAULT 'rostro'
                      CHECK (metodo IN ('rostro','huella','tarjeta','pin','combinado')),
  raw_payload       JSONB,
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de optimización temporal + por tenant
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente              ON public.asistencias (cliente_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_ts           ON public.asistencias (cliente_id, verificado_at DESC);
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_empleado     ON public.asistencias (cliente_id, empleado_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_emp_ts       ON public.asistencias (cliente_id, empleado_id, verificado_at DESC);
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_dispositivo  ON public.asistencias (cliente_id, dispositivo_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_ts_brin              ON public.asistencias USING BRIN (verificado_at);

-- ──────────────────────────────────────────────────────────────
-- 6. FUNCIÓN RLS: leer cliente_id desde el JWT
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_cliente_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::UUID,
    (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::UUID
  );
$$;

-- ──────────────────────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────

-- clientes
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clientes: SELECT propio" ON public.clientes FOR SELECT TO authenticated
  USING (id = public.auth_cliente_id());
CREATE POLICY "clientes: INSERT service" ON public.clientes FOR INSERT TO service_role
  WITH CHECK (TRUE);
CREATE POLICY "clientes: UPDATE propio"  ON public.clientes FOR UPDATE TO authenticated
  USING (id = public.auth_cliente_id()) WITH CHECK (id = public.auth_cliente_id());

-- empleados
ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empleados: SELECT" ON public.empleados FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());
CREATE POLICY "empleados: INSERT" ON public.empleados FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());
CREATE POLICY "empleados: UPDATE" ON public.empleados FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id()) WITH CHECK (cliente_id = public.auth_cliente_id());
CREATE POLICY "empleados: DELETE" ON public.empleados FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- dispositivos
ALTER TABLE public.dispositivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispositivos: SELECT" ON public.dispositivos FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());
CREATE POLICY "dispositivos: INSERT" ON public.dispositivos FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());
CREATE POLICY "dispositivos: UPDATE" ON public.dispositivos FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id()) WITH CHECK (cliente_id = public.auth_cliente_id());
CREATE POLICY "dispositivos: DELETE" ON public.dispositivos FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- asistencias
ALTER TABLE public.asistencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asistencias: SELECT" ON public.asistencias FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());
CREATE POLICY "asistencias: INSERT" ON public.asistencias FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());
-- UPDATE/DELETE bloqueados para authenticated (registros inmutables)

-- ──────────────────────────────────────────────────────────────
-- 8. SUPABASE REALTIME (tabla asistencias)
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END;
$$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.asistencias;

-- ──────────────────────────────────────────────────────────────
-- 9. GRANTS
-- ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empleados    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispositivos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asistencias  TO authenticated;
GRANT ALL ON public.clientes, public.empleados, public.dispositivos, public.asistencias TO service_role;
