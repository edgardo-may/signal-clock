-- Invoker functions; revision rows remain immutable.
BEGIN;
CREATE OR REPLACE FUNCTION public.upsert_workday_record(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_schedule_id uuid,p_timezone text,p_first_in timestamptz,p_last_out timestamptz,p_worked_minutes integer,p_break_minutes integer,p_overtime_minutes integer,p_late_minutes integer,p_early_leave_minutes integer,p_status text,p_integrity_hash text,p_calculation_version integer,p_registro_id uuid,p_source_observed_at timestamptz,p_source_event_count integer) RETURNS TABLE(workday_id uuid,persistence_result text,integrity_hash text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_existing public.workday_records%ROWTYPE; v_source uuid; v_revision uuid; v_assignments integer; v_snapshot_equal boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO v_existing FROM public.workday_records w WHERE w.cliente_id=p_cliente_id AND w.empleado_id=p_empleado_id AND w.workday_date=p_workday_date FOR UPDATE;
  IF FOUND AND v_existing.current_revision_id IS NOT NULL AND v_existing.calculation_version IS DISTINCT FROM p_calculation_version THEN
    RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',v_existing.calculation_version,'received_version',p_calculation_version)::text;
  END IF;
  IF p_calculation_version<>3 OR NULLIF(btrim(p_integrity_hash),'') IS NULL OR p_registro_id IS NULL OR p_schedule_id IS NULL OR p_workday_date IS NULL OR p_source_observed_at IS NULL OR p_source_event_count IS NULL OR p_source_event_count<1 THEN RAISE EXCEPTION 'PERSIST_PAYLOAD_INVALID' USING ERRCODE='22023'; END IF;
  SELECT r.source_event_id INTO v_source FROM public.registro_asistencia r WHERE r.id=p_registro_id AND r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id FOR KEY SHARE;
  IF v_source IS NULL OR NOT EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED') THEN RAISE EXCEPTION 'PERSIST_SOURCE_EVENT_DENIED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_features f WHERE f.cliente_id=p_cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.mode='PERSIST_ACTIVE' AND f.enabled AND f.canary_registro_id IS NULL AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL AND f.canary_workday_date IS NULL) THEN RAISE EXCEPTION 'PERSIST_AUTHORIZATION_DENIED' USING ERRCODE='P0001'; END IF;
  SELECT count(*),(array_agg(eh.schedule_revision_id))[1] INTO v_assignments,v_revision FROM public.empleados_horarios eh WHERE eh.cliente_id=p_cliente_id AND eh.empleado_id=p_empleado_id AND eh.horario_id=p_schedule_id AND eh.activo AND eh.fecha_inicio<=p_workday_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=p_workday_date);
  IF v_assignments<>1 OR v_revision IS NULL OR NOT EXISTS(SELECT 1 FROM public.schedule_revisions sr WHERE sr.id=v_revision AND sr.cliente_id=p_cliente_id AND sr.horario_id=p_schedule_id AND public.schedule_revision_calculation_hash(sr.config_snapshot)=sr.integrity_hash) THEN RAISE EXCEPTION 'PERSIST_REVISION_RESOLUTION_DENIED' USING ERRCODE='P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO v_existing FROM public.workday_records w WHERE w.cliente_id=p_cliente_id AND w.empleado_id=p_empleado_id AND w.workday_date=p_workday_date FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.workday_records(cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version,source_observed_at,source_event_count) VALUES(p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_integrity_hash,p_calculation_version,p_source_observed_at,p_source_event_count) RETURNING * INTO v_existing;
    INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'INSERTED',p_source_observed_at,p_source_event_count);
    RETURN QUERY SELECT v_existing.id,'INSERTED'::text,p_integrity_hash; RETURN;
  END IF;
  IF v_existing.source_observed_at IS NULL OR v_existing.source_event_count IS NULL THEN RAISE EXCEPTION 'PERSIST_LEGACY_SNAPSHOT_UNVERSIONED' USING ERRCODE='P0001'; END IF;
  v_snapshot_equal := v_existing.schedule_id IS NOT DISTINCT FROM p_schedule_id AND v_existing.timezone IS NOT DISTINCT FROM p_timezone AND v_existing.first_in IS NOT DISTINCT FROM p_first_in AND v_existing.last_out IS NOT DISTINCT FROM p_last_out AND v_existing.worked_minutes IS NOT DISTINCT FROM p_worked_minutes AND v_existing.break_minutes IS NOT DISTINCT FROM p_break_minutes AND v_existing.overtime_minutes IS NOT DISTINCT FROM p_overtime_minutes AND v_existing.late_minutes IS NOT DISTINCT FROM p_late_minutes AND v_existing.early_leave_minutes IS NOT DISTINCT FROM p_early_leave_minutes AND v_existing.status IS NOT DISTINCT FROM p_status AND v_existing.integrity_hash IS NOT DISTINCT FROM p_integrity_hash AND v_existing.calculation_version IS NOT DISTINCT FROM p_calculation_version AND v_existing.source_observed_at IS NOT DISTINCT FROM p_source_observed_at AND v_existing.source_event_count IS NOT DISTINCT FROM p_source_event_count;
  IF v_snapshot_equal THEN RETURN QUERY SELECT v_existing.id,'UNCHANGED'::text,p_integrity_hash; RETURN; END IF;
  IF p_source_observed_at<v_existing.source_observed_at OR (p_source_observed_at=v_existing.source_observed_at AND p_source_event_count<v_existing.source_event_count) THEN RETURN QUERY SELECT v_existing.id,'STALE'::text,v_existing.integrity_hash; RETURN; END IF;
  IF p_source_observed_at=v_existing.source_observed_at AND p_source_event_count=v_existing.source_event_count THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing.schedule_id IS DISTINCT FROM p_schedule_id THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing.current_revision_id IS NOT NULL THEN RAISE EXCEPTION 'PERSIST_REVISION_MANIFEST_REQUIRED'; END IF;
  UPDATE public.workday_records SET timezone=p_timezone,first_in=p_first_in,last_out=p_last_out,worked_minutes=p_worked_minutes,break_minutes=p_break_minutes,overtime_minutes=p_overtime_minutes,late_minutes=p_late_minutes,early_leave_minutes=p_early_leave_minutes,status=p_status,integrity_hash=p_integrity_hash,calculation_version=p_calculation_version,source_observed_at=p_source_observed_at,source_event_count=p_source_event_count WHERE id=v_existing.id;
  INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'UPDATED',p_source_observed_at,p_source_event_count);
  RETURN QUERY SELECT v_existing.id,'UPDATED'::text,p_integrity_hash;
