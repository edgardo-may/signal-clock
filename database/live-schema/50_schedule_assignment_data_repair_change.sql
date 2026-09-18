-- Phase 50: one approved, audit-only normalization transaction.
-- The assignment rows are already correct; this file writes only audit evidence.
BEGIN;

DO $phase50$
DECLARE
  v_correlation_id constant uuid := 'a7b24037-d23a-4804-a3c3-1670f551c67a'::uuid;
  v_expected_snapshot_hash constant text := 'ec8102bf5c15f153adc27d56a3419d85';
  v_actor_user_id uuid := auth.uid();
  v_actor_role constant text := 'SQL_EDITOR_ADMINISTRATIVE_DECISION';
  v_actor_context constant text := 'SQL_EDITOR_ADMINISTRATIVE_DECISION_NO_AUTH_UID';
  v_a_reason constant text := 'Asignación histórica invalidada por decisión administrativa: no correspondió a un horario real vigente del empleado. Regularización de auditoría sin mutación de datos.';
  v_b_reason constant text := 'Asignación histórica invalidada por decisión administrativa: no correspondió a un horario real vigente del empleado. Regularización de auditoría sin mutación de datos.';
  v_c_reason constant text := 'Asignación vigente validada por decisión administrativa como único horario real del empleado desde 2026-09-09. Regularización de auditoría sin mutación de datos.';
  v_current_snapshot_hash text;
  v_assignment_count integer;
  v_active_assignment_count integer;
  v_a_state jsonb;
  v_b_state jsonb;
  v_c_state jsonb;
BEGIN
  PERFORM 1 FROM public.empleados_horarios
  WHERE id IN (
    'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,
    '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid,
    '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
  ) FOR SHARE;

  SELECT count(*), count(*) FILTER (WHERE activo IS TRUE)
  INTO v_assignment_count, v_active_assignment_count
  FROM public.empleados_horarios
  WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid;

  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'label', row.label, 'id', row.id, 'cliente_id', row.cliente_id,
    'empleado_id', row.empleado_id, 'horario_id', row.horario_id,
    'activo', row.activo, 'fecha_inicio', row.fecha_inicio, 'fecha_fin', row.fecha_fin,
    'creado_at', row.creado_at, 'actualizado_at', row.actualizado_at, 'notas', row.notas
  ) ORDER BY row.label)::text, '[]'))
  INTO v_current_snapshot_hash
  FROM (
    SELECT 'A' AS label, id, cliente_id, empleado_id, horario_id, activo, fecha_inicio, fecha_fin, creado_at, actualizado_at, notas
    FROM public.empleados_horarios WHERE id = 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid
    UNION ALL
    SELECT 'B', id, cliente_id, empleado_id, horario_id, activo, fecha_inicio, fecha_fin, creado_at, actualizado_at, notas
    FROM public.empleados_horarios WHERE id = '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid
    UNION ALL
    SELECT 'C', id, cliente_id, empleado_id, horario_id, activo, fecha_inicio, fecha_fin, creado_at, actualizado_at, notas
    FROM public.empleados_horarios WHERE id = '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
  ) row;

  IF v_assignment_count <> 3
     OR v_active_assignment_count <> 1
     OR v_current_snapshot_hash IS DISTINCT FROM v_expected_snapshot_hash THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_REPAIR_DRIFT_DETECTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'id', assignment.id,
    'cliente_id', assignment.cliente_id,
    'empleado_id', assignment.empleado_id,
    'horario_id', assignment.horario_id,
    'activo', assignment.activo,
    'fecha_inicio', assignment.fecha_inicio,
    'fecha_fin', assignment.fecha_fin
  ) INTO v_a_state FROM public.empleados_horarios assignment
  WHERE id = 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid
    AND cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
    AND horario_id = 'd25454a9-b206-4c55-85ec-311cd089bba3'::uuid
    AND activo IS FALSE AND fecha_inicio = DATE '2026-08-08' AND fecha_fin IS NULL;
  SELECT jsonb_build_object(
    'id', assignment.id,
    'cliente_id', assignment.cliente_id,
    'empleado_id', assignment.empleado_id,
    'horario_id', assignment.horario_id,
    'activo', assignment.activo,
    'fecha_inicio', assignment.fecha_inicio,
    'fecha_fin', assignment.fecha_fin
  ) INTO v_b_state FROM public.empleados_horarios assignment
  WHERE id = '56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid
    AND cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
    AND horario_id = 'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid
    AND activo IS FALSE AND fecha_inicio = DATE '2026-09-03' AND fecha_fin = DATE '2026-09-13';
  SELECT jsonb_build_object(
    'id', assignment.id,
    'cliente_id', assignment.cliente_id,
    'empleado_id', assignment.empleado_id,
    'horario_id', assignment.horario_id,
    'activo', assignment.activo,
    'fecha_inicio', assignment.fecha_inicio,
    'fecha_fin', assignment.fecha_fin
  ) INTO v_c_state FROM public.empleados_horarios assignment
  WHERE id = '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
    AND cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
    AND horario_id = '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid
    AND activo IS TRUE AND fecha_inicio = DATE '2026-09-09' AND fecha_fin IS NULL;

  IF v_a_state IS NULL OR v_b_state IS NULL OR v_c_state IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_REPAIR_OLD_STATE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audit_logs audit
    WHERE audit.cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
      AND (
        (audit.resource_id = 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f' AND audit.action = 'SCHEDULE_VOIDED')
        OR (audit.resource_id = '56f8c98d-5fe1-49d2-abe2-42182a4a830a' AND audit.action = 'SCHEDULE_VOIDED')
        OR (audit.resource_id = '2984316c-1c93-4f66-853e-349f90b9f82c' AND audit.action = 'SCHEDULE_VALIDATED')
      )
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_DECISION_AUDIT_ALREADY_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_logs (cliente_id, actor_user_id, actor_role, action, resource_type, resource_id, result, metadata)
  SELECT '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid, v_actor_user_id,
         v_actor_role,
         decision.action, U&'Asignaci\00F3n Horario', decision.assignment_id::text, 'SUCCESS',
         jsonb_build_object(
           'assignment_id', decision.assignment_id,
           'cliente_id', '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid,
           'empleado_id', '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid,
           'horario_id', decision.horario_id,
           'reason', decision.reason,
           'actor_context', v_actor_context,
           'correlation_id', v_correlation_id,
           'phase49_snapshot_hash', v_expected_snapshot_hash,
           'decision_recorded_at', clock_timestamp(),
           'old_values', decision.old_values,
           'new_values', jsonb_build_object(
             'classification', decision.classification,
             'data_mutation', false,
             'phase49_snapshot_hash', v_expected_snapshot_hash,
             'decision_source', 'HUMAN_APPROVED'
           )
         )
  FROM (VALUES
    ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid, 'd25454a9-b206-4c55-85ec-311cd089bba3'::uuid, 'SCHEDULE_VOIDED', v_a_reason, v_a_state, 'VOIDED'),
    ('56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid, 'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid, 'SCHEDULE_VOIDED', v_b_reason, v_b_state, 'VOIDED'),
    ('2984316c-1c93-4f66-853e-349f90b9f82c'::uuid, '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid, 'SCHEDULE_VALIDATED', v_c_reason, v_c_state, 'VALID_CURRENT')
  ) AS decision(assignment_id, horario_id, action, reason, old_values, classification);
END
$phase50$;

COMMIT;
