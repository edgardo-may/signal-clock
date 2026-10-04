-- Signum Clock: Fase 14, PRECHECK para enlazar un evento de origen con un
-- registro normalizado de asistencia.
--
-- SOLO LECTURA. Este archivo no crea funciones, no prepara sentencias, no
-- cambia estados y no actualiza source_event_id. Su salida identifica solo
-- candidatos sustentados por el puente exacto ya existente:
--
--   registro_asistencia.raw_payload.source_log_id = attendance_logs.id
--   attendance_source_events.source_reference     = attendance_logs.id
--
-- No usa correlacion por fecha, empleado, dispositivo, PIN ni datos del
-- payload distintos de source_log_id. Los resultados READY son evidencia para
-- la posterior operacion parametrizada de Fase 14; no son una instruccion de
-- cambio.

BEGIN TRANSACTION READ ONLY;

-- PRECHECK 1: identidad de la sesion y modo efectivo de la transaccion.
SELECT
  current_database() AS database_name,
  current_user AS audit_role,
  current_setting('transaction_read_only') AS transaction_read_only,
  version() AS postgresql_version;

-- PRECHECK 2: las relaciones y columnas requeridas deben existir con el
-- contrato UUID que necesita el enlace estructural.
SELECT
  c.oid::regclass AS relation,
  c.relkind AS relation_kind,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'attendance_logs',
    'attendance_source_events',
    'registro_asistencia'
  )
ORDER BY c.relname;

SELECT
  cols.table_name,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable
FROM information_schema.columns cols
WHERE cols.table_schema = 'public'
  AND (
    (cols.table_name = 'attendance_logs'
      AND cols.column_name = 'id')
    OR (cols.table_name = 'attendance_source_events'
      AND cols.column_name IN (
        'id',
        'cliente_id',
        'employee_id',
        'device_id',
        'source_type',
        'source_reference',
        'processing_status'
      ))
    OR (cols.table_name = 'registro_asistencia'
      AND cols.column_name IN (
        'id',
        'cliente_id',
        'empleado_id',
        'dispositivo_id',
        'es_manual',
        'raw_payload',
        'source_event_id'
      ))
  )
ORDER BY cols.table_name, cols.column_name;

-- PRECHECK 3: la llave foranea y la unicidad parcial deben estar instaladas
-- antes de permitir un enlace uno a uno.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'registro_asistencia'
  AND (
    con.conname = 'fk_registro_asistencia_source_event'
    OR pg_get_constraintdef(con.oid, true) ILIKE '%source_event_id%'
  )
ORDER BY con.conname;

SELECT
  indexname AS index_name,
  indexdef AS definition
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'registro_asistencia'
  AND indexdef ILIKE '%source_event_id%'
ORDER BY indexname;

-- PRECHECK 4: conteos de integridad del enlace actual. Ningun conteo usa una
-- inferencia distinta de la clave source_log_id persistida en el JSON.
WITH exact_bridge AS (
  SELECT
    r.id AS registro_id,
    r.source_event_id AS registro_source_event_id,
    e.id AS source_event_id
  FROM public.registro_asistencia r
  JOIN public.attendance_logs l
    ON l.id::text = NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '')
  JOIN public.attendance_source_events e
    ON e.source_type = 'ZKTECO'
   AND e.source_reference = l.id
)
SELECT
  count(*) AS exact_bridge_total,
  count(*) FILTER (WHERE registro_source_event_id IS NULL) AS pending_exact_links,
  count(*) FILTER (WHERE registro_source_event_id = source_event_id) AS matching_existing_links,
  count(*) FILTER (
    WHERE registro_source_event_id IS NOT NULL
      AND registro_source_event_id IS DISTINCT FROM source_event_id
  ) AS conflicting_existing_links,
  count(DISTINCT registro_id) AS distinct_registros,
  count(DISTINCT source_event_id) AS distinct_source_events
FROM exact_bridge;

-- PRECHECK 5: candidatos individuales. Solo una fila READY puede continuar a
-- CHANGE: debe estar pendiente, tener puente exacto y conservar Empresa,
-- colaborador y dispositivo consistentes. Si una fuente o un registro aparece
-- mas de una vez, el resultado queda BLOCKED y requiere investigacion humana.
WITH exact_bridge AS (
  SELECT
    r.id AS registro_id,
    r.cliente_id AS registro_cliente_id,
    r.empleado_id AS registro_empleado_id,
    r.dispositivo_id AS registro_dispositivo_id,
    r.es_manual,
    r.source_event_id AS registro_source_event_id,
    e.id AS source_event_id,
    e.cliente_id AS source_event_cliente_id,
    e.employee_id AS source_event_employee_id,
    e.device_id AS source_event_device_id,
    e.processing_status,
    count(*) OVER (PARTITION BY r.id) AS registro_bridge_count,
    count(*) OVER (PARTITION BY e.id) AS source_event_bridge_count
  FROM public.registro_asistencia r
  JOIN public.attendance_logs l
    ON l.id::text = NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '')
  JOIN public.attendance_source_events e
    ON e.source_type = 'ZKTECO'
   AND e.source_reference = l.id
)
SELECT
  source_event_id,
  registro_id,
  processing_status,
  registro_source_event_id,
  registro_bridge_count,
  source_event_bridge_count,
  CASE
    WHEN registro_source_event_id = source_event_id THEN 'ALREADY_LINKED'
    WHEN registro_source_event_id IS NOT NULL THEN 'BLOCKED_REGISTRO_LINKED_TO_OTHER_EVENT'
    WHEN es_manual IS TRUE THEN 'BLOCKED_MANUAL_REGISTRO'
    WHEN registro_bridge_count > 1 THEN 'BLOCKED_MULTIPLE_EXACT_EVENTS_FOR_REGISTRO'
    WHEN source_event_bridge_count > 1 THEN 'BLOCKED_MULTIPLE_EXACT_REGISTROS_FOR_EVENT'
    WHEN registro_cliente_id IS DISTINCT FROM source_event_cliente_id THEN 'BLOCKED_CLIENTE_MISMATCH'
    WHEN registro_empleado_id IS DISTINCT FROM source_event_employee_id THEN 'BLOCKED_EMPLEADO_MISMATCH'
    WHEN registro_dispositivo_id IS DISTINCT FROM source_event_device_id THEN 'BLOCKED_DISPOSITIVO_MISMATCH'
    WHEN processing_status NOT IN ('PENDING', 'ERROR') THEN 'BLOCKED_SOURCE_EVENT_STATUS'
    ELSE 'READY'
  END AS precheck_status
FROM exact_bridge
ORDER BY source_event_id, registro_id;

-- PRECHECK 6: eventos ZKTECO sin un registro alcanzable por el puente exacto.
-- Se reportan para confirmar que no seran tratados por aproximacion.
SELECT
  e.id AS source_event_id,
  e.processing_status,
  CASE
    WHEN e.source_reference IS NULL THEN 'NO_SOURCE_REFERENCE'
    WHEN l.id IS NULL THEN 'SOURCE_REFERENCE_WITHOUT_ATTENDANCE_LOG'
    WHEN r.id IS NULL THEN 'NO_EXACT_NORMALIZED_REGISTRO'
    ELSE 'REVIEW_REQUIRED'
  END AS exclusion_reason
FROM public.attendance_source_events e
LEFT JOIN public.attendance_logs l
  ON l.id = e.source_reference
LEFT JOIN public.registro_asistencia r
  ON l.id::text = NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '')
WHERE e.source_type = 'ZKTECO'
  AND r.id IS NULL
ORDER BY e.id;

ROLLBACK;