END $fn$;

CREATE OR REPLACE FUNCTION public.upsert_workday_record(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_schedule_id uuid,p_timezone text,p_first_in timestamptz,p_last_out timestamptz,p_worked_minutes integer,p_break_minutes integer,p_overtime_minutes integer,p_late_minutes integer,p_early_leave_minutes integer,p_status text,p_integrity_hash text,p_calculation_version integer,p_registro_id uuid,p_source_observed_at timestamptz,p_source_event_count integer,p_evidence_manifest jsonb,p_context_manifest jsonb) RETURNS TABLE(workday_id uuid,persistence_result text,integrity_hash text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE v_existing public.workday_records%ROWTYPE; v_source uuid; v_revision uuid; v_assignments integer; v_snapshot_equal boolean; v_previous uuid; v_new uuid;
BEGIN
  LOCK TABLE public.registro_asistencia,public.attendance_source_events,public.devices,public.empleados_horarios IN SHARE MODE;
  IF p_calculation_version IS NULL OR p_calculation_version<1 OR NULLIF(btrim(p_integrity_hash),'') IS NULL OR p_registro_id IS NULL OR p_schedule_id IS NULL OR p_workday_date IS NULL OR p_source_observed_at IS NULL OR p_source_event_count IS NULL OR p_source_event_count<1 THEN RAISE EXCEPTION 'PERSIST_PAYLOAD_INVALID' USING ERRCODE='22023'; END IF;
  SELECT r.source_event_id INTO v_source FROM public.registro_asistencia r WHERE r.id=p_registro_id AND r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id FOR KEY SHARE;
  IF v_source IS NULL OR NOT EXISTS(SELECT 1 FROM public.attendance_source_events e WHERE e.id=v_source AND e.cliente_id=p_cliente_id AND e.employee_id=p_empleado_id AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED') THEN RAISE EXCEPTION 'PERSIST_SOURCE_EVENT_DENIED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_features f WHERE f.cliente_id=p_cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE' AND f.mode='PERSIST_ACTIVE' AND f.enabled AND f.canary_registro_id IS NULL AND f.canary_empleado_id IS NULL AND f.canary_schedule_id IS NULL AND f.canary_workday_date IS NULL) THEN RAISE EXCEPTION 'PERSIST_AUTHORIZATION_DENIED' USING ERRCODE='P0001'; END IF;
  SELECT count(*),(array_agg(eh.schedule_revision_id))[1] INTO v_assignments,v_revision FROM public.empleados_horarios eh WHERE eh.cliente_id=p_cliente_id AND eh.empleado_id=p_empleado_id AND eh.horario_id=p_schedule_id AND eh.activo AND eh.fecha_inicio<=p_workday_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=p_workday_date);
  IF v_assignments<>1 OR v_revision IS NULL OR NOT EXISTS(SELECT 1 FROM public.schedule_revisions sr WHERE sr.id=v_revision AND sr.cliente_id=p_cliente_id AND sr.horario_id=p_schedule_id AND public.schedule_revision_calculation_hash(sr.config_snapshot)=sr.integrity_hash) THEN RAISE EXCEPTION 'PERSIST_REVISION_RESOLUTION_DENIED' USING ERRCODE='P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO v_existing FROM public.workday_records w WHERE w.cliente_id=p_cliente_id AND w.empleado_id=p_empleado_id AND w.workday_date=p_workday_date FOR UPDATE;
  IF FOUND AND p_calculation_version IS DISTINCT FROM (CASE WHEN v_existing.current_revision_id IS NULL THEN 3 ELSE v_existing.calculation_version END) THEN
    RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',CASE WHEN v_existing.current_revision_id IS NULL THEN 3 ELSE v_existing.calculation_version END,'received_version',p_calculation_version)::text;
  END IF;
  IF NOT FOUND THEN
    IF p_calculation_version<>3 THEN RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',3,'received_version',p_calculation_version)::text; END IF;
    INSERT INTO public.workday_records(cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version,source_observed_at,source_event_count) VALUES(p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_integrity_hash,p_calculation_version,p_source_observed_at,p_source_event_count) RETURNING * INTO v_existing;
    INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'INSERTED',p_source_observed_at,p_source_event_count);

    PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest);
    v_new:=public.store_workday_calculation_revision(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest,public.workday_revision_snapshot(to_jsonb(v_existing)),p_integrity_hash,p_source_observed_at,p_source_event_count);
    INSERT INTO public.workday_revision_promotions(cliente_id,empleado_id,workday_date,previous_revision_id,promoted_revision_id,expected_current_revision_id,operation)
      VALUES(p_cliente_id,p_empleado_id,p_workday_date,v_previous,v_new,v_previous,CASE WHEN v_previous IS NULL THEN 'INITIAL' ELSE 'EVIDENCE_UPDATE' END);
    UPDATE public.workday_records SET current_revision_id=v_new WHERE id=v_existing.id;
    RETURN QUERY SELECT v_existing.id,'INSERTED'::text,p_integrity_hash; RETURN;
  END IF;
  IF v_existing.source_observed_at IS NULL OR v_existing.source_event_count IS NULL THEN RAISE EXCEPTION 'PERSIST_LEGACY_SNAPSHOT_UNVERSIONED' USING ERRCODE='P0001'; END IF;
  v_snapshot_equal := v_existing.schedule_id IS NOT DISTINCT FROM p_schedule_id AND v_existing.timezone IS NOT DISTINCT FROM p_timezone AND v_existing.first_in IS NOT DISTINCT FROM p_first_in AND v_existing.last_out IS NOT DISTINCT FROM p_last_out AND v_existing.worked_minutes IS NOT DISTINCT FROM p_worked_minutes AND v_existing.break_minutes IS NOT DISTINCT FROM p_break_minutes AND v_existing.overtime_minutes IS NOT DISTINCT FROM p_overtime_minutes AND v_existing.late_minutes IS NOT DISTINCT FROM p_late_minutes AND v_existing.early_leave_minutes IS NOT DISTINCT FROM p_early_leave_minutes AND v_existing.status IS NOT DISTINCT FROM p_status AND v_existing.integrity_hash IS NOT DISTINCT FROM p_integrity_hash AND v_existing.calculation_version IS NOT DISTINCT FROM p_calculation_version AND v_existing.source_observed_at IS NOT DISTINCT FROM p_source_observed_at AND v_existing.source_event_count IS NOT DISTINCT FROM p_source_event_count;
  IF v_snapshot_equal THEN RETURN QUERY SELECT v_existing.id,'UNCHANGED'::text,p_integrity_hash; RETURN; END IF;
  IF p_source_observed_at<v_existing.source_observed_at OR (p_source_observed_at=v_existing.source_observed_at AND p_source_event_count<v_existing.source_event_count) THEN RETURN QUERY SELECT v_existing.id,'STALE'::text,v_existing.integrity_hash; RETURN; END IF;
  IF p_source_observed_at=v_existing.source_observed_at AND p_source_event_count=v_existing.source_event_count THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing.schedule_id IS DISTINCT FROM p_schedule_id THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT' USING ERRCODE='P0001'; END IF;
  v_previous:=v_existing.current_revision_id;
  UPDATE public.workday_records SET timezone=p_timezone,first_in=p_first_in,last_out=p_last_out,worked_minutes=p_worked_minutes,break_minutes=p_break_minutes,overtime_minutes=p_overtime_minutes,late_minutes=p_late_minutes,early_leave_minutes=p_early_leave_minutes,status=p_status,integrity_hash=p_integrity_hash,calculation_version=p_calculation_version,source_observed_at=p_source_observed_at,source_event_count=p_source_event_count WHERE id=v_existing.id RETURNING * INTO v_existing;
  INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count) VALUES(v_existing.id,p_cliente_id,p_empleado_id,p_workday_date,p_schedule_id,p_timezone,p_first_in,p_last_out,p_worked_minutes,p_break_minutes,p_overtime_minutes,p_late_minutes,p_early_leave_minutes,p_status,p_calculation_version,p_integrity_hash,'UPDATED',p_source_observed_at,p_source_event_count);

    PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest);
    v_new:=public.store_workday_calculation_revision(p_cliente_id,p_empleado_id,p_workday_date,p_calculation_version,p_evidence_manifest,p_context_manifest,public.workday_revision_snapshot(to_jsonb(v_existing)),p_integrity_hash,p_source_observed_at,p_source_event_count);
    INSERT INTO public.workday_revision_promotions(cliente_id,empleado_id,workday_date,previous_revision_id,promoted_revision_id,expected_current_revision_id,operation)
      VALUES(p_cliente_id,p_empleado_id,p_workday_date,v_previous,v_new,v_previous,CASE WHEN v_previous IS NULL THEN 'INITIAL' ELSE 'EVIDENCE_UPDATE' END);
    UPDATE public.workday_records SET current_revision_id=v_new WHERE id=v_existing.id;
  RETURN QUERY SELECT v_existing.id,'UPDATED'::text,p_integrity_hash;
