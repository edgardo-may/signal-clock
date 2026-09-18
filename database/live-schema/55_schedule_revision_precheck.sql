-- Signum Clock / Phase 55: immutable schedule revision precheck.
-- Read-only evidence only. Do not infer a historical configuration.
BEGIN TRANSACTION READ ONLY;

WITH required_columns AS (
  SELECT * FROM (VALUES
    ('horarios','id'),('horarios','cliente_id'),('horarios','dias_config'),('horarios','tolerancia_minutos'),('horarios','activo'),('horarios','creado_at'),('horarios','actualizado_at'),
    ('empleados_horarios','id'),('empleados_horarios','cliente_id'),('empleados_horarios','empleado_id'),('empleados_horarios','horario_id'),('empleados_horarios','fecha_inicio'),('empleados_horarios','fecha_fin'),('empleados_horarios','activo')
  ) AS required(table_name,column_name)
), schema_check AS (
  SELECT count(*) FILTER (WHERE c.column_name IS NULL)::int AS missing_required_columns
  FROM required_columns r LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
), assignments AS (
  SELECT count(*)::int AS assignment_count,
    count(*) FILTER (WHERE activo)::int AS active_assignment_count,
    count(*) FILTER (WHERE NOT activo)::int AS voided_assignment_count,
    md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),'')) AS assignment_snapshot_hash
  FROM public.empleados_horarios
), schedule_usage AS (
  SELECT count(*)::int AS total_schedules,
    count(*) FILTER (WHERE exists(SELECT 1 FROM public.empleados_horarios eh WHERE eh.horario_id=h.id))::int AS schedules_used_by_assignments,
    count(*) FILTER (WHERE h.dias_config IS NULL OR jsonb_typeof(h.dias_config) <> 'object' OR h.tolerancia_minutos IS NULL)::int AS schedules_with_missing_calculation_config,
    count(*) FILTER (WHERE h.dias_config IS NOT NULL AND jsonb_typeof(h.dias_config)='object' AND NOT (h.dias_config ?& ARRAY['lun','mar','mie','jue','vie','sab','dom']))::int AS schedules_with_incomplete_week
  FROM public.horarios h
), targets AS (
  SELECT eh.id, eh.cliente_id, eh.empleado_id, eh.horario_id, eh.fecha_inicio, eh.fecha_fin, eh.activo,
    h.dias_config, h.tolerancia_minutos, h.activo AS horario_activo, h.creado_at AS horario_creado_at, h.actualizado_at AS horario_actualizado_at,
    CASE
      WHEN eh.id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
       AND eh.activo IS TRUE AND eh.fecha_inicio='2026-09-09'::date AND eh.fecha_fin IS NULL
       AND h.id IS NOT NULL AND h.cliente_id=eh.cliente_id
       AND h.dias_config IS NOT NULL AND jsonb_typeof(h.dias_config)='object'
       AND h.dias_config ?& ARRAY['lun','mar','mie','jue','vie','sab','dom']
       AND h.tolerancia_minutos IS NOT NULL
       AND h.creado_at::date <= eh.fecha_inicio AND h.actualizado_at::date <= eh.fecha_inicio
      THEN true ELSE false END AS deterministic_current_revision_candidate,
    CASE
      WHEN eh.id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid)
       AND eh.activo IS FALSE THEN true ELSE false END AS voided_history_must_remain_unlinked
  FROM public.empleados_horarios eh
  LEFT JOIN public.horarios h ON h.id=eh.horario_id
  WHERE eh.id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid,'2984316c-1c93-4f66-853e-349f90b9f82c'::uuid)
), target_summary AS (
  SELECT count(*)::int AS target_assignment_count,
    count(*) FILTER (WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AND deterministic_current_revision_candidate)::int AS deterministic_current_candidate_count,
    count(*) FILTER (WHERE id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid) AND voided_history_must_remain_unlinked)::int AS voided_history_unlinked_count,
    coalesce(jsonb_agg(jsonb_build_object('assignment_id',id,'horario_id',horario_id,'activo',activo,'fecha_inicio',fecha_inicio,'fecha_fin',fecha_fin,'deterministic_current_revision_candidate',deterministic_current_revision_candidate,'voided_history_must_remain_unlinked',voided_history_must_remain_unlinked) ORDER BY id),'[]'::jsonb) AS target_evidence
  FROM targets
), revision_state AS (
  SELECT to_regclass('public.schedule_revisions') IS NOT NULL AS revisions_table_already_exists,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='empleados_horarios' AND column_name='schedule_revision_id') AS assignment_revision_column_already_exists,
    EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pgcrypto') AS pgcrypto_available,
    EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS pgcrypto_installed
), target_tenant AS (
  SELECT cliente_id FROM targets WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
), downstream_baseline AS (
  SELECT
    (SELECT count(*)::int FROM public.registro_asistencia ra WHERE ra.cliente_id=tt.cliente_id) AS attendance_rows,
    (SELECT count(*)::int FROM public.workday_records wr WHERE wr.cliente_id=tt.cliente_id) AS workday_records,
    (SELECT count(*)::int FROM public.workday_record_history wrh WHERE wrh.cliente_id=tt.cliente_id) AS workday_record_history,
    (SELECT count(*)::int FROM public.incidencias i WHERE i.cliente_id=tt.cliente_id) AS incidencias
  FROM target_tenant tt
)
SELECT '55_schedule_revision_precheck' AS phase, true AS read_only,
  a.*, su.*, sc.missing_required_columns, ts.*, rs.*, db.*,
  (sc.missing_required_columns=0 AND a.assignment_count=3 AND a.active_assignment_count=1 AND a.voided_assignment_count=2 AND ts.target_assignment_count=3 AND ts.deterministic_current_candidate_count=1 AND ts.voided_history_unlinked_count=2 AND NOT rs.revisions_table_already_exists AND NOT rs.assignment_revision_column_already_exists AND rs.pgcrypto_available AND su.schedules_with_missing_calculation_config=0) AS safe_to_apply_schedule_revision_change
FROM assignments a CROSS JOIN schedule_usage su CROSS JOIN schema_check sc CROSS JOIN target_summary ts CROSS JOIN revision_state rs CROSS JOIN downstream_baseline db;

ROLLBACK;
