-- Signum Clock: auditoría del flujo ATTLOG -> registro normalizado -> source event.
-- SOLO LECTURA. Ejecutar contra la BASE REAL en Supabase SQL Editor.
--
-- No usa migraciones históricas como autoridad. No crea ni modifica objetos,
-- datos, estados de procesamiento, índices, triggers o funciones. No realiza
-- backfill y no correlaciona por tiempo, empleado o dispositivo.
--
-- El único puente transitorio que se audita para ZKTeco es exacto:
--   registro_asistencia.raw_payload.source_log_id = attendance_logs.id
--   attendance_source_events.source_reference     = attendance_logs.id

BEGIN TRANSACTION READ ONLY;

-- 1. Identidad del catálogo inspeccionado y relaciones físicas involucradas.
SELECT
  current_database() AS database_name,
  current_user AS audit_role,
  current_setting('transaction_read_only') AS transaction_read_only,
  version() AS postgresql_version;

SELECT
  c.oid::regclass AS relation,
  c.relkind AS relation_kind,
  c.relrowsecurity AS rls_enabled,
  c.relhastriggers AS has_triggers
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'attendance_logs',
    'attendance_source_events',
    'registro_asistencia',
    'devices',
    'empleados',
    'device_employee_assignments'
  )
ORDER BY c.relname;

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
  AND table_name IN (
    'attendance_logs',
    'attendance_source_events',
    'registro_asistencia',
    'devices',
    'empleados',
    'device_employee_assignments'
  )
ORDER BY table_name, ordinal_position;

-- 2. Garantías estructurales instaladas: PK/FK/UNIQUE/CHECK e índices.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN (
    'attendance_logs',
    'attendance_source_events',
    'registro_asistencia',
    'devices',
    'empleados',
    'device_employee_assignments'
  )
ORDER BY rel.relname, con.conname;

SELECT
  tablename AS table_name,
  indexname AS index_name,
  indexdef AS definition
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('attendance_logs', 'attendance_source_events', 'registro_asistencia')
ORDER BY tablename, indexname;

