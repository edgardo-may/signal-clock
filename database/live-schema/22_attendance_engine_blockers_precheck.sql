-- Signum Clock -- Fase 22: blockers del Attendance Engine y auditoria legacy.
--
-- EJECUTAR CONTRA PRODUCCION. Este archivo es 100% de lectura: no contiene
-- CREATE, ALTER, INSERT, UPDATE, DELETE, GRANT, REVOKE ni SET ROLE. El
-- ROLLBACK es intencional aun cuando una sesion de solo lectura no deje cambios.
-- No ejecutar el trigger, la funcion, ni una RPC durante esta auditoria.

BEGIN TRANSACTION READ ONLY;

-- 0. Prueba de contexto: conservar junto al resultado de la ejecucion.
SELECT current_database() AS database_name,
       current_user AS audit_role,
       current_setting('transaction_read_only') AS transaction_read_only,
       now() AS audited_at;

-- 1. Trigger legacy y definicion real de la funcion. pg_get_functiondef es la
-- autoridad para el comportamiento; no se infiere desde migraciones ni codigo TS.
SELECT t.tgname AS trigger_name,
       t.tgenabled AS enabled_mode,
       CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
       CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS level,
       t.tgfoid::regprocedure AS trigger_function,
       pg_get_triggerdef(t.oid, true) AS trigger_definition,
       'YES' AS legacy_late_trigger_exists
FROM pg_trigger t
WHERE t.tgrelid = 'public.registro_asistencia'::regclass
  AND NOT t.tgisinternal
  AND t.tgname = 'trg_evaluar_retardo';

WITH legacy_fn AS (
  SELECT p.*, n.nspname, r.rolname AS owner_name,
         pg_get_functiondef(p.oid) AS function_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
)
SELECT legacy_fn.oid::regprocedure AS function_name,
       owner_name,
       lanname AS language,
       CASE WHEN prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
       provolatile AS volatility,
       proisstrict AS strict,
       proconfig AS function_settings,
       COALESCE((SELECT setting FROM unnest(proconfig) setting
                 WHERE setting LIKE 'search_path=%' LIMIT 1),
                '[not set: invoker/default search_path applies]') AS effective_search_path_rule,
       function_definition,
       'YES' AS legacy_function_audited
FROM legacy_fn
JOIN pg_language l ON l.oid = legacy_fn.prolang;

-- EXECUTE grants, including implicit defaults. A NULL ACL is expanded to the
-- PostgreSQL default ACL, where PUBLIC normally has EXECUTE on functions.
WITH legacy_fn AS (
  SELECT p.oid, p.proowner, p.proacl
  FROM pg_proc p WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
)
SELECT f.oid::regprocedure AS function_name,
       COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
       grantor.rolname AS grantor,
       acl.privilege_type,
       acl.is_grantable
FROM legacy_fn f
CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE acl.privilege_type = 'EXECUTE'
ORDER BY grantee, grantor;

-- Dependencias que PostgreSQL registro directamente y referencias textuales.
-- PL/pgSQL y SQL dinamico pueden no producir dependencias completas; por ello se
-- emiten ambas evidencias y la definicion completa arriba.
WITH legacy_fn AS (
  SELECT p.oid FROM pg_proc p WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
)
SELECT d.deptype,
       c.oid::regclass AS referenced_relation,
       c.relkind AS relation_kind,
       pg_get_userbyid(c.relowner) AS relation_owner
FROM legacy_fn f
JOIN pg_depend d ON d.objid = f.oid AND d.classid = 'pg_proc'::regclass
JOIN pg_class c ON c.oid = d.refobjid
WHERE d.refclassid = 'pg_class'::regclass
ORDER BY referenced_relation;

WITH legacy_fn AS (
  SELECT lower(pg_get_functiondef(p.oid)) AS definition
  FROM pg_proc p WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
), public_relations AS (
  SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
)
SELECT r.relname AS relation_name,
       CASE WHEN f.definition ~ ('\mfrom[[:space:]]+(public\.)?' || r.relname || '\M')
              OR f.definition ~ ('\mjoin[[:space:]]+(public\.)?' || r.relname || '\M')
            THEN true ELSE false END AS textual_read_reference,
       CASE WHEN f.definition ~ ('\minsert[[:space:]]+into[[:space:]]+(public\.)?' || r.relname || '\M')
              OR f.definition ~ ('\mupdate[[:space:]]+(public\.)?' || r.relname || '\M')
              OR f.definition ~ ('\mdelete[[:space:]]+from[[:space:]]+(public\.)?' || r.relname || '\M')
            THEN true ELSE false END AS textual_write_reference
