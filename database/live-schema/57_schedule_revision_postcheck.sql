-- Signum Clock / Phase 57: immutable schedule revision postcheck. READ ONLY.
-- Rebind the approved Phase 55 assignment packet before execution.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_expected_snapshot_hash text := 'dad64dfa2920b3c00cb6aae75283a835'; -- PHASE 55 APPROVED
  v_expected_assignment_count integer := 3; -- PHASE 55 APPROVED
  v_expected_active_assignment_count integer := 1; -- PHASE 55 APPROVED
  v_expected_voided_assignment_count integer := 2; -- PHASE 55 APPROVED
  v_expected_attendance_rows integer := 40; -- PHASE 55 APPROVED
  v_expected_workday_records integer := 0; -- PHASE 55 APPROVED
  v_expected_workday_record_history integer := 0; -- PHASE 55 APPROVED
  v_expected_incidencias integer := 7; -- PHASE 55 APPROVED
BEGIN
  IF v_expected_snapshot_hash IS NULL OR v_expected_assignment_count IS NULL OR v_expected_active_assignment_count IS NULL OR v_expected_voided_assignment_count IS NULL OR v_expected_attendance_rows IS NULL OR v_expected_workday_records IS NULL OR v_expected_workday_record_history IS NULL OR v_expected_incidencias IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_POSTCHECK_REBIND_REQUIRED';
  END IF;
END $$;

WITH approval AS (
  SELECT 'dad64dfa2920b3c00cb6aae75283a835'::text AS expected_snapshot_hash, 3::integer AS expected_assignment_count, 1::integer AS expected_active_assignment_count, 2::integer AS expected_voided_assignment_count,
    40::integer AS expected_attendance_rows, 0::integer AS expected_workday_records, 0::integer AS expected_workday_record_history, 7::integer AS expected_incidencias -- PHASE 55 APPROVED
), assignment_state AS (
  SELECT count(*)::int AS assignment_count,count(*) FILTER(WHERE activo)::int AS active_assignment_count,count(*) FILTER(WHERE NOT activo)::int AS voided_assignment_count,
    md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),'')) AS assignment_snapshot_hash
  FROM public.empleados_horarios
), revision_contract AS (
  SELECT to_regclass('public.schedule_revisions') IS NOT NULL AS revisions_table_present,
    EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS pgcrypto_installed,
    to_regprocedure('public.schedule_revision_calculation_hash(jsonb)') IS NOT NULL AS calculation_hash_function_present,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='empleados_horarios' AND column_name='schedule_revision_id') AS assignment_revision_column_present,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.empleados_horarios'::regclass AND conname='empleados_horarios_schedule_revision_tenant_fkey') AS assignment_revision_fk_present,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.schedule_revisions'::regclass AND tgname='trg_prevent_schedule_revision_update' AND NOT tgisinternal) AS immutable_revision_trigger_present,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass AND tgname='trg_attach_schedule_revision' AND NOT tgisinternal) AS active_assignment_revision_trigger_present,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.horarios'::regclass AND tgname='trg_prevent_mutable_schedule_calculation_update' AND NOT tgisinternal) AS mutable_schedule_guard_present,
    EXISTS(SELECT 1 FROM pg_class WHERE oid='public.schedule_revisions'::regclass AND relrowsecurity) AS revision_rls_enabled,
    EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='schedule_revisions' AND policyname='schedule_revisions: SELECT tenant active' AND roles @> ARRAY['authenticated']::name[]) AS revision_tenant_select_policy_present,
    NOT coalesce(has_table_privilege('authenticated','public.schedule_revisions','INSERT, UPDATE, DELETE'),false) AS revision_authenticated_mutation_revoked,
    NOT coalesce(has_table_privilege('anon','public.schedule_revisions','SELECT'),false) AS revision_anon_read_revoked
), lifecycle_security AS (
  SELECT to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)') IS NOT NULL AS lifecycle_rpc_present,
    NOT EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='empleados_horarios' AND grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE','DELETE')) AS direct_assignment_dml_revoked
), targets AS (
  SELECT eh.id,eh.activo,eh.fecha_inicio,eh.fecha_fin,eh.schedule_revision_id,
    sr.horario_id AS revision_horario_id,sr.version,sr.integrity_hash,sr.config_snapshot,
    CASE WHEN eh.id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid THEN eh.activo IS TRUE AND eh.fecha_inicio='2026-09-09'::date AND eh.fecha_fin IS NULL AND sr.id IS NOT NULL AND sr.horario_id=eh.horario_id AND sr.version=1 AND sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot)
      WHEN eh.id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid) THEN eh.activo IS FALSE AND eh.schedule_revision_id IS NULL
      ELSE false END AS target_valid
  FROM public.empleados_horarios eh LEFT JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id
  WHERE eh.id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid,'2984316c-1c93-4f66-853e-349f90b9f82c'::uuid)
), target_summary AS (
  SELECT count(*)=3 AS target_count_matches,coalesce(bool_and(target_valid),false) AS targets_preserve_semantics,coalesce(jsonb_agg(to_jsonb(targets) ORDER BY id),'[]'::jsonb) AS target_evidence FROM targets
), target_tenant AS (
  SELECT cliente_id FROM public.empleados_horarios WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
), downstream_state AS (
  SELECT
    (SELECT count(*)::int FROM public.registro_asistencia ra WHERE ra.cliente_id=tt.cliente_id) AS attendance_rows,
    (SELECT count(*)::int FROM public.workday_records wr WHERE wr.cliente_id=tt.cliente_id) AS workday_records,
    (SELECT count(*)::int FROM public.workday_record_history wrh WHERE wrh.cliente_id=tt.cliente_id) AS workday_record_history,
    (SELECT count(*)::int FROM public.incidencias i WHERE i.cliente_id=tt.cliente_id) AS incidencias
  FROM target_tenant tt
)
SELECT '57_schedule_revision_postcheck' AS phase,true AS read_only,a.*,rc.*,ls.*,ts.*,ds.*,
  (a.assignment_snapshot_hash=ap.expected_snapshot_hash AND a.assignment_count=ap.expected_assignment_count AND a.active_assignment_count=ap.expected_active_assignment_count AND a.voided_assignment_count=ap.expected_voided_assignment_count AND ds.attendance_rows=ap.expected_attendance_rows AND ds.workday_records=ap.expected_workday_records AND ds.workday_record_history=ap.expected_workday_record_history AND ds.incidencias=ap.expected_incidencias AND rc.revisions_table_present AND rc.pgcrypto_installed AND rc.calculation_hash_function_present AND rc.assignment_revision_column_present AND rc.assignment_revision_fk_present AND rc.immutable_revision_trigger_present AND rc.active_assignment_revision_trigger_present AND rc.mutable_schedule_guard_present AND rc.revision_rls_enabled AND rc.revision_tenant_select_policy_present AND rc.revision_authenticated_mutation_revoked AND rc.revision_anon_read_revoked AND ls.lifecycle_rpc_present AND ls.direct_assignment_dml_revoked AND ts.target_count_matches AND ts.targets_preserve_semantics) AS postcheck_pass
FROM approval ap CROSS JOIN assignment_state a CROSS JOIN revision_contract rc CROSS JOIN lifecycle_security ls CROSS JOIN target_summary ts CROSS JOIN downstream_state ds;

ROLLBACK;