-- 3. Triggers reales. tgfoid identifica la función que ejecuta cada trigger;
-- pg_get_triggerdef muestra timing, eventos y condición instalados.
SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  CASE
    WHEN (trg.tgtype & 64) <> 0 THEN 'INSTEAD OF'
    WHEN (trg.tgtype & 2) <> 0 THEN 'BEFORE'
    ELSE 'AFTER'
  END AS trigger_timing,
  CASE WHEN (trg.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS trigger_level,
  concat_ws(', ',
    CASE WHEN (trg.tgtype & 4) <> 0 THEN 'INSERT' END,
    CASE WHEN (trg.tgtype & 8) <> 0 THEN 'DELETE' END,
    CASE WHEN (trg.tgtype & 16) <> 0 THEN 'UPDATE' END,
    CASE WHEN (trg.tgtype & 32) <> 0 THEN 'TRUNCATE' END
  ) AS trigger_events,
  trg.tgenabled AS enabled_mode,
  trg.tgfoid::regprocedure AS trigger_function,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('attendance_logs', 'registro_asistencia', 'attendance_source_events')
  AND NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

-- 4. Funciones instaladas que pueden participar en la normalización. La
-- búsqueda por cuerpo evita depender de nombres supuestos y muestra su DDL real.
SELECT
  p.oid::regprocedure AS function_signature,
  p.proname AS function_name,
  l.lanname AS language,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS function_config,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%attendance%'
    OR p.proname ILIKE '%asistencia%'
    OR p.proname ILIKE '%registro%'
    OR p.proname ILIKE '%source%event%'
    OR p.proname ILIKE '%attlog%'
    OR pg_get_functiondef(p.oid) ILIKE '%attendance_logs%'
    OR pg_get_functiondef(p.oid) ILIKE '%registro_asistencia%'
    OR pg_get_functiondef(p.oid) ILIKE '%attendance_source_events%'
    OR pg_get_functiondef(p.oid) ILIKE '%source_log_id%'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- 5. Dependencias declaradas entre funciones y las tres relaciones. Esto no
-- sustituye la definición del cuerpo, pero identifica dependencias catalogadas.
SELECT
  p.oid::regprocedure AS function_signature,
  c.oid::regclass AS referenced_relation,
  d.deptype AS dependency_type
FROM pg_depend d
JOIN pg_proc p ON p.oid = d.objid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
JOIN pg_class c ON c.oid = d.refobjid
JOIN pg_namespace cn ON cn.oid = c.relnamespace
WHERE pn.nspname = 'public'
  AND cn.nspname = 'public'
  AND c.relname IN ('attendance_logs', 'registro_asistencia', 'attendance_source_events')
ORDER BY p.oid::regprocedure::text, c.relname, d.deptype;

-- 6. Otros mecanismos declarativos que podrían insertar o redirigir filas.
SELECT
  c.oid::regclass AS relation,
  r.rulename AS rule_name,
  pg_get_ruledef(r.oid, true) AS definition
FROM pg_rewrite r
JOIN pg_class c ON c.oid = r.ev_class
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('attendance_logs', 'registro_asistencia', 'attendance_source_events')
  AND r.rulename <> '_RETURN'
ORDER BY c.relname, r.rulename;

SELECT
  extname AS extension_name,
  extversion AS extension_version,
  extnamespace::regnamespace AS extension_schema
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net', 'pgmq')
ORDER BY extname;

-- 7. El puente RAW actual. Solo expone nombres de claves JSON y conteos, no
-- payloads completos ni heurísticas temporales.
WITH normalized AS (
  SELECT
    r.id,
    r.es_manual,
    r.cliente_id,
    r.empleado_id,
    r.dispositivo_id,
    r.source_event_id,
    NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '') AS source_log_id
  FROM public.registro_asistencia r
), source_log_groups AS (
  SELECT source_log_id, count(*) AS registro_count
  FROM normalized
  WHERE source_log_id IS NOT NULL
  GROUP BY source_log_id
)
SELECT
  (SELECT count(*) FROM public.attendance_logs) AS attendance_logs_total,
  (SELECT count(*) FROM public.attendance_source_events) AS source_events_total,
  (SELECT count(*) FROM normalized) AS registro_total,
  (SELECT count(*) FROM normalized WHERE source_event_id IS NOT NULL) AS registro_with_source_event_id,
  (SELECT count(*) FROM normalized WHERE source_event_id IS NULL) AS registro_without_source_event_id,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NOT NULL) AS registro_with_raw_source_log_id,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NULL AND es_manual IS TRUE) AS manual_without_raw_source_log_id,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NULL AND es_manual IS NOT TRUE) AS automatic_without_raw_source_log_id,
  (SELECT count(*) FROM source_log_groups WHERE registro_count > 1) AS repeated_raw_source_log_id_groups,
  (SELECT count(*)
   FROM source_log_groups g
   LEFT JOIN public.attendance_logs l ON l.id::text = g.source_log_id
   WHERE l.id IS NULL) AS raw_source_log_id_without_attlog;

SELECT
  key AS raw_payload_key,
  count(*) AS registro_count
FROM public.registro_asistencia r
CROSS JOIN LATERAL jsonb_object_keys(
  CASE WHEN jsonb_typeof(r.raw_payload) = 'object' THEN r.raw_payload ELSE '{}'::jsonb END
) AS payload_keys(key)
WHERE payload_keys.key ILIKE '%source%'
   OR payload_keys.key ILIKE '%log%'
   OR payload_keys.key ILIKE '%device%'
   OR payload_keys.key ILIKE '%employee%'
GROUP BY payload_keys.key
ORDER BY payload_keys.key;

