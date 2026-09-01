-- ================================================================
--  SIGNUM-CLOCK · Fix RLS — cliente_id no llega en el JWT
--  Problema:  auth_cliente_id() retorna NULL → INSERT bloqueado
--  Solución:  Función mejorada con fallback a usuarios_perfiles
--             + diagnóstico del JWT actual
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- DIAGNÓSTICO: ejecuta esto primero para ver qué hay en el JWT
-- (necesitas estar autenticado como el usuario afectado)
-- ──────────────────────────────────────────────────────────────
/*
SELECT
  auth.uid()                                          AS uid,
  auth.jwt() -> 'app_metadata'  ->> 'cliente_id'     AS cliente_id_app_meta,
  auth.jwt() -> 'user_metadata' ->> 'cliente_id'     AS cliente_id_user_meta,
  auth.jwt() -> 'app_metadata'                        AS app_metadata_completo,
  auth.jwt() -> 'user_metadata'                       AS user_metadata_completo;
*/

-- ──────────────────────────────────────────────────────────────
-- PASO 1: Función auth_cliente_id() mejorada con triple fallback
--
--  Orden de búsqueda:
--    1. app_metadata.cliente_id   (set por Admin/service_role — más seguro)
--    2. user_metadata.cliente_id  (set al crear el usuario)
--    3. usuarios_perfiles          (fallback DB si el JWT no tiene el claim)
--
--  El fallback a DB cubre el caso donde el claim aún no llegó
--  al JWT (p.ej. recién seteado, token no refrescado, o usuario
--  creado sin metadatos).
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_cliente_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1º: app_metadata (fuente más confiable, seteada por admin)
    (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::UUID,
    -- 2º: user_metadata (seteada al crear el usuario)
    (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::UUID,
    -- 3º: fallback directo a la tabla de perfiles
    (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid() LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_cliente_id() TO authenticated, service_role;


-- ──────────────────────────────────────────────────────────────
-- PASO 2: Re-aplicar políticas RLS con la función corregida
--         (idempotente: DROP IF EXISTS primero)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empleados: SELECT" ON public.empleados;
DROP POLICY IF EXISTS "empleados: INSERT" ON public.empleados;
DROP POLICY IF EXISTS "empleados: UPDATE" ON public.empleados;
DROP POLICY IF EXISTS "empleados: DELETE" ON public.empleados;

CREATE POLICY "empleados: SELECT"
  ON public.empleados FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id());

CREATE POLICY "empleados: INSERT"
  ON public.empleados FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "empleados: UPDATE"
  ON public.empleados FOR UPDATE TO authenticated
  USING  (cliente_id = public.auth_cliente_id())
  WITH CHECK (cliente_id = public.auth_cliente_id());

CREATE POLICY "empleados: DELETE"
  ON public.empleados FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empleados TO authenticated;
GRANT ALL ON public.empleados TO service_role;


-- ──────────────────────────────────────────────────────────────
-- PASO 3 (OPCIONAL): Fijar el claim en app_metadata del usuario
--
--  Si quieres que el claim viaje en el JWT (evitar el fallback a DB
--  en cada request), ejecuta esto desde la consola de Supabase
--  o vía service_role, reemplazando los UUIDs reales:
--
--  UPDATE auth.users
--     SET raw_app_meta_data = raw_app_meta_data || '{"cliente_id":"<UUID_DEL_CLIENTE>"}'::jsonb
--   WHERE id = '<UUID_DEL_USUARIO>';
--
--  Después el usuario debe cerrar sesión y volver a entrar
--  para que el nuevo JWT incluya el claim actualizado.
-- ──────────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────────
-- VERIFICACIÓN FINAL
-- ──────────────────────────────────────────────────────────────
/*
-- 1. Ver políticas activas
SELECT policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE tablename = 'empleados'
 ORDER BY cmd;

-- 2. Probar la función (ejecutar autenticado como el usuario afectado)
SELECT public.auth_cliente_id() AS cliente_id_resuelto;
*/
