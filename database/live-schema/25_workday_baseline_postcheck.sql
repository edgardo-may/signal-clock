-- Signum Clock — Fase 23: postcheck del baseline workday.
-- Producción, 100% READ ONLY. No activa motor, backfill ni incidencias.

BEGIN TRANSACTION READ ONLY;

WITH table_props AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  WHERE c.oid = to_regclass('public.workday_records')
), expected_columns AS (
  SELECT * FROM (VALUES
    ('id', 'uuid', true),
    ('cliente_id', 'uuid', true),
    ('empleado_id', 'uuid', true),
    ('workday_date', 'date', true),
    ('schedule_id', 'uuid', false),
    ('timezone', 'text', true),
    ('first_in', 'timestamp with time zone', false),
    ('last_out', 'timestamp with time zone', false),
    ('worked_minutes', 'integer', true),
    ('break_minutes', 'integer', true),
    ('overtime_minutes', 'integer', true),
    ('late_minutes', 'integer', true),
    ('early_leave_minutes', 'integer', true),
    ('status', 'text', true),
    ('integrity_hash', 'text', false),
    ('created_at', 'timestamp with time zone', true),
    ('updated_at', 'timestamp with time zone', true)
  ) AS expected(column_name, data_type, required_not_null)
), column_validation AS (
  SELECT e.column_name, e.data_type AS expected_type, e.required_not_null,
         c.data_type AS actual_type, c.is_nullable,
         (c.column_name IS NOT NULL
          AND c.data_type = e.data_type
          AND (NOT e.required_not_null OR c.is_nullable = 'NO')) AS valid
  FROM expected_columns e
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'workday_records'
   AND c.column_name = e.column_name
), constraint_validation AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
            AND conname = 'workday_records_pkey' AND contype = 'p' AND convalidated) AS pk_valid,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
            AND conname = 'workday_records_cliente_id_fkey' AND contype = 'f'
            AND confrelid = 'public.clientes'::regclass AND confdeltype = 'r' AND convalidated) AS cliente_fk_restrict,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
            AND conname = 'workday_records_empleado_id_fkey' AND contype = 'f'
            AND confrelid = 'public.empleados'::regclass AND confdeltype = 'r' AND convalidated) AS empleado_fk_restrict,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
            AND conname = 'workday_records_schedule_id_fkey' AND contype = 'f'
            AND confrelid = 'public.horarios'::regclass AND confdeltype = 'r' AND convalidated) AS schedule_fk_restrict,
    EXISTS (SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = to_regclass('public.workday_records')
              AND c.conname = 'workday_records_logical_identity_key'
              AND c.contype = 'u' AND c.convalidated
              AND c.conkey = ARRAY[
                (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.workday_records') AND attname = 'cliente_id'),
                (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.workday_records') AND attname = 'empleado_id'),
                (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.workday_records') AND attname = 'workday_date')
              ]) AS logical_identity_valid,
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
                AND conname IN ('workday_records_minutes_nonnegative_check',
                                'workday_records_timezone_nonempty_check',
                                'workday_records_time_order_check',
                                'workday_records_status_check')
                AND (contype <> 'c' OR NOT convalidated))
    AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
         AND conname IN ('workday_records_minutes_nonnegative_check',
                         'workday_records_timezone_nonempty_check',
                         'workday_records_time_order_check',
                         'workday_records_status_check')
         AND contype = 'c' AND convalidated) = 4 AS checks_valid,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.workday_records')
            AND conname = 'workday_records_time_order_check'
            AND contype = 'c' AND convalidated) AS time_order_check_valid,
    COALESCE((SELECT lower(pg_get_constraintdef(oid, true))
                      LIKE '%complete%incomplete%absent%unscheduled%invalid%'
              FROM pg_constraint
              WHERE conrelid = to_regclass('public.workday_records')
                AND conname = 'workday_records_status_check'
                AND contype = 'c' AND convalidated), false) AS status_contract_valid
), trigger_validation AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_trigger t
            WHERE t.tgrelid = to_regclass('public.workday_records')
              AND t.tgname = 'trg_workday_records_tenant_integrity'
              AND t.tgenabled <> 'D'
              AND t.tgfoid = to_regprocedure('public.enforce_workday_record_tenant_integrity()')) AS empresa_integrity_enforced,
    EXISTS (SELECT 1 FROM pg_trigger t
            WHERE t.tgrelid = to_regclass('public.workday_records')
              AND t.tgname = 'trg_workday_records_set_updated_at'
              AND t.tgenabled <> 'D'
              AND t.tgfoid = to_regprocedure('public.set_workday_updated_at()')) AS updated_at_trigger_valid
), function_validation AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.set_workday_updated_at()')) AS set_workday_updated_at_exists,
    COALESCE((SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.set_workday_updated_at()')), false)
      AS set_workday_updated_at_security_invoker,
    COALESCE((SELECT lower(pg_get_functiondef(oid)) LIKE '%new.updated_at := now()%'
              FROM pg_proc WHERE oid = to_regprocedure('public.set_workday_updated_at()')), false)
      AS set_workday_updated_at_contract_valid,
    COALESCE((SELECT lower(pg_get_functiondef(oid)) LIKE '%new.actualizado_at%'
                       AND lower(pg_get_functiondef(oid)) NOT LIKE '%new.updated_at%'
              FROM pg_proc WHERE oid = to_regprocedure('public.set_updated_at()')), false)
      AS legacy_set_updated_at_original_intact,
    COALESCE((SELECT NOT prosecdef FROM pg_proc
              WHERE oid = to_regprocedure('public.enforce_workday_record_tenant_integrity()')), false)
      AS tenant_integrity_security_invoker
), policy_validation AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'workday_records'
        AND p.policyname = 'workday_records_select_tenant'
        AND p.cmd = 'SELECT'
        AND p.roles = ARRAY['authenticated'::name]
        AND regexp_replace(lower(COALESCE(p.qual, '')),
              '(public[.]|workday_records[.]|[[:space:]()]|::uuid)', '', 'g')
            = 'auth_can_read_tenantcliente_id'
    ) AS authenticated_select_tenant_scoped,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'workday_records'
        AND p.roles @> ARRAY['authenticated'::name]
        AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) AS authenticated_writes_denied,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workday_records') = 1 AS only_expected_policy
), current_counts AS (
  SELECT jsonb_build_object(
    'registro_asistencia', (SELECT count(*) FROM public.registro_asistencia),
    'incidencias', (SELECT count(*) FROM public.incidencias),
    'horarios', (SELECT count(*) FROM public.horarios),
    'empleados_horarios', (SELECT count(*) FROM public.empleados_horarios),
    'attendance_source_events', (SELECT count(*) FROM public.attendance_source_events),
    'devices', (SELECT count(*) FROM public.devices)
  ) AS counts
), legacy_trigger AS (
  SELECT COALESCE(md5(pg_get_triggerdef(t.oid, true)), 'MISSING') AS fingerprint
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.registro_asistencia'::regclass
    AND NOT t.tgisinternal
    AND t.tgname = 'trg_evaluar_retardo'
)
SELECT jsonb_build_object(
  'phase', '25_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'workday_records_exists', EXISTS (SELECT 1 FROM table_props),
  'column_validation', (SELECT jsonb_agg(jsonb_build_object(
    'column', column_name, 'expected_type', expected_type, 'actual_type', actual_type,
    'required_not_null', required_not_null, 'is_nullable', is_nullable, 'valid', valid
  ) ORDER BY column_name) FROM column_validation),
  'columns_valid', NOT EXISTS (SELECT 1 FROM column_validation WHERE NOT valid),
  'pk_valid', cv.pk_valid,
  'cliente_fk_restrict', cv.cliente_fk_restrict,
  'empleado_fk_restrict', cv.empleado_fk_restrict,
  'schedule_fk_restrict', cv.schedule_fk_restrict,
  'logical_identity_valid', cv.logical_identity_valid,
  'minute_timezone_status_checks_valid', cv.checks_valid,
  'status_contract_verified_against_code', CASE WHEN cv.status_contract_valid THEN 'PASS' ELSE 'FAIL' END,
  'time_order_check_valid', cv.time_order_check_valid,
  'empresa_integrity_enforced', tv.empresa_integrity_enforced,
  'tenant_integrity_security_invoker', fv.tenant_integrity_security_invoker,
  'updated_at_trigger_valid', tv.updated_at_trigger_valid,
  'set_workday_updated_at_exists', fv.set_workday_updated_at_exists,
  'set_workday_updated_at_security_definer', NOT fv.set_workday_updated_at_security_invoker,
  'set_workday_updated_at_contract_valid', fv.set_workday_updated_at_contract_valid,
  'legacy_set_updated_at_original_intact', fv.legacy_set_updated_at_original_intact,
  'rls_enabled', COALESCE((SELECT relrowsecurity FROM table_props), false),
  'authenticated_select_tenant_scoped', pv.authenticated_select_tenant_scoped,
  'authenticated_insert_denied', pv.authenticated_writes_denied,
  'authenticated_update_denied', pv.authenticated_writes_denied,
  'authenticated_delete_denied', pv.authenticated_writes_denied,
  'only_expected_rls_policy', pv.only_expected_policy,
  'workday_row_count', (SELECT count(*) FROM public.workday_records),
  'historical_backfill_present', CASE WHEN (SELECT count(*) FROM public.workday_records) = 0 THEN 'NO' ELSE 'YES' END,
  'current_business_counts', cc.counts,
  'business_counts_match_baseline', cc.counts = jsonb_build_object(
    'registro_asistencia', 31, 'incidencias', 5, 'horarios', 4,
    'empleados_horarios', 4, 'attendance_source_events', 2, 'devices', 3
  ),
  'legacy_trigger_fingerprint', COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING'),
  'legacy_trigger_modified', CASE WHEN COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING')
                                      = '4cf2a9c9af606713aadb6209886d66af' THEN 'NO' ELSE 'YES' END,
  'workday_tables_created', CASE WHEN EXISTS (SELECT 1 FROM table_props) THEN 'YES' ELSE 'NO' END,
  'safe_to_create_phase_23', false
) AS phase_25_postcheck_result
FROM constraint_validation cv
CROSS JOIN trigger_validation tv
CROSS JOIN function_validation fv
CROSS JOIN policy_validation pv
CROSS JOIN current_counts cc;

ROLLBACK;
