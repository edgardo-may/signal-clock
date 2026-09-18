-- Phase 32.1: READ-ONLY operative-date audit. Lists evidence only; it never
-- chooses, processes, persists, or invokes the attendance engine.
BEGIN TRANSACTION READ ONLY;

WITH target_registros AS (
  SELECT
    r.id AS registro_id,
    r.cliente_id,
    r.empleado_id,
    r.dispositivo_id,
    r.verificado_at,
    r.source_event_id,
    d.timezone,
    (r.verificado_at AT TIME ZONE d.timezone)::date AS local_event_date,
    (r.verificado_at AT TIME ZONE d.timezone)::time AS local_event_time
  FROM public.registro_asistencia AS r
  INNER JOIN public.devices AS d
    ON d.id = r.dispositivo_id
   AND d.cliente_id = r.cliente_id
  INNER JOIN public.empleados AS e
    ON e.id = r.empleado_id
   AND e.cliente_id = r.cliente_id
  WHERE r.id IN (
    'ede89226-c2ef-464b-809d-c571013a8c25'::uuid,
    '13006bce-63d0-47da-8999-ee5b551c3de0'::uuid,
    '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid
  )
),
candidate_dates AS (
  SELECT target.*, candidate.operative_date, candidate.candidate_relation
  FROM target_registros AS target
  CROSS JOIN LATERAL (
    VALUES
      (target.local_event_date, 'EVENT_LOCAL_DATE'::text),
      (target.local_event_date - 1, 'PREVIOUS_LOCAL_DATE'::text)
  ) AS candidate(operative_date, candidate_relation)
),
schedule_evidence AS (
  SELECT
    candidate.*,
    eh.id AS assignment_id,
    h.id AS schedule_id,
    h.nombre AS schedule_name,
    day_config.config AS day_config,
    NULLIF(BTRIM(day_config.config ->> 'entrada'), '') AS start_time,
    NULLIF(BTRIM(day_config.config ->> 'salida'), '') AS end_time
  FROM candidate_dates AS candidate
  LEFT JOIN public.empleados_horarios AS eh
    ON eh.cliente_id = candidate.cliente_id
   AND eh.empleado_id = candidate.empleado_id
   AND eh.activo = TRUE
   AND eh.fecha_inicio <= candidate.operative_date
   AND (eh.fecha_fin IS NULL OR eh.fecha_fin >= candidate.operative_date)
  LEFT JOIN public.horarios AS h
    ON h.id = eh.horario_id
   AND h.cliente_id = candidate.cliente_id
   AND h.activo = TRUE
  LEFT JOIN LATERAL (
    SELECT h.dias_config -> CASE EXTRACT(DOW FROM candidate.operative_date)::int
      WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mie'
      WHEN 4 THEN 'jue' WHEN 5 THEN 'vie' WHEN 6 THEN 'sab'
    END AS config
  ) AS day_config ON h.id IS NOT NULL
),
window_evidence AS (
  SELECT
    evidence.*,
    COALESCE((evidence.day_config ->> 'activo')::boolean, FALSE) AS day_active,
    CASE
      WHEN evidence.start_time IS NOT NULL AND evidence.end_time IS NOT NULL
      THEN evidence.end_time <= evidence.start_time
      ELSE NULL
    END AS crosses_midnight,
    CASE
      WHEN COALESCE((evidence.day_config ->> 'activo')::boolean, FALSE)
       AND evidence.start_time IS NOT NULL AND evidence.end_time IS NOT NULL
      THEN ((evidence.operative_date::text || ' ' || evidence.start_time)::timestamp AT TIME ZONE evidence.timezone)
      ELSE NULL
    END AS scheduled_start_utc,
    CASE
      WHEN COALESCE((evidence.day_config ->> 'activo')::boolean, FALSE)
       AND evidence.start_time IS NOT NULL AND evidence.end_time IS NOT NULL
      THEN (((evidence.operative_date + CASE WHEN evidence.end_time <= evidence.start_time THEN 1 ELSE 0 END)::text || ' ' || evidence.end_time)::timestamp AT TIME ZONE evidence.timezone)
      ELSE NULL
    END AS scheduled_end_utc
  FROM schedule_evidence AS evidence
),
evaluated AS (
  SELECT
    evidence.*,
    evidence.scheduled_start_utc - INTERVAL '120 minutes' AS window_start_utc,
    evidence.scheduled_end_utc + INTERVAL '180 minutes' AS window_end_utc,
    CASE
      WHEN evidence.scheduled_start_utc IS NULL THEN FALSE
      ELSE evidence.verificado_at BETWEEN evidence.scheduled_start_utc - INTERVAL '120 minutes'
                                    AND evidence.scheduled_end_utc + INTERVAL '180 minutes'
    END AS event_in_shiftmatcher_window
  FROM window_evidence AS evidence
),
per_candidate_date AS (
  SELECT
    registro_id,
    candidate_relation,
    COUNT(*) FILTER (WHERE day_active AND start_time IS NOT NULL AND end_time IS NOT NULL) AS valid_schedule_count,
    COUNT(*) FILTER (WHERE event_in_shiftmatcher_window) AS matching_window_count,
    COUNT(*) FILTER (WHERE candidate_relation = 'EVENT_LOCAL_DATE' AND event_in_shiftmatcher_window AND NOT crosses_midnight) AS normal_match_count,
    COUNT(*) FILTER (WHERE candidate_relation = 'PREVIOUS_LOCAL_DATE' AND event_in_shiftmatcher_window AND crosses_midnight) AS night_match_count,
    COUNT(*) FILTER (WHERE candidate_relation = 'PREVIOUS_LOCAL_DATE' AND day_active AND start_time IS NOT NULL AND end_time IS NOT NULL AND NOT crosses_midnight) AS previous_non_night_count
  FROM evaluated
  GROUP BY registro_id, candidate_relation
),
per_registro AS (
  SELECT
    registro_id,
    MAX(valid_schedule_count) AS maximum_valid_schedule_count,
    SUM(valid_schedule_count) AS total_valid_schedule_count,
    SUM(matching_window_count) AS matching_window_count,
    SUM(normal_match_count) AS normal_match_count,
    SUM(night_match_count) AS night_match_count,
    SUM(previous_non_night_count) AS previous_non_night_count
  FROM per_candidate_date
  GROUP BY registro_id
)
SELECT
  evidence.registro_id,
  evidence.cliente_id,
  evidence.empleado_id,
  evidence.dispositivo_id,
  evidence.source_event_id,
  evidence.timezone,
  evidence.verificado_at,
  evidence.local_event_date,
  evidence.local_event_time,
  evidence.candidate_relation,
  evidence.operative_date,
  evidence.assignment_id,
  evidence.schedule_id,
  evidence.schedule_name,
  evidence.day_config,
  evidence.day_active,
  evidence.start_time,
  evidence.end_time,
  evidence.crosses_midnight,
  evidence.scheduled_start_utc,
  evidence.scheduled_end_utc,
  evidence.window_start_utc,
  evidence.window_end_utc,
  evidence.event_in_shiftmatcher_window,
  CASE
    WHEN summary.maximum_valid_schedule_count > 1 THEN 'AMBIGUOUS_SCHEDULE'
    WHEN summary.matching_window_count > 1 THEN 'AMBIGUOUS_SCHEDULE'
    WHEN summary.normal_match_count = 1 THEN 'APPROVED_NORMAL'
    WHEN summary.night_match_count = 1 THEN 'APPROVED_NIGHT'
    WHEN summary.previous_non_night_count > 0 AND summary.matching_window_count = 0 THEN 'OPERATIVE_DATE_MISMATCH'
    WHEN summary.total_valid_schedule_count = 0 THEN 'UNSCHEDULED'
    WHEN evidence.schedule_id IS NULL OR evidence.day_active IS NOT TRUE THEN 'INVALID'
    ELSE 'REVIEW_REQUIRED'
  END AS candidate_status
FROM evaluated AS evidence
INNER JOIN per_registro AS summary USING (registro_id)
ORDER BY evidence.registro_id, evidence.candidate_relation, evidence.schedule_id NULLS LAST;

ROLLBACK;
