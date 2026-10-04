-- ============================================================================
-- SIGNUM-CLOCK · Workstream Gemini · Fase 102
-- POSTCHECK: Verificación de Hardening de Seguridad, RLS y Lifecycle
-- ============================================================================
-- SOLO LECTURA. NO muta datos. Ejecutable en Supabase SQL Editor.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- 1. Verificación del índice único de clave laboral
SELECT
    'INDEX_VERIFICATION' AS check_type,
    indexname,
    indexdef,
    CASE
        WHEN indexname = 'uq_empleados_cliente_clave_empleado' THEN 'CONFIRMED'
        ELSE 'UNEXPECTED'
    END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'empleados'
  AND indexname = 'uq_empleados_cliente_clave_empleado';

-- 2. Verificación de las 4 políticas RLS endurecidas
SELECT
    'RLS_POLICIES_VERIFICATION' AS check_type,
    COUNT(*) AS total_policies_found,
    ARRAY_AGG(policyname ORDER BY policyname) AS installed_policies,
    CASE
        WHEN COUNT(*) = 4 THEN 'PASS_ALL_POLICIES_INSTALLED'
        ELSE 'FAIL_MISSING_POLICIES'
    END AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'empleados'
  AND policyname IN ('role_read', 'role_insert', 'role_update', 'role_delete');

-- 3. Inspección detallada de reglas de aislamiento RLS
SELECT
    'RLS_POLICY_RULE' AS check_type,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'empleados'
ORDER BY policyname;

-- 4. Verificación de search_path seguro en funciones endurecidas
SELECT
    'SEARCH_PATH_VERIFICATION' AS check_type,
    proname AS function_name,
    prosecdef AS is_security_definer,
    proconfig AS search_path_setting,
    CASE
        WHEN proconfig @> ARRAY['search_path=public, pg_temp'] THEN 'SECURE'
        ELSE 'VULNERABLE'
    END AS security_status
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN (
      'fn_employee_lifecycle',
      'fn_auto_assign_biometric_id',
      'trg_audit_empleados',
      'trg_prevent_employee_deletion_with_history'
  )
ORDER BY proname;

-- 5. Verificación de cobertura del trigger de auditoría
SELECT
    'AUDIT_TRIGGER_COVERAGE' AS check_type,
    tgname AS trigger_name,
    proname AS function_name,
    CASE
        WHEN (tgtype::integer & 28) = 28 AND proname = 'trg_audit_empleados' THEN 'FULL_COVERAGE_INSERT_UPDATE_DELETE'
        ELSE 'PARTIAL_OR_UNEXPECTED'
    END AS event_coverage
FROM pg_trigger
JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
WHERE tgrelid = 'public.empleados'::regclass
  AND tgname = 'trg_audit_empleados_changes';

-- 6. Resumen global de conformidad
SELECT jsonb_build_object(
    'phase', '102_employee_security_and_audit_postcheck',
    'read_only', current_setting('transaction_read_only'),
    'unique_index_installed', EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'empleados' AND indexname = 'uq_empleados_cliente_clave_empleado'
    ),
    'rls_hardened', (
        SELECT COUNT(*) = 4 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'empleados'
          AND policyname IN ('role_read', 'role_insert', 'role_update', 'role_delete')
    ),
    'audit_trigger_ready', EXISTS (
        SELECT 1 FROM pg_trigger
        JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
        WHERE tgrelid = 'public.empleados'::regclass
          AND tgname = 'trg_audit_empleados_changes'
          AND proname = 'trg_audit_empleados'
          AND (tgtype::integer & 28) = 28
    ),
    'timestamp', NOW()
) AS postcheck_summary;

ROLLBACK;

