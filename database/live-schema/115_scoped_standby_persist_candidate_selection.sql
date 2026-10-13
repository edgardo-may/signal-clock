-- READ-ONLY shortlist, NOT authorization to persist any returned row.
-- Same approved tenant/employee; existing automatic PROCESSED source only.
-- Deliberately limited to non-overnight assigned working days, no existing Workday.
WITH anchors AS (
  SELECT r.*,d.timezone,(r.verificado_at AT TIME ZONE d.timezone)::date AS local_date
  FROM public.registro_asistencia r
  JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
  JOIN public.empleados emp ON emp.id=r.empleado_id AND emp.cliente_id=r.cliente_id AND emp.activo
  JOIN public.attendance_source_events e ON e.id=r.source_event_id
    AND e.cliente_id=r.cliente_id AND e.employee_id=r.empleado_id
    AND e.source_type='ZKTECO' AND e.processing_status='PROCESSED'
  WHERE r.cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND r.empleado_id='6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
    AND r.es_manual IS NOT TRUE AND d.timezone='America/Cancun'
), assignments AS (
  SELECT r.*,a.id AS assignment_id,a.horario_id AS schedule_id,
         a.schedule_revision_id,sr.version AS schedule_revision_version,
         sr.config_snapshot->'dias_config'->(ARRAY['dom','lun','mar','mie','jue','vie','sab'])[
           extract(dow FROM r.local_date)::integer+1] AS day_config,
         count(*) OVER (PARTITION BY r.id) AS assignment_count
  FROM anchors r
  JOIN public.empleados_horarios a ON a.cliente_id=r.cliente_id AND a.empleado_id=r.empleado_id
    AND a.activo AND a.fecha_inicio<=r.local_date AND (a.fecha_fin IS NULL OR a.fecha_fin>=r.local_date)
  JOIN public.schedule_revisions sr ON sr.id=a.schedule_revision_id
    AND sr.cliente_id=a.cliente_id AND sr.horario_id=a.horario_id
    AND sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot)
), bounded AS (
  SELECT a.*,
    ((a.local_date+(a.day_config->>'entrada')::time) AT TIME ZONE a.timezone)-interval '120 minutes' AS window_start,
    ((a.local_date+(a.day_config->>'salida')::time) AT TIME ZONE a.timezone)+interval '180 minutes' AS window_end
  FROM assignments a
  WHERE a.assignment_count=1 AND a.day_config->>'activo'='true'
    AND nullif(a.day_config->>'entrada','') IS NOT NULL
    AND nullif(a.day_config->>'salida','') IS NOT NULL
    AND (a.day_config->>'salida')::time>(a.day_config->>'entrada')::time
), eligible AS (
  SELECT b.* FROM bounded b
  WHERE b.verificado_at BETWEEN b.window_start AND b.window_end
    AND NOT EXISTS (SELECT 1 FROM public.workday_records w WHERE w.cliente_id=b.cliente_id AND w.empleado_id=b.empleado_id AND w.workday_date=b.local_date)
    AND NOT EXISTS (SELECT 1 FROM public.workday_calculation_revisions cr WHERE cr.cliente_id=b.cliente_id AND cr.empleado_id=b.empleado_id AND cr.workday_date=b.local_date)
    AND NOT EXISTS (SELECT 1 FROM public.workday_revision_promotions p WHERE p.cliente_id=b.cliente_id AND p.empleado_id=b.empleado_id AND p.workday_date=b.local_date)
)
SELECT DISTINCT ON (b.local_date) clock_timestamp() AS checked_at,
  b.id AS registro_id,b.cliente_id,b.empleado_id,b.schedule_id,
  b.local_date AS proposed_workday_date,b.assignment_id,b.schedule_revision_id,
  b.schedule_revision_version,b.timezone,b.source_event_id,b.tipo_verificacion,
  b.window_start,b.window_end,
  (SELECT count(*) FROM public.registro_asistencia r WHERE r.cliente_id=b.cliente_id AND r.empleado_id=b.empleado_id AND r.verificado_at BETWEEN b.window_start AND b.window_end) AS window_event_count,
  (SELECT max(r.verificado_at) FROM public.registro_asistencia r WHERE r.cliente_id=b.cliente_id AND r.empleado_id=b.empleado_id AND r.verificado_at BETWEEN b.window_start AND b.window_end) AS source_observed_at,
  (SELECT o.status FROM public.attendance_persist_outbox o WHERE o.registro_id=b.id) AS outbox_status,
  'REQUIRES_FULL_CANDIDATE_AUDIT'::text AS eligibility
FROM eligible b
ORDER BY b.local_date DESC,b.verificado_at DESC,b.id
LIMIT 5;
