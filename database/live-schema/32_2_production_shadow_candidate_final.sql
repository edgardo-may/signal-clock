-- Phase 32.2: final READ-ONLY candidate classification.
-- Each candidate_relation receives its own status. Consolidation is separate.
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
relation_summary AS (
  SELECT
    registro_id,
    candidate_relation,
    COUNT(*) FILTER (WHERE day_active AND start_time IS NOT NULL AND end_time IS NOT NULL) AS valid_schedule_count
  FROM evaluated
  GROUP BY registro_id, candidate_relation
),
row_classification AS (
  SELECT
    evidence.*,
    summary.valid_schedule_count,
    CASE
      WHEN summary.valid_schedule_count > 1 THEN 'AMBIGUOUS_SCHEDULE'
      WHEN evidence.assignment_id IS NULL THEN 'UNSCHEDULED'
      WHEN evidence.schedule_id IS NULL THEN 'INVALID'
      WHEN evidence.day_active IS NOT TRUE OR evidence.start_time IS NULL OR evidence.end_time IS NULL THEN 'UNSCHEDULED'
      WHEN evidence.crosses_midnight IS TRUE AND evidence.event_in_shiftmatcher_window IS TRUE THEN 'APPROVED_NIGHT'
      WHEN evidence.candidate_relation = 'EVENT_LOCAL_DATE'
       AND evidence.crosses_midnight IS FALSE
       AND evidence.event_in_shiftmatcher_window IS TRUE THEN 'APPROVED_NORMAL'
      WHEN evidence.candidate_relation = 'PREVIOUS_LOCAL_DATE'
       AND evidence.crosses_midnight IS FALSE THEN 'OPERATIVE_DATE_MISMATCH'
      WHEN evidence.event_in_shiftmatcher_window IS FALSE THEN 'OPERATIVE_DATE_MISMATCH'
      ELSE 'REVIEW_REQUIRED'
    END AS candidate_status
  FROM evaluated AS evidence
  INNER JOIN relation_summary AS summary
    ON summary.registro_id = evidence.registro_id
   AND summary.candidate_relation = evidence.candidate_relation
),
consolidated AS (
  SELECT
    registro_id,
    COUNT(*) FILTER (WHERE candidate_status IN ('APPROVED_NORMAL', 'APPROVED_NIGHT')) AS approved_candidate_count,
    COUNT(*) FILTER (WHERE candidate_status = 'APPROVED_NORMAL') AS approved_normal_count,
    COUNT(*) FILTER (WHERE candidate_status = 'APPROVED_NIGHT') AS approved_night_count,
    COUNT(*) FILTER (WHERE candidate_status = 'OPERATIVE_DATE_MISMATCH') AS mismatch_count,
    COUNT(*) FILTER (WHERE candidate_status = 'AMBIGUOUS_SCHEDULE') AS ambiguous_count,
    COUNT(*) FILTER (WHERE candidate_status = 'INVALID') AS invalid_count,
    COUNT(*) FILTER (WHERE candidate_status = 'UNSCHEDULED') AS unscheduled_count
  FROM row_classification
  GROUP BY registro_id
),
final_classification AS (
  SELECT
    summary.*,
    CASE
      WHEN summary.approved_candidate_count > 1 OR summary.ambiguous_count > 0 THEN 'AMBIGUOUS'
      WHEN summary.approved_normal_count = 1 AND summary.approved_night_count = 0 THEN 'APPROVED_NORMAL'
      WHEN summary.approved_night_count = 1 AND summary.approved_normal_count = 0 THEN 'APPROVED_NIGHT'
      WHEN summary.invalid_count > 0 THEN 'INVALID'
      WHEN summary.mismatch_count > 0 THEN 'OPERATIVE_DATE_MISMATCH'
      WHEN summary.unscheduled_count > 0 THEN 'UNSCHEDULED'
      ELSE 'REVIEW_REQUIRED'
    END AS final_candidate_status
  FROM consolidated AS summary
),
final_details AS (
  SELECT
    final.*,
    approved.operative_date AS final_operative_date,
    approved.schedule_id AS final_schedule_id
  FROM final_classification AS final
  LEFT JOIN row_classification AS approved
    ON approved.registro_id = final.registro_id
   AND approved.candidate_status IN ('APPROVED_NORMAL', 'APPROVED_NIGHT')
)
SELECT
  'DETAIL' AS output_kind,
  row.registro_id,
  row.candidate_relation,
  row.candidate_status,
  row.operative_date,
  row.assignment_id,
  row.schedule_id,
  row.schedule_name,
  row.day_config,
  row.day_active,
  row.start_time,
  row.end_time,
  row.crosses_midnight,
  row.local_event_date,
  row.local_event_time,
  row.scheduled_start_utc,
  row.scheduled_end_utc,
  row.window_start_utc,
  row.window_end_utc,
  row.event_in_shiftmatcher_window,
  row.valid_schedule_count,
  NULL::bigint AS approved_candidate_count,
  NULL::bigint AS approved_normal_count,
  NULL::bigint AS approved_night_count,
  NULL::bigint AS mismatch_count,
  NULL::bigint AS ambiguous_count,
  NULL::text AS final_candidate_status,
  NULL::date AS final_operative_date,
  NULL::uuid AS final_schedule_id
FROM row_classification AS row

UNION ALL

SELECT
  'CONSOLIDATED' AS output_kind,
  final.registro_id,
  NULL::text AS candidate_relation,
  NULL::text AS candidate_status,
  NULL::date AS operative_date,
  NULL::uuid AS assignment_id,
  NULL::uuid AS schedule_id,
  NULL::text AS schedule_name,
  NULL::jsonb AS day_config,
  NULL::boolean AS day_active,
  NULL::text AS start_time,
  NULL::text AS end_time,
  NULL::boolean AS crosses_midnight,
  NULL::date AS local_event_date,
  NULL::time AS local_event_time,
  NULL::timestamptz AS scheduled_start_utc,
  NULL::timestamptz AS scheduled_end_utc,
  NULL::timestamptz AS window_start_utc,
  NULL::timestamptz AS window_end_utc,
  NULL::boolean AS event_in_shiftmatcher_window,
  NULL::bigint AS valid_schedule_count,
  final.approved_candidate_count,
  final.approved_normal_count,
  final.approved_night_count,
  final.mismatch_count,
  final.ambiguous_count,
  final.final_candidate_status,
  final.final_operative_date,
  final.final_schedule_id
FROM final_details AS final

ORDER BY registro_id, output_kind, candidate_relation NULLS LAST;

ROLLBACK;
