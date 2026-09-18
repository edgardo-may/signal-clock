-- Signum Clock / Phase 53: install the atomic schedule lifecycle API.
-- DO NOT RUN until Phase 52 has been reviewed and the three expected values below
-- have been rebound to that production precheck output.
BEGIN ISOLATION LEVEL REPEATABLE READ;
LOCK TABLE public.empleados_horarios IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_expected_snapshot_hash text := 'dad64dfa2920b3c00cb6aae75283a835'; -- PHASE 52 APPROVED
  v_expected_assignment_count integer := 3; -- PHASE 52 APPROVED
  v_expected_active_assignment_count integer := 1; -- PHASE 52 APPROVED
  v_snapshot_hash text;
  v_assignment_count integer;
  v_active_assignment_count integer;
  v_invalid_ranges integer;
  v_overlap_pairs integer;
  v_tenant_inconsistent integer;
  v_unaudited_inactive integer;
  v_target_cliente_id uuid;
  v_attendance_baseline integer;
  v_workday_baseline integer;
  v_history_baseline integer;
  v_incident_baseline integer;
BEGIN
  IF v_expected_snapshot_hash IS NULL
     OR v_expected_assignment_count IS NULL
     OR v_expected_active_assignment_count IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_REBIND_REQUIRED: run and approve Phase 52 before Phase 53';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_BTREE_GIST_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='empleados_horarios' AND column_name='fecha_inicio' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.empleados_horarios'::regclass AND contype='x' AND pg_get_constraintdef(oid) ILIKE '%daterange%') THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_CONTRACT_MISSING';
  END IF;
  SELECT count(*)::int, count(*) FILTER (WHERE activo)::int,
         count(*) FILTER (WHERE fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio)::int,
         md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),''))
    INTO v_assignment_count, v_active_assignment_count, v_invalid_ranges, v_snapshot_hash
  FROM public.empleados_horarios;
  SELECT count(*)::int INTO v_overlap_pairs
  FROM public.empleados_horarios a JOIN public.empleados_horarios b
    ON a.id < b.id AND a.cliente_id=b.cliente_id AND a.empleado_id=b.empleado_id
   AND a.activo AND b.activo
   AND daterange(a.fecha_inicio,coalesce(a.fecha_fin,'infinity'::date),'[]') && daterange(b.fecha_inicio,coalesce(b.fecha_fin,'infinity'::date),'[]');
  SELECT count(*) FILTER (WHERE e.id IS NULL OR e.cliente_id IS DISTINCT FROM eh.cliente_id OR h.id IS NULL OR h.cliente_id IS DISTINCT FROM eh.cliente_id)::int,
         count(*) FILTER (WHERE eh.activo IS FALSE AND NOT EXISTS (SELECT 1 FROM public.audit_logs al WHERE al.cliente_id=eh.cliente_id AND al.resource_id=eh.id::text AND al.action='SCHEDULE_VOIDED' AND al.result='SUCCESS'))::int
    INTO v_tenant_inconsistent, v_unaudited_inactive
  FROM public.empleados_horarios eh LEFT JOIN public.empleados e ON e.id=eh.empleado_id LEFT JOIN public.horarios h ON h.id=eh.horario_id;
  IF v_snapshot_hash IS DISTINCT FROM v_expected_snapshot_hash OR v_assignment_count <> v_expected_assignment_count OR v_active_assignment_count <> v_expected_active_assignment_count THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_PRECHECK_DRIFT: snapshot/count mismatch';
  END IF;
  IF v_invalid_ranges <> 0 OR v_overlap_pairs <> 0 OR v_tenant_inconsistent <> 0 OR v_unaudited_inactive <> 0 THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_PRECHECK_UNSAFE: invalid=% overlap=% tenant=% unaudited_void=%', v_invalid_ranges, v_overlap_pairs, v_tenant_inconsistent, v_unaudited_inactive;
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.empleados_horarios', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.empleados_horarios', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.empleados_horarios', 'DELETE') THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_LEGACY_DML_GRANTS_UNEXPECTED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass AND tgname='trg_audit_empleados_horarios_changes' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_LEGACY_AUDIT_TRIGGER_UNEXPECTED';
  END IF;
  SELECT cliente_id INTO v_target_cliente_id FROM public.empleados_horarios WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid;
  IF v_target_cliente_id IS NULL THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_TARGET_TENANT_MISSING'; END IF;
  SELECT count(*)::int INTO v_attendance_baseline FROM public.registro_asistencia WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_workday_baseline FROM public.workday_records WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_history_baseline FROM public.workday_record_history WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_incident_baseline FROM public.incidencias WHERE cliente_id=v_target_cliente_id;
  PERFORM set_config('app.schedule_lifecycle.attendance_baseline',v_attendance_baseline::text,true);
  PERFORM set_config('app.schedule_lifecycle.workday_baseline',v_workday_baseline::text,true);
  PERFORM set_config('app.schedule_lifecycle.history_baseline',v_history_baseline::text,true);
  PERFORM set_config('app.schedule_lifecycle.incident_baseline',v_incident_baseline::text,true);
