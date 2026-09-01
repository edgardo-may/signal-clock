-- ================================================================
--  SIGNUM-CLOCK · Fix tenant para: edgardomay@outlook.com
--  Usuario: b2448c3b-385b-4fb8-baa1-7a35f919681f
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  Orden: ejecuta los bloques de arriba hacia abajo en secuencia.
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- PASO 1: Ver si ya existe algún cliente en la tabla
-- ──────────────────────────────────────────────────────────────
SELECT id, nombre_empresa, plan, creado_at
  FROM public.clientes
 ORDER BY creado_at;


-- ──────────────────────────────────────────────────────────────
-- PASO 2: Crear el cliente (tenant) si no existe ninguno.
--         Si ya tienes un cliente en el paso 1, copia su UUID
--         y sáltate este bloque.
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.clientes (nombre_empresa, plan)
VALUES ('Signum-Clock Demo', 'starter')
ON CONFLICT DO NOTHING
RETURNING id, nombre_empresa;


-- ──────────────────────────────────────────────────────────────
-- PASO 3: Fijar cliente_id en app_metadata del usuario.
--
--         Reemplaza <PEGA_EL_UUID_DEL_CLIENTE_AQUÍ>
--         con el UUID obtenido en el paso 1 o 2.
-- ──────────────────────────────────────────────────────────────
UPDATE auth.users
   SET raw_app_meta_data =
         COALESCE(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('cliente_id', '<PEGA_EL_UUID_DEL_CLIENTE_AQUÍ>')
 WHERE id = 'b2448c3b-385b-4fb8-baa1-7a35f919681f'
RETURNING
  id,
  email,
  raw_app_meta_data -> 'cliente_id' AS cliente_id_asignado;


-- ──────────────────────────────────────────────────────────────
-- PASO 4: Crear el perfil en usuarios_perfiles.
--         Mismo UUID de cliente del paso anterior.
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.usuarios_perfiles
  (id, cliente_id, nombre, rol, estatus_cuenta)
VALUES (
  'b2448c3b-385b-4fb8-baa1-7a35f919681f',
  '<PEGA_EL_UUID_DEL_CLIENTE_AQUÍ>',
  'Edgar',
  'admin',
  'activo'
)
ON CONFLICT (id) DO UPDATE
  SET cliente_id     = EXCLUDED.cliente_id,
      estatus_cuenta = 'activo';


-- ──────────────────────────────────────────────────────────────
-- PASO 5: Verificación final — debe mostrar el UUID del cliente
-- ──────────────────────────────────────────────────────────────
SELECT
  u.id                                        AS user_id,
  u.email,
  u.raw_app_meta_data -> 'cliente_id'         AS cliente_id_jwt,
  p.cliente_id                                AS cliente_id_perfil,
  p.rol,
  p.estatus_cuenta
FROM auth.users u
LEFT JOIN public.usuarios_perfiles p ON p.id = u.id
WHERE u.id = 'b2448c3b-385b-4fb8-baa1-7a35f919681f';
