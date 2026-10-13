-- READ-ONLY B1 preparation before making real IN/OUT punches. No gate opening.
-- Diagnostic only: execute actual ScheduleResolver/pipeline on fresh evidence later.
-- 120/180 minute bounds are standby pipeline.js eventWindow defaults; no overrides
-- are exposed by ScheduleRevisionAdapter. Inclusive assignment dates match resolver.
-- Minimum 30 minutes remaining is an OPERATIONAL safety buffer, not engine semantics.
WITH params AS (
 SELECT clock_timestamp() checked_at,
 '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,
 '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,
 'c5b9bc19-46c0-480e-a81b-9431eaed08b7'::uuid device_id,
 '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid expected_schedule_id,
 '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid expected_revision_id,
 'America/Cancun'::text timezone,
 (clock_timestamp() AT TIME ZONE 'America/Cancun')::date workday_date
), dates AS (
 SELECT p.*,p.workday_date+offset_days candidate_date
 FROM params p CROSS JOIN generate_series(-1,1) offset_days
), contexts AS (
 SELECT dt.*,a.id assignment_id,a.horario_id schedule_id,a.schedule_revision_id,
 sr.version revision_version,sr.integrity_hash,
 sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot) hash_valid,
 sr.config_snapshot, sr.config_snapshot->'dias_config'->
 (ARRAY['dom','lun','mar','mie','jue','vie','sab'])[extract(dow FROM dt.candidate_date)::integer+1] day_config
 FROM dates dt JOIN public.empleados_horarios a
 ON a.cliente_id=dt.cliente_id AND a.empleado_id=dt.empleado_id AND a.activo
 AND a.fecha_inicio<=dt.candidate_date AND (a.fecha_fin IS NULL OR a.fecha_fin>=dt.candidate_date)
 LEFT JOIN public.schedule_revisions sr ON sr.id=a.schedule_revision_id
 AND sr.cliente_id=a.cliente_id AND sr.horario_id=a.horario_id
), parsed AS (
 SELECT c.*,
 CASE WHEN day_config->>'entrada' ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
 THEN (day_config->>'entrada')::time END start_time,
 CASE WHEN day_config->>'salida' ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
 THEN (day_config->>'salida')::time END end_time
 FROM contexts c
), windows AS (
 SELECT c.*, ((candidate_date+start_time) AT TIME ZONE timezone)-interval '120 minutes' window_start,
 (((candidate_date+CASE WHEN end_time<=start_time THEN 1 ELSE 0 END)+end_time)
 AT TIME ZONE timezone)+interval '180 minutes' window_end
 FROM parsed c WHERE day_config->>'activo'='true' AND start_time IS NOT NULL AND end_time IS NOT NULL
), selected AS (
 SELECT p.*,w.assignment_id,w.schedule_id,w.schedule_revision_id,w.revision_version,w.hash_valid,
 w.config_snapshot,w.day_config,w.window_start,w.window_end,
 (SELECT count(*) FROM contexts c WHERE c.candidate_date=p.workday_date) assignment_count,
 (SELECT count(*) FROM windows ov WHERE ov.assignment_id IS DISTINCT FROM w.assignment_id
 OR ov.candidate_date<>p.workday_date) neighboring_window_count,
 (SELECT count(*) FROM windows ov WHERE (ov.assignment_id IS DISTINCT FROM w.assignment_id OR ov.candidate_date<>p.workday_date)
 AND ov.window_start<=w.window_end AND ov.window_end>=w.window_start) overlapping_windows
 FROM params p LEFT JOIN windows w ON w.candidate_date=p.workday_date
 AND w.schedule_id=p.expected_schedule_id AND w.schedule_revision_id=p.expected_revision_id
), checks AS (
 SELECT s.*,
 EXISTS(SELECT 1 FROM public.empleados e WHERE e.id=s.empleado_id AND e.cliente_id=s.cliente_id AND e.activo) employee_active,
 EXISTS(SELECT 1 FROM public.devices d WHERE d.id=s.device_id AND d.cliente_id=s.cliente_id
 AND d.is_active IS TRUE AND d.timezone=s.timezone) device_valid,
 -- Mutable schedule state is reported as an operational guard; calculation uses snapshot.
 EXISTS(SELECT 1 FROM public.horarios h WHERE h.id=s.schedule_id AND h.cliente_id=s.cliente_id AND h.activo) schedule_enabled,
 (SELECT count(*) FROM public.registro_asistencia r WHERE r.cliente_id=s.cliente_id AND r.empleado_id=s.empleado_id
 AND r.verificado_at BETWEEN s.window_start AND s.window_end) registro_count,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('registro_id',r.id,'source_event_id',r.source_event_id,
 'timestamp',r.verificado_at,'direction',r.tipo_verificacion,'device',r.dispositivo_id,'es_manual',r.es_manual)
 ORDER BY r.verificado_at,r.id),'[]'::jsonb) FROM public.registro_asistencia r
 WHERE r.cliente_id=s.cliente_id AND r.empleado_id=s.empleado_id AND r.verificado_at BETWEEN s.window_start AND s.window_end) all_registros,
 (SELECT count(*) FROM public.attendance_source_events e WHERE e.cliente_id=s.cliente_id AND
 (e.employee_id=s.empleado_id OR (e.employee_id IS NULL AND e.device_id=s.device_id))
 AND e.occurred_at BETWEEN s.window_start AND s.window_end) source_count,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('source_event_id',e.id,'timestamp',e.occurred_at,
 'status',e.processing_status,'device',e.device_id,'payload',e.raw_payload) ORDER BY e.occurred_at,e.id),'[]'::jsonb)
 FROM public.attendance_source_events e WHERE e.cliente_id=s.cliente_id AND
 (e.employee_id=s.empleado_id OR (e.employee_id IS NULL AND e.device_id=s.device_id))
 AND e.occurred_at BETWEEN s.window_start AND s.window_end) all_sources,
 (SELECT count(*) FROM public.workday_records w WHERE w.cliente_id=s.cliente_id AND w.empleado_id=s.empleado_id AND w.workday_date=s.workday_date) workday_count,
 (SELECT count(*) FROM public.workday_record_history w WHERE w.cliente_id=s.cliente_id AND w.empleado_id=s.empleado_id AND w.workday_date=s.workday_date) history_count,
 (SELECT count(*) FROM public.workday_calculation_revisions w WHERE w.cliente_id=s.cliente_id AND w.empleado_id=s.empleado_id AND w.workday_date=s.workday_date) revision_count,
 (SELECT count(*) FROM public.workday_revision_promotions w WHERE w.cliente_id=s.cliente_id AND w.empleado_id=s.empleado_id AND w.workday_date=s.workday_date) promotion_count,
 (SELECT count(*) FROM public.attendance_persist_outbox o JOIN public.registro_asistencia r ON r.id=o.registro_id
 WHERE r.cliente_id=s.cliente_id AND r.empleado_id=s.empleado_id AND r.verificado_at BETWEEN s.window_start AND s.window_end) outbox_count,
 (SELECT count(*) FROM public.tenant_features f WHERE f.cliente_id=s.cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE') pilot_rows,
 (SELECT min(mode) FROM public.tenant_features f WHERE f.cliente_id=s.cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE') pilot_mode,
 (SELECT bool_or(enabled) FROM public.tenant_features f WHERE f.cliente_id=s.cliente_id AND f.feature_key='WORKDAY_PERSIST_ACTIVE') pilot_enabled,
 (SELECT count(*) FROM public.tenant_features f WHERE f.feature_key IN ('WORKDAY_PERSIST_ACTIVE','WORKDAY_PERSIST_CANARY') AND f.enabled) active_gates,
 (SELECT count(*) FROM public.attendance_persist_outbox WHERE status IN ('PENDING','RETRY')
 OR (status='PROCESSING' AND locked_at<transaction_timestamp()-interval '10 minutes')) claimable,
 s.checked_at BETWEEN s.window_start AND s.window_end within_window,
 extract(epoch FROM (s.window_end-s.checked_at))/60 remaining_window_minutes,
 s.checked_at BETWEEN s.window_start AND s.window_end-interval '30 minutes' enough_remaining_window
 FROM selected s
)
SELECT c.*,coalesce(employee_active AND device_valid AND schedule_enabled
 AND assignment_count=1 AND hash_valid AND config_snapshot->>'horario_activo'='true'
 AND config_snapshot->>'calculation_contract_version'='1' AND overlapping_windows=0
 AND registro_count=0 AND source_count=0 AND workday_count=0 AND history_count=0
 AND revision_count=0 AND promotion_count=0 AND outbox_count=0
 AND pilot_rows=1 AND pilot_mode='OFF' AND pilot_enabled IS FALSE AND active_gates=0
 AND claimable=0 AND enough_remaining_window,false) sql_readiness_diagnostic_pass,
 'STOP unless fresh global preflight, Cloud Run traffic and dispatcher count also pass; runtime resolver still authoritative' next_step
FROM checks c;