FROM legacy_fn f CROSS JOIN public_relations r
WHERE f.definition ~ ('\m' || r.relname || '\M')
ORDER BY r.relname;

-- Evidencia mecánica para las preguntas de comportamiento. UNKNOWN no significa
-- seguro: exige leer la definicion emitida antes de cualquier hardening.
WITH legacy_fn AS (
  SELECT lower(pg_get_functiondef(p.oid)) AS definition
  FROM pg_proc p WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
)
SELECT CASE WHEN f.definition ~ '\minsert[[:space:]]+into[[:space:]]+(public\.)?incidencias\M' THEN 'YES'
            WHEN f.definition LIKE '%execute%' THEN 'UNKNOWN'
            ELSE 'NO' END AS legacy_creates_incidents,
       CASE WHEN f.definition LIKE '%on conflict%' OR f.definition ~ '\mnot[[:space:]]+exists\M'
              THEN 'UNKNOWN -- candidate guard; validate exact conflict key/predicate'
            ELSE 'UNKNOWN -- no proven duplicate guard' END AS legacy_idempotent,
       f.definition LIKE '%cliente_id%' AS mentions_cliente_id,
       f.definition LIKE '%horario%' AS mentions_schedule,
       f.definition LIKE '%tolerancia%' AS mentions_tolerance,
       f.definition LIKE '%tg_op%' AS branches_on_trigger_operation,
       f.definition LIKE '%new.%' AS reads_new_record,
       f.definition LIKE '%old.%' AS reads_old_record,
       f.definition LIKE '%on conflict%' AS has_on_conflict,
       f.definition ~ '\mnot[[:space:]]+exists\M' AS has_not_exists_guard,
       f.definition LIKE '%execute%' AS has_dynamic_sql,
       f.definition LIKE '%empleado_id%' AS mentions_empleado_id,
       f.definition LIKE '%current_date%' AS uses_current_date,
       f.definition LIKE '%current_timestamp%' OR f.definition LIKE '%now()%' AS uses_current_timestamp,
       f.definition LIKE '%timezone(%' OR f.definition LIKE '%at time zone%' AS converts_timezone,
       f.definition LIKE '%interval ''1 day''%' OR f.definition LIKE '%+ 1%' OR f.definition LIKE '%+1%' AS has_possible_next_day_logic
FROM legacy_fn f;

-- Contexto relevante de la definicion instalado. Este resultado hace visible
-- tipo/estado, horario, tolerancia, identidad y referencias temporales sin
-- ejecutar la funcion. Revisar junto con la definicion completa de arriba.
WITH legacy_fn AS (
  SELECT pg_get_functiondef(p.oid) AS function_definition
  FROM pg_proc p WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
), function_lines AS (
  SELECT line_no, line_text
  FROM legacy_fn
  CROSS JOIN LATERAL regexp_split_to_table(function_definition, chr(10))
       WITH ORDINALITY AS line(line_text, line_no)
)
SELECT line_no, line_text
FROM function_lines
WHERE lower(line_text) ~ 'incidencias|tipo_incidencia|estado|horario|tolerancia|cliente_id|empleado_id|tg_op|new[.]|old[.]|current_date|current_timestamp|now[(]|time zone|timezone|conflict|not exists|fecha'
ORDER BY line_no;

-- 2. Las cinco incidencias existentes. La descripcion no se emite: texto libre
-- no puede clasificarse como no sensible de forma segura mediante SQL.
SELECT i.id, i.cliente_id, i.empleado_id, i.tipo_incidencia,
       i.fecha_inicio, i.fecha_fin, i.estado, i.autorizado_por, i.creado_at,
       CASE WHEN i.descripcion IS NULL THEN NULL
            ELSE '[DESCRIPCION OMITIDA: requiere clasificacion humana de sensibilidad]'
       END AS descripcion_resumida_segura
FROM public.incidencias i
ORDER BY i.creado_at, i.id;

