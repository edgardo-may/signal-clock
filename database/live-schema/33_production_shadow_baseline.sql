-- Phase 33: execute immediately before the one approved SHADOW canary.
-- Read-only snapshot. Save the JSON result verbatim to a local file and use
-- backend/scripts/render-production-shadow-postcheck.js to render its paired
-- Phase 34 postcheck. Nothing from this snapshot is stored in Supabase.
BEGIN TRANSACTION READ ONLY;

WITH capture AS (
  SELECT to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS captured_at_utc
),
counts AS (
  SELECT jsonb_build_object(
    'workday_records', (SELECT count(*) FROM public.workday_records),
    'registro_asistencia', (SELECT count(*) FROM public.registro_asistencia),
    'incidencias', (SELECT count(*) FROM public.incidencias),
    'horarios', (SELECT count(*) FROM public.horarios),
    'empleados_horarios', (SELECT count(*) FROM public.empleados_horarios),
    'attendance_source_events', (SELECT count(*) FROM public.attendance_source_events),
    'devices', (SELECT count(*) FROM public.devices)
  ) AS value
),
legacy_trigger AS (
  SELECT COALESCE(md5(pg_get_triggerdef(t.oid, true)), 'MISSING') AS fingerprint
  FROM pg_trigger AS t
  WHERE t.tgrelid = 'public.registro_asistencia'::regclass
    AND NOT t.tgisinternal
    AND t.tgname = 'trg_evaluar_retardo'
)
SELECT jsonb_build_object(
  'phase', '33_production_shadow_baseline',
  'read_only', current_setting('transaction_read_only'),
  'candidate_registro_id', '7f99cef9-4100-48ff-9aaf-68548c80c948',
  'captured_at_utc', capture.captured_at_utc,
  'baseline_id', md5(
    '7f99cef9-4100-48ff-9aaf-68548c80c948'
    || ':' || capture.captured_at_utc
    || ':' || (SELECT value::text FROM counts)
    || ':' || COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING')
  ),
  'counts', (SELECT value FROM counts),
  'legacy_trigger_fingerprint', COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING')
) AS production_shadow_baseline
FROM capture;

ROLLBACK;
