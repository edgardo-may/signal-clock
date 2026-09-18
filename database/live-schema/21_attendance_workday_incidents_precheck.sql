-- Signum Clock: Fase 21, auditoria del contrato real de asistencia, jornadas
-- e incidencias. EJECUTAR SOLO CONTRA LA BASE REAL DE SUPABASE.
--
-- SOLO LECTURA. No usa migraciones como autoridad, no crea objetos y no cambia
-- datos, estados, RLS, permisos ni politicas. Los bloques DO solo ejecutan
-- SELECT dinamicos para que la auditoria pueda informar relaciones ausentes sin
-- fallar al referenciarlas directamente.

BEGIN TRANSACTION READ ONLY;

-- 0. Contexto y relaciones candidatas descubiertas desde el catalogo real.
SELECT
  current_database() AS database_name,
  current_user AS audit_role,
  current_setting('transaction_read_only') AS transaction_read_only,
  version() AS postgresql_version;

SELECT
  c.oid::regclass AS relation,
  c.relkind AS relation_kind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  c.relhastriggers AS has_triggers,
  c.reltuples::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND (
    c.relname IN (
      'registro_asistencia',
      'horarios',
      'empleados_horarios',
      'incidencias',
      'workday_records',
      'workday_record_history',
      'tenant_features',
      'clientes',
      'empleados',
      'devices'
    )
    OR c.relname ILIKE '%horario%'
    OR c.relname ILIKE '%turno%'
    OR c.relname ILIKE '%schedule%'
    OR c.relname ILIKE '%workday%'
    OR c.relname ILIKE '%jornada%'
    OR c.relname ILIKE '%inciden%'
  )
ORDER BY c.relname;

-- 1. registro_asistencia: contrato completo y campos relevantes reales.
SELECT
  cols.ordinal_position,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  cols.column_default,
  CASE
    WHEN cols.column_name IN (
      'cliente_id', 'empleado_id', 'dispositivo_id', 'source_event_id',
      'es_manual', 'metodo', 'raw_payload', 'verificado_at', 'creado_at'
    )
      OR cols.column_name ILIKE '%fecha%'
      OR cols.column_name ILIKE '%time%'
      OR cols.column_name ILIKE '%timestamp%'
      OR cols.column_name ILIKE '%tipo%'
    THEN true
    ELSE false
  END AS attendance_relevant
FROM information_schema.columns cols
WHERE cols.table_schema = 'public'
  AND cols.table_name = 'registro_asistencia'
ORDER BY cols.ordinal_position;

SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS is_validated,
  con.confrelid::regclass AS referenced_relation,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
WHERE con.conrelid = to_regclass('public.registro_asistencia')
ORDER BY con.conname;

SELECT
  idx.indexname AS index_name,
  idx.indexdef AS definition
FROM pg_indexes idx
WHERE idx.schemaname = 'public'
  AND idx.tablename = 'registro_asistencia'
ORDER BY idx.indexname;

