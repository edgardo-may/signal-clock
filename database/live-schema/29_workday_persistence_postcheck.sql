-- Signum Clock — Fase 27: postcheck de RPC de persistencia.
-- Producción, 100% READ ONLY. No invoca la RPC ni crea filas de workday.

BEGIN TRANSACTION READ ONLY;

WITH rpc AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner,
         pg_get_functiondef(p.oid) AS definition,
         pg_get_function_result(p.oid) AS result_contract
  FROM pg_proc p
  WHERE p.oid = to_regprocedure(
    'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text)'
  )
), rpc_security AS (
  SELECT
    EXISTS (SELECT 1 FROM rpc) AS rpc_exists,
    COALESCE((SELECT NOT prosecdef FROM rpc), false) AS security_invoker,
    COALESCE((
      SELECT COALESCE(proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
      FROM rpc
    ), false) AS secure_search_path,
    COALESCE((
      SELECT NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(r.proacl, acldefault('f', r.proowner))) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
      FROM rpc r
    ), false) AS public_execute_denied,
    COALESCE((
      SELECT NOT has_function_privilege('anon', oid, 'EXECUTE')
      FROM rpc
    ), false) AS anon_execute_denied,
    COALESCE((
      SELECT NOT has_function_privilege('authenticated', oid, 'EXECUTE')
      FROM rpc
    ), false) AS authenticated_execute_denied,
    COALESCE((
      SELECT has_function_privilege('service_role', oid, 'EXECUTE')
      FROM rpc
    ), false) AS service_role_execute_granted,
    has_table_privilege('service_role', 'public.workday_records', 'INSERT') AS service_role_can_insert,
    has_table_privilege('service_role', 'public.workday_records', 'UPDATE') AS service_role_can_update
), rpc_contract AS (
  SELECT
    COALESCE((
      SELECT result_contract = 'TABLE(workday_id uuid, persistence_result text, integrity_hash text)'
      FROM rpc
    ), false) AS returns_expected_shape,
    COALESCE((
      SELECT regexp_replace(lower(definition), '[[:space:]]+', ' ', 'g')
             LIKE '%on conflict (cliente_id, empleado_id, workday_date) do nothing%'
      FROM rpc
    ), false) AS uses_logical_identity_conflict,
    COALESCE((
      SELECT lower(definition) LIKE '% is distinct from %'
      FROM rpc
    ), false) AS uses_null_safe_unchanged_comparison,
    COALESCE((
      SELECT lower(definition) LIKE '%''inserted''%'
         AND lower(definition) LIKE '%''updated''%'
         AND lower(definition) LIKE '%''unchanged''%'
      FROM rpc
    ), false) AS returns_all_persistence_states,
    COALESCE((
      SELECT lower(definition) LIKE '%p_status not in%'
         AND lower(definition) LIKE '%complete%'
         AND lower(definition) LIKE '%incomplete%'
         AND lower(definition) LIKE '%absent%'
         AND lower(definition) LIKE '%unscheduled%'
         AND lower(definition) LIKE '%invalid%'
      FROM rpc
    ), false) AS validates_workday_state,
    COALESCE((
      SELECT lower(definition) LIKE '%p_last_out < p_first_in%'
      FROM rpc
    ), false) AS validates_time_order
), baseline AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_constraint c
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
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.workday_records'::regclass
        AND t.tgname = 'trg_workday_records_tenant_integrity'
        AND t.tgenabled <> 'D'
        AND t.tgfoid = to_regprocedure('public.enforce_workday_record_tenant_integrity()')
    ) AS tenant_integrity_trigger_valid,
    EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.workday_records'::regclass
        AND t.tgname = 'trg_workday_records_set_updated_at'
        AND t.tgenabled <> 'D'
        AND t.tgfoid = to_regprocedure('public.set_workday_updated_at()')
    ) AS updated_at_trigger_valid,
    EXISTS (
      SELECT 1 FROM pg_class c
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
      WHERE p.schemaname = 'public' AND p.tablename = 'workday_records') = 1
      AS only_expected_policy
), business_counts AS (
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
  'phase', '29_workday_persistence_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'rpc_exists', rs.rpc_exists,
  'rpc_security_definer', NOT rs.security_invoker,
  'rpc_secure_search_path', rs.secure_search_path,
  'public_execute_denied', rs.public_execute_denied,
  'anon_execute_denied', rs.anon_execute_denied,
  'authenticated_execute_denied', rs.authenticated_execute_denied,
  'service_role_execute_granted', rs.service_role_execute_granted,
  'service_role_can_insert_workday', rs.service_role_can_insert,
  'service_role_can_update_workday', rs.service_role_can_update,
  'return_contract_valid', rc.returns_expected_shape,
  'uses_logical_identity_conflict', rc.uses_logical_identity_conflict,
  'uses_null_safe_unchanged_comparison', rc.uses_null_safe_unchanged_comparison,
  'returns_inserted_updated_unchanged', rc.returns_all_persistence_states,
  'validates_workday_state', rc.validates_workday_state,
  'validates_time_order', rc.validates_time_order,
  'workday_rows', (SELECT count(*) FROM public.workday_records),
  'logical_identity_valid', b.logical_identity_valid,
  'tenant_integrity_trigger_valid', b.tenant_integrity_trigger_valid,
  'updated_at_trigger_valid', b.updated_at_trigger_valid,
  'rls_enabled', b.rls_enabled,
  'authenticated_select_tenant_scoped', b.authenticated_select_tenant_scoped,
  'authenticated_insert_denied', b.authenticated_writes_denied,
  'authenticated_update_denied', b.authenticated_writes_denied,
  'authenticated_delete_denied', b.authenticated_writes_denied,
  'only_expected_rls_policy', b.only_expected_policy,
  'current_business_counts', bc.counts,
  'business_counts_match_baseline', bc.counts = jsonb_build_object(
    'registro_asistencia', 31,
    'incidencias', 5,
    'horarios', 4,
    'empleados_horarios', 4,
    'attendance_source_events', 2,
    'devices', 3
  ),
  'legacy_trigger_fingerprint', COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING'),
  'legacy_trigger_modified', CASE
    WHEN COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING')
         = '4cf2a9c9af606713aadb6209886d66af' THEN 'NO'
    ELSE 'YES'
  END,
  'postcheck_pass', (
    rs.rpc_exists
    AND rs.security_invoker
    AND rs.secure_search_path
    AND rs.public_execute_denied
    AND rs.anon_execute_denied
    AND rs.authenticated_execute_denied
    AND rs.service_role_execute_granted
    AND rs.service_role_can_insert
    AND rs.service_role_can_update
    AND rc.returns_expected_shape
    AND rc.uses_logical_identity_conflict
    AND rc.uses_null_safe_unchanged_comparison
    AND rc.returns_all_persistence_states
    AND rc.validates_workday_state
    AND rc.validates_time_order
    AND (SELECT count(*) FROM public.workday_records) = 0
    AND b.logical_identity_valid
    AND b.tenant_integrity_trigger_valid
    AND b.updated_at_trigger_valid
    AND b.rls_enabled
    AND b.authenticated_select_tenant_scoped
    AND b.authenticated_writes_denied
    AND b.only_expected_policy
    AND bc.counts = jsonb_build_object(
      'registro_asistencia', 31,
      'incidencias', 5,
      'horarios', 4,
      'empleados_horarios', 4,
      'attendance_source_events', 2,
      'devices', 3
    )
    AND COALESCE((SELECT fingerprint FROM legacy_trigger), 'MISSING')
      = '4cf2a9c9af606713aadb6209886d66af'
  )
) AS phase_29_postcheck_result
FROM rpc_security rs
CROSS JOIN rpc_contract rc
CROSS JOIN baseline b
CROSS JOIN business_counts bc;

ROLLBACK;
