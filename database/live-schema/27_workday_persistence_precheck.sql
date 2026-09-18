-- Signum Clock — Fase 27: precheck de persistencia backend-controlled.
-- Producción, 100% READ ONLY. No crea RPCs, filas ni incidencias.

BEGIN TRANSACTION READ ONLY;

WITH expected_columns AS (
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
         c.column_name IS NOT NULL
           AND c.data_type = e.data_type
           AND (NOT e.required_not_null OR c.is_nullable = 'NO') AS valid
  FROM expected_columns e
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'workday_records'
   AND c.column_name = e.column_name
), constraint_validation AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.workday_records'::regclass
        AND c.conname = 'workday_records_logical_identity_key'
        AND c.contype = 'u'
        AND c.convalidated
        AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.workday_records'::regclass AND attname = 'cliente_id'),
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.workday_records'::regclass AND attname = 'empleado_id'),
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.workday_records'::regclass AND attname = 'workday_date')
        ]
    ) AS logical_identity_valid,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.workday_records'::regclass
        AND c.conname = 'workday_records_cliente_id_fkey'
        AND c.contype = 'f'
        AND c.confrelid = 'public.clientes'::regclass
        AND c.confdeltype = 'r'
    ) AS cliente_fk_restrict,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.workday_records'::regclass
        AND c.conname = 'workday_records_empleado_id_fkey'
        AND c.contype = 'f'
        AND c.confrelid = 'public.empleados'::regclass
        AND c.confdeltype = 'r'
    ) AS empleado_fk_restrict,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.workday_records'::regclass
        AND c.conname = 'workday_records_schedule_id_fkey'
        AND c.contype = 'f'
        AND c.confrelid = 'public.horarios'::regclass
        AND c.confdeltype = 'r'
    ) AS schedule_fk_restrict
), trigger_validation AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = 'public.workday_records'::regclass
        AND t.tgname = 'trg_workday_records_tenant_integrity'
        AND t.tgenabled <> 'D'
        AND t.tgfoid = to_regprocedure('public.enforce_workday_record_tenant_integrity()')
    ) AS tenant_integrity_trigger_valid,
    EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = 'public.workday_records'::regclass
        AND t.tgname = 'trg_workday_records_set_updated_at'
        AND t.tgenabled <> 'D'
        AND t.tgfoid = to_regprocedure('public.set_workday_updated_at()')
    ) AS updated_at_trigger_valid
), policy_validation AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.oid = 'public.workday_records'::regclass
        AND c.relrowsecurity
    ) AS rls_enabled,
    EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'workday_records'
        AND p.policyname = 'workday_records_select_tenant'
        AND p.cmd = 'SELECT'
        AND p.roles = ARRAY['authenticated'::name]
        AND regexp_replace(
              lower(COALESCE(p.qual, '')),
              '(public[.]|workday_records[.]|[[:space:]()]|::uuid)',
              '',
              'g'
            ) = 'auth_can_read_tenantcliente_id'
    ) AS authenticated_select_tenant_scoped,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'workday_records'
        AND p.roles @> ARRAY['authenticated'::name]
        AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) AS authenticated_writes_denied,
    (SELECT count(*)
       FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'workday_records') = 1 AS only_expected_policy
), function_availability AS (
  SELECT
    to_regprocedure('public.auth_can_read_tenant(uuid)') IS NOT NULL AS auth_can_read_tenant_exists,
    to_regprocedure('public.auth_can_write_tenant(uuid)') IS NOT NULL AS auth_can_write_tenant_exists,
    has_table_privilege('service_role', 'public.workday_records', 'INSERT') AS service_role_can_insert,
    has_table_privilege('service_role', 'public.workday_records', 'UPDATE') AS service_role_can_update,
    NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'upsert_workday_record'
    ) AS rpc_name_available
), required_roles AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS anon_role_exists,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_role_exists,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AS service_role_exists
)
SELECT jsonb_build_object(
  'phase', '27_workday_persistence_precheck',
  'read_only', current_setting('transaction_read_only'),
  'workday_records_exists', to_regclass('public.workday_records') IS NOT NULL,
  'column_validation', (
    SELECT jsonb_agg(jsonb_build_object(
      'column', column_name,
      'expected_type', expected_type,
      'actual_type', actual_type,
      'required_not_null', required_not_null,
      'is_nullable', is_nullable,
      'valid', valid
    ) ORDER BY column_name)
    FROM column_validation
  ),
  'columns_valid', NOT EXISTS (SELECT 1 FROM column_validation WHERE NOT valid),
  'logical_identity_valid', cv.logical_identity_valid,
  'cliente_fk_restrict', cv.cliente_fk_restrict,
  'empleado_fk_restrict', cv.empleado_fk_restrict,
  'schedule_fk_restrict', cv.schedule_fk_restrict,
  'tenant_integrity_trigger_valid', tv.tenant_integrity_trigger_valid,
  'updated_at_trigger_valid', tv.updated_at_trigger_valid,
  'rls_enabled', pv.rls_enabled,
  'authenticated_select_tenant_scoped', pv.authenticated_select_tenant_scoped,
  'authenticated_insert_denied', pv.authenticated_writes_denied,
  'authenticated_update_denied', pv.authenticated_writes_denied,
  'authenticated_delete_denied', pv.authenticated_writes_denied,
  'only_expected_rls_policy', pv.only_expected_policy,
  'workday_rows', (SELECT count(*) FROM public.workday_records),
  'auth_can_read_tenant_exists', fa.auth_can_read_tenant_exists,
  'auth_can_write_tenant_exists', fa.auth_can_write_tenant_exists,
  'service_role_can_insert_workday', fa.service_role_can_insert,
  'service_role_can_update_workday', fa.service_role_can_update,
  'upsert_workday_record_name_available', fa.rpc_name_available,
  'anon_role_exists', rr.anon_role_exists,
  'authenticated_role_exists', rr.authenticated_role_exists,
  'service_role_exists', rr.service_role_exists,
  'precheck_pass', (
    to_regclass('public.workday_records') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM column_validation WHERE NOT valid)
    AND cv.logical_identity_valid
    AND cv.cliente_fk_restrict
    AND cv.empleado_fk_restrict
    AND cv.schedule_fk_restrict
    AND tv.tenant_integrity_trigger_valid
    AND tv.updated_at_trigger_valid
    AND pv.rls_enabled
    AND pv.authenticated_select_tenant_scoped
    AND pv.authenticated_writes_denied
    AND pv.only_expected_policy
    AND (SELECT count(*) FROM public.workday_records) = 0
    AND fa.auth_can_read_tenant_exists
    AND fa.auth_can_write_tenant_exists
    AND fa.service_role_can_insert
    AND fa.service_role_can_update
    AND fa.rpc_name_available
    AND rr.anon_role_exists
    AND rr.authenticated_role_exists
    AND rr.service_role_exists
  )
) AS phase_27_precheck_result
FROM constraint_validation cv
CROSS JOIN trigger_validation tv
CROSS JOIN policy_validation pv
CROSS JOIN function_availability fa
CROSS JOIN required_roles rr;

ROLLBACK;
