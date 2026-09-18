-- Phase 36: PERSIST CANARY design precheck.
-- Read-only only. It deliberately does not call public.upsert_workday_record.
-- A PASS is required before a separate, explicitly approved write phase.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid AS registro_id,
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid AS schedule_id,
    '2026-09-03'::date AS operative_date,
    'America/Cancun'::text AS timezone,
    3::integer AS calculation_version,
    '2026-09-03T16:26:04.000Z'::timestamptz AS first_in,
    '2026-09-03T17:55:13.000Z'::timestamptz AS last_out,
    89::integer AS worked_minutes,
    0::integer AS break_minutes,
    326::integer AS late_minutes,
    65::integer AS early_leave_minutes,
    0::integer AS overtime_minutes,
    'COMPLETE'::text AS workday_state
),
candidate AS (
  SELECT
    e.*,
    r.id = e.registro_id
      AND r.cliente_id = e.cliente_id
      AND r.empleado_id = e.empleado_id AS registro_identity_valid,
    d.id = r.dispositivo_id
      AND d.cliente_id = e.cliente_id
      AND NULLIF(btrim(d.timezone), '') = e.timezone AS device_timezone_valid,
    EXISTS (
      SELECT 1 FROM public.empleados employee
      WHERE employee.id = e.empleado_id AND employee.cliente_id = e.cliente_id
    ) AS employee_tenant_valid,
    EXISTS (
      SELECT 1 FROM public.horarios schedule
      WHERE schedule.id = e.schedule_id AND schedule.cliente_id = e.cliente_id
    ) AS schedule_tenant_valid,
    (
      SELECT count(*)
      FROM public.empleados_horarios assignment
      WHERE assignment.cliente_id = e.cliente_id
        AND assignment.empleado_id = e.empleado_id
        AND assignment.horario_id = e.schedule_id
        AND assignment.activo = true
        AND assignment.fecha_inicio <= e.operative_date
        AND (assignment.fecha_fin IS NULL OR assignment.fecha_fin >= e.operative_date)
    ) AS active_assignment_count
  FROM expected e
  LEFT JOIN public.registro_asistencia r ON r.id = e.registro_id
  LEFT JOIN public.devices d ON d.id = r.dispositivo_id
),
target AS (
  SELECT
    c.*,
    (
      SELECT count(*)
      FROM public.workday_records workday
      WHERE workday.cliente_id = c.cliente_id
        AND workday.empleado_id = c.empleado_id
        AND workday.workday_date = c.operative_date
    ) AS logical_workday_count,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', workday.id,
        'schedule_id', workday.schedule_id,
        'timezone', workday.timezone,
        'first_in', workday.first_in,
        'last_out', workday.last_out,
        'worked_minutes', workday.worked_minutes,
        'break_minutes', workday.break_minutes,
        'overtime_minutes', workday.overtime_minutes,
        'late_minutes', workday.late_minutes,
        'early_leave_minutes', workday.early_leave_minutes,
        'status', workday.status,
        'integrity_hash', workday.integrity_hash
      ) ORDER BY workday.id)
      FROM public.workday_records workday
      WHERE workday.cliente_id = c.cliente_id
        AND workday.empleado_id = c.empleado_id
        AND workday.workday_date = c.operative_date
    ) AS existing_logical_workdays
  FROM candidate c
),
rpc AS (
  SELECT
    p.oid,
    pg_get_functiondef(p.oid) AS definition,
    md5(pg_get_functiondef(p.oid)) AS fingerprint
  FROM pg_proc p
  WHERE p.oid = to_regprocedure(
    'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text)'
  )
),
schema_contract AS (
  SELECT
    to_regclass('public.workday_record_history') IS NOT NULL AS history_table_exists,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'workday_records'
        AND column_name = 'calculation_version'
    ) AS calculation_version_column_exists,
    EXISTS (
      SELECT 1
      FROM rpc
      WHERE lower(definition) LIKE '%calculation_version%'
    ) AS rpc_persists_calculation_version,
    EXISTS (
      SELECT 1
      FROM rpc
      WHERE lower(definition) LIKE '%workday_record_history%'
    ) AS rpc_writes_history,
    EXISTS (
      SELECT 1
      FROM rpc
      WHERE lower(definition) LIKE '%incidencias%'
    ) AS rpc_writes_incidents,
    to_regclass('public.tenant_features') IS NOT NULL AS tenant_features_exists,
    false AS tenant_feature_contract_ready
),
identity_scope AS (
  SELECT count(*) AS non_target_workdays
  FROM public.workday_records workday
  CROSS JOIN expected e
  WHERE NOT (
    workday.cliente_id = e.cliente_id
    AND workday.empleado_id = e.empleado_id
    AND workday.workday_date = e.operative_date
  )
)
SELECT jsonb_build_object(
  'phase', '36_persist_canary_precheck',
  'read_only', current_setting('transaction_read_only'),
  'approved_identity', jsonb_build_object(
    'registro_id', target.registro_id,
    'cliente_id', target.cliente_id,
    'empleado_id', target.empleado_id,
    'schedule_id', target.schedule_id,
    'operative_date', target.operative_date,
    'timezone', target.timezone,
    'calculation_version', target.calculation_version
  ),
  'candidate_identity_valid',
    target.registro_identity_valid
    AND target.device_timezone_valid
    AND target.employee_tenant_valid
    AND target.schedule_tenant_valid
    AND target.active_assignment_count = 1,
  'active_assignment_count', target.active_assignment_count,
  'logical_workday_count', target.logical_workday_count,
  'existing_logical_workdays', COALESCE(target.existing_logical_workdays, '[]'::jsonb),
  'non_target_workdays', identity_scope.non_target_workdays,
  'expected_payload_v3', jsonb_build_object(
    'first_in', target.first_in,
    'last_out', target.last_out,
    'worked_minutes', target.worked_minutes,
    'break_minutes', target.break_minutes,
    'late_minutes', target.late_minutes,
    'early_leave_minutes', target.early_leave_minutes,
    'overtime_minutes', target.overtime_minutes,
    'workday_state', target.workday_state,
    'calculation_version', target.calculation_version,
    'integrity_hash', 'REQUIRES_FRESH_SHADOW_MANIFEST'
  ),
  'expected_rpc_result', CASE
    WHEN target.logical_workday_count = 0 THEN 'INSERTED'
    WHEN target.logical_workday_count = 1 THEN 'REQUIRES_EXACT_SNAPSHOT_COMPARISON'
    ELSE 'BLOCKED_LOGICAL_IDENTITY_CONFLICT'
  END,
  'expected_write_set', jsonb_build_object(
    'public.workday_records', CASE
      WHEN target.logical_workday_count = 0 THEN '0 -> 1 row (INSERTED expected)'
      WHEN target.logical_workday_count = 1 THEN '1 -> 1 row (UNCHANGED only after exact comparison; differing snapshot is BLOCKED)'
      ELSE 'BLOCKED'
    END,
    'public.workday_record_history', CASE
      WHEN schema_contract.history_table_exists AND schema_contract.rpc_writes_history THEN 'contract requires inspection'
      ELSE 'UNSUPPORTED_BY_CURRENT_RPC'
    END,
    'public.incidencias', CASE
      WHEN schema_contract.rpc_writes_incidents THEN 'BLOCKED'
      ELSE '0 writes expected'
    END
  ),
  'rpc_exists', EXISTS (SELECT 1 FROM rpc),
  'rpc_fingerprint', (SELECT fingerprint FROM rpc),
  'history_table_exists', schema_contract.history_table_exists,
  'calculation_version_persisted',
    schema_contract.calculation_version_column_exists
    AND schema_contract.rpc_persists_calculation_version,
  'history_contract_ready',
    schema_contract.history_table_exists
    AND schema_contract.rpc_writes_history,
  'incident_write_path', schema_contract.rpc_writes_incidents,
  'tenant_features_exists', schema_contract.tenant_features_exists,
  'tenant_feature_contract_ready', schema_contract.tenant_feature_contract_ready,
  'external_contract_evidence_required', jsonb_build_object(
    'v3_regression', 'REQUIRES_LOCAL_APPROVED_MANIFEST',
    'approved_rpc_fingerprint', 'REQUIRES_LOCAL_APPROVED_MANIFEST'
  ),
  'blockers', to_jsonb(array_remove(ARRAY[
    CASE WHEN NOT (schema_contract.calculation_version_column_exists AND schema_contract.rpc_persists_calculation_version)
      THEN 'CALCULATION_VERSION_NOT_PERSISTED' END,
    CASE WHEN NOT (schema_contract.history_table_exists AND schema_contract.rpc_writes_history)
      THEN 'HISTORY_CONTRACT_UNSUPPORTED' END,
    CASE WHEN NOT schema_contract.tenant_feature_contract_ready
      THEN 'TENANT_FEATURE_CONTRACT_UNAVAILABLE' END,
    'V3_REGRESSION_MANIFEST_REQUIRED',
    'APPROVED_RPC_FINGERPRINT_REQUIRED',
    CASE WHEN target.logical_workday_count > 1
      THEN 'LOGICAL_IDENTITY_CONFLICT' END,
    CASE WHEN target.active_assignment_count <> 1
      THEN 'SCHEDULE_ASSIGNMENT_NOT_EXACTLY_ONE' END
  ]::text[], NULL)),
  'precheck_pass',
    target.registro_identity_valid
    AND target.device_timezone_valid
    AND target.employee_tenant_valid
    AND target.schedule_tenant_valid
    AND target.active_assignment_count = 1
    AND target.logical_workday_count <= 1
    AND schema_contract.calculation_version_column_exists
    AND schema_contract.rpc_persists_calculation_version
    AND schema_contract.history_table_exists
    AND schema_contract.rpc_writes_history
    AND NOT schema_contract.rpc_writes_incidents
    AND schema_contract.tenant_feature_contract_ready
) AS persist_canary_precheck
FROM target
CROSS JOIN schema_contract
CROSS JOIN identity_scope;

ROLLBACK;