-- 8. Integridad del puente exacto disponible hoy. Cada conteo se basa solo en
-- UUIDs: registro.raw_payload.source_log_id -> ATTLOG.id -> source_reference.
WITH bridge AS (
  SELECT
    r.id AS registro_id,
    r.cliente_id AS registro_cliente_id,
    r.empleado_id AS registro_empleado_id,
    r.dispositivo_id AS registro_dispositivo_id,
    r.source_event_id AS registro_source_event_id,
    l.id AS attendance_log_id,
    e.id AS source_event_id,
    e.cliente_id AS source_event_cliente_id,
    e.employee_id AS source_event_employee_id,
    e.device_id AS source_event_device_id,
    e.processing_status
  FROM public.registro_asistencia r
  JOIN public.attendance_logs l
    ON l.id::text = NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '')
  LEFT JOIN public.attendance_source_events e
    ON e.source_type = 'ZKTECO'
   AND e.source_reference = l.id
)
SELECT
  count(*) AS exact_attlog_registro_bridges,
  count(*) FILTER (WHERE source_event_id IS NOT NULL) AS bridges_with_source_event,
  count(*) FILTER (WHERE source_event_id IS NULL) AS bridges_without_source_event,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND registro_source_event_id IS NULL) AS link_candidates_pending,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND registro_source_event_id = source_event_id) AS existing_structural_links_matching,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND registro_source_event_id IS DISTINCT FROM source_event_id) AS structural_link_mismatch,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND registro_cliente_id IS DISTINCT FROM source_event_cliente_id) AS company_mismatch,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND registro_empleado_id IS DISTINCT FROM source_event_employee_id) AS employee_mismatch,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND registro_dispositivo_id IS DISTINCT FROM source_event_device_id) AS device_mismatch,
  count(*) FILTER (WHERE source_event_id IS NOT NULL AND processing_status IN ('PENDING', 'ERROR')) AS retryable_source_events
FROM bridge;

-- 9. Evidencia puntual del canary autorizado. No enlaza ni actualiza filas.
-- Los UUIDs fueron proporcionados por la validación física de fase 12.
WITH canary AS (
  SELECT
    '7ae3bd79-3feb-4f82-a279-16f7e3876e18'::uuid AS attendance_log_id,
    'fcc67f56-d0ae-44c7-8b6e-1957420e8ccb'::uuid AS expected_source_event_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS expected_employee_id
), normalized_match AS (
  SELECT r.*
  FROM public.registro_asistencia r
  JOIN canary c
    ON NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '') = c.attendance_log_id::text
)
SELECT
  EXISTS (SELECT 1 FROM public.attendance_logs l JOIN canary c ON l.id = c.attendance_log_id) AS attlog_exists,
  EXISTS (
    SELECT 1
    FROM public.attendance_source_events e
    JOIN canary c ON e.id = c.expected_source_event_id
    WHERE e.source_type = 'ZKTECO'
      AND e.source_reference = c.attendance_log_id
      AND e.employee_id = c.expected_employee_id
  ) AS exact_source_event_exists,
  (SELECT count(*) FROM normalized_match) AS exact_normalized_records_by_raw_source_log_id,
  (SELECT count(*) FROM normalized_match WHERE source_event_id IS NULL) AS exact_normalized_records_pending_structural_link,
  (SELECT count(*) FROM normalized_match WHERE source_event_id = (SELECT expected_source_event_id FROM canary)) AS exact_normalized_records_already_linked,
  (SELECT count(*) FROM normalized_match WHERE empleado_id = (SELECT expected_employee_id FROM canary)) AS exact_normalized_employee_matches;

-- 10. Sólo si las columnas temporales existen según la sección 1, este resultado
-- ayuda a interpretar el orden observado del canary. No se usa para enlazar.
SELECT
  l.created_at AS attendance_log_created_at,
  r.creado_at AS registro_created_at,
  e.created_at AS source_event_created_at,
  e.received_at AS source_event_received_at,
  e.processing_status AS source_event_processing_status
FROM public.attendance_logs l
LEFT JOIN public.attendance_source_events e
  ON e.source_type = 'ZKTECO'
 AND e.source_reference = l.id
LEFT JOIN public.registro_asistencia r
  ON NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '') = l.id::text
WHERE l.id = '7ae3bd79-3feb-4f82-a279-16f7e3876e18'::uuid;

ROLLBACK;