END $fn$;

CREATE FUNCTION public.workday_manifest_fingerprint(p_manifest jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,public AS $$
SELECT encode(extensions.digest(convert_to(p_manifest::text,'UTF8'),'sha256'),'hex') $$;

CREATE FUNCTION public.workday_revision_snapshot(p_record jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,public AS $$
SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_record)
WHERE key=ANY(ARRAY['schedule_id','timezone','first_in','last_out','worked_minutes','break_minutes','overtime_minutes','late_minutes','early_leave_minutes','status','integrity_hash','calculation_version']) $$;

CREATE FUNCTION public.live_workday_evidence_manifest(p_cliente_id uuid,p_empleado_id uuid,p_date date,p_context jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
SELECT jsonb_build_object('evidence_manifest_version',1,'cliente_id',p_cliente_id,'empleado_id',p_empleado_id,'workday_date',p_date,
  'events',coalesce(jsonb_agg(jsonb_build_object(
    'registro_id',r.id,'source_event_id',r.source_event_id,
    'effective_timestamp_utc',to_char(r.verificado_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ordering_timestamp_utc',to_char(r.verificado_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'effective_type',CASE lower(btrim(r.tipo_verificacion)) WHEN 'entrada' THEN 'ENTRY' WHEN 'salida' THEN 'EXIT' WHEN 'descanso_inicio' THEN 'BREAK_OUT' WHEN 'descanso_fin' THEN 'BREAK_IN' ELSE 'UNSPECIFIED' END,
    'effective_origin',CASE WHEN r.es_manual THEN 'MANUAL' ELSE 'ADMS' END)
    ORDER BY r.verificado_at,r.id),'[]'::jsonb))
FROM public.registro_asistencia r
WHERE r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id
  AND r.verificado_at>=(p_context->>'window_start_utc')::timestamptz
  AND r.verificado_at<=(p_context->>'window_end_utc')::timestamptz $$;

CREATE FUNCTION public.validate_workday_revision_manifests(p_cliente_id uuid,p_empleado_id uuid,p_date date,p_version integer,p_evidence jsonb,p_context jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE event jsonb; registro public.registro_asistencia%ROWTYPE;
BEGIN
  -- These locks also protect direct helper/INSERT callers; IDs in JSON are never
  -- an authority for tenant ownership. Keep the same lock order as promotion.
  LOCK TABLE public.registro_asistencia,public.attendance_source_events,public.devices,public.empleados_horarios IN SHARE MODE;
  IF p_cliente_id IS NULL OR p_empleado_id IS NULL OR p_date IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.empleados WHERE id=p_empleado_id AND cliente_id=p_cliente_id)
    OR p_evidence->>'cliente_id' IS DISTINCT FROM p_cliente_id::text
    OR p_evidence->>'empleado_id' IS DISTINCT FROM p_empleado_id::text
    OR p_evidence->>'workday_date' IS DISTINCT FROM p_date::text THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;
  IF jsonb_typeof(p_evidence->'events') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(p_evidence->'events') LOOP
    SELECT * INTO registro FROM public.registro_asistencia
      WHERE id::text=event->>'registro_id' AND cliente_id=p_cliente_id AND empleado_id=p_empleado_id;
    IF NOT FOUND OR registro.source_event_id::text IS DISTINCT FROM event->>'source_event_id' THEN
      RAISE EXCEPTION 'TENANT_MISMATCH';
    END IF;
    IF registro.source_event_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.attendance_source_events s WHERE s.id=registro.source_event_id
        AND s.cliente_id=p_cliente_id AND s.employee_id=p_empleado_id
        AND s.device_id IS NOT DISTINCT FROM registro.dispositivo_id
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  END LOOP;
  IF p_context->>'schedule_id' IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.horarios WHERE id::text=p_context->>'schedule_id' AND cliente_id=p_cliente_id
  ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF p_context->>'schedule_revision_id' IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.schedule_revisions WHERE id::text=p_context->>'schedule_revision_id'
      AND cliente_id=p_cliente_id AND horario_id::text=p_context->>'schedule_id'
  ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF p_evidence IS NULL OR p_context IS NULL OR p_version IS NULL
    OR (p_evidence->>'evidence_manifest_version')::integer IS DISTINCT FROM 1
    OR (p_context->>'context_manifest_version')::integer IS DISTINCT FROM 1
    OR (p_context->>'calculation_version')::integer IS DISTINCT FROM p_version
    OR (p_evidence->>'cliente_id')::uuid IS DISTINCT FROM p_cliente_id
    OR (p_evidence->>'empleado_id')::uuid IS DISTINCT FROM p_empleado_id
    OR (p_evidence->>'workday_date')::date IS DISTINCT FROM p_date
    OR p_context->>'window_start_utc' IS NULL OR p_context->>'window_end_utc' IS NULL
    OR (p_context->>'window_start_utc')::timestamptz>(p_context->>'window_end_utc')::timestamptz
    OR NULLIF(p_context->>'timezone','') IS NULL THEN
    RAISE EXCEPTION 'PERSIST_REVISION_MANIFEST_INVALID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.empleados WHERE id=p_empleado_id AND cliente_id=p_cliente_id) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF public.live_workday_evidence_manifest(p_cliente_id,p_empleado_id,p_date,p_context) IS DISTINCT FROM p_evidence THEN
    RAISE EXCEPTION 'PERSIST_EVIDENCE_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.registro_asistencia r LEFT JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
    WHERE r.cliente_id=p_cliente_id AND r.empleado_id=p_empleado_id
    AND r.verificado_at BETWEEN (p_context->>'window_start_utc')::timestamptz AND (p_context->>'window_end_utc')::timestamptz
    AND (d.id IS NULL OR btrim(d.timezone) IS DISTINCT FROM p_context->>'timezone')) THEN RAISE EXCEPTION 'EVENT_TIMEZONE_MISMATCH'; END IF;
END $$;

CREATE FUNCTION public.store_workday_calculation_revision(p_cliente_id uuid,p_empleado_id uuid,p_date date,p_version integer,p_evidence jsonb,p_context jsonb,p_snapshot jsonb,p_hash text,p_observed timestamptz,p_count integer) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE existing public.workday_calculation_revisions%ROWTYPE; new_id uuid;
BEGIN
  PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_date,p_version,p_evidence,p_context);
  IF (p_snapshot ? 'cliente_id' AND p_snapshot->>'cliente_id' IS DISTINCT FROM p_cliente_id::text)
    OR (p_snapshot ? 'empleado_id' AND p_snapshot->>'empleado_id' IS DISTINCT FROM p_empleado_id::text)
    OR (p_snapshot ? 'workday_date' AND p_snapshot->>'workday_date' IS DISTINCT FROM p_date::text)
    OR (p_snapshot ? 'workday_record_id' AND NOT EXISTS(SELECT 1 FROM public.workday_records
      WHERE id::text=p_snapshot->>'workday_record_id' AND cliente_id=p_cliente_id AND empleado_id=p_empleado_id AND workday_date=p_date))
    OR (p_snapshot ? 'revision_id' AND NOT EXISTS(SELECT 1 FROM public.workday_calculation_revisions
      WHERE id::text=p_snapshot->>'revision_id' AND cliente_id=p_cliente_id AND empleado_id=p_empleado_id AND workday_date=p_date)) THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;
  IF p_snapshot->>'integrity_hash' IS DISTINCT FROM p_hash OR (p_snapshot->>'calculation_version')::integer IS DISTINCT FROM p_version
    OR p_snapshot->>'timezone' IS DISTINCT FROM p_context->>'timezone'
    OR p_snapshot->>'schedule_id' IS DISTINCT FROM p_context->>'schedule_id'
    OR jsonb_array_length(p_evidence->'events') IS DISTINCT FROM p_count
    OR (SELECT max((e->>'effective_timestamp_utc')::timestamptz) FROM jsonb_array_elements(p_evidence->'events') e) IS DISTINCT FROM p_observed THEN
    RAISE EXCEPTION 'PERSIST_REVISION_MANIFEST_INVALID';
  END IF;
  SELECT * INTO existing FROM public.workday_calculation_revisions
    WHERE cliente_id=p_cliente_id AND empleado_id=p_empleado_id AND workday_date=p_date
    AND evidence_fingerprint=public.workday_manifest_fingerprint(p_evidence) AND context_fingerprint=public.workday_manifest_fingerprint(p_context);
  IF FOUND THEN
    IF existing.snapshot IS DISTINCT FROM p_snapshot OR existing.integrity_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'PERSIST_SNAPSHOT_CONFLICT'; END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO public.workday_calculation_revisions(cliente_id,empleado_id,workday_date,calculation_version,evidence_manifest_version,evidence_manifest,evidence_fingerprint,context_manifest_version,context_manifest,context_fingerprint,snapshot,integrity_hash,source_observed_at,source_event_count)
    VALUES(p_cliente_id,p_empleado_id,p_date,p_version,1,p_evidence,public.workday_manifest_fingerprint(p_evidence),1,p_context,public.workday_manifest_fingerprint(p_context),p_snapshot,p_hash,p_observed,p_count) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE FUNCTION public.create_workday_revision_candidate(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_snapshot jsonb,p_evidence_manifest jsonb,p_context_manifest jsonb,p_source_observed_at timestamptz,p_source_event_count integer)
RETURNS TABLE(revision_id uuid,revision_result text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE current_record public.workday_records%ROWTYPE; existing uuid; new_id uuid; version integer:=(p_snapshot->>'calculation_version')::integer;
BEGIN
  LOCK TABLE public.registro_asistencia,public.attendance_source_events,public.devices,public.empleados_horarios IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO current_record FROM public.workday_records WHERE cliente_id=p_cliente_id AND empleado_id=p_empleado_id AND workday_date=p_workday_date FOR UPDATE;
  IF NOT FOUND OR current_record.current_revision_id IS NULL THEN RAISE EXCEPTION 'PERSIST_LEGACY_SNAPSHOT_UNVERSIONED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_features WHERE cliente_id=p_cliente_id AND feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled AND mode='PERSIST_ACTIVE') THEN RAISE EXCEPTION 'PERSIST_AUTHORIZATION_DENIED'; END IF;
  IF p_source_observed_at<current_record.source_observed_at OR (p_source_observed_at=current_record.source_observed_at AND p_source_event_count<current_record.source_event_count) THEN
    RETURN QUERY SELECT NULL::uuid,'STALE'::text; RETURN;
  END IF;
  IF version<current_record.calculation_version THEN RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',current_record.calculation_version,'received_version',version)::text; END IF;
  PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_workday_date,version,p_evidence_manifest,p_context_manifest);
  SELECT id INTO existing FROM public.workday_calculation_revisions WHERE cliente_id=p_cliente_id AND empleado_id=p_empleado_id AND workday_date=p_workday_date AND evidence_fingerprint=public.workday_manifest_fingerprint(p_evidence_manifest) AND context_fingerprint=public.workday_manifest_fingerprint(p_context_manifest);
  new_id:=public.store_workday_calculation_revision(p_cliente_id,p_empleado_id,p_workday_date,version,p_evidence_manifest,p_context_manifest,p_snapshot,p_snapshot->>'integrity_hash',p_source_observed_at,p_source_event_count);
  RETURN QUERY SELECT new_id,CASE WHEN existing IS NULL THEN 'CREATED' ELSE 'UNCHANGED' END;
END $$;

CREATE FUNCTION public.promote_workday_revision(p_cliente_id uuid,p_empleado_id uuid,p_workday_date date,p_candidate_revision_id uuid,p_expected_current_revision_id uuid,p_expected_evidence_fingerprint text)
RETURNS TABLE(revision_id uuid,promotion_result text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE w public.workday_records%ROWTYPE; candidate public.workday_calculation_revisions%ROWTYPE; current_revision public.workday_calculation_revisions%ROWTYPE; snapshot public.workday_records%ROWTYPE;
BEGIN
  -- SHARE blocks factual INSERT/UPDATE/DELETE until commit; committed writes before
  -- this lock are visible in the subsequent READ COMMITTED revalidation statement.
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'PROMOTION_ISOLATION_REQUIRED'; END IF;
  LOCK TABLE public.registro_asistencia,public.attendance_source_events,public.devices,public.empleados_horarios IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text||':'||p_empleado_id::text||':'||p_workday_date::text,0));
  SELECT * INTO w FROM public.workday_records WHERE cliente_id=p_cliente_id AND empleado_id=p_empleado_id AND workday_date=p_workday_date FOR UPDATE;
  IF NOT FOUND OR w.current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN RAISE EXCEPTION 'PROMOTION_CONFLICT'; END IF;
  SELECT * INTO candidate FROM public.workday_calculation_revisions WHERE id=p_candidate_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROMOTION_CONFLICT'; END IF;
  IF candidate.cliente_id IS DISTINCT FROM p_cliente_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF candidate.empleado_id IS DISTINCT FROM p_empleado_id OR candidate.workday_date IS DISTINCT FROM p_workday_date THEN RAISE EXCEPTION 'INVALID_IDENTITY'; END IF;
  SELECT * INTO current_revision FROM public.workday_calculation_revisions WHERE id=w.current_revision_id;
  IF w.current_revision_id IS NULL OR candidate.id=w.current_revision_id
    OR EXISTS(SELECT 1 FROM public.workday_revision_promotions WHERE promoted_revision_id=candidate.id)
    OR current_revision.evidence_fingerprint IS DISTINCT FROM p_expected_evidence_fingerprint
    OR candidate.evidence_fingerprint IS DISTINCT FROM p_expected_evidence_fingerprint THEN RAISE EXCEPTION 'PROMOTION_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_features WHERE cliente_id=p_cliente_id AND feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled AND mode='PERSIST_ACTIVE') THEN RAISE EXCEPTION 'DENIED'; END IF;
  IF candidate.calculation_version<w.calculation_version THEN RAISE EXCEPTION 'PERSIST_CALCULATION_VERSION_MISMATCH' USING DETAIL=jsonb_build_object('expected_version',w.calculation_version,'received_version',candidate.calculation_version)::text; END IF;
  BEGIN
    PERFORM public.validate_workday_revision_manifests(p_cliente_id,p_empleado_id,p_workday_date,candidate.calculation_version,candidate.evidence_manifest,candidate.context_manifest);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'PROMOTION_CONFLICT'; END;
  SELECT * INTO snapshot FROM jsonb_populate_record(NULL::public.workday_records,candidate.snapshot);
  INSERT INTO public.workday_revision_promotions(cliente_id,empleado_id,workday_date,previous_revision_id,promoted_revision_id,expected_current_revision_id,expected_evidence_fingerprint,operation)
    VALUES(p_cliente_id,p_empleado_id,p_workday_date,w.current_revision_id,candidate.id,p_expected_current_revision_id,p_expected_evidence_fingerprint,'PROMOTION');
  UPDATE public.workday_records SET current_revision_id=candidate.id,schedule_id=snapshot.schedule_id,timezone=snapshot.timezone,first_in=snapshot.first_in,last_out=snapshot.last_out,worked_minutes=snapshot.worked_minutes,break_minutes=snapshot.break_minutes,overtime_minutes=snapshot.overtime_minutes,late_minutes=snapshot.late_minutes,early_leave_minutes=snapshot.early_leave_minutes,status=snapshot.status,integrity_hash=candidate.integrity_hash,calculation_version=candidate.calculation_version,source_observed_at=candidate.source_observed_at,source_event_count=candidate.source_event_count WHERE id=w.id;
  INSERT INTO public.workday_record_history(workday_record_id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,calculation_version,integrity_hash,action,source_observed_at,source_event_count)
    VALUES(w.id,p_cliente_id,p_empleado_id,p_workday_date,snapshot.schedule_id,snapshot.timezone,snapshot.first_in,snapshot.last_out,snapshot.worked_minutes,snapshot.break_minutes,snapshot.overtime_minutes,snapshot.late_minutes,snapshot.early_leave_minutes,snapshot.status,candidate.calculation_version,candidate.integrity_hash,'UPDATED',candidate.source_observed_at,candidate.source_event_count);
  RETURN QUERY SELECT candidate.id,'PROMOTED'::text;
