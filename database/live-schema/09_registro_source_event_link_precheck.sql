-- Signum Clock: precheck para registro_asistencia.source_event_id.
-- SOLO LECTURA. Requiere que 08 ya exista en la base real; no modifica nada.

BEGIN TRANSACTION READ ONLY;

-- A. Contrato de la nueva capa y del registro normalizado.
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
  AND table_name IN ('attendance_source_events', 'registro_asistencia', 'attendance_logs')
ORDER BY table_name, ordinal_position;

-- B. El campo no debe aparecer ya por una implementación paralela.
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'registro_asistencia'
  AND column_name IN ('source_event_id', 'source_log_id', 'attendance_log_id');

-- C. Garantías y consumidores instalados que podrían alterar la normalización.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('attendance_source_events', 'registro_asistencia', 'attendance_logs')
ORDER BY rel.relname, con.conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('attendance_source_events', 'registro_asistencia', 'attendance_logs')
ORDER BY tablename, indexname;

SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname IN ('fn_sync_attendance_to_registro', 'fn_evaluar_retardo_asistencia')
    OR p.proname ILIKE '%source%event%'
  )
ORDER BY p.oid::regprocedure::text;

SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  pg_get_triggerdef(trg.oid, true) AS definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('attendance_logs', 'registro_asistencia', 'attendance_source_events')
  AND NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;

-- D. Línea base de historia. No proyecta UUIDs, PINes ni payloads.
WITH normalizados AS (
  SELECT
    es_manual,
    NULLIF(BTRIM(raw_payload ->> 'source_log_id'), '') AS embedded_source_log_id
  FROM public.registro_asistencia
)
SELECT
  (SELECT count(*) FROM public.registro_asistencia) AS registro_total,
  (SELECT count(*) FROM normalizados WHERE es_manual IS TRUE) AS manual_total,
  (SELECT count(*) FROM normalizados WHERE es_manual IS NOT TRUE) AS automatico_total,
  (SELECT count(*) FROM normalizados WHERE embedded_source_log_id IS NOT NULL) AS embedded_attlog_links,
  (SELECT count(*) FROM normalizados WHERE es_manual IS NOT TRUE AND embedded_source_log_id IS NULL) AS automaticos_historicos_sin_attlog_link,
  (SELECT count(*) FROM public.attendance_source_events) AS source_event_total;

ROLLBACK;