SELECT 'INCIDENT ROWS' AS metric, count(*)::text AS value FROM public.incidencias
UNION ALL
SELECT 'INCIDENT TYPES', COALESCE(string_agg(tipo_incidencia::text, ', ' ORDER BY tipo_incidencia::text), '[none]')
FROM (SELECT DISTINCT tipo_incidencia FROM public.incidencias WHERE tipo_incidencia IS NOT NULL) s
UNION ALL
SELECT 'INCIDENT STATES', COALESCE(string_agg(estado::text, ', ' ORDER BY estado::text), '[none]')
FROM (SELECT DISTINCT estado FROM public.incidencias WHERE estado IS NOT NULL) s;

-- Una coincidencia textual entre un tipo existente y la funcion es evidencia de
-- compatibilidad, no prueba de procedencia. No existe aun una llave de origen.
WITH legacy_fn AS (
  SELECT lower(pg_get_functiondef(p.oid)) AS definition
  FROM pg_proc p WHERE p.oid = 'public.fn_evaluar_retardo_asistencia()'::regprocedure
)
SELECT i.tipo_incidencia,
       count(*) AS incident_rows,
       bool_or(f.definition LIKE '%' || lower(quote_literal(i.tipo_incidencia::text)) || '%')
         AS type_literal_appears_in_legacy_function,
       'NOT_PROVEN: incidencias has no source/workday/detection key' AS provenance_verdict
FROM public.incidencias i CROSS JOIN legacy_fn f
GROUP BY i.tipo_incidencia, f.definition
ORDER BY i.tipo_incidencia;

-- 3. Empresa de incidencias y FK directa hacia clientes.
SELECT count(*) AS incident_empresa_mismatches
FROM public.incidencias i
JOIN public.empleados e ON e.id = i.empleado_id
WHERE i.cliente_id IS DISTINCT FROM e.cliente_id;

SELECT con.conname AS constraint_name, pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.incidencias'::regclass
ORDER BY con.conname;

SELECT indexname AS index_name, indexdef AS definition
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'incidencias'
ORDER BY indexname;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_constraint con
  WHERE con.conrelid = 'public.incidencias'::regclass
    AND con.confrelid = 'public.clientes'::regclass
    AND con.contype = 'f'
    AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.incidencias'::regclass
                              AND attname = 'cliente_id' AND NOT attisdropped)]
) THEN 'YES' ELSE 'NO' END AS incidencias_has_direct_cliente_fk;

-- 4. Cuatro asignaciones: no ocultar divergencias entre empresa de asignacion,
-- empleado y horario.
SELECT eh.id AS assignment_id, eh.cliente_id AS assignment_cliente_id,
       eh.empleado_id, e.cliente_id AS empleado_cliente_id,
       eh.horario_id, h.cliente_id AS horario_cliente_id,
       eh.fecha_inicio, eh.fecha_fin, eh.activo,
       (eh.cliente_id = e.cliente_id AND eh.cliente_id = h.cliente_id) AS empresa_consistent
FROM public.empleados_horarios eh
LEFT JOIN public.empleados e ON e.id = eh.empleado_id
LEFT JOIN public.horarios h ON h.id = eh.horario_id
ORDER BY eh.empleado_id, eh.fecha_inicio, eh.id;

SELECT count(*) AS assignment_empresa_mismatches
FROM public.empleados_horarios eh
LEFT JOIN public.empleados e ON e.id = eh.empleado_id
LEFT JOIN public.horarios h ON h.id = eh.horario_id
WHERE eh.cliente_id IS DISTINCT FROM e.cliente_id
   OR eh.cliente_id IS DISTINCT FROM h.cliente_id;

-- Rango cerrado: fecha_fin NULL significa vigencia abierta. Dos asignaciones
-- activas que comparten cualquier fecha se consideran ambiguas.
SELECT eh1.empleado_id, eh1.id AS assignment_id_a, eh2.id AS assignment_id_b,
       eh1.fecha_inicio AS a_fecha_inicio, eh1.fecha_fin AS a_fecha_fin,
       eh2.fecha_inicio AS b_fecha_inicio, eh2.fecha_fin AS b_fecha_fin
FROM public.empleados_horarios eh1
JOIN public.empleados_horarios eh2
  ON eh1.empleado_id = eh2.empleado_id AND eh1.id < eh2.id
 AND eh1.activo IS TRUE AND eh2.activo IS TRUE
 AND daterange(eh1.fecha_inicio, COALESCE(eh1.fecha_fin, 'infinity'::date), '[]')
     && daterange(eh2.fecha_inicio, COALESCE(eh2.fecha_fin, 'infinity'::date), '[]')
ORDER BY eh1.empleado_id, eh1.id, eh2.id;

