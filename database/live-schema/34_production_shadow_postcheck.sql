-- Phase 34: execute only after one approved SHADOW canary completes.
--
-- This is a read-only template. Do not edit counts into this file. Generate a
-- one-run local copy from the exact JSON emitted by Phase 33:
--   node backend/scripts/render-production-shadow-postcheck.js \
--     --baseline-file <local-phase-33-baseline.json> \
--     --output <local-phase-34-postcheck.sql>
--
-- The unrendered template intentionally has no baseline and therefore returns
-- BASELINE_REQUIRED. The generated local copy embeds only that run's Phase 33
-- JSON; no snapshot is stored in Supabase.
BEGIN TRANSACTION READ ONLY;

WITH supplied_baseline AS (
  SELECT /* PHASE_33_BASELINE_JSON */ NULL::jsonb AS value
),
baseline_shape AS (
  SELECT
    value,
    value IS NOT NULL
      AND jsonb_typeof(value) = 'object'
      AND value->>'phase' = '33_production_shadow_baseline'
      AND value->>'read_only' = 'on'
      AND value->>'candidate_registro_id' = '7f99cef9-4100-48ff-9aaf-68548c80c948'
      AND value->>'baseline_id' ~ '^[0-9a-f]{32}$'
      AND value->>'captured_at_utc' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND value->>'legacy_trigger_fingerprint' ~ '^[0-9a-f]{32}$'
      AND jsonb_typeof(value->'counts') = 'object'
      AND value->'counts' ?& ARRAY[
        'devices',
        'horarios',
        'incidencias',
        'workday_records',
        'empleados_horarios',
        'registro_asistencia',
        'attendance_source_events'
      ]
      AND jsonb_typeof(value->'counts'->'devices') = 'number'
      AND jsonb_typeof(value->'counts'->'horarios') = 'number'
      AND jsonb_typeof(value->'counts'->'incidencias') = 'number'
      AND jsonb_typeof(value->'counts'->'workday_records') = 'number'
      AND jsonb_typeof(value->'counts'->'empleados_horarios') = 'number'
      AND jsonb_typeof(value->'counts'->'registro_asistencia') = 'number'
      AND jsonb_typeof(value->'counts'->'attendance_source_events') = 'number'
      AND (value->'counts'->>'devices') ~ '^(0|[1-9][0-9]*)$'
      AND (value->'counts'->>'horarios') ~ '^(0|[1-9][0-9]*)$'
      AND (value->'counts'->>'incidencias') ~ '^(0|[1-9][0-9]*)$'
      AND (value->'counts'->>'workday_records') ~ '^(0|[1-9][0-9]*)$'
      AND (value->'counts'->>'empleados_horarios') ~ '^(0|[1-9][0-9]*)$'
      AND (value->'counts'->>'registro_asistencia') ~ '^(0|[1-9][0-9]*)$'
      AND (value->'counts'->>'attendance_source_events') ~ '^(0|[1-9][0-9]*)$' AS valid
  FROM supplied_baseline
),
baseline AS (
  SELECT
    value->>'baseline_id' AS baseline_id,
    value->>'captured_at_utc' AS captured_at_utc,
    (value->>'candidate_registro_id')::uuid AS candidate_registro_id,
    value->'counts' AS counts,
    value->>'legacy_trigger_fingerprint' AS legacy_trigger_fingerprint
  FROM baseline_shape
  WHERE valid
),
current_counts AS (
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
),
comparison AS (
  SELECT
    baseline.baseline_id,
    baseline.captured_at_utc,
    baseline.candidate_registro_id,
    baseline.counts AS baseline_counts,
    baseline.legacy_trigger_fingerprint AS baseline_legacy_trigger_fingerprint,
    current_counts.value AS current_counts,
    COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING') AS current_legacy_trigger_fingerprint,
    baseline.counts = current_counts.value AS counts_identical,
    baseline.legacy_trigger_fingerprint = COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING')
      AS legacy_trigger_identical
  FROM baseline
  CROSS JOIN current_counts
)
SELECT jsonb_build_object(
  'phase', '34_production_shadow_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'baseline_present', EXISTS (SELECT 1 FROM supplied_baseline WHERE value IS NOT NULL),
  'baseline_valid', EXISTS (SELECT 1 FROM baseline),
  'baseline_id', (SELECT baseline_id FROM comparison),
  'baseline_captured_at_utc', (SELECT captured_at_utc FROM comparison),
  'candidate_registro_id', (SELECT candidate_registro_id FROM comparison),
  'baseline_counts', (SELECT baseline_counts FROM comparison),
  'current_counts', (SELECT current_counts FROM comparison),
  'counts_identical', COALESCE((SELECT counts_identical FROM comparison), false),
  'baseline_legacy_trigger_fingerprint', (SELECT baseline_legacy_trigger_fingerprint FROM comparison),
  'current_legacy_trigger_fingerprint', COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING'),
  'legacy_trigger_identical', COALESCE((SELECT legacy_trigger_identical FROM comparison), false),
  'postcheck_status', CASE
    WHEN NOT EXISTS (SELECT 1 FROM supplied_baseline WHERE value IS NOT NULL) THEN 'BASELINE_REQUIRED'
    WHEN NOT EXISTS (SELECT 1 FROM baseline) THEN 'INVALID_BASELINE'
    WHEN (SELECT counts_identical FROM comparison)
      AND (SELECT legacy_trigger_identical FROM comparison) THEN 'PASS'
    ELSE 'MISMATCH'
  END,
  'postcheck_pass', COALESCE((SELECT counts_identical FROM comparison), false)
    AND COALESCE((SELECT legacy_trigger_identical FROM comparison), false)
) AS production_shadow_postcheck;

ROLLBACK;
