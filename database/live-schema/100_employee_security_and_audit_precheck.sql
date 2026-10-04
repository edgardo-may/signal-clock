-- ============================================================================
-- SIGNUM-CLOCK · Workstream Gemini · Fase 100
-- PRECHECK: Auditoría de Seguridad, Integridad y Lifecycle en public.empleados
-- ============================================================================
-- SOLO LECTURA. NO muta datos. Ejecutable en Supabase SQL Editor.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- 1. Verificación de existencia de tablas base
SELECT
    'TABLE_EXISTS' AS check_type,
    table_name,
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = c.table_name
    ) AS exists
FROM (VALUES
    ('clientes'),
    ('empleados'),
    ('usuarios_perfiles'),
    ('employee_user_links'),
    ('device_employee_assignments'),
    ('biometric_templates'),
    ('registro_asistencia'),
    ('incidencias'),
    ('empleados_horarios'),
    ('audit_logs')
) AS c(table_name);

-- 2. Verificación de columnas de public.empleados en information_schema.columns
SELECT
    'COLUMN_AUDIT_CHECK' AS check_type,
    column_name,
    data_type,
    is_nullable,
    CASE
        WHEN column_name IN (
            'id', 'cliente_id', 'nombre', 'apellido', 'clave_empleado',
            'departamento', 'puesto', 'pin', 'device_userid', 'tarjeta',
            'sexo', 'fecha_ingreso', 'fecha_cumpleanos', 'activo'
        ) THEN 'EXPECTED_AUDITABLE_COLUMN'
        ELSE 'OTHER_COLUMN'
    END AS category
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'empleados'
ORDER BY ordinal_position;

-- 3. Confirmación expresa de no existencia de columnas obsoletas (ej. hikvision_device_userid)
SELECT
    'OBSOLETE_COLUMN_CHECK' AS check_type,
    'hikvision_device_userid' AS column_name,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'empleados'
          AND column_name = 'hikvision_device_userid'
    ) AS exists_in_schema;

-- 4. PRECHECK OBLIGATORIO DE DUPLICADOS DE CLAVE LABORAL (clave_empleado)
-- Regla de producto: Si existen duplicados, no se puede instalar el índice único.
WITH duplicate_claves AS (
    SELECT
        cliente_id,
        TRIM(clave_empleado) AS clave_empleado_norm,
        COUNT(*) AS total_duplicados,
        ARRAY_AGG(id) AS employee_ids
    FROM public.empleados
    WHERE clave_empleado IS NOT NULL AND TRIM(clave_empleado) <> ''
    GROUP BY cliente_id, TRIM(clave_empleado)
    HAVING COUNT(*) > 1
)
SELECT
    'DUPLICATE_CLAVE_EMPLEADO_CHECK' AS check_type,
    COALESCE(COUNT(*), 0) AS duplicate_groups_count,
    CASE
        WHEN COUNT(*) = 0 THEN 'SAFE_TO_INSTALL_UNIQUE_INDEX'
        ELSE 'BLOCKED_DUPLICATES_DETECTED'
    END AS evaluation,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'cliente_id', cliente_id,
                'clave_empleado', clave_empleado_norm,
                'total', total_duplicados,
                'ids', employee_ids
            )
        ),
        '[]'::jsonb
    ) AS duplicate_details
FROM duplicate_claves;

-- 3. Verificación de unicidad de device_userid por tenant
WITH duplicate_devids AS (
    SELECT
        cliente_id,
        TRIM(device_userid) AS devid_norm,
        COUNT(*) AS total_duplicados
    FROM public.empleados
    WHERE device_userid IS NOT NULL AND TRIM(device_userid) <> ''
    GROUP BY cliente_id, TRIM(device_userid)
    HAVING COUNT(*) > 1
)
SELECT
    'DUPLICATE_DEVICE_USERID_CHECK' AS check_type,
    COALESCE(COUNT(*), 0) AS duplicate_devid_groups,
    CASE
        WHEN COUNT(*) = 0 THEN 'SAFE'
        ELSE 'DUPLICATES_FOUND'
    END AS status
FROM duplicate_devids;

-- 4. Verificación de RLS en public.empleados
SELECT
    'RLS_CHECK' AS check_type,
    relname AS table_name,
    relrowsecurity AS rls_enabled,
    relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid = 'public.empleados'::regclass;

-- 5. Listado de políticas RLS actuales en public.empleados
SELECT
    'RLS_POLICY' AS check_type,
    policyname,
    cmd,
    roles,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'empleados'
ORDER BY policyname;

-- 6. Verificación de triggers actuales en public.empleados
SELECT
    'TRIGGER_CHECK' AS check_type,
    tgname AS trigger_name,
    CASE tgtype::integer & 66
        WHEN 2 THEN 'BEFORE'
        WHEN 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END AS timing,
    CASE tgtype::integer & 28
        WHEN 4 THEN 'INSERT'
        WHEN 8 THEN 'DELETE'
        WHEN 16 THEN 'UPDATE'
        WHEN 20 THEN 'INSERT/UPDATE'
        WHEN 28 THEN 'INSERT/UPDATE/DELETE'
        ELSE 'OTHER'
    END AS events,
    proname AS function_name
FROM pg_trigger
JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
WHERE tgrelid = 'public.empleados'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- 7. Verificación de funciones de seguridad y ciclo de vida (search_path & definer)
SELECT
    'FUNCTION_SECURITY_CHECK' AS check_type,
    proname AS function_name,
    prosecdef AS is_security_definer,
    provolatile,
    proconfig AS search_path_config
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN (
      'fn_employee_lifecycle',
      'fn_delete_employee_safe',
      'fn_auto_assign_biometric_id',
      'trg_sync_employee_lifecycle_assignments',
      'fn_validar_limite_empleados_tenant',
      'trg_audit_empleados'
  )
ORDER BY proname;

-- 8. Resumen global de consistencia para el precheck
SELECT jsonb_build_object(
    'phase', '100_employee_security_and_audit_precheck',
    'read_only', current_setting('transaction_read_only'),
    'timestamp', NOW()
) AS precheck_summary;

ROLLBACK;

