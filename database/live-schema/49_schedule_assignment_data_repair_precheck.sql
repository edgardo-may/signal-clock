-- Phase 49: manual schedule-assignment repair precheck.
-- READ ONLY. This script does not authorize a repair; it captures the exact
-- pre-state that a separately approved Phase 50 must match.
BEGIN TRANSACTION READ ONLY;

WITH expected_assignments AS (
  SELECT * FROM (VALUES
    ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid, 'd25454a9-b206-4c55-85ec-311cd089bba3'::uuid, false, DATE '2026-08-08', NULL::date, 'A'),
    ('56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid, 'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid, false, DATE '2026-09-03', DATE '2026-09-13', 'B'),
    ('2984316c-1c93-4f66-853e-349f90b9f82c'::uuid, '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid, true, DATE '2026-09-09', NULL::date, 'C')
  ) AS expected(id, horario_id, activo, fecha_inicio, fecha_fin, label)
), actual_assignments AS (
  SELECT
    expected.label,
    expected.id AS expected_id,
    assignment.id,
    assignment.cliente_id,
    assignment.empleado_id,
    assignment.horario_id,
    assignment.activo,
    assignment.fecha_inicio,
    assignment.fecha_fin,
    assignment.creado_at,
    assignment.actualizado_at,
    assignment.notas,
    expected.horario_id = assignment.horario_id
      AND expected.activo IS NOT DISTINCT FROM assignment.activo
      AND expected.fecha_inicio IS NOT DISTINCT FROM assignment.fecha_inicio
      AND expected.fecha_fin IS NOT DISTINCT FROM assignment.fecha_fin
      AND assignment.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
      AND assignment.empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS old_state_matches
  FROM expected_assignments expected
  LEFT JOIN public.empleados_horarios assignment ON assignment.id = expected.id
), employee_assignment_count AS (
  SELECT count(*) AS value
  FROM public.empleados_horarios
  WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
), audit_evidence AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', audit.id, 'action', audit.action, 'actor_user_id', audit.actor_user_id,
    'actor_role', audit.actor_role, 'created_at', audit.created_at,
    'metadata', audit.metadata, 'result', audit.result
  ) ORDER BY audit.created_at, audit.id), '[]'::jsonb) AS value
  FROM public.audit_logs audit
  WHERE audit.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND audit.resource_id IN (
      'a290fc73-7ee6-4ea8-9e0e-8e92a683245f',
      '56f8c98d-5fe1-49d2-abe2-42182a4a830a',
      '2984316c-1c93-4f66-853e-349f90b9f82c'
    )
), attendance_baseline AS (
  SELECT jsonb_build_object(
    'total_rows', count(*),
    'rows_with_device_timezone', count(*) FILTER (WHERE device.timezone IS NOT NULL),
    'rows_without_device_timezone', count(*) FILTER (WHERE device.timezone IS NULL)
  ) AS value
  FROM public.registro_asistencia attendance
  LEFT JOIN public.devices device
    ON device.id = attendance.dispositivo_id
   AND device.cliente_id = attendance.cliente_id
  WHERE attendance.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND attendance.empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
), downstream_baseline AS (
  SELECT jsonb_build_object(
    'workday_records', (SELECT count(*) FROM public.workday_records WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid),
    'workday_record_history', (SELECT count(*) FROM public.workday_record_history WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid),
    'incidencias_for_employee', (SELECT count(*) FROM public.incidencias WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid),
    'incidencias_for_tenant', (SELECT count(*) FROM public.incidencias WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid)
  ) AS value
), snapshot AS (
  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'label', label, 'id', id, 'cliente_id', cliente_id, 'empleado_id', empleado_id,
    'horario_id', horario_id, 'activo', activo, 'fecha_inicio', fecha_inicio,
    'fecha_fin', fecha_fin, 'creado_at', creado_at, 'actualizado_at', actualizado_at,
    'notas', notas
  ) ORDER BY label)::text, '[]')) AS hash
  FROM actual_assignments
)
SELECT jsonb_build_object(
  'phase', '49_schedule_assignment_data_repair_precheck',
  'read_only', current_setting('transaction_read_only'),
  'tenant_id', '69095bd5-fee5-4237-a1a4-186dd88310ff',
  'employee_id', '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  'assignment_rows', COALESCE((SELECT jsonb_agg(to_jsonb(actual_assignments) ORDER BY label) FROM actual_assignments), '[]'::jsonb),
  'assignment_count', employee_assignment_count.value,
  'audit_evidence', audit_evidence.value,
  'attendance_baseline', attendance_baseline.value,
  'downstream_baseline', downstream_baseline.value,
  'snapshot_hash', snapshot.hash,
  'state_matches_expected', employee_assignment_count.value = 3
    AND NOT EXISTS (SELECT 1 FROM actual_assignments WHERE old_state_matches IS DISTINCT FROM true),
  'active_assignment_count', (SELECT count(*) FROM actual_assignments WHERE activo IS TRUE),
  'only_c_is_active', (SELECT count(*) = 1 FROM actual_assignments
    WHERE activo IS TRUE
      AND id = '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
      AND fecha_inicio = DATE '2026-09-09'
      AND fecha_fin IS NULL),
  'safe_to_repair', false,
  'blocked_reason', 'EXECUTION_APPROVAL_REQUIRED: human decisions are fixed (A/B VOIDED, C VALID_CURRENT), but Phase 50 remains intentionally blocked pending a fresh Phase 49 snapshot hash and a separately approved execution correlation.'
) AS schedule_assignment_data_repair_precheck
FROM employee_assignment_count
CROSS JOIN audit_evidence
CROSS JOIN attendance_baseline
CROSS JOIN downstream_baseline
CROSS JOIN snapshot;

ROLLBACK;
