-- SELECT-only shortlist. Exact RAW evidence; no direction inference, writes or RPC.
-- All historical dates in the pilot tenant; preferred employee ranks first.
WITH attendance AS (
 SELECT r.id,r.cliente_id,r.empleado_id,r.dispositivo_id,r.verificado_at,
        r.tipo_verificacion,r.source_event_id,r.es_manual,
        r.raw_payload->>'raw_status' AS raw_status,
        r.raw_payload->>'source_log_id' AS source_log_id,d.timezone,
        (r.verificado_at AT TIME ZONE d.timezone)::date AS local_date
 FROM public.registro_asistencia r
 JOIN public.empleados emp ON emp.id=r.empleado_id AND emp.cliente_id=r.cliente_id AND emp.activo
 JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
 WHERE r.cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
   AND d.timezone='America/Cancun'
), dates AS (
 SELECT DISTINCT cliente_id,empleado_id,timezone,local_date AS workday_date FROM attendance
 UNION
 SELECT DISTINCT cliente_id,empleado_id,timezone,local_date-1 FROM attendance
), contexts AS (
 SELECT dt.*,a.id AS assignment_id,a.horario_id AS schedule_id,a.schedule_revision_id,
        sr.version AS schedule_revision_version,
        sr.config_snapshot->'dias_config'->(ARRAY['dom','lun','mar','mie','jue','vie','sab'])[extract(dow FROM dt.workday_date)::integer+1] AS day_config,
        sr.config_snapshot->>'horario_activo' AS schedule_active,
        sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot) AS revision_hash_valid,
        (SELECT count(*) FROM public.empleados_horarios other
         WHERE other.cliente_id=dt.cliente_id AND other.empleado_id=dt.empleado_id AND other.activo
           AND other.fecha_inicio<=dt.workday_date AND (other.fecha_fin IS NULL OR other.fecha_fin>=dt.workday_date)) AS assignment_count
 FROM dates dt
 JOIN public.empleados_horarios a ON a.cliente_id=dt.cliente_id AND a.empleado_id=dt.empleado_id
   AND a.activo AND a.fecha_inicio<=dt.workday_date AND (a.fecha_fin IS NULL OR a.fecha_fin>=dt.workday_date)
 JOIN public.schedule_revisions sr ON sr.id=a.schedule_revision_id AND sr.cliente_id=a.cliente_id AND sr.horario_id=a.horario_id
), windows AS (
 SELECT c.*,
   ((workday_date+(day_config->>'entrada')::time) AT TIME ZONE timezone)-interval '120 minutes' AS window_start,
   (((workday_date+CASE WHEN (day_config->>'salida')::time<=(day_config->>'entrada')::time THEN 1 ELSE 0 END)
       +(day_config->>'salida')::time) AT TIME ZONE timezone)+interval '180 minutes' AS window_end
 FROM contexts c WHERE day_config->>'activo'='true'
   AND nullif(day_config->>'entrada','') IS NOT NULL AND nullif(day_config->>'salida','') IS NOT NULL
), pairs AS (
 SELECT w.*,pair.rows,pair.event_count
 FROM windows w
 CROSS JOIN LATERAL (
   SELECT count(*) AS event_count,jsonb_agg(jsonb_build_object(
      'registro_id',r.id,'source_event_id',r.source_event_id,'timestamp',r.verificado_at,
      'occurred_at',e.occurred_at,'raw_status',r.raw_status,'tipo_verificacion',r.tipo_verificacion,
      'device_id',r.dispositivo_id,'timezone',r.timezone,'processing_status',e.processing_status)
      ORDER BY r.verificado_at,r.id) AS rows,
      bool_and(COALESCE(r.es_manual IS NOT TRUE AND e.id IS NOT NULL AND e.source_type='ZKTECO'
        AND e.processing_status='PROCESSED' AND e.cliente_id=r.cliente_id AND e.employee_id=r.empleado_id
        AND e.device_id=r.dispositivo_id AND e.occurred_at=r.verificado_at
        AND l.id IS NOT NULL AND l.timestamp=r.verificado_at AND l.status=r.raw_status
        AND (SELECT count(*) FROM public.registro_asistencia link WHERE link.source_event_id=e.id)=1
        AND (SELECT count(*) FROM windows ov WHERE ov.cliente_id=r.cliente_id AND ov.empleado_id=r.empleado_id
             AND r.verificado_at BETWEEN ov.window_start AND ov.window_end)=1,false)) AS evidence_valid,
      count(DISTINCT r.dispositivo_id) AS device_count
   FROM attendance r
   LEFT JOIN public.attendance_source_events e ON e.id=r.source_event_id
   LEFT JOIN public.attendance_logs l ON l.id::text=r.source_log_id AND l.id=e.source_reference
   WHERE r.cliente_id=w.cliente_id AND r.empleado_id=w.empleado_id
     AND r.verificado_at BETWEEN w.window_start AND w.window_end
 ) pair
 WHERE w.assignment_count=1 AND w.revision_hash_valid AND w.schedule_active='true'
   AND (w.day_config->>'salida')::time>(w.day_config->>'entrada')::time
   AND pair.event_count=2 AND pair.evidence_valid AND pair.device_count=1
   AND (pair.rows->0->>'raw_status')='check_in' AND (pair.rows->0->>'tipo_verificacion')='entrada'
   AND (pair.rows->1->>'raw_status')='check_out' AND (pair.rows->1->>'tipo_verificacion')='salida'
   AND (pair.rows->0->>'occurred_at')::timestamptz<(pair.rows->1->>'occurred_at')::timestamptz
   AND (SELECT count(*) FROM public.attendance_source_events e WHERE e.cliente_id=w.cliente_id AND e.employee_id=w.empleado_id
        AND e.occurred_at BETWEEN w.window_start AND w.window_end)=2
   AND NOT EXISTS(SELECT 1 FROM public.workday_records x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date)
   AND NOT EXISTS(SELECT 1 FROM public.workday_record_history x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date)
   AND NOT EXISTS(SELECT 1 FROM public.workday_calculation_revisions x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date)
   AND NOT EXISTS(SELECT 1 FROM public.workday_revision_promotions x WHERE x.cliente_id=w.cliente_id AND x.empleado_id=w.empleado_id AND x.workday_date=w.workday_date)
   AND NOT EXISTS(SELECT 1 FROM public.attendance_persist_outbox o JOIN attendance r ON o.registro_id=r.id
       WHERE r.cliente_id=w.cliente_id AND r.empleado_id=w.empleado_id AND r.verificado_at BETWEEN w.window_start AND w.window_end)
)
SELECT clock_timestamp() AS checked_at,rows->1->>'registro_id' AS candidate_registro_id,
 cliente_id,empleado_id,workday_date,schedule_id,assignment_id,schedule_revision_id,schedule_revision_version,
 timezone,window_start,window_end,event_count,rows AS ordered_events,
 false AS workday_exists,NULL::uuid AS current_revision_id,0 AS history_count,0 AS revision_count,0 AS promotion_count,
 0 AS outbox_count,true AS schedule_valid,true AS employee_active,'IN -> OUT'::text AS event_order,
 'REQUIRES_FULL_AUDIT_AND_OFFLINE_CALCULATION'::text AS next_step
FROM pairs
ORDER BY (empleado_id='6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid) DESC,workday_date DESC,empleado_id
LIMIT 10;
