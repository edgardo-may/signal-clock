-- Signum Clock: precheck para endurecer ATTLOG → registro_asistencia.
-- SOLO LECTURA. No modifica funciones, columnas, datos ni índices.

BEGIN TRANSACTION READ ONLY;

-- A. Contrato real mínimo de ambas tablas.
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
  AND table_name IN ('attendance_logs', 'registro_asistencia', 'devices', 'device_employee_assignments', 'empleados')
ORDER BY table_name, ordinal_position;

-- B. Determina si ya existe una relación directa equivalente.
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'registro_asistencia'
  AND column_name IN ('source_log_id', 'attendance_log_id', 'raw_log_id');

-- C. Índices y constraints que podrían garantizar idempotencia actualmente.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('attendance_logs', 'registro_asistencia')
ORDER BY rel.relname, con.conname;

SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('attendance_logs', 'registro_asistencia')
ORDER BY tablename, indexname;

-- D. Definición instalada: es autoridad sobre cualquier archivo histórico.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('fn_sync_attendance_to_registro', 'fn_evaluar_retardo_asistencia')
ORDER BY p.oid::regprocedure::text;

-- Si los nombres difieren, muestra candidatos sin ejecutar ninguno.
SELECT
  p.oid::regprocedure AS function_signature,
  p.proname,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%sync%attendance%'
    OR p.proname ILIKE '%attendance%registro%'
    OR p.proname ILIKE '%retardo%'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- E. Triggers instalados sobre RAW y normalización.
SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('attendance_logs', 'registro_asistencia')
  AND NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

-- F. Integridad de vínculos embebidos, sin proyectar payloads ni UUIDs.
WITH normalized AS (
  SELECT
    id,
    es_manual,
    NULLIF(BTRIM(raw_payload ->> 'source_log_id'), '') AS source_log_id
  FROM public.registro_asistencia
),
source_groups AS (
  SELECT source_log_id, count(*) AS normalized_count
  FROM normalized
  WHERE source_log_id IS NOT NULL
  GROUP BY source_log_id
),
raw_ids AS (
  SELECT id::text AS source_log_id
  FROM public.attendance_logs
)
SELECT
  (SELECT count(*) FROM normalized WHERE source_log_id IS NOT NULL) AS links_embedded,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NULL AND es_manual IS TRUE) AS manuales_sin_link,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NULL AND es_manual IS NOT TRUE) AS automaticos_sin_link,
  (SELECT count(*) FROM source_groups WHERE normalized_count > 1) AS links_repetidos,
  (SELECT count(*) FROM source_groups sg LEFT JOIN raw_ids r USING (source_log_id) WHERE r.source_log_id IS NULL) AS links_sin_raw,
  (SELECT count(*) FROM raw_ids r LEFT JOIN source_groups sg USING (source_log_id) WHERE sg.source_log_id IS NULL) AS raw_sin_link;

-- G. Resolución física requerida para una futura normalización segura.
SELECT
  count(*) FILTER (WHERE d.id IS NULL) AS raw_sin_dispositivo,
  count(*) FILTER (WHERE d.id IS NOT NULL AND a.id IS NULL) AS raw_sin_assignment_activo,
  count(*) FILTER (WHERE a.id IS NOT NULL AND e.id IS NULL) AS assignment_sin_colaborador_de_la_misma_empresa,
  count(*) FILTER (WHERE a.id IS NOT NULL AND e.id IS NOT NULL) AS raw_resoluble_por_dispositivo_pin
FROM public.attendance_logs l
LEFT JOIN public.devices d
  ON UPPER(BTRIM(d.serial_number)) = UPPER(BTRIM(l.device_serial))
LEFT JOIN public.device_employee_assignments a
  ON a.device_id = d.id
 AND a.cliente_id = d.cliente_id
 AND BTRIM(a.biometric_user_id::text) = BTRIM(l.user_id::text)
 AND a.activo IS TRUE
LEFT JOIN public.empleados e
  ON e.id = a.employee_id
 AND e.cliente_id = d.cliente_id;

ROLLBACK;
