-- Remove schedules from the operational catalog without deleting immutable evidence.
-- Active tenant admin or active superadmin only. LOCAL/DBREAL first.
BEGIN;
ALTER TABLE public.horarios ADD COLUMN archived_at timestamptz;
ALTER TABLE public.horarios ADD COLUMN archived_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.horarios ADD COLUMN archive_reason text;
ALTER TABLE public.horarios ADD CONSTRAINT horarios_archive_complete CHECK (
  (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
  OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND nullif(btrim(archive_reason),'') IS NOT NULL)
);

CREATE FUNCTION public.archive_schedule(p_schedule_id uuid,p_reason text,p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_schedule public.horarios%rowtype; v_role text;
BEGIN
  v_role:=lower(coalesce(public.auth_current_role(),''));
  IF auth.uid() IS NULL OR NOT public.auth_cuenta_activa() OR v_role NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'SCHEDULE_DELETE_FORBIDDEN';
  END IF;
  IF p_schedule_id IS NULL OR nullif(btrim(p_reason),'') IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_DELETE_INVALID_ARGUMENTS';
  END IF;
  SELECT * INTO v_schedule FROM public.horarios WHERE id=p_schedule_id FOR UPDATE;
  IF NOT FOUND OR (v_role<>'superadmin' AND v_schedule.cliente_id IS DISTINCT FROM public.auth_current_cliente_id()) THEN
    RAISE EXCEPTION 'SCHEDULE_DELETE_FORBIDDEN';
  END IF;
  IF v_schedule.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('schedule_id',v_schedule.id,'result','UNCHANGED');
  END IF;
  IF EXISTS(SELECT 1 FROM public.empleados_horarios WHERE horario_id=v_schedule.id
    AND cliente_id=v_schedule.cliente_id AND activo IS TRUE
    AND (fecha_fin IS NULL OR fecha_fin >= (clock_timestamp() AT TIME ZONE 'America/Cancun')::date)) THEN
    RAISE EXCEPTION 'SCHEDULE_DELETE_HAS_ACTIVE_ASSIGNMENTS';
  END IF;
  UPDATE public.horarios SET archived_at=clock_timestamp(),archived_by=auth.uid(),archive_reason=btrim(p_reason)
  WHERE id=v_schedule.id;
  PERFORM public.log_audit_event(v_schedule.cliente_id,'SCHEDULE_ARCHIVED','Horario',v_schedule.id::text,'SUCCESS',
    jsonb_build_object('actor_id',auth.uid(),'reason',btrim(p_reason),'correlation_id',p_correlation_id,
      'old_values',to_jsonb(v_schedule),'new_values',(SELECT to_jsonb(h) FROM public.horarios h WHERE id=v_schedule.id)));
  RETURN jsonb_build_object('schedule_id',v_schedule.id,'result','ARCHIVED');
END $$;
REVOKE ALL ON FUNCTION public.archive_schedule(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_schedule(uuid,text,uuid) TO authenticated;

CREATE FUNCTION public.guard_archived_schedule_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'SCHEDULE_ARCHIVED_READ_ONLY';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_archived_schedule_catalog() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER horarios_archived_read_only BEFORE UPDATE ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.guard_archived_schedule_catalog();

CREATE FUNCTION public.guard_archived_schedule_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_archived timestamptz;
BEGIN
  IF NEW.activo IS TRUE THEN
    SELECT archived_at INTO v_archived FROM public.horarios
    WHERE id=NEW.horario_id AND cliente_id=NEW.cliente_id FOR SHARE;
    IF v_archived IS NOT NULL THEN RAISE EXCEPTION 'SCHEDULE_ARCHIVED_NOT_ASSIGNABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_archived_schedule_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER schedule_assignment_archive_guard BEFORE INSERT OR UPDATE OF horario_id,empleado_id,fecha_inicio,fecha_fin,activo
ON public.empleados_horarios FOR EACH ROW EXECUTE FUNCTION public.guard_archived_schedule_assignment();

-- The existing catalog RPC follows with DISABLE additionally restricted to admin/superadmin.

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
  IF v_action='DISABLE' AND v_role NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'SCHEDULE_DELETE_FORBIDDEN'; END IF;
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



NOTIFY pgrst,'reload schema';
COMMIT;
