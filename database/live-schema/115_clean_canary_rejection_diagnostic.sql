-- READ-ONLY diagnostics; no row here is authorized as a persist candidate.
WITH attendance AS (
 SELECT r.id,r.cliente_id,r.empleado_id,r.dispositivo_id,r.verificado_at,r.tipo_verificacion,
   r.source_event_id,r.es_manual,r.raw_payload->>'raw_status' AS raw_status,
   r.raw_payload->>'source_log_id' AS source_log_id,d.timezone,
   (r.verificado_at AT TIME ZONE d.timezone)::date AS local_date
 FROM public.registro_asistencia r
 JOIN public.empleados emp ON emp.id=r.empleado_id AND emp.cliente_id=r.cliente_id AND emp.activo
 JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
 WHERE r.cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND d.timezone='America/Cancun'
), dates AS (
 SELECT DISTINCT cliente_id,empleado_id,timezone,local_date AS workday_date FROM attendance
 UNION SELECT DISTINCT cliente_id,empleado_id,timezone,local_date-1 FROM attendance
), contexts AS (
 SELECT dt.*,a.id AS assignment_id,a.horario_id AS schedule_id,a.schedule_revision_id,
   sr.config_snapshot->>'horario_activo' AS schedule_active,
   sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot) AS hash_valid,
   sr.config_snapshot->'dias_config'->(ARRAY['dom','lun','mar','mie','jue','vie','sab'])[extract(dow FROM dt.workday_date)::integer+1] AS day_config,
   (SELECT count(*) FROM public.empleados_horarios x WHERE x.cliente_id=dt.cliente_id AND x.empleado_id=dt.empleado_id
      AND x.activo AND x.fecha_inicio<=dt.workday_date AND (x.fecha_fin IS NULL OR x.fecha_fin>=dt.workday_date)) AS assignment_count
 FROM dates dt JOIN public.empleados_horarios a ON a.cliente_id=dt.cliente_id AND a.empleado_id=dt.empleado_id
   AND a.activo AND a.fecha_inicio<=dt.workday_date AND (a.fecha_fin IS NULL OR a.fecha_fin>=dt.workday_date)
 LEFT JOIN public.schedule_revisions sr ON sr.id=a.schedule_revision_id AND sr.cliente_id=a.cliente_id AND sr.horario_id=a.horario_id
), windows AS (
 SELECT c.*,
   ((workday_date+(day_config->>'entrada')::time) AT TIME ZONE timezone)-interval '120 minutes' AS window_start,
   (((workday_date+CASE WHEN (day_config->>'salida')::time<=(day_config->>'entrada')::time THEN 1 ELSE 0 END)
      +(day_config->>'salida')::time) AT TIME ZONE timezone)+interval '180 minutes' AS window_end
 FROM contexts c WHERE day_config->>'activo'='true' AND nullif(day_config->>'entrada','') IS NOT NULL
   AND nullif(day_config->>'salida','') IS NOT NULL
), diagnostics AS (
 SELECT w.*,p.event_count,p.events,
   (SELECT count(*) FROM public.attendance_source_events s WHERE s.cliente_id=w.cliente_id AND s.employee_id=w.empleado_id
     AND s.occurred_at BETWEEN w.window_start AND w.window_end) AS source_count,
   (SELECT count(*) FROM public.workday_records x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date) AS workday_count,
   (SELECT count(*) FROM public.workday_record_history x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date) AS history_count,
   (SELECT count(*) FROM public.workday_calculation_revisions x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date) AS revision_count,
   (SELECT count(*) FROM public.workday_revision_promotions x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date) AS promotion_count
 FROM windows w CROSS JOIN LATERAL (
   SELECT count(*) AS event_count,jsonb_agg(jsonb_build_object(
     'registro_id',r.id,'timestamp',r.verificado_at,'raw_status',r.raw_status,'tipo_verificacion',r.tipo_verificacion,
     'source_event_id',s.id,'source_occurred_at',s.occurred_at,'processing_status',s.processing_status,
     'source_tenant_matches',s.cliente_id=r.cliente_id,'source_employee_matches',s.employee_id=r.empleado_id,
     'source_device_matches',s.device_id=r.dispositivo_id,'timestamps_match',s.occurred_at=r.verificado_at,
     'es_manual',r.es_manual,'device_id',r.dispositivo_id,
     'attlog_exists',l.id IS NOT NULL,'attlog_status',l.status,'attlog_timestamp',l.timestamp,
     'attlog_source_reference_matches',l.id=s.source_reference,
     'source_link_count',(SELECT count(*) FROM public.registro_asistencia x WHERE x.source_event_id=s.id),
     'matching_window_count',(SELECT count(*) FROM windows x WHERE x.cliente_id=r.cliente_id AND x.empleado_id=r.empleado_id AND r.verificado_at BETWEEN x.window_start AND x.window_end),
     'outbox_count',(SELECT count(*) FROM public.attendance_persist_outbox x WHERE x.registro_id=r.id))
     ORDER BY r.verificado_at,r.id) AS events
   FROM attendance r LEFT JOIN public.attendance_source_events s ON s.id=r.source_event_id
   LEFT JOIN public.attendance_logs l ON l.id::text=r.source_log_id
   WHERE r.cliente_id=w.cliente_id AND r.empleado_id=w.empleado_id AND r.verificado_at BETWEEN w.window_start AND w.window_end
 ) p WHERE p.event_count>0
)
SELECT clock_timestamp() AS checked_at,cliente_id,empleado_id,workday_date,schedule_id,schedule_revision_id,
 assignment_count,schedule_active,hash_valid,timezone,window_start,window_end,
 event_count,source_count,events,
 (event_count=2 AND events->0->>'raw_status'='check_in' AND events->0->>'tipo_verificacion'='entrada'
   AND events->1->>'raw_status'='check_out' AND events->1->>'tipo_verificacion'='salida') AS explicit_two_event_in_out,
 workday_count,history_count,revision_count,promotion_count,
 'DIAGNOSTIC_ONLY_NOT_ELIGIBILITY_APPROVAL'::text AS classification
FROM diagnostics
ORDER BY (empleado_id='6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) DESC,
 (event_count=2 AND events->0->>'raw_status'='check_in' AND events->1->>'raw_status'='check_out') DESC NULLS LAST,
 workday_count ASC,workday_date DESC,empleado_id
LIMIT 30;