SELECT
  trg.tgname AS trigger_name,
  CASE
    WHEN (trg.tgtype & 64) <> 0 THEN 'INSTEAD OF'
    WHEN (trg.tgtype & 2) <> 0 THEN 'BEFORE'
    ELSE 'AFTER'
  END AS trigger_timing,
  CASE WHEN (trg.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS trigger_level,
  trg.tgenabled AS enabled_mode,
  trg.tgfoid::regprocedure AS trigger_function,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
WHERE trg.tgrelid = to_regclass('public.registro_asistencia')
  AND NOT trg.tgisinternal
ORDER BY trg.tgname;

SELECT
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
WHERE c.oid = to_regclass('public.registro_asistencia');

SELECT
  pol.policyname AS policy_name,
  pol.permissive,
  pol.roles,
  pol.cmd AS command,
  pol.qual AS using_expression,
  pol.with_check AS with_check_expression
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND pol.tablename = 'registro_asistencia'
ORDER BY pol.policyname;

-- 2. Descubrimiento de tablas de horario, turno y asignacion. La salida no
-- presupone que los nombres historicos sean los que operan en produccion.
WITH schedule_relations AS (
  SELECT DISTINCT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.columns cols
    ON cols.table_schema = 'public'
   AND cols.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (
      c.relname ILIKE '%horario%'
      OR c.relname ILIKE '%turno%'
      OR c.relname ILIKE '%schedule%'
      OR cols.column_name IN (
        'horario_id', 'turno_id', 'schedule_id', 'dias_config',
        'fecha_inicio', 'fecha_fin', 'tolerancia_minutos'
      )
    )
)
SELECT
  r.relname AS table_name,
  r.oid::regclass AS relation,
  c.relkind AS relation_kind,
  c.relrowsecurity AS rls_enabled,
  c.relhastriggers AS has_triggers
FROM schedule_relations r
JOIN pg_class c ON c.oid = r.oid
ORDER BY r.relname;

WITH schedule_relations AS (
  SELECT DISTINCT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.columns probe
    ON probe.table_schema = 'public'
   AND probe.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (
      c.relname ILIKE '%horario%'
      OR c.relname ILIKE '%turno%'
      OR c.relname ILIKE '%schedule%'
      OR probe.column_name IN ('horario_id', 'turno_id', 'schedule_id', 'dias_config')
    )
)
SELECT
  cols.table_name,
  cols.ordinal_position,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  cols.column_default
FROM information_schema.columns cols
JOIN schedule_relations rel ON rel.relname = cols.table_name
WHERE cols.table_schema = 'public'
ORDER BY cols.table_name, cols.ordinal_position;

WITH schedule_relations AS (
  SELECT DISTINCT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.columns probe
    ON probe.table_schema = 'public'
   AND probe.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (
      c.relname ILIKE '%horario%'
      OR c.relname ILIKE '%turno%'
      OR c.relname ILIKE '%schedule%'
      OR probe.column_name IN ('horario_id', 'turno_id', 'schedule_id', 'dias_config')
    )
)
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS is_validated,
  con.confrelid::regclass AS referenced_relation,
  pg_get_constraintdef(con.oid, true) AS definition
FROM schedule_relations rel
JOIN pg_constraint con ON con.conrelid = rel.oid
ORDER BY rel.relname, con.conname;

WITH schedule_relations AS (
  SELECT DISTINCT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.columns probe
    ON probe.table_schema = 'public'
   AND probe.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (
      c.relname ILIKE '%horario%'
      OR c.relname ILIKE '%turno%'
      OR c.relname ILIKE '%schedule%'
      OR probe.column_name IN ('horario_id', 'turno_id', 'schedule_id', 'dias_config')
    )
)
SELECT idx.tablename AS table_name, idx.indexname AS index_name, idx.indexdef AS definition
FROM pg_indexes idx
JOIN schedule_relations rel ON rel.relname = idx.tablename
WHERE idx.schemaname = 'public'
ORDER BY idx.tablename, idx.indexname;

WITH schedule_relations AS (
  SELECT DISTINCT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.columns probe
    ON probe.table_schema = 'public'
   AND probe.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (
      c.relname ILIKE '%horario%'
      OR c.relname ILIKE '%turno%'
      OR c.relname ILIKE '%schedule%'
      OR probe.column_name IN ('horario_id', 'turno_id', 'schedule_id', 'dias_config')
    )
)
SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  trg.tgfoid::regprocedure AS trigger_function,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM schedule_relations rel
JOIN pg_trigger trg ON trg.tgrelid = rel.oid
WHERE NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

SELECT
  pol.tablename AS table_name,
  pol.policyname AS policy_name,
  pol.permissive,
  pol.roles,
  pol.cmd AS command,
  pol.qual AS using_expression,
  pol.with_check AS with_check_expression
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN information_schema.columns probe
      ON probe.table_schema = 'public'
     AND probe.table_name = c.relname
    WHERE n.nspname = 'public'
      AND c.relname = pol.tablename
      AND (
        c.relname ILIKE '%horario%'
        OR c.relname ILIKE '%turno%'
        OR c.relname ILIKE '%schedule%'
        OR probe.column_name IN ('horario_id', 'turno_id', 'schedule_id', 'dias_config')
      )
  )
ORDER BY pol.tablename, pol.policyname;

-- Resume las columnas que determinan la asignacion vigente, sin afirmar que
-- exista una regla suficiente hasta revisar las constraints y datos emitidos.
SELECT
  cols.table_name,
  array_agg(cols.column_name ORDER BY cols.ordinal_position) FILTER (
    WHERE cols.column_name IN (
      'cliente_id', 'empleado_id', 'horario_id', 'turno_id', 'schedule_id',
      'activo', 'fecha_inicio', 'fecha_fin', 'dias_config', 'entrada', 'salida',
      'tolerancia_minutos', 'timezone'
    )
  ) AS scheduling_columns_present
FROM information_schema.columns cols
WHERE cols.table_schema = 'public'
  AND (cols.table_name ILIKE '%horario%' OR cols.table_name ILIKE '%turno%' OR cols.table_name ILIKE '%schedule%')
GROUP BY cols.table_name
ORDER BY cols.table_name;