END $$;

CREATE OR REPLACE FUNCTION public.apply_employee_schedule_lifecycle(
  p_cliente_id uuid, p_empleado_ids uuid[], p_action text, p_horario_id uuid,
  p_effective_date date, p_fecha_fin date, p_assignment_id uuid, p_reason text,
  p_correlation_id uuid, p_retroactive_confirmed boolean DEFAULT false,
  p_preview_only boolean DEFAULT false
) RETURNS jsonb
-- SECURITY DEFINER is required because authenticated loses direct DML grants;
-- authorization is derived from auth.uid(), role and tenant below, never caller input.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_employee_id uuid; v_role text; v_old public.empleados_horarios%rowtype;
  v_new public.empleados_horarios%rowtype; v_schedule public.horarios%rowtype;
  v_old_json jsonb; v_results jsonb := '[]'::jsonb; v_attendance integer := 0; v_workdays integer := 0;
  v_action text := upper(trim(p_action)); v_today date := current_date;
BEGIN
  IF auth.uid() IS NULL OR p_cliente_id IS NULL OR coalesce(array_length(p_empleado_ids,1),0) = 0
     OR p_effective_date IS NULL OR nullif(trim(p_reason),'') IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_INVALID_ARGUMENTS';
  END IF;
  v_role := lower(coalesce(public.auth_current_role(),''));
  IF v_role NOT IN ('superadmin','admin','rh') OR NOT public.auth_cuenta_activa()
     OR (v_role <> 'superadmin' AND public.auth_current_cliente_id() IS DISTINCT FROM p_cliente_id) THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_FORBIDDEN';
  END IF;
  IF v_action NOT IN ('ASSIGN_OR_REPLACE','CLOSE','VOID') THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_INVALID_ACTION'; END IF;
  IF v_action IN ('ASSIGN_OR_REPLACE','VOID') AND p_horario_id IS NULL AND v_action='ASSIGN_OR_REPLACE' THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_SCHEDULE_REQUIRED'; END IF;
  IF p_fecha_fin IS NOT NULL AND p_fecha_fin < p_effective_date THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_INVALID_RANGE'; END IF;
  IF p_effective_date < v_today AND NOT p_preview_only AND NOT p_retroactive_confirmed THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_RETROACTIVE_CONFIRMATION_REQUIRED'; END IF;
  IF v_action='VOID' AND p_assignment_id IS NULL THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_VOID_ASSIGNMENT_REQUIRED'; END IF;
  IF v_action='VOID' AND coalesce(array_length(p_empleado_ids,1),0) <> 1 THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_VOID_SINGLE_EMPLOYEE_ONLY'; END IF;
  IF v_action='ASSIGN_OR_REPLACE' THEN
    SELECT * INTO v_schedule FROM public.horarios WHERE id=p_horario_id AND cliente_id=p_cliente_id AND activo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_SCHEDULE_TENANT_MISMATCH'; END IF;
  END IF;
  SELECT count(*)::int INTO v_attendance FROM public.registro_asistencia
    WHERE cliente_id=p_cliente_id AND empleado_id=ANY(p_empleado_ids) AND verificado_at::date >= p_effective_date;
  SELECT count(*)::int INTO v_workdays FROM public.workday_records WHERE cliente_id=p_cliente_id AND empleado_id=ANY(p_empleado_ids) AND workday_date >= p_effective_date;
  IF p_preview_only THEN
    IF p_effective_date >= v_today THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_PREVIEW_ONLY_RETROACTIVE'; END IF;
    RETURN jsonb_build_object('preview_only',true,'affected_attendance_count',v_attendance,'affected_workday_count',v_workdays,'effective_date',p_effective_date);
  END IF;
  FOR v_employee_id IN SELECT DISTINCT x FROM unnest(p_empleado_ids) x ORDER BY x LOOP
    IF NOT EXISTS (SELECT 1 FROM public.empleados WHERE id=v_employee_id AND cliente_id=p_cliente_id) THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text || ':' || v_employee_id::text, 0));
    PERFORM 1 FROM public.empleados_horarios WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND activo IS TRUE FOR UPDATE;
    IF v_action='VOID' THEN
      SELECT * INTO v_old FROM public.empleados_horarios WHERE id=p_assignment_id AND cliente_id=p_cliente_id AND empleado_id=v_employee_id FOR UPDATE;
      IF NOT FOUND OR v_old.activo IS FALSE THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_VOID_TARGET_INVALID'; END IF;
      v_old_json := to_jsonb(v_old);
      UPDATE public.empleados_horarios SET activo=false, actualizado_at=clock_timestamp() WHERE id=v_old.id RETURNING * INTO v_new;
      PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_VOIDED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',v_old_json,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp()));
    ELSIF v_action='CLOSE' THEN
      SELECT * INTO v_old FROM public.empleados_horarios WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND activo IS TRUE AND fecha_inicio <= p_effective_date AND (fecha_fin IS NULL OR fecha_fin >= p_effective_date) ORDER BY fecha_inicio DESC LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_CLOSE_TARGET_NOT_FOUND'; END IF;
      v_old_json := to_jsonb(v_old);
      UPDATE public.empleados_horarios SET fecha_fin=p_effective_date, actualizado_at=clock_timestamp() WHERE id=v_old.id RETURNING * INTO v_new;
      PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_CLOSED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',v_old_json,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp()));
    ELSE
      SELECT * INTO v_old FROM public.empleados_horarios WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND activo IS TRUE AND fecha_inicio <= p_effective_date AND (fecha_fin IS NULL OR fecha_fin >= p_effective_date) ORDER BY fecha_inicio DESC LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        IF v_old.fecha_inicio = p_effective_date THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_SAME_DAY_REPLACEMENT_UNSUPPORTED'; END IF;
        v_old_json := to_jsonb(v_old);
        UPDATE public.empleados_horarios SET fecha_fin=p_effective_date-1, actualizado_at=clock_timestamp() WHERE id=v_old.id RETURNING * INTO v_new;
        PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_CLOSED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',v_old_json,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp()));
      END IF;
      INSERT INTO public.empleados_horarios(cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo,notas,actualizado_at)
      VALUES(p_cliente_id,v_employee_id,p_horario_id,p_effective_date,p_fecha_fin,true,trim(p_reason),clock_timestamp()) RETURNING * INTO v_new;
      PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_ASSIGNED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',NULL,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp(),'affected_attendance_count',v_attendance,'affected_workday_count',v_workdays));
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object('empleado_id',v_employee_id,'assignment_id',v_new.id,'action',v_action));
  END LOOP;
  RETURN jsonb_build_object('ok',true,'action',v_action,'correlation_id',p_correlation_id,'affected_attendance_count',v_attendance,'affected_workday_count',v_workdays,'results',v_results);
