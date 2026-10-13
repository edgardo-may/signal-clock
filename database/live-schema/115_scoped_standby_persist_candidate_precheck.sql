-- SELECT-only candidate audit. Does not authorize persistence or invoke an RPC.
-- Return the complete row; calculation output must be compared before opening a gate.
WITH candidate AS (
  SELECT r.id AS registro_id, r.cliente_id, r.empleado_id, r.dispositivo_id,
         r.source_event_id, r.es_manual, r.verificado_at,
         r.tipo_verificacion, r.metodo,
         md5(to_jsonb(r)::text) AS registro_digest
  FROM public.registro_asistencia r
  WHERE r.id='ead4b1f4-7428-48f6-9784-da35ffa88e80'::uuid
)
SELECT clock_timestamp() AS checked_at, c.*,
       d.timezone, emp.activo AS employee_active,
       e.source_type, e.processing_status,
       e.cliente_id AS source_cliente_id, e.employee_id AS source_employee_id,
       o.id AS outbox_id, o.status AS outbox_status,
       o.workday_id AS outbox_workday_id,
       w.id AS workday_id, w.schedule_id, w.workday_date,
       w.current_revision_id, w.calculation_version,
       to_jsonb(w) AS current_workday_snapshot,
       md5(to_jsonb(e)::text) AS source_event_digest,
       md5(to_jsonb(o)::text) AS outbox_digest,
       md5(to_jsonb(w)::text) AS workday_digest,
       md5(to_jsonb(d)::text) AS device_digest,
       md5(to_jsonb(emp)::text) AS employee_digest,
       (SELECT count(*) FROM public.workday_record_history h WHERE h.workday_record_id=w.id) AS workday_history_count,
       (SELECT count(*) FROM public.workday_calculation_revisions cr WHERE cr.cliente_id=c.cliente_id AND cr.empleado_id=c.empleado_id AND cr.workday_date=w.workday_date) AS workday_revision_count,
       (SELECT count(*) FROM public.workday_revision_promotions p WHERE p.cliente_id=c.cliente_id AND p.empleado_id=c.empleado_id AND p.workday_date=w.workday_date) AS workday_promotion_count,
       (SELECT count(*) FROM public.registro_asistencia r WHERE r.cliente_id=c.cliente_id AND r.empleado_id=c.empleado_id) AS employee_event_count,
       (SELECT jsonb_agg(jsonb_build_object(
          'id',a.id,'cliente_id',a.cliente_id,'empleado_id',a.empleado_id,
          'horario_id',a.horario_id,'schedule_revision_id',a.schedule_revision_id,
          'fecha_inicio',a.fecha_inicio,'fecha_fin',a.fecha_fin,'activo',a.activo,
          'revision_version',sr.version,'revision_hash',sr.integrity_hash,
          'revision_hash_valid',sr.integrity_hash=public.schedule_revision_calculation_hash(sr.config_snapshot),
          'config_snapshot',sr.config_snapshot) ORDER BY a.fecha_inicio,a.id)
        FROM public.empleados_horarios a
        LEFT JOIN public.schedule_revisions sr ON sr.id=a.schedule_revision_id AND sr.cliente_id=a.cliente_id AND sr.horario_id=a.horario_id
        WHERE a.cliente_id=c.cliente_id AND a.empleado_id=c.empleado_id AND a.activo) AS assignments_and_revisions,
       (SELECT jsonb_agg(jsonb_build_object('cliente_id',f.cliente_id,'feature_key',f.feature_key,'mode',f.mode,'enabled',f.enabled) ORDER BY f.feature_key)
        FROM public.tenant_features f WHERE f.cliente_id=c.cliente_id AND f.feature_key IN ('REVISION_SCHEDULE_RESOLVER','WORKDAY_PERSIST_ACTIVE')) AS feature_state,
       (SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,
          'trigger',t.tgname,'enabled',t.tgenabled,
          'definition',pg_get_triggerdef(t.oid),
          'function_definition',pg_get_functiondef(t.tgfoid)) ORDER BY t.tgrelid::regclass::text,t.tgname)
        FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN (
          'public.workday_records'::regclass,'public.workday_record_history'::regclass,
          'public.workday_calculation_revisions'::regclass,'public.workday_revision_promotions'::regclass,
          'public.attendance_persist_outbox'::regclass,'public.tenant_features'::regclass)) AS mutation_surface_triggers
FROM candidate c
LEFT JOIN public.devices d ON d.id=c.dispositivo_id AND d.cliente_id=c.cliente_id
LEFT JOIN public.empleados emp ON emp.id=c.empleado_id AND emp.cliente_id=c.cliente_id
LEFT JOIN public.attendance_source_events e ON e.id=c.source_event_id
LEFT JOIN public.attendance_persist_outbox o ON o.registro_id=c.registro_id
LEFT JOIN public.workday_records w ON w.id=o.workday_id AND w.cliente_id=c.cliente_id AND w.empleado_id=c.empleado_id;
