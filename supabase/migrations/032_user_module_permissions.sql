-- ============================================================================
-- SIGNUM-CLOCK · Migración 032
-- Excepciones de acceso por usuario y módulo.
-- El rol conserva el acceso predeterminado; esta tabla solo almacena cambios
-- explícitos realizados desde Central o por el admin del tenant.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_module_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.usuarios_perfiles(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN (
    'dashboard',
    'employees',
    'schedules',
    'attendance',
    'attendance_manage',
    'reports',
    'biometrics',
    'users',
    'synchronization',
    'permissions'
  )),
  allowed BOOLEAN NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_module_permission UNIQUE (user_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_user_module_permissions_user
  ON public.user_module_permissions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_module_permissions_tenant
  ON public.user_module_permissions (cliente_id);

DROP TRIGGER IF EXISTS trg_user_module_permissions_updated_at ON public.user_module_permissions;
CREATE TRIGGER trg_user_module_permissions_updated_at
  BEFORE UPDATE ON public.user_module_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

-- Asegura que el usuario seleccionado pertenece al mismo tenant indicado en la
-- fila; impide que un admin local asigne permisos a usuarios de otra empresa.
CREATE OR REPLACE FUNCTION public.auth_permission_target_is_valid(
  target_user_id UUID,
  target_cliente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios_perfiles
    WHERE id = target_user_id
      AND cliente_id = target_cliente_id
  );
$$;

CREATE POLICY "user_module_permissions: SELECT"
  ON public.user_module_permissions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_superadmin()
    OR (
      public.auth_is_tenant_admin()
      AND cliente_id = public.auth_current_cliente_id()
    )
  );

CREATE POLICY "user_module_permissions: INSERT"
  ON public.user_module_permissions FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_permission_target_is_valid(user_id, cliente_id)
    AND (
      public.auth_is_superadmin()
      OR (
        public.auth_is_tenant_admin()
        AND cliente_id = public.auth_current_cliente_id()
      )
    )
  );

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
      )
    )
  );

CREATE POLICY "user_module_permissions: DELETE"
  ON public.user_module_permissions FOR DELETE TO authenticated
  USING (
    public.auth_is_superadmin()
    OR (
      public.auth_is_tenant_admin()
      AND cliente_id = public.auth_current_cliente_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_module_permissions TO authenticated;
GRANT ALL ON public.user_module_permissions TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_permission_target_is_valid(UUID, UUID) TO authenticated, service_role;
