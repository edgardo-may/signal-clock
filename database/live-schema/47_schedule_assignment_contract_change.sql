-- Phase 47: definitive schedule-assignment contract DDL.
-- Bound to the reviewed Phase 46 production result on 2026-09-16.
BEGIN;

LOCK TABLE public.empleados_horarios IN SHARE ROW EXCLUSIVE MODE;

DO $phase47_guard$
DECLARE
  v_expected_snapshot_hash constant text := 'e22d6dc08b22e9c74343cc2d56439857';
  v_expected_assignment_count constant integer := 3;
  v_expected_active_assignment_count constant integer := 1;
  v_current_snapshot_hash text;
  v_assignment_count integer;
  v_active_assignment_count integer;
  v_invalid_range_count integer;
  v_active_overlap_count integer;
  v_unaudited_inactive_count integer;
  v_tenant_inconsistent_count integer;
  v_target_mismatch_count integer;
  v_extension_available boolean;
BEGIN
  IF v_expected_snapshot_hash IS NULL
     OR v_expected_assignment_count IS NULL
     OR v_expected_active_assignment_count IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_PRECHECK_REBIND_REQUIRED' USING ERRCODE = 'P0001',
      HINT = 'Run Phase 46, review its output, then bind its exact snapshot hash and counts before rerunning this file.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE activo IS TRUE),
    count(*) FILTER (WHERE fecha_inicio IS NULL OR (fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio))
  INTO v_assignment_count, v_active_assignment_count, v_invalid_range_count
  FROM public.empleados_horarios;

  SELECT count(*) INTO v_active_overlap_count
  FROM public.empleados_horarios left_assignment
  JOIN public.empleados_horarios right_assignment
    ON right_assignment.cliente_id = left_assignment.cliente_id
   AND right_assignment.empleado_id = left_assignment.empleado_id
   AND right_assignment.id > left_assignment.id
   AND left_assignment.activo IS TRUE AND right_assignment.activo IS TRUE
   AND left_assignment.fecha_inicio IS NOT NULL AND right_assignment.fecha_inicio IS NOT NULL
   AND daterange(left_assignment.fecha_inicio, COALESCE(left_assignment.fecha_fin, 'infinity'::date), '[]')
       && daterange(right_assignment.fecha_inicio, COALESCE(right_assignment.fecha_fin, 'infinity'::date), '[]');

  SELECT count(*) INTO v_unaudited_inactive_count
  FROM public.empleados_horarios assignment
  WHERE assignment.activo IS FALSE AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs audit
    WHERE audit.cliente_id = assignment.cliente_id
      AND audit.resource_id = assignment.id::text
      AND audit.action = 'SCHEDULE_VOIDED'
      AND audit.resource_type = U&'Asignaci\00F3n Horario'
      AND audit.metadata -> 'new_values' ->> 'classification' = 'VOIDED'
      AND audit.metadata -> 'new_values' ->> 'data_mutation' = 'false'
      AND audit.metadata ? 'old_values' AND audit.metadata ? 'reason'
  );

  SELECT count(*) INTO v_tenant_inconsistent_count
  FROM public.empleados_horarios assignment
  LEFT JOIN public.empleados employee ON employee.id = assignment.empleado_id AND employee.cliente_id = assignment.cliente_id
  LEFT JOIN public.horarios schedule ON schedule.id = assignment.horario_id AND schedule.cliente_id = assignment.cliente_id
  WHERE employee.id IS NULL OR schedule.id IS NULL;

  SELECT count(*) INTO v_target_mismatch_count
  FROM (VALUES
    ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid, false, DATE '2026-08-08', NULL::date, 'SCHEDULE_VOIDED'),
    ('56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid, false, DATE '2026-09-03', DATE '2026-09-13', 'SCHEDULE_VOIDED'),
    ('2984316c-1c93-4f66-853e-349f90b9f82c'::uuid, true, DATE '2026-09-09', NULL::date, 'SCHEDULE_VALIDATED')
  ) AS expected(id, activo, fecha_inicio, fecha_fin, audit_action)
  LEFT JOIN public.empleados_horarios assignment ON assignment.id = expected.id
  WHERE assignment.id IS NULL
     OR assignment.activo IS DISTINCT FROM expected.activo
     OR assignment.fecha_inicio IS DISTINCT FROM expected.fecha_inicio
     OR assignment.fecha_fin IS DISTINCT FROM expected.fecha_fin
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_logs audit
       WHERE audit.cliente_id = assignment.cliente_id AND audit.resource_id = expected.id::text
         AND audit.action = expected.audit_action
         AND audit.metadata ->> 'correlation_id' = 'a7b24037-d23a-4804-a3c3-1670f551c67a'
         AND audit.metadata ->> 'phase49_snapshot_hash' = 'ec8102bf5c15f153adc27d56a3419d85'
     );

  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'cliente_id', cliente_id, 'empleado_id', empleado_id, 'horario_id', horario_id,
    'activo', activo, 'fecha_inicio', fecha_inicio, 'fecha_fin', fecha_fin,
    'creado_at', creado_at, 'actualizado_at', actualizado_at
  ) ORDER BY id)::text, '[]')) INTO v_current_snapshot_hash
  FROM public.empleados_horarios;

  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') INTO v_extension_available;

  IF v_invalid_range_count <> 0 OR v_active_overlap_count <> 0
     OR v_unaudited_inactive_count <> 0 OR v_tenant_inconsistent_count <> 0
     OR v_target_mismatch_count <> 0 OR NOT v_extension_available
     OR v_assignment_count <> v_expected_assignment_count
     OR v_active_assignment_count <> v_expected_active_assignment_count
     OR v_current_snapshot_hash IS DISTINCT FROM v_expected_snapshot_hash THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_CONTRACT_PRECONDITION_FAILED' USING ERRCODE = 'P0001',
      DETAIL = format('invalid_ranges=%s active_overlaps=%s unaudited_inactive=%s tenant_inconsistent=%s target_mismatch=%s assignment_count=%s active_count=%s snapshot=%s', v_invalid_range_count, v_active_overlap_count, v_unaudited_inactive_count, v_tenant_inconsistent_count, v_target_mismatch_count, v_assignment_count, v_active_assignment_count, v_current_snapshot_hash),
      HINT = 'Do not repair automatically. Re-run and review Phase 46; rebind only its exact fresh snapshot and counts.';
  END IF;
END
$phase47_guard$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $phase47_extension$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_BTREE_GIST_INSTALL_FAILED' USING ERRCODE = 'P0001';
  END IF;
END
$phase47_extension$;

DO $phase47_ddl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.empleados_horarios'::regclass AND attname = 'fecha_inicio' AND attnotnull) THEN
    ALTER TABLE public.empleados_horarios ALTER COLUMN fecha_inicio SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.empleados_horarios'::regclass AND conname = 'empleados_horarios_valid_effective_range') THEN
    ALTER TABLE public.empleados_horarios ADD CONSTRAINT empleados_horarios_valid_effective_range CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.empleados_horarios'::regclass AND conname = 'empleados_horarios_no_valid_range_overlap') THEN
    ALTER TABLE public.empleados_horarios ADD CONSTRAINT empleados_horarios_no_valid_range_overlap
      EXCLUDE USING gist (cliente_id WITH =, empleado_id WITH =,
        daterange(fecha_inicio, COALESCE(fecha_fin, 'infinity'::date), '[]') WITH &&)
      WHERE (activo IS TRUE);
  END IF;
END
$phase47_ddl$;

COMMIT;