-- 3. Workday y feature flags: presencia, contrato y cantidad exacta de datos
-- si la relacion existe. Las relaciones ausentes se informan por NOTICE.
SELECT
  relname AS expected_relation,
  to_regclass('public.' || relname) IS NOT NULL AS relation_exists
FROM unnest(ARRAY['workday_records', 'workday_record_history', 'tenant_features']) AS expected(relname)
ORDER BY relname;

WITH workday_relations AS (
  SELECT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (c.relname ILIKE '%workday%' OR c.relname ILIKE '%jornada%' OR c.relname = 'tenant_features')
)
SELECT
  rel.relname AS table_name,
  cols.ordinal_position,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  cols.column_default
FROM workday_relations rel
JOIN information_schema.columns cols
  ON cols.table_schema = 'public'
 AND cols.table_name = rel.relname
ORDER BY rel.relname, cols.ordinal_position;

WITH workday_relations AS (
  SELECT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (c.relname ILIKE '%workday%' OR c.relname ILIKE '%jornada%' OR c.relname = 'tenant_features')
)
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS is_validated,
  con.confrelid::regclass AS referenced_relation,
  pg_get_constraintdef(con.oid, true) AS definition
FROM workday_relations rel
JOIN pg_constraint con ON con.conrelid = rel.oid
ORDER BY rel.relname, con.conname;

WITH workday_relations AS (
  SELECT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (c.relname ILIKE '%workday%' OR c.relname ILIKE '%jornada%' OR c.relname = 'tenant_features')
)
SELECT idx.tablename AS table_name, idx.indexname AS index_name, idx.indexdef AS definition
FROM pg_indexes idx
JOIN workday_relations rel ON rel.relname = idx.tablename
WHERE idx.schemaname = 'public'
ORDER BY idx.tablename, idx.indexname;

WITH workday_relations AS (
  SELECT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (c.relname ILIKE '%workday%' OR c.relname ILIKE '%jornada%' OR c.relname = 'tenant_features')
)
SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  trg.tgfoid::regprocedure AS trigger_function,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM workday_relations rel
JOIN pg_trigger trg ON trg.tgrelid = rel.oid
WHERE NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

SELECT
  pol.tablename AS table_name,
  pol.policyname AS policy_name,
  pol.permissive,
  pol.roles,
  pol.cmd AS command,
  pol.qual AS using_expression,
  pol.with_check AS with_check_expression
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND (pol.tablename ILIKE '%workday%' OR pol.tablename ILIKE '%jornada%' OR pol.tablename = 'tenant_features')
ORDER BY pol.tablename, pol.policyname;

-- 4. incidencias: contrato completo, seguridad y catalogos reales existentes.
SELECT
  to_regclass('public.incidencias') IS NOT NULL AS incident_table_exists;

SELECT
  cols.ordinal_position,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  cols.column_default
FROM information_schema.columns cols
WHERE cols.table_schema = 'public'
  AND cols.table_name = 'incidencias'
ORDER BY cols.ordinal_position;

SELECT
  cols.column_name,
  typ.typname AS enum_type,
  enum.enumlabel AS enum_value,
  enum.enumsortorder AS sort_order
FROM information_schema.columns cols
JOIN pg_type typ ON typ.typname = cols.udt_name
JOIN pg_namespace typ_namespace ON typ_namespace.oid = typ.typnamespace
JOIN pg_enum enum ON enum.enumtypid = typ.oid
WHERE cols.table_schema = 'public'
  AND cols.table_name = 'incidencias'
  AND typ_namespace.nspname = cols.udt_schema
ORDER BY cols.column_name, enum.enumsortorder;

SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS is_validated,
  con.confrelid::regclass AS referenced_relation,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
WHERE con.conrelid = to_regclass('public.incidencias')
ORDER BY con.conname;

SELECT idx.indexname AS index_name, idx.indexdef AS definition
FROM pg_indexes idx
WHERE idx.schemaname = 'public'
  AND idx.tablename = 'incidencias'
ORDER BY idx.indexname;

SELECT
  trg.tgname AS trigger_name,
  trg.tgfoid::regprocedure AS trigger_function,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
WHERE trg.tgrelid = to_regclass('public.incidencias')
  AND NOT trg.tgisinternal
ORDER BY trg.tgname;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
WHERE c.oid = to_regclass('public.incidencias');

SELECT
  pol.policyname AS policy_name,
  pol.permissive,
  pol.roles,
  pol.cmd AS command,
  pol.qual AS using_expression,
  pol.with_check AS with_check_expression
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND pol.tablename = 'incidencias'
ORDER BY pol.policyname;

-- 5. Empresa, empleado y timezone: columnas, FKs y evidencia de aislamiento.
SELECT
  cols.table_name,
  cols.ordinal_position,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable
FROM information_schema.columns cols
WHERE cols.table_schema = 'public'
  AND cols.table_name IN (
    'clientes', 'empleados', 'devices', 'registro_asistencia',
    'horarios', 'empleados_horarios', 'incidencias',
    'workday_records', 'workday_record_history', 'tenant_features'
  )
  AND (
    cols.column_name IN ('id', 'id_empresa', 'cliente_id', 'empleado_id', 'employee_id', 'device_id')
    OR cols.column_name ILIKE '%timezone%'
    OR cols.column_name ILIKE '%zona_horaria%'
  )
ORDER BY cols.table_name, cols.ordinal_position;

SELECT
  cols.table_name,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  cols.column_default
FROM information_schema.columns cols
WHERE cols.table_schema = 'public'
  AND (
    cols.column_name ILIKE '%timezone%'
    OR cols.column_name ILIKE '%time_zone%'
    OR cols.column_name ILIKE '%zona_horaria%'
  )
ORDER BY cols.table_name, cols.ordinal_position;

SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.confrelid::regclass AS referenced_relation,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'f'
  AND rel.relname IN (
    'registro_asistencia', 'horarios', 'empleados_horarios', 'incidencias',
    'workday_records', 'workday_record_history', 'devices', 'empleados'
  )
ORDER BY rel.relname, con.conname;

SELECT
  c.relname AS table_name,
  bool_or(cols.column_name = 'cliente_id') AS has_cliente_id,
  bool_or(cols.column_name IN ('empleado_id', 'employee_id')) AS has_employee_id,
  bool_or(cols.column_name IN ('timezone', 'time_zone', 'zona_horaria')) AS has_timezone_column
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN information_schema.columns cols
  ON cols.table_schema = 'public'
 AND cols.table_name = c.relname
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND c.relname IN (
    'registro_asistencia', 'horarios', 'empleados_horarios', 'incidencias',
    'workday_records', 'workday_record_history', 'devices', 'empleados', 'clientes'
  )
GROUP BY c.relname
ORDER BY c.relname;

-- 6. Conteos exactos y valores distintos se emiten como NOTICE solo para
-- relaciones y columnas que el catalogo confirma. No hay DML ni DDL.
DO $read_only_audit$
DECLARE
  relation_name text;
  column_name text;
  row_count bigint;
  distinct_count bigint;
  distinct_values jsonb;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'registro_asistencia', 'horarios', 'empleados_horarios', 'incidencias',
    'workday_records', 'workday_record_history', 'tenant_features'
  ]
  LOOP
    IF to_regclass('public.' || relation_name) IS NULL THEN
      RAISE NOTICE 'PHASE21 relation public.%: MISSING', relation_name;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I', relation_name) INTO row_count;
      RAISE NOTICE 'PHASE21 relation public.%: rows=%', relation_name, row_count;
    END IF;
  END LOOP;

  IF to_regclass('public.incidencias') IS NOT NULL THEN
    FOR column_name IN
      SELECT c.column_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'incidencias'
        AND c.column_name IN (
          'tipo', 'tipo_incidencia', 'estado', 'estatus', 'origen',
          'fecha', 'fecha_inicio', 'fecha_fin', 'empleado_id', 'employee_id', 'cliente_id'
        )
      ORDER BY c.ordinal_position
    LOOP
      EXECUTE format(
        'SELECT count(*), COALESCE(jsonb_agg(value ORDER BY value), ''[]''::jsonb) '
        || 'FROM (SELECT DISTINCT %1$I::text AS value FROM public.incidencias '
        || 'WHERE %1$I IS NOT NULL) AS distinct_values',
        column_name
      ) INTO distinct_count, distinct_values;
      RAISE NOTICE 'PHASE21 incidencias column %: distinct_count=% values=%',
        column_name, distinct_count, distinct_values;
    END LOOP;
  END IF;

  FOR relation_name, column_name IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('timezone', 'time_zone', 'zona_horaria')
    ORDER BY c.table_name, c.ordinal_position
  LOOP
    EXECUTE format(
      'SELECT count(*), COALESCE(jsonb_agg(value ORDER BY value), ''[]''::jsonb) '
      || 'FROM (SELECT DISTINCT %1$I::text AS value FROM public.%2$I '
      || 'WHERE %1$I IS NOT NULL) AS distinct_values',
      column_name, relation_name
    ) INTO distinct_count, distinct_values;
    RAISE NOTICE 'PHASE21 timezone public.%.%: distinct_count=% values=%',
      relation_name, column_name, distinct_count, distinct_values;
  END LOOP;
END
$read_only_audit$;

ROLLBACK;
