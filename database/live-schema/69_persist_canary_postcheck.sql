-- Phase 69: READ ONLY postcheck after INSERTED plus exact UNCHANGED replay.
-- Replace each NULL below with a JSONB literal from Phase 68, the fresh
-- manifest, the first runner result, and the replay runner result. Do not run
-- this template with NULL placeholders: it will return postcheck_pass=false.
BEGIN TRANSACTION READ ONLY;

WITH supplied AS (
  SELECT
    /* PERSIST_CANARY_PHASE68_JSON */ NULL::jsonb AS precheck,
    /* PERSIST_CANARY_MANIFEST_JSON */ NULL::jsonb AS manifest,
    /* PERSIST_CANARY_FIRST_RUN_JSON */ NULL::jsonb AS first_run,
    /* PERSIST_CANARY_REPLAY_RUN_JSON */ NULL::jsonb AS replay_run
), expected AS (
  SELECT '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid registro_id,'69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid empleado_id,'5a753368-f019-4230-89e2-79beaa39ff0f'::uuid schedule_id,'2026-09-09'::date operative_date,
    'America/Cancun'::text timezone,'09df6a75-e231-4654-ae70-8448bdf2c312'::text revision_id,
    '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text revision_hash
), valid AS (
  SELECT s.* FROM supplied s, expected e
  WHERE s.precheck->>'phase'='68_persist_canary_runner_precheck' AND s.precheck->>'read_only'='on' AND (s.precheck->>'runner_precheck_pass')::boolean IS TRUE
    AND s.manifest->>'phase'='65_persist_canary_revision_shadow_manifest' AND s.manifest->>'mode'='READ_ONLY_SHADOW_MANIFEST'
    AND s.manifest->'identity'->>'registro_id'=e.registro_id::text AND s.manifest->'identity'->>'cliente_id'=e.cliente_id::text AND s.manifest->'identity'->>'empleado_id'=e.empleado_id::text
    AND s.manifest->'identity'->>'assignment_id'='2984316c-1c93-4f66-853e-349f90b9f82c' AND s.manifest->'identity'->>'schedule_id'=e.schedule_id::text
    AND s.manifest->'identity'->>'operative_date'=e.operative_date::text AND s.manifest->'identity'->>'schedule_revision_id'=e.revision_id AND s.manifest->'identity'->>'revision_integrity_hash'=e.revision_hash
    AND (s.manifest->'snapshot'->>'calculation_version')::integer=3 AND s.manifest->'snapshot'->>'integrity_hash' ~ '^[0-9a-f]{64}$'
    AND s.first_run->>'phase'='persist_canary_revision_v3' AND s.first_run->>'persistence_result'='INSERTED' AND s.first_run->>'manifest_sha256'=s.manifest->>'manifest_sha256'
    AND s.replay_run->>'phase'='persist_canary_revision_v3' AND s.replay_run->>'persistence_result'='UNCHANGED' AND s.replay_run->>'manifest_sha256'=s.manifest->>'manifest_sha256'
    AND s.first_run->>'integrity_hash'=s.manifest->'snapshot'->>'integrity_hash' AND s.replay_run->>'integrity_hash'=s.manifest->'snapshot'->>'integrity_hash'
), counts AS (
  SELECT jsonb_build_object('workday_records',(SELECT count(*) FROM public.workday_records),'workday_record_history',(SELECT count(*) FROM public.workday_record_history),'tenant_features',(SELECT count(*) FROM public.tenant_features),'incidencias',(SELECT count(*) FROM public.incidencias),'registro_asistencia',(SELECT count(*) FROM public.registro_asistencia),'attendance_source_events',(SELECT count(*) FROM public.attendance_source_events)) value
), target AS (
  SELECT count(*) FILTER (WHERE w.schedule_id=e.schedule_id AND w.timezone=e.timezone AND w.first_in=(v.manifest->'snapshot'->>'first_in')::timestamptz AND w.last_out=(v.manifest->'snapshot'->>'last_out')::timestamptz AND w.worked_minutes=(v.manifest->'snapshot'->>'worked_minutes')::integer AND w.break_minutes=(v.manifest->'snapshot'->>'break_minutes')::integer AND w.overtime_minutes=(v.manifest->'snapshot'->>'overtime_minutes')::integer AND w.late_minutes=(v.manifest->'snapshot'->>'late_minutes')::integer AND w.early_leave_minutes=(v.manifest->'snapshot'->>'early_leave_minutes')::integer AND w.status=v.manifest->'snapshot'->>'status' AND w.calculation_version=3 AND w.integrity_hash=v.manifest->'snapshot'->>'integrity_hash') exact_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date AND h.action='INSERTED' AND h.calculation_version=3 AND h.integrity_hash=v.manifest->'snapshot'->>'integrity_hash') exact_history_rows
  FROM expected e CROSS JOIN valid v LEFT JOIN public.workday_records w ON w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date
  GROUP BY e.cliente_id,e.empleado_id,e.operative_date,v.manifest
), checks AS (
  SELECT c.value counts,v.*,t.exact_workday_rows,t.exact_history_rows,
    (SELECT xmin::text FROM public.registro_asistencia r, expected e WHERE r.id=e.registro_id) source_registro_xmin,
    (SELECT count(*) FROM public.tenant_features f,expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='REVISION_SCHEDULE_RESOLVER' AND f.enabled AND f.mode='SHADOW') revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='ACTIVE') active_tenant_count,
    (SELECT count(*) FROM public.tenant_features f, expected e WHERE f.cliente_id=e.cliente_id AND f.feature_key='WORKDAY_PERSIST_CANARY' AND f.enabled AND f.mode='PERSIST_CANARY' AND f.canary_registro_id=e.registro_id AND f.canary_empleado_id=e.empleado_id AND f.canary_schedule_id=e.schedule_id AND f.canary_workday_date=e.operative_date) exact_authorization_rows,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') all_authorization_rows
  FROM counts c CROSS JOIN valid v CROSS JOIN target t
)
SELECT jsonb_build_object(
  'phase','69_persist_canary_postcheck','read_only',current_setting('transaction_read_only'),'inputs_valid',EXISTS(SELECT 1 FROM valid),
  'exact_workday_rows',COALESCE((SELECT exact_workday_rows FROM checks),0),'exact_history_rows',COALESCE((SELECT exact_history_rows FROM checks),0),
  'exact_authorization_rows',COALESCE((SELECT exact_authorization_rows FROM checks),0),'all_authorization_rows',COALESCE((SELECT all_authorization_rows FROM checks),0),
  'postcheck_pass',EXISTS(SELECT 1 FROM checks q WHERE q.exact_workday_rows=1 AND q.exact_history_rows=1 AND q.exact_authorization_rows=1 AND q.all_authorization_rows=1 AND q.revision_shadow_rows=1 AND q.active_tenant_count=0
    AND q.source_registro_xmin=q.precheck->'global_baseline'->>'candidate_registro_xmin'
    AND (q.counts->>'workday_records')::bigint=(q.precheck->'global_baseline'->'counts'->>'workday_records')::bigint+1
    AND (q.counts->>'workday_record_history')::bigint=(q.precheck->'global_baseline'->'counts'->>'workday_record_history')::bigint+1
    AND (q.counts->>'tenant_features')::bigint=(q.precheck->'global_baseline'->'counts'->>'tenant_features')::bigint
    AND (q.counts->>'incidencias')::bigint=(q.precheck->'global_baseline'->'counts'->>'incidencias')::bigint
    AND (q.counts->>'registro_asistencia')::bigint=(q.precheck->'global_baseline'->'counts'->>'registro_asistencia')::bigint
    AND (q.counts->>'attendance_source_events')::bigint=(q.precheck->'global_baseline'->'counts'->>'attendance_source_events')::bigint
  )
) AS persist_canary_postcheck;

ROLLBACK;
