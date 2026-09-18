-- Signum Clock — Fase 22.1A: precheck de hardening de blockers.
-- Producción, 100% READ ONLY. No ejecuta funciones de negocio ni DDL/DML.

BEGIN TRANSACTION READ ONLY;

-- La definición completa es la evidencia primaria para el diagnóstico legacy.
WITH legacy_function AS (
  SELECT p.oid, p.oid::regprocedure AS signature, r.rolname AS owner,
         p.prosecdef AS security_definer, p.proconfig,
         pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure('public.fn_evaluar_retardo_asistencia()')
), function_acl AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
           'grantor', grantor.rolname,
           'privilege', acl.privilege_type,
           'grantable', acl.is_grantable
         ) ORDER BY COALESCE(grantee.rolname, 'PUBLIC')), '[]'::jsonb) AS execute_privileges
  FROM legacy_function f
  CROSS JOIN LATERAL aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = f.oid),
                                         acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = f.oid)))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  JOIN pg_roles grantor ON grantor.oid = acl.grantor
  WHERE acl.privilege_type = 'EXECUTE'
), relevant_lines AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('line', line_no, 'text', line_text) ORDER BY line_no), '[]'::jsonb) AS lines
  FROM legacy_function f
  CROSS JOIN LATERAL regexp_split_to_table(f.definition, chr(10)) WITH ORDINALITY AS line(line_text, line_no)
  WHERE lower(line_text) ~ 'registro_asistencia|tipo_verificacion|empleado_id|cliente_id|horario|empleados_horarios|fecha_inicio|fecha_fin|dias_config|tolerancia_minutos|incidencias|tipo_incidencia|estado|current_date|current_timestamp|now[(]|verificado_at|timezone|time zone|conflict|not exists|insert|select'
), devices_policies AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'policy_name', policyname,
           'permissive', permissive,
           'roles', to_jsonb(roles),
           'command', cmd,
           'using', qual,
           'with_check', with_check
         ) ORDER BY policyname), '[]'::jsonb) AS policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'devices'
), snapshots AS (
  SELECT jsonb_build_object(
    'devices', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(d)::text), ',' ORDER BY d.id::text), '')))
      FROM public.devices d),
    'registro_asistencia', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(r)::text), ',' ORDER BY r.id::text), '')))
      FROM public.registro_asistencia r),
    'incidencias', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(i)::text), ',' ORDER BY i.id::text), '')))
      FROM public.incidencias i),
    'horarios', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(h)::text), ',' ORDER BY h.id::text), '')))
      FROM public.horarios h),
    'empleados_horarios', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(eh)::text), ',' ORDER BY eh.id::text), '')))
      FROM public.empleados_horarios eh),
    'attendance_source_events', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(ase)::text), ',' ORDER BY ase.id::text), '')))
      FROM public.attendance_source_events ase)
  ) AS data_snapshot
), trigger_snapshot AS (
  SELECT COALESCE(md5(pg_get_triggerdef(t.oid, true)), 'MISSING') AS definition_fingerprint
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.registro_asistencia'::regclass
    AND NOT t.tgisinternal
    AND t.tgname = 'trg_evaluar_retardo'
)
SELECT jsonb_build_object(
  'phase', '22.1_precheck',
  'read_only', current_setting('transaction_read_only'),
  'legacy_function', COALESCE((SELECT jsonb_build_object(
    'signature', signature::text,
    'owner', owner,
    'security_definer', security_definer,
    'search_path', COALESCE((SELECT setting FROM unnest(proconfig) setting WHERE setting LIKE 'search_path=%' LIMIT 1),
                            '[not set: invoker/default search_path applies]'),
    'execute_privileges', fa.execute_privileges,
    'full_definition', definition
  ) FROM legacy_function CROSS JOIN function_acl fa),
  jsonb_build_object('status', 'MISSING')),
  'legacy_relevant_definition_lines', rl.lines,
  'devices_policies_before', dp.policies,
  'data_snapshot_before', s.data_snapshot,
  'legacy_trigger_definition_fingerprint_before', COALESCE((SELECT definition_fingerprint FROM trigger_snapshot), 'MISSING'),
  'semantic_legacy_verdicts', jsonb_build_object(
    'incident_type', 'REVIEW_FULL_DEFINITION',
    'incident_state', 'REVIEW_FULL_DEFINITION',
    'idempotent', 'REVIEW_FULL_DEFINITION',
    'empresa_safe', 'REVIEW_FULL_DEFINITION',
    'night_shift_safe', 'REVIEW_FULL_DEFINITION'
  )
) AS phase_22_1_precheck_result
FROM function_acl fa
CROSS JOIN relevant_lines rl
CROSS JOIN devices_policies dp
CROSS JOIN snapshots s;

ROLLBACK;
