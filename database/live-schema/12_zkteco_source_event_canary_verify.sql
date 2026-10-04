-- SOLO LECTURA. Ejecutar después de un canary autorizado.
-- Sustituir los dos UUID de ejemplo por los UUID observados; no correlacionar
-- por timestamp ni por similitud.

BEGIN TRANSACTION READ ONLY;

WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS attlog_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS expected_employee_id
), linked AS (
  SELECT
    l.id AS attendance_log_id,
    l.device_serial,
    l.user_id AS attendance_user_id,
    l.timestamp AS occurred_at,
    e.id AS source_event_id,
    e.source_type,
    e.source_reference,
    e.cliente_id,
    e.device_id,
    e.employee_id,
    e.processing_status,
    e.raw_payload->>'hardware_user_id' AS hardware_user_id
  FROM public.attendance_logs l
  JOIN public.attendance_source_events e
    ON e.source_type = 'ZKTECO'
   AND e.source_reference = l.id
  WHERE l.id = (SELECT attlog_id FROM params)
)
SELECT
  linked.*,
  (linked.employee_id = (SELECT expected_employee_id FROM params)) AS employee_matches_expected,
  ((linked.raw_payload IS NOT NULL) AND linked.hardware_user_id IS NOT NULL) AS hardware_identity_present
FROM linked;

-- Debe devolver exactamente una fila para el ATTLOG canary.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS attlog_id
)
SELECT
  l.id AS attendance_log_id,
  COUNT(e.id) AS source_event_count
FROM public.attendance_logs l
LEFT JOIN public.attendance_source_events e
  ON e.source_type = 'ZKTECO'
 AND e.source_reference = l.id
WHERE l.id = (SELECT attlog_id FROM params)
GROUP BY l.id;

COMMIT;
