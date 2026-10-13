-- SELECT ONLY. Review complete results before considering proposal 125.
-- Known catalog contains public.dispositivos; absence requires a new catalog review.
SELECT jsonb_build_object(
 'legacy_device_count',(SELECT count(*) FROM public.dispositivos),
 'request_protocols',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT protocol,status,count(*) AS count FROM public.device_registration_requests GROUP BY protocol,status ORDER BY protocol,status) x),
 'legacy_employee_columns',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public'
     AND table_name='empleados' AND column_name IN ('hikvision_device_userid','device_id_hikvision','isup_key')) x),
 'employees_with_legacy_identifier',(SELECT count(*) FROM public.empleados e
   WHERE nullif(btrim(to_jsonb(e)->>'hikvision_device_userid'),'') IS NOT NULL),
 'legacy_table_columns',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'
    AND (table_name='dispositivos' OR column_name IN ('hikvision_device_userid','device_id_hikvision','isup_key'))) x),
 'foreign_keys',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT conname,conrelid::regclass::text AS relation,confrelid::regclass::text AS referenced_relation,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype='f' AND (conrelid='public.dispositivos'::regclass OR confrelid='public.dispositivos'::regclass)) x),
 'catalog_dependencies',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT pg_describe_object(classid,objid,objsubid) AS dependent,deptype,refobjsubid
    FROM pg_depend WHERE refobjid='public.dispositivos'::regclass) x),
 'legacy_triggers',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger
    WHERE tgrelid='public.dispositivos'::regclass AND NOT tgisinternal) x),
 'routine_contracts',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT p.oid::regprocedure::text AS signature,md5(pg_get_functiondef(p.oid)) AS definition_md5,
      p.prosecdef AS security_definer,p.proconfig,p.proacl
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
      AND (p.proname IN ('device_request_serial_taken','request_device_registration','resolve_device_registration',
        'fn_obtener_limites_tenant','fn_resumen_global_tenants','fn_validar_limite_dispositivos_tenant',
        'sync_device_employee_assignments','proc_trg_dispositivos_sync_policy','fn_delete_device_superadmin')
       OR p.prosrc ~* 'public[.]dispositivos|hikvision|isup_key') ORDER BY signature) x),
 'legacy_grants',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT grantee,privilege_type,is_grantable FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name='dispositivos') x),
 'legacy_column_grants',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT grantee,column_name,privilege_type FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='dispositivos') x),
 'device_rls',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname IN ('devices','dispositivos','device_employee_assignments')) x),
 'device_policies',(SELECT coalesce(jsonb_agg(x),'[]') FROM
   (SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('devices','dispositivos','device_employee_assignments')) x)
) AS zkteco_only_precheck;