SELECT count(*) AS schedule_overlap_count
FROM public.empleados_horarios eh1
JOIN public.empleados_horarios eh2
  ON eh1.empleado_id = eh2.empleado_id AND eh1.id < eh2.id
 AND eh1.activo IS TRUE AND eh2.activo IS TRUE
 AND daterange(eh1.fecha_inicio, COALESCE(eh1.fecha_fin, 'infinity'::date), '[]')
     && daterange(eh2.fecha_inicio, COALESCE(eh2.fecha_fin, 'infinity'::date), '[]');

-- 5. dias_config. Un dia activo exige entrada/salida HH:MM. Descansos solo se
-- validan si se declaran. salida <= entrada es NIGHT_SHIFT_CANDIDATE, no error.
SELECT count(*) AS schedule_rows FROM public.horarios;

SELECT h.id, h.cliente_id, h.nombre, h.tolerancia_minutos, h.activo, h.dias_config
FROM public.horarios h ORDER BY h.id;

WITH day_rows AS (
  SELECT h.id AS horario_id, h.nombre, k.day_key, d.config,
         COALESCE((d.config ->> 'activo')::boolean, false) AS day_active,
         d.config ->> 'entrada' AS entrada, d.config ->> 'salida' AS salida,
         d.config ->> 'descanso_inicio' AS descanso_inicio,
         d.config ->> 'descanso_fin' AS descanso_fin
  FROM public.horarios h
  CROSS JOIN LATERAL (VALUES ('lun'), ('mar'), ('mie'), ('jue'), ('vie'), ('sab'), ('dom')) k(day_key)
  CROSS JOIN LATERAL (SELECT h.dias_config -> k.day_key AS config) d
)
SELECT horario_id, nombre, day_key, day_active, entrada, salida, descanso_inicio, descanso_fin,
       CASE WHEN NOT day_active THEN 'INACTIVE'
            WHEN entrada ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             AND salida  ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             AND (descanso_inicio IS NULL OR descanso_inicio ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
             AND (descanso_fin IS NULL OR descanso_fin ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
            THEN 'VALID' ELSE 'INVALID_DAY_CONFIG' END AS config_verdict,
       CASE WHEN day_active
                   AND entrada ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                   AND salida ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                   AND salida <= entrada
            THEN 'NIGHT_SHIFT_CANDIDATE' END AS night_shift_flag
FROM day_rows ORDER BY horario_id, array_position(ARRAY['lun','mar','mie','jue','vie','sab','dom'], day_key);

WITH validated AS (
  SELECT COALESCE((h.dias_config -> k.day_key ->> 'activo')::boolean, false) AS day_active,
         h.dias_config -> k.day_key ->> 'entrada' AS entrada,
         h.dias_config -> k.day_key ->> 'salida' AS salida,
         h.dias_config -> k.day_key ->> 'descanso_inicio' AS descanso_inicio,
         h.dias_config -> k.day_key ->> 'descanso_fin' AS descanso_fin
  FROM public.horarios h CROSS JOIN LATERAL (VALUES ('lun'),('mar'),('mie'),('jue'),('vie'),('sab'),('dom')) k(day_key)
)
SELECT count(*) FILTER (WHERE day_active AND NOT (
         entrada ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND salida ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     AND (descanso_inicio IS NULL OR descanso_inicio ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
     AND (descanso_fin IS NULL OR descanso_fin ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
       )) AS invalid_day_configs,
       count(*) FILTER (WHERE day_active
         AND entrada ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
         AND salida ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND salida <= entrada) AS night_shift_candidates
FROM validated;

-- 6. Devices: lista completa de policies y una prueba estática para roles que
-- pueden ser authenticated/PUBLIC. Una policy PERMISSIVE SELECT/ALL, INSERT/ALL
-- o UPDATE/ALL
-- sin cliente_id en USING/WITH CHECK deja al usuario activo sin frontera de Empresa.
SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS table_owner
FROM pg_class c WHERE c.oid = 'public.devices'::regclass;

SELECT policyname, permissive, roles, cmd, qual AS using_expression,
       with_check AS with_check_expression
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'devices'
ORDER BY policyname;

WITH policies AS (
  SELECT *, (roles @> ARRAY['authenticated'::name] OR roles @> ARRAY['public'::name]) AS applies_to_authenticated
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'devices'
), exposure AS (
  SELECT policyname, cmd,
         CASE WHEN cmd IN ('SELECT', 'ALL')
                   AND permissive = 'PERMISSIVE' AND applies_to_authenticated
                   AND COALESCE(qual, 'true') NOT ILIKE '%cliente_id%'
              THEN true ELSE false END AS unscoped_read,
         CASE WHEN cmd IN ('INSERT', 'ALL')
                   AND permissive = 'PERMISSIVE' AND applies_to_authenticated
                   AND COALESCE(with_check, 'true') NOT ILIKE '%cliente_id%'
              THEN true ELSE false END AS unscoped_create,
         CASE WHEN cmd IN ('UPDATE', 'ALL')
                   AND permissive = 'PERMISSIVE' AND applies_to_authenticated
                   AND (COALESCE(qual, 'true') NOT ILIKE '%cliente_id%'
                        OR COALESCE(with_check, 'true') NOT ILIKE '%cliente_id%')
              THEN true ELSE false END AS unscoped_update
  FROM policies
)
SELECT CASE WHEN NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.devices'::regclass)
              OR EXISTS (SELECT 1 FROM exposure WHERE unscoped_read OR unscoped_create OR unscoped_update)
            THEN 'FAIL' ELSE 'PASS' END AS devices_tenant_rls,
       COALESCE(array_agg(policyname) FILTER (WHERE unscoped_read), ARRAY[]::name[]) AS unscoped_read_policies,
       COALESCE(array_agg(policyname) FILTER (WHERE unscoped_create), ARRAY[]::name[]) AS unscoped_create_policies,
       COALESCE(array_agg(policyname) FILTER (WHERE unscoped_update), ARRAY[]::name[]) AS unscoped_update_policies,
       'Static rule: emitted policy SQL is the evidence; a function-only predicate requires manual proof of tenant scope.' AS evidence_rule
FROM exposure;

-- 7. Confirmar la ausencia del baseline workday, sin crear ningun objeto.
SELECT relname AS expected_relation, to_regclass('public.' || relname) IS NOT NULL AS exists
FROM unnest(ARRAY['workday_records', 'workday_record_history', 'tenant_features']) AS expected(relname)
ORDER BY relname;

-- 8. Salida consolidada. No sustituye los result sets anteriores: permite
-- recuperar al final una sola fila con los veredictos que puede demostrar el
-- catálogo y los datos. UNKNOWN se usa de forma deliberada cuando SQL no puede
-- probar el comportamiento semántico de la función legacy.
WITH legacy_fn AS (
  SELECT p.oid, r.rolname AS owner_name, p.prosecdef,
         lower(pg_get_functiondef(p.oid)) AS function_definition
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure('public.fn_evaluar_retardo_asistencia()')
), legacy_props AS (
  SELECT count(*) > 0 AS function_exists,
         COALESCE(bool_or(function_definition IS NOT NULL), false) AS function_audited,
         COALESCE(bool_or(prosecdef), false) AS security_definer,
         COALESCE(max(owner_name), 'UNKNOWN') AS function_owner,
         max(function_definition) AS function_definition
  FROM legacy_fn
), trigger_props AS (
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.registro_asistencia'::regclass
      AND NOT t.tgisinternal
      AND t.tgname = 'trg_evaluar_retardo'
      AND t.tgfoid = to_regprocedure('public.fn_evaluar_retardo_asistencia()')
  ) AS late_trigger_exists
), incident_values AS (
  SELECT count(*) AS incident_rows
  FROM public.incidencias
), incident_types AS (
  SELECT COALESCE(jsonb_agg(tipo_incidencia::text ORDER BY tipo_incidencia::text), '[]'::jsonb) AS incident_types
  FROM (SELECT DISTINCT tipo_incidencia FROM public.incidencias WHERE tipo_incidencia IS NOT NULL) values_set
), incident_states AS (
  SELECT COALESCE(jsonb_agg(estado::text ORDER BY estado::text), '[]'::jsonb) AS incident_states
  FROM (SELECT DISTINCT estado FROM public.incidencias WHERE estado IS NOT NULL) values_set
), incident_empresa AS (
  SELECT count(*) AS mismatches
  FROM public.incidencias i
  JOIN public.empleados e ON e.id = i.empleado_id
  WHERE i.cliente_id IS DISTINCT FROM e.cliente_id
), assignment_empresa AS (
  SELECT count(*) AS assignment_rows,
         count(*) FILTER (
           WHERE eh.cliente_id IS DISTINCT FROM e.cliente_id
              OR eh.cliente_id IS DISTINCT FROM h.cliente_id
         ) AS mismatches
  FROM public.empleados_horarios eh
  LEFT JOIN public.empleados e ON e.id = eh.empleado_id
  LEFT JOIN public.horarios h ON h.id = eh.horario_id
), schedule_overlaps AS (
  SELECT count(*) AS overlap_count
  FROM public.empleados_horarios eh1
  JOIN public.empleados_horarios eh2
    ON eh1.empleado_id = eh2.empleado_id
   AND eh1.id < eh2.id
   AND eh1.activo IS TRUE
   AND eh2.activo IS TRUE
   AND daterange(eh1.fecha_inicio, COALESCE(eh1.fecha_fin, 'infinity'::date), '[]')
       && daterange(eh2.fecha_inicio, COALESCE(eh2.fecha_fin, 'infinity'::date), '[]')
), day_configs AS (
  SELECT COALESCE((h.dias_config -> k.day_key ->> 'activo')::boolean, false) AS day_active,
         h.dias_config -> k.day_key ->> 'entrada' AS entrada,
         h.dias_config -> k.day_key ->> 'salida' AS salida,
         h.dias_config -> k.day_key ->> 'descanso_inicio' AS descanso_inicio,
         h.dias_config -> k.day_key ->> 'descanso_fin' AS descanso_fin
  FROM public.horarios h
  CROSS JOIN LATERAL (VALUES ('lun'), ('mar'), ('mie'), ('jue'), ('vie'), ('sab'), ('dom')) k(day_key)
), day_config_stats AS (
  SELECT count(*) FILTER (WHERE day_active AND NOT (
           entrada ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       AND salida ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       AND (descanso_inicio IS NULL OR descanso_inicio ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
       AND (descanso_fin IS NULL OR descanso_fin ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
         )) AS invalid_day_configs,
         count(*) FILTER (WHERE day_active
           AND entrada ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
           AND salida ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
           AND salida <= entrada) AS night_shift_candidates
  FROM day_configs
), device_meta AS (
  SELECT relrowsecurity AS rls_enabled
  FROM pg_class WHERE oid = 'public.devices'::regclass
), device_policies AS (
  SELECT policyname, permissive, roles, cmd, qual, with_check,
         COALESCE(roles @> ARRAY['authenticated'::name]
                  OR roles @> ARRAY['public'::name], false) AS applies_to_authenticated
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'devices'
), device_exposure AS (
  SELECT policyname,
         cmd IN ('SELECT', 'ALL')
           AND permissive = 'PERMISSIVE'
           AND applies_to_authenticated
           AND COALESCE(qual, 'true') NOT ILIKE '%cliente_id%' AS unscoped_read,
         cmd IN ('INSERT', 'ALL')
           AND permissive = 'PERMISSIVE'
           AND applies_to_authenticated
           AND COALESCE(with_check, 'true') NOT ILIKE '%cliente_id%' AS unscoped_insert,
         cmd IN ('UPDATE', 'ALL')
           AND permissive = 'PERMISSIVE'
           AND applies_to_authenticated
           AND (COALESCE(qual, 'true') NOT ILIKE '%cliente_id%'
                OR COALESCE(with_check, 'true') NOT ILIKE '%cliente_id%') AS unscoped_update
  FROM device_policies
), device_stats AS (
  SELECT COALESCE(bool_or(unscoped_read), false) AS read_risk,
         COALESCE(bool_or(unscoped_insert), false) AS insert_risk,
         COALESCE(bool_or(unscoped_update), false) AS update_risk,
         COALESCE(jsonb_agg(DISTINCT policyname::text)
                  FILTER (WHERE unscoped_read OR unscoped_insert OR unscoped_update),
                  '[]'::jsonb) AS problematic_policies
  FROM device_exposure
), workday_props AS (
  SELECT to_regclass('public.workday_records') IS NOT NULL AS workday_records_exists,
         to_regclass('public.workday_record_history') IS NOT NULL AS workday_record_history_exists,
         to_regclass('public.tenant_features') IS NOT NULL AS tenant_features_exists
), schedule_props AS (
  SELECT count(*) AS schedule_rows FROM public.horarios
), incident_contract AS (
  SELECT NOT (
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'incidencias' AND column_name = 'origen')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'incidencias' AND column_name = 'workday_record_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'incidencias' AND column_name = 'detection_key')
  ) AS requires_extension
)
SELECT jsonb_build_object(
  'legacy_late_trigger_exists', CASE WHEN tp.late_trigger_exists THEN 'YES' ELSE 'NO' END,
  'legacy_function_exists', CASE WHEN lp.function_exists THEN 'YES' ELSE 'NO' END,
  'legacy_function_audited', CASE WHEN lp.function_audited THEN 'YES' ELSE 'NO' END,
  'legacy_security_definer', CASE WHEN NOT lp.function_exists THEN 'UNKNOWN'
                                  WHEN lp.security_definer THEN 'YES' ELSE 'NO' END,
  'legacy_function_owner', lp.function_owner,
  'legacy_creates_incidents', CASE WHEN NOT lp.function_exists THEN 'UNKNOWN'
                                   WHEN lp.function_definition ~ '\minsert[[:space:]]+into[[:space:]]+(public\.)?incidencias\M' THEN 'YES'
                                   ELSE 'UNKNOWN' END,
  'legacy_incident_type', 'UNKNOWN',
  'legacy_incident_state', 'UNKNOWN',
  'legacy_idempotent', 'UNKNOWN',
  'legacy_night_shift_safe', 'UNKNOWN',
  'legacy_uses_tolerance', CASE WHEN NOT lp.function_exists THEN 'UNKNOWN'
                                WHEN lp.function_definition LIKE '%tolerancia_minutos%' THEN 'YES'
                                ELSE 'UNKNOWN' END,
  'legacy_empresa_safe', 'UNKNOWN',
  'incident_rows', iv.incident_rows,
  'incident_types', it.incident_types,
  'incident_states', ist.incident_states,
  'incident_empresa_mismatches', ie.mismatches,
  'schedule_rows', sp.schedule_rows,
  'assignment_rows', ae.assignment_rows,
  'assignment_empresa_mismatches', ae.mismatches,
  'schedule_overlaps', so.overlap_count,
  'invalid_day_configs', dcs.invalid_day_configs,
  'night_shift_candidates', dcs.night_shift_candidates,
  'devices_tenant_rls', CASE WHEN NOT dm.rls_enabled OR ds.read_risk OR ds.insert_risk OR ds.update_risk
                             THEN 'FAIL' ELSE 'PASS' END,
  'devices_cross_tenant_read_risk', CASE WHEN NOT dm.rls_enabled OR ds.read_risk THEN 'YES' ELSE 'NO' END,
  'devices_cross_tenant_insert_risk', CASE WHEN NOT dm.rls_enabled OR ds.insert_risk THEN 'YES' ELSE 'NO' END,
  'devices_cross_tenant_update_risk', CASE WHEN NOT dm.rls_enabled OR ds.update_risk THEN 'YES' ELSE 'NO' END,
  'devices_problematic_policies', ds.problematic_policies,
  'workday_records_exists', wp.workday_records_exists,
  'workday_record_history_exists', wp.workday_record_history_exists,
  'tenant_features_exists', wp.tenant_features_exists,
  'new_workday_baseline_required', NOT (wp.workday_records_exists AND wp.workday_record_history_exists),
  'attendance_normalizer_status', 'NEEDS_ADAPTATION',
  'shift_matcher_status', 'REUSABLE',
  'workday_calculator_status', 'REUSABLE',
  'timezone_utils_status', 'REUSABLE',
  'integrity_hasher_status', 'REUSABLE',
  'workday_persistence_service_status', 'BLOCKED',
  'workday_reprocess_service_status', 'OBSOLETE',
  'attendance_engine_code_reusable', 'PARTIAL',
  'incident_contract_requires_extension', CASE WHEN ic.requires_extension THEN 'YES' ELSE 'NO' END,
  'legacy_trigger_recommendation', 'UNKNOWN',
  'safe_to_create_phase_23', false
) AS phase_22_result
FROM legacy_props lp
CROSS JOIN trigger_props tp
CROSS JOIN incident_values iv
CROSS JOIN incident_types it
CROSS JOIN incident_states ist
CROSS JOIN incident_empresa ie
CROSS JOIN assignment_empresa ae
CROSS JOIN schedule_overlaps so
CROSS JOIN day_config_stats dcs
CROSS JOIN device_meta dm
CROSS JOIN device_stats ds
CROSS JOIN workday_props wp
CROSS JOIN schedule_props sp
CROSS JOIN incident_contract ic;

ROLLBACK;
