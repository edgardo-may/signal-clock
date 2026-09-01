-- ================================================================
--  SIGNUM-CLOCK · RLS Empleados — Script de activación completo
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  Idempotente: usa DROP IF EXISTS antes de cada CREATE POLICY
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- PASO 1: Función helper auth_cliente_id()
--   Lee el cliente_id del JWT del usuario autenticado.
--   Busca primero en app_metadata (recomendado para producción)
--   y como fallback en user_metadata.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_cliente_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::UUID,
    (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::UUID
  );
$$;

-- Permisos de ejecución
GRANT EXECUTE ON FUNCTION public.auth_cliente_id() TO authenticated, service_role;


-- ──────────────────────────────────────────────────────────────
-- PASO 2: Habilitar RLS en la tabla empleados
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;

-- Forzar RLS incluso para el rol propietario de la tabla
ALTER TABLE public.empleados FORCE ROW LEVEL SECURITY;


-- ──────────────────────────────────────────────────────────────
-- PASO 3: Limpiar políticas anteriores (idempotente)
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "empleados: SELECT"  ON public.empleados;
DROP POLICY IF EXISTS "empleados: INSERT"  ON public.empleados;
DROP POLICY IF EXISTS "empleados: UPDATE"  ON public.empleados;
DROP POLICY IF EXISTS "empleados: DELETE"  ON public.empleados;


-- ──────────────────────────────────────────────────────────────
-- PASO 4: Crear políticas RLS multi-tenant
--
--   Aislamiento garantizado: cada política filtra por
--   cliente_id = auth_cliente_id() extraído del JWT.
--   Un usuario autenticado SOLO puede ver/modificar los
--   empleados de su propio tenant, sin importar qué UUID
--   intente consultar.
-- ──────────────────────────────────────────────────────────────

-- SELECT: solo empleados del mismo cliente
CREATE POLICY "empleados: SELECT"
  ON public.empleados
  FOR SELECT
  TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- INSERT: solo permite insertar en el propio cliente
--   WITH CHECK impide inyectar un cliente_id ajeno
CREATE POLICY "empleados: INSERT"
  ON public.empleados
  FOR INSERT
  TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());

-- UPDATE: USING valida la fila existente, WITH CHECK valida el nuevo valor
--   Impide tanto leer filas ajenas como mover un empleado a otro cliente
CREATE POLICY "empleados: UPDATE"
  ON public.empleados
  FOR UPDATE
  TO authenticated
  USING  (cliente_id = public.auth_cliente_id())
  WITH CHECK (cliente_id = public.auth_cliente_id());

-- DELETE: solo puede borrar empleados de su propio cliente
CREATE POLICY "empleados: DELETE"
  ON public.empleados
  FOR DELETE
  TO authenticated
  USING (cliente_id = public.auth_cliente_id());

-- service_role tiene acceso total sin restricciones RLS
-- (no requiere políticas explícitas; FORCE RLS no aplica a service_role)


-- ──────────────────────────────────────────────────────────────
-- PASO 5: Verificar que los GRANTs de la tabla estén activos
-- ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empleados TO authenticated;
GRANT ALL                             ON public.empleados TO service_role;


-- ──────────────────────────────────────────────────────────────
-- VERIFICACIÓN — ejecuta esto en una segunda consulta para
-- confirmar que las políticas quedaron activas:
--
--   SELECT schemaname, tablename, policyname, cmd, roles, qual
--     FROM pg_policies
--    WHERE tablename = 'empleados'
--    ORDER BY cmd;
-- ──────────────────────────────────────────────────────────────
