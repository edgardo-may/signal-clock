-- Signum Clock / Phase 54: lifecycle postcheck. READ ONLY.
-- Rebind the three Phase 52 values before using this file after Phase 53.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_expected_snapshot_hash text := 'dad64dfa2920b3c00cb6aae75283a835'; -- PHASE 52 APPROVED
  v_expected_assignment_count integer := 3; -- PHASE 52 APPROVED
  v_expected_active_assignment_count integer := 1; -- PHASE 52 APPROVED
BEGIN
  IF v_expected_snapshot_hash IS NULL OR v_expected_assignment_count IS NULL OR v_expected_active_assignment_count IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_POSTCHECK_REBIND_REQUIRED';
  END IF;
END $$;

WITH approval AS (
  SELECT 'dad64dfa2920b3c00cb6aae75283a835'::text AS expected_snapshot_hash, 3::integer AS expected_assignment_count, 1::integer AS expected_active_assignment_count -- PHASE 52 APPROVED
), current_state AS (
  SELECT count(*)::int AS assignment_count,
         count(*) FILTER (WHERE activo)::int AS active_assignment_count,
         count(*) FILTER (WHERE fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio)::int AS invalid_ranges,
         md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),'')) AS assignment_snapshot_hash
  FROM public.empleados_horarios
), active_overlap_scan AS (
  SELECT count(*)::int AS active_overlap_pairs FROM public.empleados_horarios a JOIN public.empleados_horarios b
    ON a.id<b.id AND a.cliente_id=b.cliente_id AND a.empleado_id=b.empleado_id AND a.activo AND b.activo
   AND daterange(a.fecha_inicio,coalesce(a.fecha_fin,'infinity'::date),'[]') && daterange(b.fecha_inicio,coalesce(b.fecha_fin,'infinity'::date),'[]')
), contract AS (
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') AS btree_gist_installed,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='empleados_horarios' AND column_name='fecha_inicio' AND is_nullable='NO') AS fecha_inicio_not_null,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.empleados_horarios'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%fecha_fin%fecha_inicio%') AS range_check_present,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.empleados_horarios'::regclass AND contype='x' AND pg_get_constraintdef(oid) ILIKE '%daterange%') AS active_exclusion_present
), lifecycle AS (
  SELECT to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)') IS NOT NULL AS rpc_present,
    coalesce(has_function_privilege('authenticated',to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)'),'EXECUTE'),false) AS rpc_authenticated_execute,
    NOT coalesce(has_function_privilege('anon',to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)'),'EXECUTE'),false) AS rpc_anon_execute_revoked,
    NOT EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='empleados_horarios' AND grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE','DELETE')) AS authenticated_direct_dml_revoked,
    NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass AND tgname='trg_audit_empleados_horarios_changes' AND NOT tgisinternal) AS legacy_audit_trigger_retired,
    EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)') AND prosecdef AND coalesce(array_to_string(proconfig,','),'') LIKE '%search_path=public, pg_temp%') AS hardened_definer_rpc
), targets AS (
  SELECT id, cliente_id, activo, fecha_inicio,
    CASE WHEN id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid) THEN 'VOIDED'
         WHEN id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid THEN 'VALID_CURRENT' ELSE 'OTHER' END AS classification,
    CASE WHEN id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid)
           THEN activo IS FALSE AND EXISTS(SELECT 1 FROM public.audit_logs al WHERE al.cliente_id=eh.cliente_id AND al.resource_id=eh.id::text AND al.action='SCHEDULE_VOIDED' AND al.result='SUCCESS')
         WHEN id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
           THEN activo IS TRUE AND fecha_inicio='2026-09-09'::date AND EXISTS(SELECT 1 FROM public.audit_logs al WHERE al.cliente_id=eh.cliente_id AND al.resource_id=eh.id::text AND al.action='SCHEDULE_VALIDATED' AND al.result='SUCCESS')
         ELSE false END AS state_and_audit_valid
  FROM public.empleados_horarios eh
  WHERE id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid,'2984316c-1c93-4f66-853e-349f90b9f82c'::uuid)
), target_validation AS (
  SELECT count(*)=3 AS target_count_matches, coalesce(bool_and(state_and_audit_valid),false) AS target_states_and_audits_valid, coalesce(jsonb_agg(to_jsonb(targets) ORDER BY id),'[]'::jsonb) AS target_assignments
  FROM targets
)
SELECT '54_schedule_lifecycle_postcheck' AS phase, true AS read_only, cs.*, o.active_overlap_pairs, c.*, l.*, a.*, tv.*,
  (cs.assignment_snapshot_hash=a.expected_snapshot_hash AND cs.assignment_count=a.expected_assignment_count AND cs.active_assignment_count=a.expected_active_assignment_count AND cs.invalid_ranges=0 AND o.active_overlap_pairs=0 AND c.btree_gist_installed AND c.fecha_inicio_not_null AND c.range_check_present AND c.active_exclusion_present AND l.rpc_present AND l.rpc_authenticated_execute AND l.rpc_anon_execute_revoked AND l.authenticated_direct_dml_revoked AND l.legacy_audit_trigger_retired AND l.hardened_definer_rpc AND tv.target_count_matches AND tv.target_states_and_audits_valid) AS postcheck_pass
FROM approval a CROSS JOIN current_state cs CROSS JOIN active_overlap_scan o CROSS JOIN contract c CROSS JOIN lifecycle l CROSS JOIN target_validation tv;

ROLLBACK;
