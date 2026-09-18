-- Phase 36.2: read-only postcheck template. Render a local copy only after the
-- future runner returns, using its exact JSON result and the Phase 44 baseline.
BEGIN TRANSACTION READ ONLY;

WITH supplied AS (
  SELECT
    /* PERSIST_CANARY_BASELINE_JSON */ NULL::jsonb AS baseline,
    /* PERSIST_CANARY_RUNNER_RESULT_JSON */ NULL::jsonb AS runner
), baseline AS (
  SELECT baseline
  FROM supplied
  WHERE baseline->>'phase' = '36_2_persist_canary_global_baseline'
    AND baseline->>'read_only' = 'on'
    AND baseline->>'candidate_registro_id' = '7f99cef9-4100-48ff-9aaf-68548c80c948'
    AND jsonb_typeof(baseline->'counts') = 'object'
), runner_result AS (
  SELECT runner
  FROM supplied
  WHERE runner->>'mode' = 'PERSIST_CANARY'
    AND runner->>'persistenceResult' IN ('INSERTED', 'UNCHANGED')
    AND runner->>'integrityHash' ~ '^[0-9a-f]{64}$'
), expected AS (
  SELECT
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid AS schedule_id,
    '2026-09-03'::date AS workday_date,
    '2026-09-03T16:26:04.000Z'::timestamptz AS first_in,
    '2026-09-03T17:55:13.000Z'::timestamptz AS last_out
), current_counts AS (
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
), target AS (
  SELECT
    (SELECT count(*) FROM public.workday_records w, expected e
      WHERE w.cliente_id = e.cliente_id AND w.empleado_id = e.empleado_id AND w.schedule_id = e.schedule_id
        AND w.workday_date = e.workday_date AND w.calculation_version = 3
        AND w.first_in = e.first_in AND w.last_out = e.last_out AND w.worked_minutes = 89
        AND w.break_minutes = 0 AND w.late_minutes = 326 AND w.early_leave_minutes = 65
        AND w.overtime_minutes = 0 AND w.status = 'COMPLETE'
        AND w.integrity_hash = (SELECT runner->>'integrityHash' FROM runner_result)) AS exact_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h, expected e
      WHERE h.cliente_id = e.cliente_id AND h.empleado_id = e.empleado_id AND h.schedule_id = e.schedule_id
        AND h.workday_date = e.workday_date AND h.calculation_version = 3 AND h.action = 'INSERTED'
        AND h.integrity_hash = (SELECT runner->>'integrityHash' FROM runner_result)) AS exact_history_rows
), deltas AS (
  SELECT
    current_counts.value AS current_counts,
    (SELECT baseline FROM baseline) AS baseline_value,
    (current_counts.value->>'workday_records')::bigint - ((SELECT baseline->'counts'->>'workday_records' FROM baseline)::bigint) AS workday_delta,
    (current_counts.value->>'workday_record_history')::bigint - ((SELECT baseline->'counts'->>'workday_record_history' FROM baseline)::bigint) AS history_delta,
    (current_counts.value->>'tenant_features')::bigint - ((SELECT baseline->'counts'->>'tenant_features' FROM baseline)::bigint) AS tenant_features_delta,
    (current_counts.value->>'incidencias')::bigint - ((SELECT baseline->'counts'->>'incidencias' FROM baseline)::bigint) AS incidencias_delta
  FROM current_counts
)
SELECT jsonb_build_object(
  'phase', '36_2_persist_canary_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'baseline_valid', EXISTS (SELECT 1 FROM baseline),
  'runner_result_valid', EXISTS (SELECT 1 FROM runner_result),
  'exact_workday_rows', (SELECT exact_workday_rows FROM target),
  'exact_history_rows', (SELECT exact_history_rows FROM target),
  'deltas', jsonb_build_object('workday_records', workday_delta, 'workday_record_history', history_delta,
    'tenant_features', tenant_features_delta, 'incidencias', incidencias_delta),
  'postcheck_pass', EXISTS (SELECT 1 FROM baseline) AND EXISTS (SELECT 1 FROM runner_result)
    AND (SELECT exact_workday_rows FROM target) = 1 AND (SELECT exact_history_rows FROM target) = 1
    AND workday_delta = CASE WHEN (SELECT runner->>'persistenceResult' FROM runner_result) = 'INSERTED' THEN 1 ELSE 0 END
    AND history_delta = CASE WHEN (SELECT runner->>'persistenceResult' FROM runner_result) = 'INSERTED' THEN 1 ELSE 0 END
    AND tenant_features_delta = 0 AND incidencias_delta = 0
    AND current_counts = (SELECT baseline->'counts' || jsonb_build_object(
      'workday_records', ((baseline->'counts'->>'workday_records')::bigint + workday_delta),
      'workday_record_history', ((baseline->'counts'->>'workday_record_history')::bigint + history_delta)
    ) FROM baseline)
) AS persist_canary_postcheck
FROM deltas;

ROLLBACK;