END $$;
CREATE FUNCTION public.enforce_current_workday_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE projection public.workday_records%ROWTYPE; revision public.workday_calculation_revisions%ROWTYPE;
BEGIN
  SELECT * INTO projection FROM public.workday_records WHERE id=NEW.id;
  IF projection.current_revision_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO revision FROM public.workday_calculation_revisions WHERE id=projection.current_revision_id;
  IF NOT FOUND OR revision.snapshot IS DISTINCT FROM public.workday_revision_snapshot(to_jsonb(projection))
    OR revision.source_observed_at IS DISTINCT FROM projection.source_observed_at OR revision.source_event_count IS DISTINCT FROM projection.source_event_count THEN
    RAISE EXCEPTION 'CURRENT_PROJECTION_MISMATCH';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workday_current_projection_consistent AFTER INSERT OR UPDATE ON public.workday_records
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_current_workday_revision();
REVOKE ALL ON FUNCTION public.enforce_current_workday_revision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_current_workday_revision() TO service_role;
-- service_role already has INSERT for invoker RPCs. Validate that route too,
-- so a direct table write cannot bypass the shared identity authority.
CREATE FUNCTION public.enforce_workday_revision_insert_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.validate_workday_revision_manifests(NEW.cliente_id,NEW.empleado_id,NEW.workday_date,NEW.calculation_version,NEW.evidence_manifest,NEW.context_manifest);
  RETURN NEW;
END $$;
CREATE TRIGGER workday_revision_insert_identity BEFORE INSERT ON public.workday_calculation_revisions
FOR EACH ROW EXECUTE FUNCTION public.enforce_workday_revision_insert_identity();
REVOKE ALL ON FUNCTION public.enforce_workday_revision_insert_identity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_workday_revision_insert_identity() TO service_role;
COMMIT;
