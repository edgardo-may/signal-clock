-- Phase 31: READ-ONLY candidate discovery for a future production SHADOW canary.
-- This script deliberately lists candidates; it never chooses or processes one.
BEGIN TRANSACTION READ ONLY;

WITH physical_registros AS (
  SELECT
    r.id AS registro_id,
    r.cliente_id,
    r.empleado_id,
    r.dispositivo_id,
    r.verificado_at,
    r.source_event_id,
    d.timezone,
    (r.verificado_at AT TIME ZONE d.timezone)::date AS local_event_date
  FROM public.registro_asistencia AS r
  INNER JOIN public.devices AS d
    ON d.id = r.dispositivo_id
   AND d.cliente_id = r.cliente_id
  INNER JOIN public.empleados AS e
    ON e.id = r.empleado_id
   AND e.cliente_id = r.cliente_id
  WHERE r.cliente_id IS NOT NULL
    AND r.empleado_id IS NOT NULL
    AND r.dispositivo_id IS NOT NULL
    AND NULLIF(BTRIM(d.timezone), '') IS NOT NULL
),
schedule_candidates AS (
  SELECT
    p.registro_id,
    p.cliente_id,
    p.empleado_id,
    p.dispositivo_id,
    p.verificado_at,
    p.source_event_id,
    p.timezone,
    p.local_event_date,
    candidate.operative_date,
    h.id AS schedule_id,
    day_config.config AS day_config
  FROM physical_registros AS p
  CROSS JOIN LATERAL (
    VALUES (p.local_event_date), (p.local_event_date - 1)
  ) AS candidate(operative_date)
  INNER JOIN public.empleados_horarios AS eh
    ON eh.cliente_id = p.cliente_id
   AND eh.empleado_id = p.empleado_id
   AND eh.activo = TRUE
   AND eh.fecha_inicio <= candidate.operative_date
   AND (eh.fecha_fin IS NULL OR eh.fecha_fin >= candidate.operative_date)
  INNER JOIN public.horarios AS h
    ON h.id = eh.horario_id
   AND h.cliente_id = p.cliente_id
   AND h.activo = TRUE
  CROSS JOIN LATERAL (
    SELECT h.dias_config -> CASE EXTRACT(DOW FROM candidate.operative_date)::int
      WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mie'
      WHEN 4 THEN 'jue' WHEN 5 THEN 'vie' WHEN 6 THEN 'sab'
    END AS config
  ) AS day_config
  WHERE COALESCE((day_config.config ->> 'activo')::boolean, FALSE) = TRUE
    AND NULLIF(BTRIM(day_config.config ->> 'entrada'), '') IS NOT NULL
    AND NULLIF(BTRIM(day_config.config ->> 'salida'), '') IS NOT NULL
),
candidate_summary AS (
  SELECT
    p.registro_id,
    p.cliente_id,
    p.empleado_id,
    p.dispositivo_id,
    p.verificado_at,
    p.source_event_id,
    p.timezone,
    p.local_event_date,
    COUNT(sc.schedule_id) AS valid_schedule_count,
    ARRAY_AGG(sc.schedule_id ORDER BY sc.schedule_id) FILTER (WHERE sc.schedule_id IS NOT NULL) AS schedule_ids,
    ARRAY_AGG(sc.operative_date ORDER BY sc.operative_date) FILTER (WHERE sc.operative_date IS NOT NULL) AS operative_dates,
    BOOL_OR((sc.day_config ->> 'salida') <= (sc.day_config ->> 'entrada')) AS has_night_schedule
  FROM physical_registros AS p
  LEFT JOIN schedule_candidates AS sc ON sc.registro_id = p.registro_id
  GROUP BY p.registro_id, p.cliente_id, p.empleado_id, p.dispositivo_id,
    p.verificado_at, p.source_event_id, p.timezone, p.local_event_date
)
SELECT
  registro_id,
  cliente_id,
  empleado_id,
  dispositivo_id,
  verificado_at,
  source_event_id,
  timezone,
  local_event_date,
  schedule_ids,
  operative_dates,
  has_night_schedule,
  CASE
    WHEN valid_schedule_count = 1 THEN 'ELIGIBLE_REVIEW_REQUIRED'
    WHEN valid_schedule_count = 0 THEN 'NO_VALID_SCHEDULE'
    ELSE 'AMBIGUOUS_SCHEDULE'
  END AS candidate_status
FROM candidate_summary
WHERE valid_schedule_count = 1
ORDER BY (source_event_id IS NOT NULL) DESC, has_night_schedule DESC, verificado_at, registro_id;

-- The caller must inspect the full result and choose a registro_id manually.
-- No automatic selection, mutation, RPC, or engine invocation is permitted.
ROLLBACK;
