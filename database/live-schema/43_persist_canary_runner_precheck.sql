-- Phase 36.2: read-only contract evidence for the one-workday runner.
-- Save the JSON result locally. The runner requires that artifact and a matching
-- PERSIST_CANARY_APPROVED_RPC_FINGERPRINT before it can invoke the V3 RPC.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid AS registro_id,
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid AS schedule_id,
    '2026-09-03'::date AS workday_date,
    'America/Cancun'::text AS timezone,
    3::integer AS calculation_version,
    'WORKDAY_PERSIST_CANARY'::text AS feature_key
), rpc AS (
  SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS fingerprint
  FROM pg_proc p
  WHERE p.oid = to_regprocedure(
    'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)'
  )
), state AS (
  SELECT
    EXISTS (SELECT 1 FROM public.registro_asistencia r, expected e
      WHERE r.id = e.registro_id AND r.cliente_id = e.cliente_id AND r.empleado_id = e.empleado_id) AS registro_exact,
    EXISTS (SELECT 1 FROM public.empleados employee, expected e
      WHERE employee.id = e.empleado_id AND employee.cliente_id = e.cliente_id) AS empleado_exact,
    EXISTS (SELECT 1 FROM public.horarios schedule, expected e
      WHERE schedule.id = e.schedule_id AND schedule.cliente_id = e.cliente_id) AS schedule_exact,
    (SELECT count(*) FROM public.tenant_features feature, expected e
      WHERE feature.cliente_id = e.cliente_id AND feature.feature_key = e.feature_key
        AND feature.mode = 'PERSIST_CANARY' AND feature.enabled = true
        AND feature.canary_registro_id = e.registro_id AND feature.canary_empleado_id = e.empleado_id
        AND feature.canary_schedule_id = e.schedule_id AND feature.canary_workday_date = e.workday_date) AS exact_authorization_rows,
    (SELECT count(*) FROM public.tenant_features feature, expected e
      WHERE feature.feature_key = e.feature_key) AS all_authorization_rows,
    (SELECT count(*) FROM public.workday_records workday, expected e
      WHERE workday.cliente_id = e.cliente_id AND workday.empleado_id = e.empleado_id
        AND workday.workday_date = e.workday_date) AS target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history history, expected e
      WHERE history.cliente_id = e.cliente_id AND history.empleado_id = e.empleado_id
        AND history.workday_date = e.workday_date) AS target_history_rows
)
SELECT jsonb_build_object(
  'phase', '36_2_persist_canary_runner_precheck',
  'read_only', current_setting('transaction_read_only'),
  'identity', jsonb_build_object(
    'registroId', e.registro_id, 'clienteId', e.cliente_id, 'empleadoId', e.empleado_id,
    'scheduleId', e.schedule_id, 'operativeDate', e.workday_date, 'timezone', e.timezone,
    'calculationVersion', e.calculation_version
  ),
  'candidate_exact', s.registro_exact AND s.empleado_exact AND s.schedule_exact,
  'exact_authorization_rows', s.exact_authorization_rows,
  'all_authorization_rows', s.all_authorization_rows,
  'target_workday_rows', s.target_workday_rows,
  'target_history_rows', s.target_history_rows,
  'rpc_v3_available', EXISTS (SELECT 1 FROM rpc),
  'rpc_fingerprint', (SELECT fingerprint FROM rpc),
  'incident_write_path', false,
  'precheck_pass', s.registro_exact AND s.empleado_exact AND s.schedule_exact
    AND s.exact_authorization_rows = 1 AND s.all_authorization_rows = 1
    AND EXISTS (SELECT 1 FROM rpc)
    AND ((s.target_workday_rows = 0 AND s.target_history_rows = 0)
      OR (s.target_workday_rows = 1 AND s.target_history_rows = 1))
) AS persist_canary_runner_precheck
FROM expected e CROSS JOIN state s;

ROLLBACK;
