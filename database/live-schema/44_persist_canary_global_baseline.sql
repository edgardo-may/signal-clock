-- Phase 36.2: capture immediately before the future runner invocation, after
-- authorization is already installed. Save its single JSON result locally.
BEGIN TRANSACTION READ ONLY;

WITH capture AS (
  SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS captured_at_utc
), counts AS (
  SELECT jsonb_build_object(
    'workday_records', (SELECT count(*) FROM public.workday_records),
    'workday_record_history', (SELECT count(*) FROM public.workday_record_history),
    'tenant_features', (SELECT count(*) FROM public.tenant_features),
    'incidencias', (SELECT count(*) FROM public.incidencias),
    'registro_asistencia', (SELECT count(*) FROM public.registro_asistencia),
    'empleados', (SELECT count(*) FROM public.empleados),
    'horarios', (SELECT count(*) FROM public.horarios),
    'empleados_horarios', (SELECT count(*) FROM public.empleados_horarios),
    'devices', (SELECT count(*) FROM public.devices),
    'attendance_source_events', (SELECT count(*) FROM public.attendance_source_events)
  ) AS value
)
SELECT jsonb_build_object(
  'phase', '36_2_persist_canary_global_baseline',
  'read_only', current_setting('transaction_read_only'),
  'candidate_registro_id', '7f99cef9-4100-48ff-9aaf-68548c80c948',
  'captured_at_utc', capture.captured_at_utc,
  'baseline_id', md5(capture.captured_at_utc || ':' || (SELECT value::text FROM counts)),
  'counts', (SELECT value FROM counts)
) AS persist_canary_global_baseline
FROM capture;

ROLLBACK;
