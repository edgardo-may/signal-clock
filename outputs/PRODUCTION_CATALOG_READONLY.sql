-- Signum Clock: producción, inspección de catálogo estrictamente READ-ONLY.
-- Ejecutar en Supabase SQL Editor con rol de lectura privilegiado.
-- Devuelve sólo metadatos/definiciones de los objetos explícitamente relacionados
-- con Employee Portal, sesiones, attendance, WEB_CLOCK y persistencia.
-- No ejecuta RPCs de aplicación ni modifica datos/esquema.
-- Pegar el resultado completo de cada SELECT para comparar contra el candidato.

-- 1) Schemas solicitados y presencia.
SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS owner,
       n.nspname IN ('employee_private','public') AS in_scope
FROM pg_catalog.pg_namespace n
WHERE n.nspname IN ('employee_private','public')
ORDER BY n.nspname;

-- 1b) Versión del servidor que satisface (o no) los guards SQL candidatos.
SELECT current_setting('server_version') AS server_version,
       current_setting('server_version_num')::integer AS server_version_num,
       current_database() AS database_name,
       current_user AS executing_role;
-- 2) Tablas/vistas y estado RLS.
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='employee_private' AND c.relname IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
   OR (n.nspname='public' AND c.relname IN
       ('registro_asistencia','attendance_source_events','devices','clientes','empleados',
        'workday_records','attendance_persist_outbox','audit_logs','rate_limits_logs','web_clock_canonical_sources'))
ORDER BY n.nspname,c.relname;

-- 3) Columnas de esos objetos.
SELECT table_schema, table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE (table_schema='employee_private' AND table_name IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
   OR (table_schema='public' AND table_name IN
       ('registro_asistencia','attendance_source_events','devices','clientes','empleados',
        'workday_records','attendance_persist_outbox','audit_logs','rate_limits_logs','web_clock_canonical_sources'))
ORDER BY table_schema,table_name,ordinal_position;

-- 3b) Definición de vistas canónicas relacionadas con autorización/evidencia.
SELECT n.nspname AS schema_name,c.relname AS view_name,
       md5(pg_catalog.pg_get_viewdef(c.oid,true)) AS definition_md5,
       pg_catalog.pg_get_viewdef(c.oid,true) AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('v','m')
  AND ((n.nspname='public' AND c.relname IN ('web_clock_canonical_sources'))
       OR (n.nspname='employee_private' AND c.relname ILIKE '%web_clock%'))
ORDER BY n.nspname,c.relname;
-- 4) Constraints e índices.
SELECT n.nspname AS schema_name,c.relname AS table_name,con.conname,
       con.contype,pg_get_constraintdef(con.oid,true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='employee_private' AND c.relname IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
   OR (n.nspname='public' AND c.relname IN
       ('registro_asistencia','attendance_source_events','devices','clientes','empleados',
        'workday_records','attendance_persist_outbox','audit_logs','rate_limits_logs'))
ORDER BY n.nspname,c.relname,con.conname;

SELECT schemaname,tablename,indexname,indexdef
FROM pg_catalog.pg_indexes
WHERE (schemaname='employee_private' AND tablename IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
   OR (schemaname='public' AND tablename IN
       ('registro_asistencia','attendance_source_events','devices','clientes','empleados',
        'workday_records','attendance_persist_outbox','audit_logs','rate_limits_logs'))
ORDER BY schemaname,tablename,indexname;

-- 5) Functions: signatures, SECURITY DEFINER, search_path, definition y hash.
-- Incluye legacy, candidato Employee, WEB_CLOCK validator, audit/rate-limit helpers
-- que aparezcan con esos nombres, y los guards productivos de outbox/RPC20.
SELECT n.nspname AS schema_name,p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS function_settings,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
       pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND (
       p.proname IN ('fn_login_colaborador','fn_registrar_asistencia_colaborador',
         'fn_employee_portal','manage_web_clock','is_canonical_web_clock_source',
         'enqueue_attendance_persist_outbox','rpc20','fn_employee_insert_sync',
         'fn_generar_faltas_diarias')
       OR p.proname ILIKE '%employee%session%'
       OR p.proname ILIKE '%web_clock%'
       OR p.proname ILIKE '%rate_limit%'
       OR p.proname ILIKE '%audit%'))
   OR (n.nspname='employee_private')
ORDER BY n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid);

