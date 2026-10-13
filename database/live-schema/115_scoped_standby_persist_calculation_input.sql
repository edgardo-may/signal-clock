-- SELECT-only input for offline execution of the deployed standby/domain.
-- The validated Thursday shift is 09:00-18:00 America/Cancun.
-- Canonical window: scheduled start minus 120 min, end plus 180 min.
WITH anchor AS (
  SELECT id,cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,source_event_id,es_manual
  FROM public.registro_asistencia
  WHERE id='ead4b1f4-7428-48f6-9784-da35ffa88e80'::uuid
), events AS (
  SELECT r.id,r.cliente_id,r.empleado_id,r.dispositivo_id,r.verificado_at,
         r.tipo_verificacion,r.metodo,r.source_event_id,r.es_manual
  FROM public.registro_asistencia r JOIN anchor a
    ON r.cliente_id=a.cliente_id AND r.empleado_id=a.empleado_id
  WHERE r.verificado_at >= (timestamp '2026-09-24 07:00:00' AT TIME ZONE 'America/Cancun')
    AND r.verificado_at <= (timestamp '2026-09-24 21:00:00' AT TIME ZONE 'America/Cancun')
)
SELECT clock_timestamp() AS checked_at,
       (SELECT to_jsonb(a) FROM anchor a) AS anchor,
       (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.verificado_at,r.id) FROM events r) AS events,
       (SELECT count(*) FROM events) AS source_event_count,
       (SELECT max(verificado_at) FROM events) AS source_observed_at,
       (SELECT jsonb_agg(jsonb_build_object('id',d.id,'cliente_id',d.cliente_id,'timezone',d.timezone) ORDER BY d.id)
        FROM public.devices d JOIN anchor a ON d.cliente_id=a.cliente_id
        WHERE d.id IN (SELECT dispositivo_id FROM events)) AS devices;
