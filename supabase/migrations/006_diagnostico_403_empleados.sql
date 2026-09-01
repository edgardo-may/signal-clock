-- ================================================================
--  SIGNUM-CLOCK · Diagnóstico y corrección 403 en empleados
--  EJECUTAR EN: Supabase Dashboard → SQL Editor (como postgres/service_role)
--
--  INSTRUCCIONES:
--    1. Ejecuta el BLOQUE A para ver el estado actual.
--    2. Con los UUIDs obtenidos, ejecuta el BLOQUE B.
--    3. El usuario debe cerrar sesión y volver a entrar.
-- ================================================================


-- ══════════════════════════════════════════════════════════════
-- BLOQUE A · DIAGNÓSTICO — ejecuta esto primero
-- ══════════════════════════════════════════════════════════════

-- A1: Ver todos los usuarios y su app_metadata actual
SELECT
  id                                                    AS user_id,
  email,
  raw_app_meta_data  -> 'cliente_id'                    AS cliente_id_en_app_meta,
  raw_user_meta_data -> 'cliente_id'                    AS cliente_id_en_user_meta,
  raw_app_meta_data                                     AS app_metadata_completo,
  created_at
FROM auth.users
ORDER BY created_at DESC;

-- A2: Ver todos los clientes disponibles
-- SELECT id, nombre_empresa, plan FROM public.clientes ORDER BY creado_at;

-- A3: Ver si existe el perfil en usuarios_perfiles
-- SELECT * FROM public.usuarios_perfiles;


-- ══════════════════════════════════════════════════════════════
-- BLOQUE B · CORRECCIÓN — reemplaza los UUIDs con valores reales
-- ══════════════════════════════════════════════════════════════

-- OPCIÓN 1 (Recomendada): Crear el cliente si no existe, luego asignar
-- --------------------------------------------------------------------
-- PASO B1: Crear un cliente de prueba (omitir si ya tienes uno)
/*
INSERT INTO public.clientes (nombre_empresa, plan)
VALUES ('Mi Empresa S.A.', 'starter')
RETURNING id, nombre_empresa;
*/

-- PASO B2: Fijar cliente_id en app_metadata del usuario afectado
--          Reemplaza '<USER_UUID>' y '<CLIENTE_UUID>' con los valores reales
/*
UPDATE auth.users
   SET raw_app_meta_data =
         COALESCE(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('cliente_id', '<CLIENTE_UUID>')
 WHERE id = '<USER_UUID>'
RETURNING id, email, raw_app_meta_data;
*/

-- PASO B3: Crear el perfil en usuarios_perfiles para que el fallback funcione
/*
INSERT INTO public.usuarios_perfiles (id, cliente_id, nombre, rol, estatus_cuenta)
VALUES (
  '<USER_UUID>',
  '<CLIENTE_UUID>',
  'Administrador',
  'admin',
  'activo'
)
ON CONFLICT (id) DO UPDATE
  SET cliente_id = EXCLUDED.cliente_id;
*/


-- ══════════════════════════════════════════════════════════════
-- BLOQUE C · VERIFICACIÓN — ejecuta después de aplicar el fix
-- ══════════════════════════════════════════════════════════════
/*
-- Verificar que el usuario tiene el claim correcto
SELECT
  id,
  email,
  raw_app_meta_data -> 'cliente_id' AS cliente_id_asignado
FROM auth.users
WHERE raw_app_meta_data -> 'cliente_id' IS NOT NULL;

-- Verificar el perfil
SELECT id, cliente_id, nombre, rol, estatus_cuenta
FROM public.usuarios_perfiles;

-- Probar la función auth_cliente_id() como el usuario (requiere su JWT)
-- SELECT public.auth_cliente_id();
*/
