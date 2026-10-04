-- Signum Clock: precheck de la capa RAW universal de asistencia.
-- SOLO LECTURA. Ejecutar manualmente en Supabase SQL Editor antes de cualquier
-- script de cambio. No crea tablas, funciones, índices, políticas ni datos.
--
-- La base real es la autoridad. Los archivos de supabase/migrations no forman
-- parte de esta comprobación.

BEGIN TRANSACTION READ ONLY;

-- A. Verifica si ya existe una capa equivalente antes de crear otra.
SELECT
  c.oid::regclass AS relation,
  c.relkind AS relation_kind,
  c.relrowsecurity AS row_security_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (
    c.relname = 'attendance_source_events'
    OR c.relname ILIKE '%attendance%source%'
    OR c.relname ILIKE '%source%event%'
  )
ORDER BY c.relname;

-- B. Busca columnas que ya puedan modelar la misma trazabilidad.
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    column_name IN ('source_event_id', 'source_reference', 'source_type', 'request_id', 'processing_status')
    OR column_name ILIKE '%source%event%'
  )
ORDER BY table_name, ordinal_position;

-- C. Contrato real de las relaciones que necesitaría el nuevo evento.
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('clientes', 'empleados', 'devices', 'attendance_logs', 'registro_asistencia', 'usuarios_perfiles', 'cliente_modulos', 'module_catalog')
ORDER BY table_name, ordinal_position;

-- D. PK/FK/CHECK e índices existentes. Estos resultados determinan los tipos
-- y las garantías que el script de cambio puede usar.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('clientes', 'empleados', 'devices', 'attendance_logs', 'registro_asistencia', 'usuarios_perfiles', 'cliente_modulos', 'module_catalog')
ORDER BY rel.relname, con.conname;

SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('clientes', 'empleados', 'devices', 'attendance_logs', 'registro_asistencia', 'usuarios_perfiles', 'cliente_modulos', 'module_catalog')
ORDER BY tablename, indexname;

-- E. Funciones, triggers y políticas que ya puedan resolver usuario, Empresa,
-- permisos o normalización. La definición instalada prevalece sobre migraciones.
SELECT
  p.oid::regprocedure AS function_signature,
  p.proname,
  p.prosecdef AS security_definer,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%attendance%'
    OR p.proname ILIKE '%source%event%'
    OR p.proname ILIKE '%employee%'
    OR p.proname ILIKE '%empleado%'
    OR p.proname ILIKE '%current%'
    OR p.proname ILIKE '%module%'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('attendance_logs', 'registro_asistencia', 'clientes', 'empleados', 'devices', 'usuarios_perfiles', 'cliente_modulos')
  AND NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('attendance_logs', 'registro_asistencia', 'clientes', 'empleados', 'devices', 'usuarios_perfiles', 'cliente_modulos', 'module_catalog')
ORDER BY tablename, policyname;

SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('attendance_logs', 'registro_asistencia', 'clientes', 'empleados', 'devices', 'usuarios_perfiles', 'cliente_modulos', 'module_catalog')
ORDER BY table_name, grantee, privilege_type;

-- F. Sistema de módulos o configuración reutilizable. Solo muestra claves y
-- conteos; no expone usuarios, sesiones ni metadatos privados.
SELECT
  mc.module_key,
  mc.active AS catalog_active,
  count(cm.id) AS empresa_configuration_rows,
  count(cm.id) FILTER (WHERE cm.habilitado IS TRUE) AS enabled_for_empresas
FROM public.module_catalog mc
LEFT JOIN public.cliente_modulos cm ON cm.module_key = mc.module_key
GROUP BY mc.module_key, mc.active
ORDER BY mc.module_key;

-- G. Comprueba si existe una relación autenticada usuario -> colaborador.
-- No se muestran identificadores, nombres ni correos.
SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'employee_user_links'
  ) AS employee_user_links_exists,
  count(*) FILTER (WHERE column_name IN ('employee_id', 'empleado_id')) AS employee_reference_columns,
  count(*) FILTER (WHERE column_name IN ('user_id', 'auth_user_id', 'usuario_id')) AS user_reference_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'usuarios_perfiles';

-- H. Estado de la trazabilidad actual. No proyecta payloads ni UUIDs.
WITH normalizados AS (
  SELECT
    es_manual,
    NULLIF(BTRIM(raw_payload ->> 'source_log_id'), '') AS source_log_id
  FROM public.registro_asistencia
),
referencias AS (
  SELECT source_log_id, count(*) AS total
  FROM normalizados
  WHERE source_log_id IS NOT NULL
  GROUP BY source_log_id
)
SELECT
  (SELECT count(*) FROM public.attendance_logs) AS attlog_raw_total,
  (SELECT count(*) FROM public.registro_asistencia) AS normalized_total,
  (SELECT count(*) FROM referencias) AS normalized_with_embedded_source_log,
  (SELECT count(*) FROM referencias WHERE total > 1) AS repeated_embedded_source_log_groups,
  (SELECT count(*) FROM normalizados WHERE es_manual IS NOT TRUE AND source_log_id IS NULL) AS automatic_without_embedded_source_log,
  (SELECT count(*) FROM normalizados WHERE es_manual IS TRUE AND source_log_id IS NULL) AS manual_without_embedded_source_log;

ROLLBACK;
