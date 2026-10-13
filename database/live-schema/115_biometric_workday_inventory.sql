-- SELECT-only full tenant inventory, starting from every registro_asistencia row.
-- No employee/status/RAW/history/outbox/eligibility filter and no LIMIT.
-- SQL schedule grouping is diagnostic; final candidates need the real offline pipeline.
WITH rows AS (
 SELECT r.id AS registro_id,r.cliente_id,r.empleado_id,r.dispositivo_id,r.verificado_at,
  r.tipo_verificacion,r.metodo,r.es_manual,r.source_event_id,
  r.raw_payload->>'raw_status' AS raw_status,l.status AS attlog_status,
  l.verify_type,e.occurred_at,e.processing_status,e.employee_id AS source_employee_id,
  e.device_id AS source_device_id,e.cliente_id AS source_cliente_id,
  emp.activo AS employee_active,d.timezone,
  CASE WHEN tz.name IS NOT NULL THEN (r.verificado_at AT TIME ZONE d.timezone)::date END AS local_date,
  CASE lower(btrim(r.tipo_verificacion::text))
    WHEN 'entrada' THEN 'IN' WHEN 'in' THEN 'IN' WHEN '0' THEN 'IN'
    WHEN 'salida' THEN 'OUT' WHEN 'out' THEN 'OUT' WHEN '1' THEN 'OUT'
    WHEN '2' THEN 'OUT' WHEN 'break_out' THEN 'OUT' WHEN 'descanso_inicio' THEN 'OUT' WHEN 'comida_salida' THEN 'OUT'
    WHEN '3' THEN 'IN' WHEN 'break_in' THEN 'IN' WHEN 'descanso_fin' THEN 'IN' WHEN 'comida_entrada' THEN 'IN'
    ELSE 'UNKNOWN' END AS runtime_direction
 FROM public.registro_asistencia r
 LEFT JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
 LEFT JOIN pg_timezone_names tz ON tz.name=d.timezone
 LEFT JOIN public.empleados emp ON emp.id=r.empleado_id AND emp.cliente_id=r.cliente_id
 LEFT JOIN public.attendance_source_events e ON e.id=r.source_event_id
 LEFT JOIN public.attendance_logs l ON l.id::text=r.raw_payload->>'source_log_id'
 WHERE r.cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
), dates AS (
 SELECT DISTINCT cliente_id,empleado_id,timezone,local_date AS candidate_date FROM rows WHERE local_date IS NOT NULL
 UNION SELECT DISTINCT cliente_id,empleado_id,timezone,local_date-1 FROM rows WHERE local_date IS NOT NULL
), contexts AS (
 SELECT dt.*,a.id AS assignment_id,a.horario_id AS schedule_id,a.schedule_revision_id,
  sr.id IS NOT NULL AS revision_exists,sr.config_snapshot,
  CASE WHEN sr.id IS NOT NULL THEN sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot) ELSE false END AS hash_valid,
  sr.config_snapshot->'dias_config'->(ARRAY['dom','lun','mar','mie','jue','vie','sab'])[extract(dow FROM dt.candidate_date)::integer+1] AS day_config,
  (SELECT count(*) FROM public.empleados_horarios x WHERE x.cliente_id=dt.cliente_id AND x.empleado_id=dt.empleado_id
    AND x.activo AND x.fecha_inicio<=dt.candidate_date AND (x.fecha_fin IS NULL OR x.fecha_fin>=dt.candidate_date)) AS assignment_count
 FROM dates dt JOIN public.empleados_horarios a ON a.cliente_id=dt.cliente_id AND a.empleado_id=dt.empleado_id
  AND a.activo AND a.fecha_inicio<=dt.candidate_date AND (a.fecha_fin IS NULL OR a.fecha_fin>=dt.candidate_date)
 LEFT JOIN public.schedule_revisions sr ON sr.id=a.schedule_revision_id AND sr.cliente_id=a.cliente_id AND sr.horario_id=a.horario_id
), windows AS (
 SELECT c.*,
  ((candidate_date+(day_config->>'entrada')::time) AT TIME ZONE timezone)-interval '120 minutes' AS window_start,
  (((candidate_date+CASE WHEN (day_config->>'salida')::time<=(day_config->>'entrada')::time THEN 1 ELSE 0 END)
    +(day_config->>'salida')::time) AT TIME ZONE timezone)+interval '180 minutes' AS window_end
 FROM contexts c WHERE day_config->>'activo'='true'
  AND day_config->>'entrada' ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
  AND day_config->>'salida' ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
), mapped AS (
 SELECT r.*,m.matches,m.schedule_id,m.schedule_revision_id,
  CASE WHEN m.matches=1 AND m.valid THEN m.candidate_date
       ELSE COALESCE(r.local_date,(r.verificado_at AT TIME ZONE 'UTC')::date) END AS inventory_date,
  CASE WHEN m.matches=1 AND m.valid THEN 'OPERATIVE_WINDOW_DIAGNOSTIC'
       WHEN r.local_date IS NULL THEN 'UTC_OBSERVATION_DATE_NOT_WORKDAY_DATE'
       WHEN m.matches>1 THEN 'AMBIGUOUS_WINDOW_LOCAL_DATE_FALLBACK'
       ELSE 'UNRESOLVED_LOCAL_DATE_FALLBACK' END AS grouping_basis,
  COALESCE(m.matches=1 AND m.valid,false) AS schedule_resolved
 FROM rows r LEFT JOIN LATERAL (
  SELECT count(*) AS matches,min(w.candidate_date) AS candidate_date,
   (array_agg(w.schedule_id))[1] AS schedule_id,(array_agg(w.schedule_revision_id))[1] AS schedule_revision_id,
   bool_and(w.assignment_count=1 AND w.revision_exists AND w.hash_valid AND w.config_snapshot->>'horario_activo'='true') AS valid
  FROM windows w WHERE w.cliente_id=r.cliente_id AND w.empleado_id=r.empleado_id AND w.timezone=r.timezone
   AND w.candidate_date IN (r.local_date,r.local_date-1) AND r.verificado_at BETWEEN w.window_start AND w.window_end
 ) m ON true
), groups AS (
 SELECT cliente_id,empleado_id,inventory_date,grouping_basis,count(*) AS event_count,
  count(*) FILTER(WHERE runtime_direction='IN') AS in_count,count(*) FILTER(WHERE runtime_direction='OUT') AS out_count,
  string_agg(runtime_direction,' -> ' ORDER BY verificado_at,registro_id) AS event_order,
  jsonb_agg(tipo_verificacion ORDER BY verificado_at,registro_id) AS registro_directions,
  jsonb_agg(raw_status ORDER BY verificado_at,registro_id) AS raw_directions,
  bool_and(schedule_resolved) AS schedule_resolved,bool_and(employee_active IS TRUE) AS employee_active,
  jsonb_agg(DISTINCT schedule_id) AS schedule_ids,jsonb_agg(DISTINCT schedule_revision_id) AS schedule_revision_ids,
  count(DISTINCT dispositivo_id) AS device_count,count(*)-count(DISTINCT verificado_at) AS duplicate_timestamps,
  count(*) FILTER(WHERE raw_status='255' AND runtime_direction IN ('IN','OUT')) AS raw255_normalized_count,
  jsonb_agg(jsonb_build_object('registro_id',registro_id,'source_event_id',source_event_id,'empleado_id',empleado_id,
    'verificado_at',verificado_at,'occurred_at',occurred_at,'tipo_verificacion',tipo_verificacion,'runtime_direction',runtime_direction,
    'raw_status',raw_status,'attlog_status',attlog_status,'verify_type',verify_type,'processing_status',processing_status,
    'device_id',dispositivo_id,'timezone',timezone,'es_manual',es_manual,'employee_active',employee_active,
    'source_tenant_matches',source_cliente_id=cliente_id,'source_employee_matches',source_employee_id=empleado_id,
    'source_device_matches',source_device_id=dispositivo_id) ORDER BY verificado_at,registro_id) AS events,
  array_agg(registro_id) AS registro_ids
 FROM mapped GROUP BY cliente_id,empleado_id,inventory_date,grouping_basis
), inventory AS (
 SELECT g.*,
  CASE WHEN g.grouping_basis<>'UTC_OBSERVATION_DATE_NOT_WORKDAY_DATE' THEN
   (SELECT count(*) FROM public.workday_records x WHERE x.cliente_id=g.cliente_id AND x.empleado_id=g.empleado_id AND x.workday_date=g.inventory_date) END AS workday_count,
  CASE WHEN g.grouping_basis<>'UTC_OBSERVATION_DATE_NOT_WORKDAY_DATE' THEN
   (SELECT count(*) FROM public.workday_record_history x WHERE x.cliente_id=g.cliente_id AND x.empleado_id=g.empleado_id AND x.workday_date=g.inventory_date) END AS history_count,
  CASE WHEN g.grouping_basis<>'UTC_OBSERVATION_DATE_NOT_WORKDAY_DATE' THEN
   (SELECT count(*) FROM public.workday_calculation_revisions x WHERE x.cliente_id=g.cliente_id AND x.empleado_id=g.empleado_id AND x.workday_date=g.inventory_date) END AS revision_count,
  CASE WHEN g.grouping_basis<>'UTC_OBSERVATION_DATE_NOT_WORKDAY_DATE' THEN
   (SELECT count(*) FROM public.workday_revision_promotions x WHERE x.cliente_id=g.cliente_id AND x.empleado_id=g.empleado_id AND x.workday_date=g.inventory_date) END AS promotion_count,
  (SELECT count(*) FROM public.attendance_persist_outbox o WHERE o.registro_id=ANY(g.registro_ids)) AS outbox_count,
  (g.event_count=2 AND g.event_order='IN -> OUT' AND g.duplicate_timestamps=0) AS normalized_clean_pair
 FROM groups g
)
SELECT clock_timestamp() AS checked_at,
 (SELECT jsonb_build_object('total_registros',count(*),'total_in',count(*) FILTER(WHERE runtime_direction='IN'),
   'total_out',count(*) FILTER(WHERE runtime_direction='OUT'),'total_unknown',count(*) FILTER(WHERE runtime_direction='UNKNOWN'),
   'raw255_normalized_direction_present',count(*) FILTER(WHERE raw_status='255' AND runtime_direction IN ('IN','OUT')),
   'local_days_with_in_out',(SELECT count(*) FROM (SELECT empleado_id,local_date FROM rows WHERE local_date IS NOT NULL GROUP BY empleado_id,local_date
      HAVING bool_or(runtime_direction='IN') AND bool_or(runtime_direction='OUT')) local_days),
   'records_without_authoritative_local_date',count(*) FILTER(WHERE local_date IS NULL)) FROM rows) AS raw_summary,
 (SELECT jsonb_agg((to_jsonb(i)-'registro_ids') || jsonb_build_object('strict_canary_exclusion_reasons',
   array_remove(ARRAY[
    CASE WHEN NOT normalized_clean_pair THEN 'NOT_EXACTLY_TWO_ORDERED_IN_OUT' END,
    CASE WHEN raw_directions IS DISTINCT FROM '["check_in","check_out"]'::jsonb THEN 'PREVIOUS_QUERY_REQUIRED_EXPLICIT_RAW_CHECK_IN_OUT' END,
    CASE WHEN NOT schedule_resolved THEN 'SCHEDULE_UNRESOLVED_OR_AMBIGUOUS' END,
    CASE WHEN NOT employee_active THEN 'EMPLOYEE_INACTIVE_OR_MISSING' END,
    CASE WHEN device_count<>1 THEN 'MULTIPLE_OR_MISSING_DEVICE' END,
    CASE WHEN duplicate_timestamps>0 THEN 'DUPLICATE_TIMESTAMPS' END,
    CASE WHEN workday_count>0 THEN 'WORKDAY_EXISTS' END,
    CASE WHEN history_count>0 THEN 'HISTORY_EXISTS' END,
    CASE WHEN revision_count>0 THEN 'REVISION_EXISTS' END,
    CASE WHEN promotion_count>0 THEN 'PROMOTION_EXISTS' END,
    CASE WHEN outbox_count>0 THEN 'OUTBOX_EXISTS' END
   ]::text[],NULL)) ORDER BY empleado_id,inventory_date,grouping_basis) FROM inventory i) AS all_jornadas,
 (SELECT jsonb_build_object('normalized_clean_pairs',count(*) FILTER(WHERE normalized_clean_pair),
   'clean_pairs_already_persisted',count(*) FILTER(WHERE normalized_clean_pair AND workday_count>0),
   'clean_pairs_without_workday',count(*) FILTER(WHERE normalized_clean_pair AND workday_count=0),
   'clean_pairs_without_versioned_evidence',count(*) FILTER(WHERE normalized_clean_pair AND revision_count=0 AND promotion_count=0),
   'clean_pairs_with_raw255',count(*) FILTER(WHERE normalized_clean_pair AND raw255_normalized_count>0)) FROM inventory) AS diagnostic_summary;
