-- Phase 51: deliberately blocked, read-only postcheck template.
-- Fill every approved literal from the final Phase 49 packet only after Phase
-- 50 has completed successfully. Until then postcheck_pass is always false.
-- Fresh Phase 49 preserved the assignment snapshot; the refreshed attendance
-- and incident counts below are ordinary pre-Phase-50 activity, not assignment drift.
BEGIN TRANSACTION READ ONLY;

WITH approval AS (
  SELECT
    'a7b24037-d23a-4804-a3c3-1670f551c67a'::uuid AS correlation_id,
    'ec8102bf5c15f153adc27d56a3419d85'::text AS phase49_snapshot_hash,
    39::integer AS expected_attendance_rows,
    32::integer AS expected_attendance_rows_with_device_timezone,
    7::integer AS expected_attendance_rows_without_device_timezone,
    0::integer AS expected_workday_rows,
    0::integer AS expected_history_rows,
    4::integer AS expected_incident_rows,
    7::integer AS expected_tenant_incident_rows
), expected_final AS (
  SELECT * FROM (VALUES
    ('A', 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid, false, DATE '2026-08-08', NULL::date),
    ('B', '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid, false, DATE '2026-09-03', DATE '2026-09-13'),
    ('C', '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid, true, DATE '2026-09-09', NULL::date)
  ) AS expected(label, id, activo, fecha_inicio, fecha_fin)
), final_rows AS (
  SELECT expected.*, assignment.cliente_id, assignment.empleado_id, assignment.horario_id,
    assignment.activo AS actual_activo, assignment.fecha_inicio AS actual_fecha_inicio,
    assignment.fecha_fin AS actual_fecha_fin,
    expected.activo IS NOT NULL
      AND expected.activo IS NOT DISTINCT FROM assignment.activo
      AND expected.fecha_inicio IS NOT DISTINCT FROM assignment.fecha_inicio
      AND expected.fecha_fin IS NOT DISTINCT FROM assignment.fecha_fin AS final_state_matches
  FROM expected_final expected
  LEFT JOIN public.empleados_horarios assignment ON assignment.id = expected.id
), valid_active_overlaps AS (
  SELECT count(*) AS value
  FROM public.empleados_horarios left_assignment
  JOIN public.empleados_horarios right_assignment
    ON right_assignment.cliente_id = left_assignment.cliente_id
   AND right_assignment.empleado_id = left_assignment.empleado_id
   AND right_assignment.id > left_assignment.id
   AND left_assignment.activo IS TRUE AND right_assignment.activo IS TRUE
   AND daterange(left_assignment.fecha_inicio, COALESCE(left_assignment.fecha_fin, 'infinity'::date), '[]')
       && daterange(right_assignment.fecha_inicio, COALESCE(right_assignment.fecha_fin, 'infinity'::date), '[]')
  WHERE left_assignment.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND left_assignment.empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
), invalid_ranges AS (
  SELECT count(*) AS value FROM public.empleados_horarios
  WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
    AND (fecha_inicio IS NULL OR (fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio))
), date_cardinality AS (
  SELECT approved_date,
    count(assignment.id) FILTER (WHERE assignment.activo IS TRUE) AS applicable_valid_assignments
  FROM (VALUES
    (DATE '2026-09-09'), (DATE '2026-09-10'),
    (DATE '2026-09-11'), (DATE '2026-09-12'), (DATE '2026-09-13'), (DATE '2026-09-14')
  ) AS dates(approved_date)
  LEFT JOIN public.empleados_horarios assignment
    ON assignment.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
   AND assignment.empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
   AND assignment.activo IS TRUE
   AND approved_date <@ daterange(assignment.fecha_inicio, COALESCE(assignment.fecha_fin, 'infinity'::date), '[]')
  GROUP BY approved_date
), downstream_counts AS (
  SELECT
    attendance_baseline.attendance_rows,
    attendance_baseline.attendance_rows_with_device_timezone,
    attendance_baseline.attendance_rows_without_device_timezone,
    (SELECT count(*) FROM public.workday_records WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS workday_rows,
    (SELECT count(*) FROM public.workday_record_history WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS history_rows,
    (SELECT count(*) FROM public.incidencias WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) AS incident_rows,
    (SELECT count(*) FROM public.incidencias WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid) AS tenant_incident_rows
  FROM (
    SELECT
      count(*) AS attendance_rows,
      count(*) FILTER (WHERE device.timezone IS NOT NULL) AS attendance_rows_with_device_timezone,
      count(*) FILTER (WHERE device.timezone IS NULL) AS attendance_rows_without_device_timezone
    FROM public.registro_asistencia attendance
    LEFT JOIN public.devices device
      ON device.id = attendance.dispositivo_id
     AND device.cliente_id = attendance.cliente_id
    WHERE attendance.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
      AND attendance.empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
  ) AS attendance_baseline
), assignment_snapshot AS (
  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'label', row.label, 'id', row.id, 'cliente_id', row.cliente_id,
    'empleado_id', row.empleado_id, 'horario_id', row.horario_id,
    'activo', row.activo, 'fecha_inicio', row.fecha_inicio, 'fecha_fin', row.fecha_fin,
    'creado_at', row.creado_at, 'actualizado_at', row.actualizado_at, 'notas', row.notas
  ) ORDER BY row.label)::text, '[]')) AS value
  FROM (
    SELECT 'A' AS label, id, cliente_id, empleado_id, horario_id, activo, fecha_inicio, fecha_fin, creado_at, actualizado_at, notas
    FROM public.empleados_horarios WHERE id = 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid
    UNION ALL
    SELECT 'B', id, cliente_id, empleado_id, horario_id, activo, fecha_inicio, fecha_fin, creado_at, actualizado_at, notas
    FROM public.empleados_horarios WHERE id = '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid
    UNION ALL
    SELECT 'C', id, cliente_id, empleado_id, horario_id, activo, fecha_inicio, fecha_fin, creado_at, actualizado_at, notas
    FROM public.empleados_horarios WHERE id = '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
  ) row
), repair_audit AS (
  SELECT
    count(*) FILTER (WHERE audit.resource_id = 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f' AND audit.action = 'SCHEDULE_VOIDED' AND audit.metadata -> 'new_values' ->> 'classification' = 'VOIDED' AND audit.metadata -> 'new_values' ->> 'data_mutation' = 'false') AS a_voided_count,
    count(*) FILTER (WHERE audit.resource_id = '56f8c98d-5fe1-49d2-abe2-42182a4a830a' AND audit.action = 'SCHEDULE_VOIDED' AND audit.metadata -> 'new_values' ->> 'classification' = 'VOIDED' AND audit.metadata -> 'new_values' ->> 'data_mutation' = 'false') AS b_voided_count,
    count(*) FILTER (WHERE audit.resource_id = '2984316c-1c93-4f66-853e-349f90b9f82c' AND audit.action = 'SCHEDULE_VALIDATED' AND audit.metadata -> 'new_values' ->> 'classification' = 'VALID_CURRENT' AND audit.metadata -> 'new_values' ->> 'data_mutation' = 'false') AS c_validated_count
  FROM public.audit_logs audit CROSS JOIN approval
  WHERE audit.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND audit.action IN ('SCHEDULE_VOIDED', 'SCHEDULE_VALIDATED')
    AND audit.metadata ->> 'correlation_id' = approval.correlation_id::text
    AND audit.metadata ->> 'phase49_snapshot_hash' = approval.phase49_snapshot_hash
), baseline_matches AS (
  SELECT
    approval.expected_attendance_rows IS NOT NULL
      AND approval.expected_attendance_rows_with_device_timezone IS NOT NULL
      AND approval.expected_attendance_rows_without_device_timezone IS NOT NULL
      AND approval.expected_workday_rows IS NOT NULL
      AND approval.expected_history_rows IS NOT NULL
      AND approval.expected_incident_rows IS NOT NULL
      AND approval.expected_tenant_incident_rows IS NOT NULL
      AND downstream_counts.attendance_rows = approval.expected_attendance_rows
      AND downstream_counts.attendance_rows_with_device_timezone = approval.expected_attendance_rows_with_device_timezone
      AND downstream_counts.attendance_rows_without_device_timezone = approval.expected_attendance_rows_without_device_timezone
      AND downstream_counts.workday_rows = approval.expected_workday_rows
      AND downstream_counts.history_rows = approval.expected_history_rows
      AND downstream_counts.incident_rows = approval.expected_incident_rows
      AND downstream_counts.tenant_incident_rows = approval.expected_tenant_incident_rows AS value
  FROM approval CROSS JOIN downstream_counts
), approval_ready AS (
  SELECT approval.correlation_id IS NOT NULL
    AND approval.phase49_snapshot_hash IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM expected_final WHERE activo IS NULL OR fecha_inicio IS NULL) AS value
  FROM approval
)
SELECT jsonb_build_object(
  'phase', '51_schedule_assignment_data_repair_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'expected_correlation_id', approval.correlation_id,
  'expected_phase49_snapshot_hash', approval.phase49_snapshot_hash,
  'current_assignment_snapshot_hash', assignment_snapshot.value,
  'final_rows', COALESCE((SELECT jsonb_agg(to_jsonb(final_rows) ORDER BY label) FROM final_rows), '[]'::jsonb),
  'valid_active_overlap_count', valid_active_overlaps.value,
  'invalid_range_count', invalid_ranges.value,
  'date_cardinality', COALESCE((SELECT jsonb_agg(to_jsonb(date_cardinality) ORDER BY approved_date) FROM date_cardinality), '[]'::jsonb),
  'downstream_counts', to_jsonb(downstream_counts),
  'downstream_baseline_matches', baseline_matches.value,
  'a_voided_audit_count', repair_audit.a_voided_count,
  'b_voided_audit_count', repair_audit.b_voided_count,
  'c_validated_audit_count', repair_audit.c_validated_count,
  'approved_audit_event_count', repair_audit.a_voided_count + repair_audit.b_voided_count + repair_audit.c_validated_count,
  'postcheck_pass', approval_ready.value
    AND NOT EXISTS (SELECT 1 FROM final_rows WHERE final_state_matches IS DISTINCT FROM true)
    AND valid_active_overlaps.value = 0
    AND invalid_ranges.value = 0
    AND NOT EXISTS (SELECT 1 FROM date_cardinality WHERE applicable_valid_assignments <> 1)
    AND baseline_matches.value
    AND assignment_snapshot.value = approval.phase49_snapshot_hash
    AND repair_audit.a_voided_count = 1
    AND repair_audit.b_voided_count = 1
    AND repair_audit.c_validated_count = 1
) AS schedule_assignment_data_repair_postcheck
FROM valid_active_overlaps
CROSS JOIN invalid_ranges
CROSS JOIN downstream_counts
CROSS JOIN assignment_snapshot
CROSS JOIN repair_audit
CROSS JOIN baseline_matches
CROSS JOIN approval_ready
CROSS JOIN approval;

ROLLBACK;
