-- ============================================================================
-- SIGNUM-CLOCK · Migración 035
-- Tabla cliente_modulos: módulos habilitados por tenant desde Central.
--
-- Jerarquía de permisos final:
--   Central habilita módulo → Tenant (cliente_modulos)
--   Admin asigna módulo     → Usuario (user_module_permissions)
--   Permiso efectivo        → cliente_modulos.habilitado AND user_module_permissions.allowed
--
-- SEGURIDAD:
--   - Solo superadmin puede gestionar cliente_modulos.
--   - Las políticas de user_module_permissions INSERT/UPDATE
--     ahora validan que el módulo esté habilitado para el tenant.
--   - Un admin de tenant no puede asignar módulos no contratados aunque
--     manipule directamente el request (RLS lo bloquea en DB).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- 1. TABLA: cliente_modulos
--    Almacena qué módulos tiene habilitados cada empresa desde Central.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cliente_modulos (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID        NOT NULL REFERENCES public.clientes(id)     ON DELETE CASCADE,
  module_key     TEXT        NOT NULL REFERENCES public.module_catalog(module_key)
                               ON UPDATE CASCADE ON DELETE RESTRICT,
  habilitado     BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cliente_modulo UNIQUE (cliente_id, module_key)
);

-- Trigger para actualizado_at
DROP TRIGGER IF EXISTS trg_cliente_modulos_updated_at ON public.cliente_modulos;
CREATE TRIGGER trg_cliente_modulos_updated_at
  BEFORE UPDATE ON public.cliente_modulos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_cliente_modulos_cliente
  ON public.cliente_modulos (cliente_id);

CREATE INDEX IF NOT EXISTS idx_cliente_modulos_habilitado
  ON public.cliente_modulos (cliente_id, habilitado);

CREATE INDEX IF NOT EXISTS idx_cliente_modulos_key
  ON public.cliente_modulos (module_key);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. DATOS INICIALES
--    Pre-poblar todos los módulos activos para todos los tenants existentes.
--    Garantiza que el acceso actual no se interrumpa.
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.cliente_modulos (cliente_id, module_key, habilitado)
SELECT
  c.id         AS cliente_id,
  m.module_key AS module_key,
  TRUE         AS habilitado
FROM
  public.clientes       c
  CROSS JOIN public.module_catalog m
WHERE
  m.active = TRUE
ON CONFLICT (cliente_id, module_key) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cliente_modulos ENABLE ROW LEVEL SECURITY;

-- SELECT: superadmin ve todo, tenant ve solo sus propios módulos habilitados
CREATE POLICY "cliente_modulos: SELECT"
  ON public.cliente_modulos FOR SELECT TO authenticated
  USING (
    public.auth_is_superadmin()
    OR cliente_id = public.auth_current_cliente_id()
  );

-- INSERT: exclusivo de superadmin
CREATE POLICY "cliente_modulos: INSERT superadmin"
  ON public.cliente_modulos FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_superadmin());

-- UPDATE: exclusivo de superadmin
CREATE POLICY "cliente_modulos: UPDATE superadmin"
  ON public.cliente_modulos FOR UPDATE TO authenticated
  USING  (public.auth_is_superadmin())
  WITH CHECK (public.auth_is_superadmin());

-- DELETE: exclusivo de superadmin
CREATE POLICY "cliente_modulos: DELETE superadmin"
  ON public.cliente_modulos FOR DELETE TO authenticated
  USING (public.auth_is_superadmin());

-- ──────────────────────────────────────────────────────────────────────────
-- 4. FUNCIÓN HELPER: auth_tenant_has_module
--    Verifica si un tenant tiene un módulo habilitado desde Central.
--    SECURITY DEFINER: no puede ser bloqueado por RLS al verificarse.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_tenant_has_module(
  p_cliente_id UUID,
  p_module_key TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cliente_modulos
    WHERE cliente_id = p_cliente_id
      AND module_key = p_module_key
      AND habilitado = TRUE
  );
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. ACTUALIZAR POLÍTICAS de user_module_permissions
--    INSERT y UPDATE ahora validan que el módulo esté habilitado para el
--    tenant, excepto para superadmin que siempre puede operar globalmente.
-- ──────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_module_permissions: INSERT" ON public.user_module_permissions;
CREATE POLICY "user_module_permissions: INSERT"
  ON public.user_module_permissions FOR INSERT TO authenticated
  WITH CHECK (
    -- El usuario objetivo debe pertenecer al tenant indicado en la fila
    public.auth_permission_target_is_valid(user_id, cliente_id)
    AND (
      -- superadmin: sin restricción de tenant ni de módulo habilitado
      public.auth_is_superadmin()
      OR (
        -- admin de tenant: solo su tenant, solo módulos habilitados
        public.auth_is_tenant_admin()
        AND cliente_id = public.auth_current_cliente_id()
        AND public.auth_tenant_has_module(cliente_id, module_key)
      )
    )
  );

DROP POLICY IF EXISTS "user_module_permissions: UPDATE" ON public.user_module_permissions;
CREATE POLICY "user_module_permissions: UPDATE"
  ON public.user_module_permissions FOR UPDATE TO authenticated
  USING (
    public.auth_is_superadmin()
    OR (
      public.auth_is_tenant_admin()
      AND cliente_id = public.auth_current_cliente_id()
    )
  )
  WITH CHECK (
    public.auth_permission_target_is_valid(user_id, cliente_id)
    AND (
      public.auth_is_superadmin()
      OR (
        public.auth_is_tenant_admin()
        AND cliente_id = public.auth_current_cliente_id()
        AND public.auth_tenant_has_module(cliente_id, module_key)
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 6. TRIGGER: limpiar user_module_permissions cuando se deshabilita un módulo
--    Cuando Central deshabilita un módulo del tenant, los permisos de usuario
--    previos quedan obsoletos. Se borran automáticamente para consistencia.
--    (Caso G del spec de pruebas)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cleanup_permissions_on_module_disable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo actuar cuando se deshabilita un módulo (habilitado: true → false)
  IF OLD.habilitado = TRUE AND NEW.habilitado = FALSE THEN
    DELETE FROM public.user_module_permissions
    WHERE  cliente_id = NEW.cliente_id
      AND  module_key = NEW.module_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_on_module_disable ON public.cliente_modulos;
CREATE TRIGGER trg_cleanup_on_module_disable
  AFTER UPDATE OF habilitado ON public.cliente_modulos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cleanup_permissions_on_module_disable();

-- ──────────────────────────────────────────────────────────────────────────
-- 7. REALTIME para cliente_modulos
--    Permite que la Vista Cliente reciba actualizaciones de módulos en tiempo
--    real cuando Central habilita o deshabilita un módulo para su empresa.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname   = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = 'cliente_modulos'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cliente_modulos';
    END IF;
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. GRANTS
-- ──────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_modulos TO authenticated;
GRANT ALL ON public.cliente_modulos TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_tenant_has_module(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cleanup_permissions_on_module_disable() TO service_role;
