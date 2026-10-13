-- SELECT-only. Input for offline standby calculation; no RPC or authorization write.
WITH anchor AS (
 SELECT id,cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,source_event_id,es_manual
 FROM public.registro_asistencia WHERE id='6c438fa7-3537-4859-a539-c84c87744754'::uuid
), events AS (
 SELECT r.id,r.cliente_id,r.empleado_id,r.dispositivo_id,r.verificado_at,r.tipo_verificacion,r.metodo,r.source_event_id,r.es_manual
 FROM public.registro_asistencia r JOIN anchor a ON r.cliente_id=a.cliente_id AND r.empleado_id=a.empleado_id
 WHERE r.verificado_at BETWEEN timestamptz '2026-09-16 12:00:00+00' AND timestamptz '2026-09-17 02:00:00+00'
), source_evidence AS (
 SELECT e.id,e.cliente_id,e.employee_id,e.device_id,e.source_type,e.source_reference,
        e.occurred_at,e.received_at,e.processing_status,
        (SELECT jsonb_object_agg(k,v) FROM jsonb_each(e.raw_payload) kv(k,v)
         WHERE k ~* '(direction|status|in.?out|punch.?state|verify|verification)') AS raw_direction_evidence,
        (SELECT jsonb_agg(r.id ORDER BY r.id) FROM public.registro_asistencia r WHERE r.source_event_id=e.id) AS linked_registro_ids
 FROM public.attendance_source_events e JOIN anchor a ON e.cliente_id=a.cliente_id AND e.employee_id=a.empleado_id
 WHERE e.id IN (SELECT source_event_id FROM events)
    OR e.occurred_at BETWEEN timestamptz '2026-09-16 12:00:00+00' AND timestamptz '2026-09-17 02:00:00+00'
)
SELECT clock_timestamp() AS checked_at,
 (SELECT to_jsonb(a) FROM anchor a) AS anchor,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.verificado_at,e.id) FROM events e) AS events,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.occurred_at,s.id) FROM source_evidence s) AS source_evidence,
 (SELECT jsonb_agg(jsonb_build_object('id',d.id,'cliente_id',d.cliente_id,'timezone',d.timezone) ORDER BY d.id)
  FROM public.devices d JOIN anchor a ON d.cliente_id=a.cliente_id
  WHERE d.id IN (SELECT dispositivo_id FROM events UNION SELECT dispositivo_id FROM anchor)) AS devices,
 (SELECT jsonb_build_object('id',e.id,'cliente_id',e.cliente_id,'activo',e.activo)
  FROM public.empleados e JOIN anchor a ON e.id=a.empleado_id AND e.cliente_id=a.cliente_id) AS employee,
 (SELECT jsonb_agg(jsonb_build_object('id',a.id,'cliente_id',a.cliente_id,'empleado_id',a.empleado_id,'horario_id',a.horario_id,
    'schedule_revision_id',a.schedule_revision_id,'fecha_inicio',a.fecha_inicio,'fecha_fin',a.fecha_fin,'activo',a.activo) ORDER BY a.id)
  FROM public.empleados_horarios a JOIN anchor r ON a.cliente_id=r.cliente_id AND a.empleado_id=r.empleado_id WHERE a.activo) AS assignments,
 (SELECT jsonb_agg(jsonb_build_object('id',sr.id,'cliente_id',sr.cliente_id,'horario_id',sr.horario_id,'version',sr.version,
    'config_snapshot',sr.config_snapshot,'integrity_hash',sr.integrity_hash,
    'hash_valid',sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot)) ORDER BY sr.id)
  FROM public.schedule_revisions sr WHERE sr.id IN (
    SELECT a.schedule_revision_id FROM public.empleados_horarios a JOIN anchor r ON a.cliente_id=r.cliente_id AND a.empleado_id=r.empleado_id WHERE a.activo)) AS revisions,
 (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.workday_records w JOIN anchor a ON w.cliente_id=a.cliente_id AND w.empleado_id=a.empleado_id
  WHERE w.workday_date=date '2026-09-16') AS existing_workdays,
 (SELECT count(*) FROM public.workday_record_history h JOIN anchor a ON h.cliente_id=a.cliente_id AND h.empleado_id=a.empleado_id WHERE h.workday_date=date '2026-09-16') AS history_count,
 (SELECT count(*) FROM public.workday_calculation_revisions cr JOIN anchor a ON cr.cliente_id=a.cliente_id AND cr.empleado_id=a.empleado_id WHERE cr.workday_date=date '2026-09-16') AS calculation_revision_count,
 (SELECT count(*) FROM public.workday_revision_promotions p JOIN anchor a ON p.cliente_id=a.cliente_id AND p.empleado_id=a.empleado_id WHERE p.workday_date=date '2026-09-16') AS promotion_count,
 (SELECT jsonb_agg(jsonb_build_object('id',o.id,'registro_id',o.registro_id,'status',o.status,'workday_id',o.workday_id,'persistence_result',o.persistence_result) ORDER BY o.id)
  FROM public.attendance_persist_outbox o WHERE o.registro_id IN (SELECT id FROM events)) AS window_outbox,
 (SELECT jsonb_agg(jsonb_build_object('cliente_id',f.cliente_id,'feature_key',f.feature_key,'mode',f.mode,'enabled',f.enabled,
    'canary_registro_id',f.canary_registro_id,'canary_empleado_id',f.canary_empleado_id,'canary_schedule_id',f.canary_schedule_id,'canary_workday_date',f.canary_workday_date) ORDER BY f.feature_key)
  FROM public.tenant_features f JOIN anchor a ON f.cliente_id=a.cliente_id
  WHERE f.feature_key IN ('WORKDAY_PERSIST_ACTIVE','REVISION_SCHEDULE_RESOLVER')) AS feature_state;
