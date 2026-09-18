-- Phase 48: schedule-assignment contract postcheck. READ ONLY.
BEGIN TRANSACTION READ ONLY;

WITH contract_status AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS btree_gist_exists,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.empleados_horarios'::regclass AND attname = 'fecha_inicio' AND attnotnull) AS fecha_inicio_not_null,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.empleados_horarios'::regclass AND conname = 'empleados_horarios_valid_effective_range' AND pg_get_constraintdef(oid) ILIKE '%fecha_fin >= fecha_inicio%') AS range_check_exists,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.empleados_horarios'::regclass AND conname = 'empleados_horarios_no_valid_range_overlap' AND contype = 'x') AS overlap_exclusion_exists
), assignment_health AS (
  SELECT
    count(*) FILTER (WHERE fecha_inicio IS NULL OR (fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio)) AS invalid_range_count,
    (SELECT count(*) FROM public.empleados_horarios left_assignment JOIN public.empleados_horarios right_assignment
      ON right_assignment.cliente_id = left_assignment.cliente_id AND right_assignment.empleado_id = left_assignment.empleado_id
     AND right_assignment.id > left_assignment.id AND left_assignment.activo IS TRUE AND right_assignment.activo IS TRUE
     AND daterange(left_assignment.fecha_inicio, COALESCE(left_assignment.fecha_fin, 'infinity'::date), '[]') && daterange(right_assignment.fecha_inicio, COALESCE(right_assignment.fecha_fin, 'infinity'::date), '[]')) AS active_overlap_pairs
  FROM public.empleados_horarios
), target_expected AS (
  SELECT * FROM (VALUES
    ('A', 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid, false, DATE '2026-08-08', NULL::date, 'SCHEDULE_VOIDED'),
    ('B', '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid, false, DATE '2026-09-03', DATE '2026-09-13', 'SCHEDULE_VOIDED'),
    ('C', '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid, true, DATE '2026-09-09', NULL::date, 'SCHEDULE_VALIDATED')
  ) AS expected(label, id, activo, fecha_inicio, fecha_fin, audit_action)
), target_status AS (
  SELECT expected.label, expected.id,
    assignment.activo IS NOT DISTINCT FROM expected.activo AND assignment.fecha_inicio IS NOT DISTINCT FROM expected.fecha_inicio AND assignment.fecha_fin IS NOT DISTINCT FROM expected.fecha_fin AS state_matches,
    EXISTS (SELECT 1 FROM public.audit_logs audit
      WHERE audit.cliente_id = assignment.cliente_id AND audit.resource_id = expected.id::text AND audit.action = expected.audit_action
        AND audit.metadata ->> 'correlation_id' = 'a7b24037-d23a-4804-a3c3-1670f551c67a'
        AND audit.metadata ->> 'phase49_snapshot_hash' = 'ec8102bf5c15f153adc27d56a3419d85') AS audit_matches
  FROM target_expected expected LEFT JOIN public.empleados_horarios assignment ON assignment.id = expected.id
), downstream_counts AS (
  SELECT
    (SELECT count(*) FROM public.registro_asistencia WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS attendance_rows,
    (SELECT count(*) FROM public.workday_records WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS workday_rows,
    (SELECT count(*) FROM public.workday_record_history WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS history_rows,
    (SELECT count(*) FROM public.incidencias WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS employee_incident_rows,
    (SELECT count(*) FROM public.incidencias WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid) AS tenant_incident_rows
)
SELECT jsonb_build_object(
  'phase', '48_schedule_assignment_contract_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'btree_gist_exists', contract_status.btree_gist_exists,
  'fecha_inicio_not_null', contract_status.fecha_inicio_not_null,
  'range_check_exists', contract_status.range_check_exists,
  'overlap_exclusion_exists', contract_status.overlap_exclusion_exists,
  'invalid_range_count', assignment_health.invalid_range_count,
  'active_overlap_pairs', assignment_health.active_overlap_pairs,
  'active_overlap_rows', assignment_health.active_overlap_pairs * 2,
  'target_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', label, 'assignment_id', id, 'state_matches', state_matches, 'audit_matches', audit_matches) ORDER BY label) FROM target_status), '[]'::jsonb),
  'downstream_counts', to_jsonb(downstream_counts),
  'downstream_baseline_matches', downstream_counts.attendance_rows = 39 AND downstream_counts.workday_rows = 0 AND downstream_counts.history_rows = 0 AND downstream_counts.employee_incident_rows = 4 AND downstream_counts.tenant_incident_rows = 7,
  'postcheck_pass', contract_status.btree_gist_exists AND contract_status.fecha_inicio_not_null AND contract_status.range_check_exists AND contract_status.overlap_exclusion_exists
    AND assignment_health.invalid_range_count = 0 AND assignment_health.active_overlap_pairs = 0
    AND NOT EXISTS (SELECT 1 FROM target_status WHERE state_matches IS DISTINCT FROM TRUE OR audit_matches IS DISTINCT FROM TRUE)
    AND downstream_counts.attendance_rows = 39 AND downstream_counts.workday_rows = 0 AND downstream_counts.history_rows = 0 AND downstream_counts.employee_incident_rows = 4 AND downstream_counts.tenant_incident_rows = 7
) AS schedule_assignment_contract_postcheck
FROM contract_status CROSS JOIN assignment_health CROSS JOIN downstream_counts;

ROLLBACK;
