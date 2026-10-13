-- LOCAL / DBREAL first. Requires canonical 116; does not apply 116 automatically.
-- New schedules may start today only before today's scheduled entry in Cancun.
-- Existing revisions remain immutable and revisions/disables remain future-only.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.apply_schedule_catalog_revision(uuid,text,uuid,text,text,text,jsonb,date,text,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass
       AND tgname='trg_guard_active_schedule_employee' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SCHEDULE_118_REQUIRES_116';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_schedule_start_not_elapsed(p_date date,p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamp := clock_timestamp() AT TIME ZONE 'America/Cancun';
  v_key text; v_day jsonb; v_entry text;
BEGIN
  IF p_date IS NULL THEN RAISE EXCEPTION 'SCHEDULE_START_DATE_REQUIRED'; END IF;
  IF p_date <> v_now::date THEN RETURN; END IF;
  v_key := (ARRAY['lun','mar','mie','jue','vie','sab','dom'])[extract(isodow FROM p_date)::integer];
  v_day := p_snapshot->'dias_config'->v_key;
  v_entry := v_day->>'entrada';
  IF v_day->>'activo' IS DISTINCT FROM 'true' OR v_entry IS NULL
     OR v_entry !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'SCHEDULE_TODAY_HAS_NO_ACTIVE_ENTRY';
  END IF;
  IF p_date + v_entry::time <= v_now THEN
    RAISE EXCEPTION 'SCHEDULE_START_ALREADY_ELAPSED';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_schedule_start_not_elapsed(date,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.trg_guard_same_day_schedule_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_snapshot jsonb;
BEGIN
  IF NEW.activo IS TRUE AND NEW.fecha_inicio = (clock_timestamp() AT TIME ZONE 'America/Cancun')::date THEN
    SELECT sr.config_snapshot INTO v_snapshot FROM public.schedule_revisions sr
    WHERE sr.cliente_id=NEW.cliente_id AND sr.horario_id=NEW.horario_id
      AND sr.effective_from<=NEW.fecha_inicio
    ORDER BY sr.effective_from DESC,sr.version DESC LIMIT 1;
    IF v_snapshot IS NULL THEN RAISE EXCEPTION 'SCHEDULE_REVISION_REQUIRED_FOR_ACTIVE_ASSIGNMENT'; END IF;
    PERFORM public.assert_schedule_start_not_elapsed(NEW.fecha_inicio,v_snapshot);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_guard_same_day_schedule_assignment() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_guard_same_day_schedule_assignment ON public.empleados_horarios;
CREATE TRIGGER trg_guard_same_day_schedule_assignment BEFORE INSERT ON public.empleados_horarios
FOR EACH ROW EXECUTE FUNCTION public.trg_guard_same_day_schedule_assignment();

-- Canonical catalog RPC from 116 follows, with CREATE-only same-day validation.

CREATE OR REPLACE FUNCTION public.apply_schedule_catalog_revision(
  p_cliente_id uuid, p_action text, p_horario_id uuid, p_nombre text,
  p_descripcion text, p_color text, p_snapshot jsonb, p_effective_date date,
  p_reason text, p_correlation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_action text := upper(btrim(p_action)); v_role text; v_schedule public.horarios%rowtype;
  v_revision public.schedule_revisions%rowtype; v_old public.schedule_revisions%rowtype;
  v_assignment public.empleados_horarios%rowtype; v_new public.empleados_horarios%rowtype;
  v_day text; v_config jsonb; v_version integer; v_changed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR p_cliente_id IS NULL OR p_effective_date IS NULL
     OR p_effective_date < (clock_timestamp() AT TIME ZONE 'America/Cancun')::date
     OR (v_action <> 'CREATE' AND p_effective_date = (clock_timestamp() AT TIME ZONE 'America/Cancun')::date)
     OR p_correlation_id IS NULL
     OR nullif(btrim(p_reason),'') IS NULL OR nullif(btrim(p_nombre),'') IS NULL
     OR v_action IS NULL OR v_action NOT IN ('CREATE','REVISE','DISABLE') THEN
    RAISE EXCEPTION 'SCHEDULE_CATALOG_INVALID_ARGUMENTS';
  END IF;
  v_role := lower(coalesce(public.auth_current_role(),''));
  IF v_role NOT IN ('superadmin','admin','rh') OR NOT public.auth_cuenta_activa()
     OR (v_role <> 'superadmin' AND public.auth_current_cliente_id() IS DISTINCT FROM p_cliente_id) THEN
    RAISE EXCEPTION 'SCHEDULE_CATALOG_FORBIDDEN';
  END IF;
  IF p_snapshot->>'calculation_contract_version' IS DISTINCT FROM '1'
     OR jsonb_typeof(p_snapshot->'dias_config') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'tolerancia_minutos') IS DISTINCT FROM 'number'
     OR (p_snapshot->>'tolerancia_minutos')::numeric < 0
     OR (p_snapshot->>'tolerancia_minutos')::numeric <> trunc((p_snapshot->>'tolerancia_minutos')::numeric)
     OR jsonb_typeof(p_snapshot->'horario_activo') IS DISTINCT FROM 'boolean'
     OR (v_action='DISABLE' AND p_snapshot->>'horario_activo'<>'false')
     OR (v_action<>'DISABLE' AND p_snapshot->>'horario_activo'<>'true') THEN
    RAISE EXCEPTION 'SCHEDULE_CATALOG_INVALID_SNAPSHOT';
  END IF;
  FOREACH v_day IN ARRAY ARRAY['lun','mar','mie','jue','vie','sab','dom'] LOOP
    v_config := p_snapshot->'dias_config'->v_day;
    IF jsonb_typeof(v_config) IS DISTINCT FROM 'object' OR jsonb_typeof(v_config->'activo') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'SCHEDULE_CATALOG_INVALID_DAY';
    END IF;
    IF v_config->>'activo'='true' AND (
      coalesce(v_config->>'entrada','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR coalesce(v_config->>'salida','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ) THEN RAISE EXCEPTION 'SCHEDULE_CATALOG_INVALID_DAY'; END IF;
    IF (coalesce(v_config->>'descanso_inicio','')='') <> (coalesce(v_config->>'descanso_fin','')='') THEN
      RAISE EXCEPTION 'SCHEDULE_CATALOG_INVALID_BREAK';
    END IF;
  END LOOP;
  IF v_action='CREATE' THEN
    PERFORM public.assert_schedule_start_not_elapsed(p_effective_date,p_snapshot);
    IF p_horario_id IS NOT NULL THEN RAISE EXCEPTION 'SCHEDULE_CATALOG_NEW_ID_FORBIDDEN'; END IF;
    INSERT INTO public.horarios(cliente_id,nombre,descripcion,color,dias_config,tolerancia_minutos,activo)
    VALUES(p_cliente_id,btrim(p_nombre),p_descripcion,coalesce(p_color,'#4f46e5'),p_snapshot->'dias_config',(p_snapshot->>'tolerancia_minutos')::integer,true)
    RETURNING * INTO v_schedule;
    v_version := 1;
  ELSE
    SELECT * INTO v_schedule FROM public.horarios WHERE id=p_horario_id AND cliente_id=p_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_CATALOG_TENANT_MISMATCH'; END IF;
    SELECT * INTO v_old FROM public.schedule_revisions
      WHERE horario_id=v_schedule.id ORDER BY version DESC LIMIT 1;
    IF NOT FOUND OR v_old.effective_from >= p_effective_date THEN
      RAISE EXCEPTION 'SCHEDULE_CATALOG_REVISION_BOUNDARY_INVALID';
    END IF;
    IF v_old.config_snapshot->>'horario_activo'='false' THEN
      RAISE EXCEPTION 'SCHEDULE_CATALOG_ALREADY_DISABLED';
    END IF;
    UPDATE public.horarios SET nombre=btrim(p_nombre),descripcion=p_descripcion,
      color=coalesce(p_color,color),actualizado_at=clock_timestamp()
      WHERE id=v_schedule.id;
    v_version := v_old.version+1;
  END IF;
  INSERT INTO public.schedule_revisions(cliente_id,horario_id,version,effective_from,config_snapshot,integrity_hash,created_by,reason)
  VALUES(p_cliente_id,v_schedule.id,v_version,p_effective_date,p_snapshot,
    public.schedule_revision_calculation_hash(p_snapshot),auth.uid(),btrim(p_reason))
  RETURNING * INTO v_revision;
  PERFORM public.log_audit_event(p_cliente_id,
    CASE v_action WHEN 'CREATE' THEN 'SCHEDULE_CREATED' WHEN 'REVISE' THEN 'SCHEDULE_REVISED' ELSE 'SCHEDULE_DISABLED' END,
    'Horario',v_schedule.id::text,'SUCCESS',
    jsonb_build_object('cliente_id',p_cliente_id,'schedule_id',v_schedule.id,'revision_id',v_revision.id,
      'old_values',to_jsonb(v_old),'new_values',to_jsonb(v_revision),'reason',btrim(p_reason),
      'correlation_id',p_correlation_id,'actor_id',auth.uid(),'timestamp',clock_timestamp()));
  IF v_action<>'CREATE' THEN
    FOR v_assignment IN SELECT * FROM public.empleados_horarios
      WHERE cliente_id=p_cliente_id AND horario_id=v_schedule.id AND activo IS TRUE
        AND (fecha_fin IS NULL OR fecha_fin>=p_effective_date)
      ORDER BY empleado_id,fecha_inicio,id FOR UPDATE LOOP
      IF v_assignment.fecha_inicio < p_effective_date THEN
        UPDATE public.empleados_horarios SET fecha_fin=p_effective_date-1,actualizado_at=clock_timestamp()
          WHERE id=v_assignment.id RETURNING * INTO v_new;
        IF v_action='REVISE' THEN
          INSERT INTO public.empleados_horarios(cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo,notas,schedule_revision_id)
          VALUES(p_cliente_id,v_assignment.empleado_id,v_schedule.id,p_effective_date,v_assignment.fecha_fin,true,
            btrim(p_reason),v_revision.id) RETURNING * INTO v_new;
        END IF;
      ELSIF v_action='REVISE' THEN
        UPDATE public.empleados_horarios SET schedule_revision_id=v_revision.id,actualizado_at=clock_timestamp()
          WHERE id=v_assignment.id RETURNING * INTO v_new;
      ELSE
        UPDATE public.empleados_horarios SET activo=false,actualizado_at=clock_timestamp()
          WHERE id=v_assignment.id RETURNING * INTO v_new;
      END IF;
      v_changed := v_changed+1;
      PERFORM public.log_audit_event(p_cliente_id,
        CASE WHEN v_action='DISABLE' THEN 'SCHEDULE_ASSIGNMENT_DISABLED' ELSE 'SCHEDULE_REVISION_ASSIGNED' END,
        'Asignación Horario',v_assignment.id::text,'SUCCESS',
        jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_assignment.empleado_id,
          'schedule_id',v_schedule.id,'revision_id',v_revision.id,'old_values',to_jsonb(v_assignment),
          'new_values',to_jsonb(v_new),'reason',btrim(p_reason),'correlation_id',p_correlation_id,
          'actor_id',auth.uid(),'timestamp',clock_timestamp()));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('schedule_id',v_schedule.id,'revision_id',v_revision.id,
    'revision_version',v_revision.version,'effective_from',v_revision.effective_from,
    'assignments_changed',v_changed,'action',v_action);
END $$;


-- Preserve assignment RPC contract; derive its calendar day in Cancun, not session timezone.
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


COMMIT;
