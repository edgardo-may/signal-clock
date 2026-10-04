-- Signum Clock: clasificación de automáticos sin raw_payload.source_log_id.
-- SOLO LECTURA. No proyecta payloads, PINes, nombres ni UUIDs de eventos.

BEGIN TRANSACTION READ ONLY;

WITH raw_window AS (
  SELECT min(timestamp) AS first_raw_at, max(timestamp) AS last_raw_at
  FROM public.attendance_logs
),
unlinked AS (
  SELECT
    r.id,
    r.creado_at,
    r.verificado_at,
    r.dispositivo_id,
    r.metodo,
    r.tipo_verificacion,
    r.raw_payload,
    NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '') AS source_log_id
  FROM public.registro_asistencia r
  WHERE r.es_manual IS NOT TRUE
    AND NULLIF(BTRIM(r.raw_payload ->> 'source_log_id'), '') IS NULL
),
classified AS (
  SELECT
    u.*,
    CASE
      WHEN u.raw_payload IS NULL THEN 'RAW_PAYLOAD_NULL'
      WHEN jsonb_typeof(u.raw_payload) <> 'object' THEN 'RAW_PAYLOAD_NON_OBJECT'
      WHEN u.raw_payload = '{}'::jsonb THEN 'RAW_PAYLOAD_EMPTY_OBJECT'
      ELSE 'RAW_PAYLOAD_OBJECT'
    END AS raw_payload_shape,
    CASE
      WHEN NULLIF(BTRIM(u.raw_payload ->> 'origin'), '') ILIKE '%IMPORT%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'source'), '') ILIKE '%IMPORT%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'source_type'), '') ILIKE '%IMPORT%'
        OR LOWER(COALESCE(u.metodo, '')) LIKE '%import%'
        THEN 'IMPORT_EVENT'
      WHEN NULLIF(BTRIM(u.raw_payload ->> 'origin'), '') ILIKE '%WEB%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'origin'), '') ILIKE '%API%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'source'), '') ILIKE '%WEB%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'source'), '') ILIKE '%API%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'source_type'), '') ILIKE '%WEB%'
        OR NULLIF(BTRIM(u.raw_payload ->> 'source_type'), '') ILIKE '%API%'
        OR LOWER(COALESCE(u.metodo, '')) = 'web'
        THEN 'WEB_EVENT'
      WHEN NULLIF(BTRIM(u.raw_payload ->> 'device_serial'), '') IS NOT NULL
        OR NULLIF(BTRIM(u.raw_payload ->> 'hardware_user_id'), '') IS NOT NULL
        OR NULLIF(BTRIM(u.raw_payload ->> 'user_id'), '') IS NOT NULL
        THEN 'LEGACY_NORMALIZED'
      ELSE 'UNKNOWN'
    END AS evidence_based_classification,
    CASE
      WHEN u.creado_at < w.first_raw_at THEN 'BEFORE_RAW_ATTLOG_WINDOW'
      WHEN u.creado_at > w.last_raw_at THEN 'AFTER_RAW_ATTLOG_WINDOW'
      WHEN u.creado_at IS NULL OR w.first_raw_at IS NULL OR w.last_raw_at IS NULL THEN 'TIMING_NOT_COMPARABLE'
      ELSE 'WITHIN_RAW_ATTLOG_WINDOW'
    END AS timing_relation,
    NULLIF(BTRIM(u.raw_payload ->> 'device_serial'), '') IS NOT NULL AS payload_has_device_serial,
    NULLIF(BTRIM(u.raw_payload ->> 'hardware_user_id'), '') IS NOT NULL AS payload_has_hardware_user_id,
    NULLIF(BTRIM(u.raw_payload ->> 'user_id'), '') IS NOT NULL AS payload_has_user_id
  FROM unlinked u
  CROSS JOIN raw_window w
)
SELECT
  evidence_based_classification,
  timing_relation,
  raw_payload_shape,
  (dispositivo_id IS NOT NULL) AS has_device_id,
  payload_has_device_serial,
  payload_has_hardware_user_id,
  payload_has_user_id,
  creado_at::date AS created_date,
  verificado_at::date AS verified_date,
  metodo,
  tipo_verificacion,
  count(*) AS record_count
FROM classified
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
ORDER BY 1, 2, 3, 4, 8, 9, 10, 11;

-- Distribución de llaves JSON, sin valores de payload.
WITH unlinked AS (
  SELECT raw_payload
  FROM public.registro_asistencia
  WHERE es_manual IS NOT TRUE
    AND NULLIF(BTRIM(raw_payload ->> 'source_log_id'), '') IS NULL
)
SELECT
  COALESCE(
    array_to_string(
      ARRAY(
        SELECT jsonb_object_keys(
          CASE WHEN jsonb_typeof(raw_payload) = 'object' THEN raw_payload ELSE '{}'::jsonb END
        )
        ORDER BY 1
      ),
      '|'
    ),
    'NO_JSON_OBJECT'
  ) AS payload_keys,
  count(*) AS record_count
FROM unlinked
GROUP BY 1
ORDER BY 1;

ROLLBACK;
