-- Signum Clock: auditoría de vínculo RAW → registro normalizado.
-- SOLO LECTURA. Nunca proyecta raw_payload completo.

BEGIN TRANSACTION READ ONLY;

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
  (SELECT count(*) FROM public.attendance_logs) AS attlog_raw_total,
  (SELECT count(*) FROM normalized) AS registro_normalizado_total,
  (SELECT count(*) FROM normalized WHERE es_manual IS TRUE) AS registro_manual_total,
  (SELECT count(*) FROM normalized WHERE es_manual IS NOT TRUE) AS registro_automatico_total,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NOT NULL) AS normalizados_con_source_log_id,
  (SELECT count(*) FROM normalized WHERE source_log_id IS NULL) AS normalizados_sin_source_log_id,
  (SELECT count(*) FROM normalized WHERE es_manual IS TRUE AND source_log_id IS NOT NULL) AS manuales_con_source_log_id,
  (SELECT count(*) FROM normalized WHERE es_manual IS NOT TRUE AND source_log_id IS NOT NULL) AS automaticos_con_source_log_id,
  (SELECT count(*) FROM source_groups WHERE normalized_count > 1) AS source_log_id_repetidos,
  (SELECT COALESCE(sum(normalized_count), 0) FROM source_groups WHERE normalized_count > 1) AS normalizados_en_source_log_id_repetidos,
  (SELECT count(*) FROM source_groups sg JOIN raw_ids r USING (source_log_id) WHERE normalized_count > 1) AS attlog_con_mas_de_un_normalizado,
  (SELECT count(*) FROM source_groups sg LEFT JOIN raw_ids r USING (source_log_id) WHERE r.source_log_id IS NULL) AS source_log_id_sin_attlog_raw,
  (SELECT count(*) FROM raw_ids r LEFT JOIN source_groups sg USING (source_log_id) WHERE sg.source_log_id IS NULL) AS attlog_sin_normalizacion_vinculada;

-- Únicamente confirma la forma del valor de referencia; no revela payloads ni UUIDs.
SELECT
  CASE
    WHEN raw_payload IS NULL THEN 'RAW_PAYLOAD_NULL'
    WHEN NULLIF(BTRIM(raw_payload ->> 'source_log_id'), '') IS NULL THEN 'SOURCE_LOG_ID_ABSENT'
    WHEN (raw_payload ->> 'source_log_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN 'SOURCE_LOG_ID_UUID'
    ELSE 'SOURCE_LOG_ID_NON_UUID'
  END AS source_link_shape,
  count(*) AS registro_count
FROM public.registro_asistencia
GROUP BY 1
ORDER BY 1;

ROLLBACK;
