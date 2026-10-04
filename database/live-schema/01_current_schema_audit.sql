-- Signum Clock: catálogo de la base real.
-- SOLO LECTURA. Ejecutar manualmente en Supabase SQL Editor.
-- No consulta templates, fotografías, huellas ni filas de negocio.

BEGIN TRANSACTION READ ONLY;

-- 1. Tablas, vistas y RLS del esquema público.
SELECT
  c.relname AS object_name,
  c.relkind AS object_kind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY c.relkind, c.relname;

-- 2. Columnas y defaults reales de los objetos relevantes.
SELECT
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_schema,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'clientes',
    'empleados',
    'devices',
    'device_employee_assignments',
    'device_commands',
    'attendance_logs',
    'registro_asistencia',
    'horarios',
    'empleados_horarios',
    'incidencias',
    'workday_records',
    'workday_record_history',
    'tenant_features',
    'biometric_templates'
  )
ORDER BY c.table_name, c.ordinal_position;

-- 3. Tipos ENUM y sus valores reales.
SELECT
  n.nspname AS schema_name,
  t.typname AS enum_name,
  e.enumsortorder,
  e.enumlabel
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname IN ('public', 'auth')
ORDER BY n.nspname, t.typname, e.enumsortorder;

-- 4. PK, FK, UNIQUE y CHECK reales.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    WHEN 'x' THEN 'EXCLUSION'
    ELSE con.contype::text
  END AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition,
  con.convalidated AS validated
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
ORDER BY rel.relname, con.contype, con.conname;

-- 5. Índices reales, incluidos índices parciales y de expresión.
SELECT
  tablename AS table_name,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 6. Secuencias existentes y su propietario.
SELECT
  sequence_schema,
  sequence_name,
  data_type,
  start_value,
  minimum_value,
  maximum_value,
  increment,
  cycle_option
FROM information_schema.sequences
WHERE sequence_schema = 'public'
ORDER BY sequence_name;

-- 7. Inventario de funciones públicas.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  COALESCE(array_to_string(p.proconfig, ', '), '') AS configuration
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, arguments;

-- 8. Definiciones de funciones que procesan identidad, asistencia, jornada o incidencias.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%attendance%'
    OR p.proname ILIKE '%asistencia%'
    OR p.proname ILIKE '%workday%'
    OR p.proname ILIKE '%retardo%'
    OR p.proname ILIKE '%inciden%'
    OR p.proname ILIKE '%employee_assignment%'
    OR p.proname ILIKE '%device%'
  )
ORDER BY p.proname, arguments;

-- 9. Triggers reales sobre las tablas operativas.
SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  pg_get_triggerdef(trg.oid, true) AS definition,
  pg_get_triggerdef(trg.oid, false) AS full_definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

-- 10. Políticas RLS reales.
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
ORDER BY tablename, policyname;

-- 11. Grants de tabla, columna y función.
SELECT
  table_name,
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
ORDER BY table_name, grantee, privilege_type;

SELECT
  table_name,
  column_name,
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
ORDER BY table_name, column_name, grantee, privilege_type;

SELECT
  routine_name,
  specific_name,
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
ORDER BY routine_name, grantee, privilege_type;

-- 12. Roles operativos visibles al catálogo.
SELECT
  rolname,
  rolcanlogin,
  rolinherit,
  rolcreaterole,
  rolcreatedb,
  rolsuper,
  rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY rolname;

ROLLBACK;
