-- SELECT-only production preflight. Keep its complete row as BEFORE evidence.
-- STOP unless quiet_precheck_pass AND baseline_matches_last_known are true.
WITH pilot AS (
  SELECT * FROM public.tenant_features
  WHERE cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND feature_key='WORKDAY_PERSIST_ACTIVE'
), global_state AS (
  SELECT clock_timestamp() AS checked_at,
    (SELECT count(*) FROM pilot) AS pilot_rows,
    (SELECT min(mode) FROM pilot) AS pilot_mode,
    (SELECT bool_or(enabled) FROM pilot) AS pilot_enabled,
    (SELECT count(*) FROM public.tenant_features WHERE feature_key IN ('WORKDAY_PERSIST_ACTIVE','WORKDAY_PERSIST_CANARY') AND enabled) AS active_persist_gates,
    (SELECT count(*) FROM public.tenant_features WHERE NOT (
  (mode <> 'PERSIST_CANARY' OR (enabled AND feature_key IN ('WORKDAY_PERSIST_CANARY','WORKDAY_PERSIST_ACTIVE')
    AND canary_registro_id IS NOT NULL AND canary_empleado_id IS NOT NULL
    AND canary_schedule_id IS NOT NULL AND canary_workday_date IS NOT NULL))
  AND (mode <> 'PERSIST_ACTIVE' OR (enabled AND feature_key='WORKDAY_PERSIST_ACTIVE'
    AND canary_registro_id IS NULL AND canary_empleado_id IS NULL
    AND canary_schedule_id IS NULL AND canary_workday_date IS NULL))
)) AS incompatible_constraint_rows,
    (SELECT count(*) FROM public.attendance_persist_outbox WHERE status='PENDING') AS pending,
    (SELECT count(*) FROM public.attendance_persist_outbox WHERE status='PROCESSING') AS processing,
    (SELECT count(*) FROM public.attendance_persist_outbox WHERE status='RETRY') AS retry,
    (SELECT count(*) FROM public.attendance_persist_outbox WHERE status='DENIED') AS denied,
    (SELECT count(*) FROM public.attendance_persist_outbox WHERE status='SUCCEEDED') AS succeeded,
    -- Literal claim candidate predicate from phase 92; no claim RPC is invoked.
    (SELECT count(*) FROM public.attendance_persist_outbox WHERE status IN ('PENDING','RETRY')
      OR (status='PROCESSING' AND locked_at<transaction_timestamp()-interval '10 minutes')) AS claimable,
    (SELECT count(*) FROM public.workday_calculation_revisions) AS calculation_revisions,
    (SELECT count(*) FROM public.workday_revision_promotions) AS promotions,
    (SELECT md5(coalesce(string_agg(to_jsonb(f)::text,'' ORDER BY f.cliente_id,f.feature_key),'')) FROM public.tenant_features f) AS tenant_features_digest,
    (SELECT md5(coalesce(string_agg(to_jsonb(o)::text,'' ORDER BY o.id),'')) FROM public.attendance_persist_outbox o) AS outbox_digest,
    (SELECT md5(coalesce(string_agg(to_jsonb(w)::text,'' ORDER BY w.id),'')) FROM public.workday_records w) AS workday_digest,
    (SELECT md5(coalesce(string_agg(to_jsonb(h)::text,'' ORDER BY h.id),'')) FROM public.workday_record_history h) AS history_digest,
    (SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'' ORDER BY r.id),'')) FROM public.workday_calculation_revisions r) AS revisions_digest,
    (SELECT md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY p.id),'')) FROM public.workday_revision_promotions p) AS promotions_digest
), rpc AS (
  SELECT p.*,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND ((p.proname='upsert_workday_record' AND p.pronargs IN (14,16,18,20))
    OR (p.proname='workday_persist_authorized' AND p.pronargs=5))
), fingerprints AS (
  SELECT jsonb_agg(jsonb_build_object('function',proname,'args',pronargs,
    'identity_arguments',pg_get_function_identity_arguments(oid),
    'raw_definition_md5',md5(definition),
    'normalized_body_md5',md5(btrim(replace(prosrc,chr(13),''),chr(32)||chr(10)||chr(9))),
    'security_invoker',NOT prosecdef,'volatility',provolatile,'config',proconfig,
    'service_role_execute',has_function_privilege('service_role',oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',oid,'EXECUTE'),
    'anon_execute',has_function_privilege('anon',oid,'EXECUTE'),
    'public_execute',EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
    ORDER BY proname,pronargs) AS object_fingerprints FROM rpc
), schema_safety AS (
  SELECT
    (SELECT md5(coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl) ORDER BY c.relname)::text,''))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS table_rls_grants_digest,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname)::text,'')) FROM pg_policies p WHERE schemaname='public') AS rls_policies_digest,
    (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.tenant_features'::regclass AND conname='tenant_features_persist_scope_check') AS constraint_md5
)
SELECT g.*, (pilot_rows=1 AND pilot_mode='OFF' AND pilot_enabled IS FALSE
  AND active_persist_gates=0 AND incompatible_constraint_rows=0
  AND pending=0 AND processing=0 AND retry=0 AND denied=0 AND claimable=0
  AND calculation_revisions=0 AND promotions=0) AS quiet_precheck_pass, succeeded=4 AS baseline_matches_last_known,
  f.object_fingerprints,s.* FROM global_state g CROSS JOIN fingerprints f CROSS JOIN schema_safety s;
