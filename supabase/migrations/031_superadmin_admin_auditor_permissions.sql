-- ============================================================================
-- SIGNUM-CLOCK · Migración 031
-- Roles terminados en esta fase: superadmin, admin y auditor.
--
-- La interfaz solo guía al usuario. Estas políticas son la fuente de verdad:
--   superadmin: operaciones globales
--   admin:      gestión completa de su propio tenant
--   auditor:    consulta de su tenant, sin mutaciones
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auth_current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(rol)
  FROM public.usuarios_perfiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_current_cliente_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cliente_id
  FROM public.usuarios_perfiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Mantiene compatibilidad con las políticas antiguas, pero deja de confiar en
-- user_metadata, que un usuario autenticado puede modificar por sí mismo.
CREATE OR REPLACE FUNCTION public.auth_cliente_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_current_cliente_id();
$$;

CREATE OR REPLACE FUNCTION public.auth_cuenta_activa()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios_perfiles
    WHERE id = auth.uid()
      AND estatus_cuenta = 'activo'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_current_role() = 'superadmin'
     AND public.auth_cuenta_activa();
$$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_current_role() = 'admin'
     AND public.auth_current_cliente_id() IS NOT NULL
     AND public.auth_cuenta_activa();
$$;

CREATE OR REPLACE FUNCTION public.auth_can_read_tenant(target_cliente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_is_superadmin()
      OR (
        public.auth_cuenta_activa()
        AND target_cliente_id = public.auth_current_cliente_id()
      );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_write_tenant(target_cliente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_is_superadmin()
      OR (
        public.auth_cuenta_activa()
        AND public.auth_current_role() <> 'auditor'
        AND target_cliente_id = public.auth_current_cliente_id()
      );
$$;

-- Todas las tablas operativas que tienen cliente_id comparten el mismo
-- aislamiento de tenant. Los roles existentes conservan su comportamiento
-- actual; esta fase solo limita expresamente al rol auditor.
DO $$
DECLARE
  target_table TEXT;
  target_policy TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'empleados',
    'dispositivos',
    'asistencias',
    'registro_asistencia',
    'attendance_logs',
    'biometric_templates',
    'device_commands',
    'device_employee_assignments',
    'horarios',
    'empleados_horarios',
    'dias_festivos',
    'incidencias',
    'periodos_nomina'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = target_table
          AND column_name = 'cliente_id'
      )
    THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

      FOR target_policy IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = target_table
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target_policy, target_table);
      END LOOP;

      EXECUTE format(
        'CREATE POLICY role_read ON public.%I FOR SELECT TO authenticated USING (public.auth_can_read_tenant(cliente_id))',
        target_table
      );
      EXECUTE format(
        'CREATE POLICY role_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.auth_can_write_tenant(cliente_id))',
        target_table
      );
      EXECUTE format(
        'CREATE POLICY role_update ON public.%I FOR UPDATE TO authenticated USING (public.auth_can_write_tenant(cliente_id)) WITH CHECK (public.auth_can_write_tenant(cliente_id))',
        target_table
      );
      EXECUTE format(
        'CREATE POLICY role_delete ON public.%I FOR DELETE TO authenticated USING (public.auth_can_write_tenant(cliente_id))',
        target_table
      );
    END IF;
  END LOOP;
END
$$;

-- Los clientes se pueden consultar dentro de su tenant, pero solo Central puede
-- alterar datos de plataforma (planes, límites y estado de suscripción).
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clientes: SELECT propio" ON public.clientes;
DROP POLICY IF EXISTS "clientes: INSERT service" ON public.clientes;
DROP POLICY IF EXISTS "clientes: UPDATE propio" ON public.clientes;

CREATE POLICY "clientes: SELECT rol"
  ON public.clientes FOR SELECT TO authenticated
  USING (id = public.auth_current_cliente_id() OR public.auth_is_superadmin());

CREATE POLICY "clientes: INSERT superadmin"
  ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_superadmin());

CREATE POLICY "clientes: UPDATE superadmin"
  ON public.clientes FOR UPDATE TO authenticated
  USING (public.auth_is_superadmin())
  WITH CHECK (public.auth_is_superadmin());

CREATE POLICY "clientes: DELETE superadmin"
  ON public.clientes FOR DELETE TO authenticated
  USING (public.auth_is_superadmin());

-- Usuarios: un admin de tenant puede gestionar únicamente cuentas de su
-- empresa, pero jamás conceder superadmin. La creación sigue pasando por la
-- Edge Function, que usa service_role internamente.
ALTER TABLE public.usuarios_perfiles ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  target_policy TEXT;
BEGIN
  FOR target_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'usuarios_perfiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.usuarios_perfiles', target_policy);
  END LOOP;
END
$$;

CREATE POLICY "perfiles: SELECT rol"
  ON public.usuarios_perfiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_is_superadmin()
    OR (
      cliente_id = public.auth_current_cliente_id()
      AND public.auth_cuenta_activa()
    )
  );

CREATE POLICY "perfiles: UPDATE admin o superadmin"
  ON public.usuarios_perfiles FOR UPDATE TO authenticated
  USING (
    public.auth_is_superadmin()
    OR (
      public.auth_is_tenant_admin()
      AND cliente_id = public.auth_current_cliente_id()
      AND lower(rol) <> 'superadmin'
    )
  )
  WITH CHECK (
    public.auth_is_superadmin()
    OR (
      public.auth_is_tenant_admin()
      AND cliente_id = public.auth_current_cliente_id()
      AND lower(rol) <> 'superadmin'
    )
  );

CREATE POLICY "perfiles: INSERT service"
  ON public.usuarios_perfiles FOR INSERT TO service_role
  WITH CHECK (TRUE);

CREATE POLICY "perfiles: DELETE service"
  ON public.usuarios_perfiles FOR DELETE TO service_role
  USING (TRUE);

GRANT EXECUTE ON FUNCTION public.auth_current_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_current_cliente_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_cliente_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_superadmin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_tenant_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_can_read_tenant(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_can_write_tenant(UUID) TO authenticated, service_role;
