-- READ ONLY. Known objects/dependencies only. Never emits PIN/hash/session tokens.
BEGIN READ ONLY;
SELECT p.oid::regprocedure AS object,p.prosecdef AS security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') browser_execute
FROM pg_proc p WHERE p.oid IN (
 to_regprocedure('public.fn_login_colaborador(uuid,text,text)'),
 to_regprocedure('public.fn_registrar_asistencia_colaborador(uuid,uuid,text,timestamptz,jsonb)'),
 to_regprocedure('public.enqueue_attendance_persist_outbox()'));
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename='registro_asistencia';
SELECT has_table_privilege('anon','public.registro_asistencia','SELECT') anon_select,
 has_table_privilege('anon','public.registro_asistencia','INSERT') anon_insert;
SELECT cliente_id,count(*) FILTER(WHERE nullif(pin,'') IS NOT NULL) legacy_credentials,
 count(*) FILTER(WHERE nullif(pin,'') IS NOT NULL AND pin !~ '^[0-9]{5}$') require_pin_reset
 FROM public.empleados GROUP BY cliente_id ORDER BY cliente_id;
SELECT count(*) AS historical_employee_audits_with_pin_values
 FROM public.audit_logs WHERE resource_type='Empleado'
 AND (nullif(metadata->'new_values'->>'pin','') IS NOT NULL AND metadata->'new_values'->>'pin'<>'***'
 OR nullif(metadata->'old_values'->>'pin','') IS NOT NULL AND metadata->'old_values'->>'pin'<>'***');
SELECT to_regprocedure('extensions.crypt(text,text)') existing_pgcrypto,
 to_regnamespace('employee_private') candidate_already_installed;
SELECT cliente_id,feature_key,mode,enabled FROM public.tenant_features
 WHERE feature_key='WORKDAY_PERSIST_ACTIVE';
ROLLBACK;