END $$;

REVOKE ALL ON FUNCTION public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean) TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.empleados_horarios FROM authenticated;
GRANT SELECT ON public.empleados_horarios TO authenticated;

-- The old AFTER trigger emitted incomplete and duplicate audit events. Once the
-- hardened RPC and grants above exist, it has no authorized application writer.
DROP TRIGGER IF EXISTS trg_audit_empleados_horarios_changes ON public.empleados_horarios;

DO $$
DECLARE
  v_expected_snapshot_hash text := 'dad64dfa2920b3c00cb6aae75283a835';
  v_current_snapshot_hash text;
  v_assignment_count integer;
  v_active_assignment_count integer;
  v_target_cliente_id uuid;
  v_attendance_count integer;
  v_workday_count integer;
  v_history_count integer;
  v_incident_count integer;
BEGIN
  SELECT count(*)::int, count(*) FILTER (WHERE activo)::int,
         md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),''))
    INTO v_assignment_count, v_active_assignment_count, v_current_snapshot_hash
  FROM public.empleados_horarios;
  IF v_current_snapshot_hash IS DISTINCT FROM v_expected_snapshot_hash OR v_assignment_count <> 3 OR v_active_assignment_count <> 1 THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_INSTALLATION_CHANGED_ASSIGNMENTS';
  END IF;
  SELECT cliente_id INTO v_target_cliente_id FROM public.empleados_horarios WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid;
  SELECT count(*)::int INTO v_attendance_count FROM public.registro_asistencia WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_workday_count FROM public.workday_records WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_history_count FROM public.workday_record_history WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_incident_count FROM public.incidencias WHERE cliente_id=v_target_cliente_id;
  IF v_attendance_count <> current_setting('app.schedule_lifecycle.attendance_baseline')::integer
     OR v_workday_count <> current_setting('app.schedule_lifecycle.workday_baseline')::integer
     OR v_history_count <> current_setting('app.schedule_lifecycle.history_baseline')::integer
     OR v_incident_count <> current_setting('app.schedule_lifecycle.incident_baseline')::integer THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_INSTALLATION_CHANGED_DOWNSTREAM_DATA';
  END IF;
  IF to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)') AND prosecdef AND coalesce(array_to_string(proconfig,','),'') LIKE '%search_path=public, pg_temp%')
     OR NOT has_function_privilege('authenticated','public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)'::regprocedure,'EXECUTE')
     OR has_function_privilege('anon','public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean)'::regprocedure,'EXECUTE')
     OR has_table_privilege('authenticated','public.empleados_horarios','INSERT')
     OR has_table_privilege('authenticated','public.empleados_horarios','UPDATE')
     OR has_table_privilege('authenticated','public.empleados_horarios','DELETE')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass AND tgname='trg_audit_empleados_horarios_changes' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_INSTALLATION_HARDENING_FAILED';
  END IF;
END $$;
COMMIT;
