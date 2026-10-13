-- PROPOSAL, UNNUMBERED. No production execution authorized.
-- Caller owns BEGIN/ROLLBACK. This file intentionally contains no COMMIT.
-- FROZEN PARTIAL CANDIDATE: non-row ACLs + backend-only sync/absence.
-- Not a global closure migration. Identity/policies/defaults are NOT solved.
DO $guard$
BEGIN
  IF current_setting('signum.hardening_design', true) IS DISTINCT FROM 'DBREAL_ROLLBACK_ONLY' THEN
    RAISE EXCEPTION 'DESIGN_REQUIRES_DBREAL_ROLLBACK_ONLY';
  END IF;
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'REQUIRES_POSTGRES_17_MAINTAIN';
  END IF;
END
$guard$;

DO $acl$
DECLARE
  table_name text;
  columns_sql text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'attendance_logs', 'attendance_source_events', 'audit_logs',
    'biometric_templates', 'cliente_modulos', 'clientes', 'dias_festivos',
    'empleados', 'incidencias', 'login_attempts', 'module_catalog',
    'periodos_nomina', 'rate_limits_logs', 'registro_asistencia',
    'user_module_permissions', 'usuarios_perfiles', 'workday_records',
    'empleados_horarios', 'horarios'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=table_name
        AND c.relkind='r' AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'EXPECTED_RLS_TABLE_MISSING: %', table_name;
    END IF;
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, MAINTAIN, REFERENCES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      table_name
    );
    -- Table-level REVOKE does not remove independent REFERENCES(column) grants.
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO columns_sql FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=format('public.%I',table_name)::regclass
      AND a.attnum>0 AND NOT a.attisdropped;
    EXECUTE format(
      'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      columns_sql, table_name
    );
  END LOOP;
END
$acl$;

-- Explicit signatures. Missing RPCs fail rather than silently passing.
REVOKE EXECUTE ON FUNCTION public.fn_employee_insert_sync(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_employee_insert_sync(uuid,jsonb) TO service_role;
ALTER FUNCTION public.fn_employee_insert_sync(uuid,jsonb)
  SET search_path = pg_catalog, public, pg_temp;

-- Preserve existing row privileges, policies, backend ACLs and all routine bodies.
-- No fn_registrar_asistencia_colaborador / fn_login_colaborador change here.
-- No replay of 116/124; no Attendance/Workday/source/gate/dispatch changes.

-- User confirmed 2026-10-11: fn_generar_faltas_diarias is currently UNUSED.
-- Preserve body/signature and service_role; do NOT invoke or schedule it.
REVOKE EXECUTE ON FUNCTION public.fn_generar_faltas_diarias()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_generar_faltas_diarias() TO service_role;
ALTER FUNCTION public.fn_generar_faltas_diarias()
  SET search_path = pg_catalog, public, pg_temp;
-- Expected business data changes = 0. Caller must BEGIN ... ROLLBACK.