-- 6) Triggers en tablas involucradas (incluye empleado PIN y outbox).
SELECT n.nspname AS schema_name,c.relname AS table_name,t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid,true) AS definition,
       t.tgenabled
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal
  AND ((n.nspname='employee_private' AND c.relname IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
    OR (n.nspname='public' AND c.relname IN
       ('empleados','registro_asistencia','attendance_source_events','attendance_persist_outbox')))
ORDER BY n.nspname,c.relname,t.tgname;

-- 7) Policies, incluyendo roles, comandos, USING y WITH CHECK.
SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies
WHERE (schemaname='employee_private' AND tablename IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
   OR (schemaname='public' AND tablename IN
       ('registro_asistencia','attendance_source_events','devices','clientes','empleados',
        'workday_records','attendance_persist_outbox','audit_logs','rate_limits_logs'))
ORDER BY schemaname,tablename,policyname;

-- 8) Grants efectivos de schema/tabla/columna/rutina.
SELECT 'SCHEMA' AS object_kind,n.nspname AS schema_name,NULL::text AS object_name,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,x.is_grantable
FROM pg_catalog.pg_namespace n
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x
WHERE n.nspname IN ('public','employee_private')
  AND (x.grantee=0 OR pg_catalog.pg_get_userbyid(x.grantee) IN
       ('anon','authenticated','service_role','postgres','supabase_admin'))
ORDER BY 1,2,3,4,5;

SELECT 'TABLE' AS object_kind,n.nspname AS schema_name,c.relname AS object_name,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,x.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) x
WHERE ((n.nspname='employee_private' AND c.relname IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
    OR (n.nspname='public' AND c.relname IN
       ('registro_asistencia','attendance_source_events','devices','clientes','empleados',
        'workday_records','attendance_persist_outbox','audit_logs','rate_limits_logs','web_clock_canonical_sources')))
  AND (x.grantee=0 OR pg_catalog.pg_get_userbyid(x.grantee) IN
       ('anon','authenticated','service_role','postgres','supabase_admin'))
ORDER BY 1,2,3,4,5;

SELECT 'COLUMN' AS object_kind,n.nspname AS schema_name,c.relname||'.'||a.attname AS object_name,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,x.is_grantable
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  AND ((n.nspname='employee_private' AND c.relname IN
       ('credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
    OR (n.nspname='public' AND c.relname='registro_asistencia'))
  AND (x.grantee=0 OR pg_catalog.pg_get_userbyid(x.grantee) IN
       ('anon','authenticated','service_role','postgres','supabase_admin'))
ORDER BY 1,2,3,4,5;

SELECT 'FUNCTION' AS object_kind,n.nspname AS schema_name,
       p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')' AS object_name,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,x.is_grantable
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
WHERE ((n.nspname='public' AND (p.proname IN
       ('fn_login_colaborador','fn_registrar_asistencia_colaborador','fn_employee_portal',
        'manage_web_clock','is_canonical_web_clock_source','enqueue_attendance_persist_outbox',
        'rpc20','fn_employee_insert_sync','fn_generar_faltas_diarias')
       OR p.proname ILIKE '%rpc20%'))
       OR n.nspname='employee_private')
  AND (x.grantee=0 OR pg_catalog.pg_get_userbyid(x.grantee) IN
       ('anon','authenticated','service_role','postgres','supabase_admin'))
ORDER BY 1,2,3,4,5;
-- 9) Default privileges relevantes por creator/schema (sólo lectura).
SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS creator,
       COALESCE(n.nspname,'<GLOBAL>') AS schema_name,
       d.defaclobjtype AS object_type,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,x.is_grantable
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
WHERE pg_catalog.pg_get_userbyid(d.defaclrole) IN ('postgres','supabase_admin','service_role')
  AND (d.defaclnamespace=0 OR n.nspname IN ('public','employee_private'))
ORDER BY creator,schema_name,object_type,grantee,privilege_type;

-- 10) PIN inventory by safe aggregate only; no PIN value is selected or emitted.
-- If employee_private.credentials is absent, this result identifies the legacy
-- population without exposing credentials.
SELECT count(*) AS employee_rows,
       count(*) FILTER (WHERE NULLIF(pin,'') IS NOT NULL) AS nonempty_legacy_pin_rows,
       count(*) FILTER (WHERE pin ~ '^[0-9]{5}$') AS five_digit_plain_format_rows,
       count(*) FILTER (WHERE pin LIKE '$2a$%' OR pin LIKE '$2b$%') AS bcrypt_format_rows,
       count(*) FILTER (WHERE NULLIF(pin,'') IS NOT NULL AND pin !~ '^[0-9]{5}$'
                        AND pin NOT LIKE '$2a$%' AND pin NOT LIKE '$2b$%') AS other_format_rows
FROM public.empleados;

SELECT to_regclass('employee_private.credentials') AS credentials_table,
       to_regclass('employee_private.sessions') AS sessions_table,
       to_regclass('employee_private.company_authorizations') AS company_authorizations_table,
       to_regclass('employee_private.web_clocks') AS web_clocks_table,
       to_regclass('employee_private.web_clock_receipts') AS web_clock_receipts_table;
-- 10) Event/evidence and tenant capability object inventory, including similarly
-- named WEB_CLOCK/source validation objects without scanning unrelated schemas.
SELECT n.nspname,c.relname,c.relkind,pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity,c.relforcerowsecurity
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','employee_private')
  AND (c.relname ILIKE '%web_clock%' OR c.relname ILIKE '%employee%session%'
       OR c.relname ILIKE '%canonical%source%' OR c.relname='tenant_features')
ORDER BY n.nspname,c.relname;
