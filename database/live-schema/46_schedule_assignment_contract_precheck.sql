-- Phase 46: schedule-assignment contract precheck.
-- READ ONLY. It classifies inactive rows as VOIDED only from approved audit facts.
BEGIN TRANSACTION READ ONLY;

WITH approved_void_audit AS (
  SELECT DISTINCT audit.cliente_id, audit.resource_id::uuid AS assignment_id
  FROM public.audit_logs audit
  WHERE audit.action = 'SCHEDULE_VOIDED'
    AND audit.resource_type = U&'Asignaci\00F3n Horario'
    AND audit.resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND audit.metadata -> 'new_values' ->> 'classification' = 'VOIDED'
    AND audit.metadata -> 'new_values' ->> 'data_mutation' = 'false'
    AND audit.metadata ? 'old_values' AND audit.metadata ? 'reason'
), assignment_rows AS (
  SELECT eh.id, eh.cliente_id, eh.empleado_id, eh.horario_id, eh.activo,
    eh.fecha_inicio, eh.fecha_fin, eh.creado_at, eh.actualizado_at,
    employee.id IS NOT NULL AS employee_tenant_matches,
    schedule.id IS NOT NULL AS schedule_tenant_matches,
    void_audit.assignment_id IS NOT NULL AS has_approved_void_audit,
    eh.fecha_inicio IS NULL OR (eh.fecha_fin IS NOT NULL AND eh.fecha_fin < eh.fecha_inicio) AS invalid_range,
    CASE WHEN eh.fecha_inicio IS NULL OR (eh.fecha_fin IS NOT NULL AND eh.fecha_fin < eh.fecha_inicio)
      THEN NULL::daterange
      ELSE daterange(eh.fecha_inicio, COALESCE(eh.fecha_fin, 'infinity'::date), '[]') END AS effective_range
  FROM public.empleados_horarios eh
  LEFT JOIN public.empleados employee ON employee.id = eh.empleado_id AND employee.cliente_id = eh.cliente_id
  LEFT JOIN public.horarios schedule ON schedule.id = eh.horario_id AND schedule.cliente_id = eh.cliente_id
  LEFT JOIN approved_void_audit void_audit ON void_audit.assignment_id = eh.id AND void_audit.cliente_id = eh.cliente_id
), active_overlap_pairs AS (
  SELECT left_assignment.id AS left_assignment_id, right_assignment.id AS right_assignment_id
  FROM assignment_rows left_assignment
  JOIN assignment_rows right_assignment
    ON right_assignment.cliente_id = left_assignment.cliente_id
   AND right_assignment.empleado_id = left_assignment.empleado_id
   AND right_assignment.id > left_assignment.id
   AND left_assignment.activo IS TRUE AND right_assignment.activo IS TRUE
   AND NOT left_assignment.invalid_range AND NOT right_assignment.invalid_range
   AND left_assignment.effective_range && right_assignment.effective_range
), classified AS (
  SELECT assignment_row.*,
    EXISTS (SELECT 1 FROM active_overlap_pairs pair WHERE pair.left_assignment_id = assignment_row.id OR pair.right_assignment_id = assignment_row.id) AS has_active_overlap,
    CASE
      WHEN assignment_row.invalid_range THEN 'INVALID_RANGE'
      WHEN NOT assignment_row.employee_tenant_matches THEN 'EMPLOYEE_TENANT_MISMATCH'
      WHEN NOT assignment_row.schedule_tenant_matches THEN 'SCHEDULE_TENANT_MISMATCH'
      WHEN assignment_row.activo IS FALSE AND assignment_row.has_approved_void_audit THEN 'VOIDED'
      WHEN assignment_row.activo IS FALSE THEN 'UNRESOLVABLE_INACTIVE'
      WHEN EXISTS (SELECT 1 FROM active_overlap_pairs pair WHERE pair.left_assignment_id = assignment_row.id OR pair.right_assignment_id = assignment_row.id) THEN 'ACTIVE_OVERLAP'
      WHEN assignment_row.fecha_inicio > CURRENT_DATE THEN 'VALID_FUTURE'
      WHEN assignment_row.fecha_fin IS NOT NULL AND assignment_row.fecha_fin < CURRENT_DATE THEN 'VALID_HISTORICAL'
      WHEN CURRENT_DATE <@ assignment_row.effective_range THEN 'VALID_CURRENT'
      ELSE 'VALID_HISTORICAL'
    END AS classification
  FROM assignment_rows assignment_row
), assignment_snapshot AS (
  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'cliente_id', cliente_id, 'empleado_id', empleado_id, 'horario_id', horario_id,
    'activo', activo, 'fecha_inicio', fecha_inicio, 'fecha_fin', fecha_fin,
    'creado_at', creado_at, 'actualizado_at', actualizado_at
  ) ORDER BY id)::text, '[]')) AS value FROM assignment_rows
), target_expected AS (
  SELECT * FROM (VALUES
    ('A', 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid, false, DATE '2026-08-08', NULL::date, 'VOIDED', 'SCHEDULE_VOIDED'),
    ('B', '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid, false, DATE '2026-09-03', DATE '2026-09-13', 'VOIDED', 'SCHEDULE_VOIDED'),
    ('C', '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid, true, DATE '2026-09-09', NULL::date, 'VALID_CURRENT', 'SCHEDULE_VALIDATED')
  ) AS expected(label, id, activo, fecha_inicio, fecha_fin, classification, audit_action)
), target_decisions AS (
  SELECT expected.*, classified.classification AS actual_classification,
    classified.activo IS NOT DISTINCT FROM expected.activo
      AND classified.fecha_inicio IS NOT DISTINCT FROM expected.fecha_inicio
      AND classified.fecha_fin IS NOT DISTINCT FROM expected.fecha_fin
      AND classified.classification = expected.classification AS state_matches,
    EXISTS (SELECT 1 FROM public.audit_logs audit
      WHERE audit.cliente_id = classified.cliente_id AND audit.resource_id = expected.id::text
        AND audit.action = expected.audit_action
        AND audit.metadata ->> 'correlation_id' = 'a7b24037-d23a-4804-a3c3-1670f551c67a'
        AND audit.metadata ->> 'phase49_snapshot_hash' = 'ec8102bf5c15f153adc27d56a3419d85') AS required_audit_exists
  FROM target_expected expected LEFT JOIN classified ON classified.id = expected.id
), summary AS (
  SELECT count(*) FILTER (WHERE invalid_range) AS invalid_ranges,
    (SELECT count(*) FROM active_overlap_pairs) AS active_overlap_pairs,
    count(*) FILTER (WHERE has_active_overlap) AS active_overlap_rows,
    count(*) FILTER (WHERE classification = 'UNRESOLVABLE_INACTIVE') AS unaudited_inactive_rows,
    count(*) FILTER (WHERE classification IN ('EMPLOYEE_TENANT_MISMATCH', 'SCHEDULE_TENANT_MISMATCH')) AS tenant_inconsistent_rows,
    count(*) FILTER (WHERE classification IN ('INVALID_RANGE', 'ACTIVE_OVERLAP', 'UNRESOLVABLE_INACTIVE', 'EMPLOYEE_TENANT_MISMATCH', 'SCHEDULE_TENANT_MISMATCH')) AS blocking_rows
  FROM classified
), extension_status AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS btree_gist_installed,
    EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') AS btree_gist_available
)
SELECT jsonb_build_object(
  'phase', '46_schedule_assignment_contract_precheck',
  'read_only', current_setting('transaction_read_only'),
  'interval_model', '[fecha_inicio, fecha_fin] inclusive; NULL fecha_fin = infinity',
  'assignment_snapshot_hash', assignment_snapshot.value,
  'assignment_count', (SELECT count(*) FROM classified),
  'active_assignment_count', (SELECT count(*) FROM classified WHERE activo IS TRUE),
  'invalid_ranges', summary.invalid_ranges,
  'active_overlap_rows', summary.active_overlap_rows,
  'active_overlap_pairs', summary.active_overlap_pairs,
  'unaudited_inactive_rows', summary.unaudited_inactive_rows,
  'tenant_inconsistent_rows', summary.tenant_inconsistent_rows,
  'btree_gist_installed', extension_status.btree_gist_installed,
  'btree_gist_available', extension_status.btree_gist_available,
  'target_decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'label', label, 'assignment_id', id, 'expected_classification', classification,
    'actual_classification', actual_classification, 'state_matches', state_matches,
    'required_audit_exists', required_audit_exists) ORDER BY label) FROM target_decisions), '[]'::jsonb),
  'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'assignment_id', id, 'cliente_id', cliente_id, 'empleado_id', empleado_id, 'horario_id', horario_id,
    'activo', activo, 'fecha_inicio', fecha_inicio, 'fecha_fin', fecha_fin,
    'classification', classification, 'has_approved_void_audit', has_approved_void_audit,
    'has_active_overlap', has_active_overlap) ORDER BY cliente_id, empleado_id, fecha_inicio, id) FROM classified), '[]'::jsonb),
  'manual_decision_required', summary.blocking_rows <> 0 OR EXISTS (SELECT 1 FROM target_decisions WHERE state_matches IS DISTINCT FROM TRUE OR required_audit_exists IS DISTINCT FROM TRUE),
  'safe_to_apply_contract_change', summary.blocking_rows = 0
    AND extension_status.btree_gist_available
    AND NOT EXISTS (SELECT 1 FROM target_decisions WHERE state_matches IS DISTINCT FROM TRUE OR required_audit_exists IS DISTINCT FROM TRUE)
) AS schedule_assignment_contract_precheck
FROM summary CROSS JOIN assignment_snapshot CROSS JOIN extension_status;

ROLLBACK;
