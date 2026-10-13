-- Additive correction to 118: replace an unstarted assignment on its start date.
-- Old assignment retained as inactive; revisions and Workdays preserved.
-- No changes to resolver rules, Attendance or persistence contracts.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.assert_schedule_start_not_elapsed(date,jsonb)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass
      AND tgname='trg_guard_same_day_schedule_assignment' AND tgenabled IN ('O','A') AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass
      AND tgname='trg_guard_active_schedule_employee' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SCHEDULE_122_REQUIRES_118';
  END IF;
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
  v_action text := upper(trim(p_action)); v_today date := (clock_timestamp() AT TIME ZONE 'America/Cancun')::date;
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
    PERFORM 1 FROM public.empleados WHERE id=v_employee_id AND cliente_id=p_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH'; END IF;
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
        IF (p_effective_date=v_today OR v_old.fecha_inicio=p_effective_date) AND (
            EXISTS(SELECT 1 FROM public.registro_asistencia WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id
               AND verificado_at >= (p_effective_date::timestamp AT TIME ZONE 'America/Cancun'))
            OR EXISTS(SELECT 1 FROM public.attendance_source_events WHERE cliente_id=p_cliente_id AND employee_id=v_employee_id
               AND occurred_at >= (p_effective_date::timestamp AT TIME ZONE 'America/Cancun'))
            OR EXISTS(SELECT 1 FROM public.workday_records WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.workday_record_history WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.workday_calculation_revisions WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.workday_revision_promotions WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.attendance_persist_outbox o JOIN public.registro_asistencia r ON r.id=o.registro_id
               WHERE o.cliente_id=p_cliente_id AND o.empleado_id=v_employee_id
               AND r.verificado_at >= (p_effective_date::timestamp AT TIME ZONE 'America/Cancun'))) THEN
            RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_REPLACEMENT_HAS_EVIDENCE';
          END IF;
          IF v_old.fecha_inicio = p_effective_date THEN
          IF p_effective_date < v_today THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_HISTORICAL_REPLACEMENT_UNSUPPORTED'; END IF;
          v_old_json := to_jsonb(v_old);
          UPDATE public.empleados_horarios SET activo=false, actualizado_at=clock_timestamp() WHERE id=v_old.id RETURNING * INTO v_new;
          PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_VOIDED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',v_old_json,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp(),'replacement',true));
        ELSE
        v_old_json := to_jsonb(v_old);
        UPDATE public.empleados_horarios SET fecha_fin=p_effective_date-1, actualizado_at=clock_timestamp() WHERE id=v_old.id RETURNING * INTO v_new;
        PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_CLOSED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',v_old_json,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp()));
        END IF;
      END IF;
      INSERT INTO public.empleados_horarios(cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo,notas,actualizado_at)
      VALUES(p_cliente_id,v_employee_id,p_horario_id,p_effective_date,p_fecha_fin,true,trim(p_reason),clock_timestamp()) RETURNING * INTO v_new;
      PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_ASSIGNED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',NULL,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp(),'affected_attendance_count',v_attendance,'affected_workday_count',v_workdays));
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object('empleado_id',v_employee_id,'assignment_id',v_new.id,'action',v_action));
  END LOOP;
  RETURN jsonb_build_object('ok',true,'action',v_action,'correlation_id',p_correlation_id,'affected_attendance_count',v_attendance,'affected_workday_count',v_workdays,'results',v_results);
END $$;
REVOKE ALL ON FUNCTION public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
