-- ============================================================================
-- SIGNUM-CLOCK · Workstream Gemini · Fase 101
-- CHANGE: Endurecimiento de Seguridad, RLS, Lifecycle y Auditoría en empleados
-- ============================================================================
-- PREPARADO PARA REVISIÓN. NO EJECUTAR EN PRODUCCIÓN DIRECTAMENTE.
-- Aplica numeración reservada Gemini (100+), independiente de Codex.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. UNICIDAD LABORAL: clave_empleado POR TENANT (CON GUARDIA PRECHECK)
-- ============================================================================
-- Si existen duplicados en el tenant, la transacción se aborta de inmediato.
DO $$
DECLARE
    v_dup_count INT;
BEGIN
    SELECT COUNT(*)
      INTO v_dup_count
      FROM (
          SELECT cliente_id, TRIM(clave_empleado)
            FROM public.empleados
           WHERE clave_empleado IS NOT NULL AND TRIM(clave_empleado) <> ''
           GROUP BY cliente_id, TRIM(clave_empleado)
          HAVING COUNT(*) > 1
      ) d;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'CHANGE ABORTED: Existen % grupos de claves de colaborador duplicadas en public.empleados. Debe sanearse manualmente antes de aplicar el índice.', v_dup_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_cliente_clave_empleado
    ON public.empleados (cliente_id, clave_empleado)
    WHERE clave_empleado IS NOT NULL AND TRIM(clave_empleado) <> '';


-- ============================================================================
-- 2. HARDENING DE search_path EN fn_auto_assign_biometric_id
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_assign_biometric_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_id INT;
BEGIN
    -- Bloqueo consultivo transaccional por tenant para serializar inserciones concurrentes
    PERFORM pg_advisory_xact_lock(hashtext('device_userid_' || NEW.cliente_id::text));

    IF NEW.device_userid IS NULL OR TRIM(NEW.device_userid) = '' THEN
        SELECT COALESCE(MAX(NULLIF(regexp_replace(device_userid, '\D', '', 'g'), '')::INT), 0) + 1
          INTO v_next_id
          FROM public.empleados
         WHERE cliente_id = NEW.cliente_id;

        NEW.device_userid := v_next_id::TEXT;
    ELSE
        -- Validar que el valor provisto sea estrictamente numérico para compatibilidad con terminales
        IF NEW.device_userid !~ '^\d+$' THEN
            RAISE EXCEPTION 'device_userid debe ser estrictamente numérico para compatibilidad de hardware. Recibido: %', NEW.device_userid;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- ============================================================================
-- 3. RLS POR ROLES Y PRINCIPIO DE MÍNIMO PRIVILEGIO EN public.empleados
-- ============================================================================
-- Superadmin: global
-- Admin / RH: gestión completa de su tenant
-- Supervisor / Auditor: solo lectura de su tenant
-- Colaborador: solo lectura de su propio registro (id = auth_current_employee_id())
-- Mutaciones: terminantemente prohibidas para Colaborador, Supervisor y Auditor.

ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;

-- Limpieza de políticas previas sobre empleados
DROP POLICY IF EXISTS role_read ON public.empleados;
DROP POLICY IF EXISTS role_insert ON public.empleados;
DROP POLICY IF EXISTS role_update ON public.empleados;
DROP POLICY IF EXISTS role_delete ON public.empleados;
DROP POLICY IF EXISTS "empleados: SELECT" ON public.empleados;
DROP POLICY IF EXISTS "empleados: INSERT" ON public.empleados;
DROP POLICY IF EXISTS "empleados: UPDATE" ON public.empleados;
DROP POLICY IF EXISTS "empleados: DELETE" ON public.empleados;

-- 3.1. LECTURA (SELECT)
CREATE POLICY role_read ON public.empleados
    FOR SELECT
    TO authenticated
    USING (
        public.auth_is_superadmin()
        OR (
            public.auth_cuenta_activa()
            AND cliente_id = public.auth_current_cliente_id()
            AND (
                public.auth_current_role() IN ('admin', 'rh', 'supervisor', 'auditor')
                OR (
                    public.auth_current_role() = 'colaborador'
                    AND id = public.auth_current_employee_id()
                )
            )
        )
    );

-- 3.2. INSERCIÓN (INSERT)
CREATE POLICY role_insert ON public.empleados
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.auth_is_superadmin()
        OR (
            public.auth_cuenta_activa()
            AND public.auth_current_role() IN ('admin', 'rh')
            AND cliente_id = public.auth_current_cliente_id()
        )
    );

-- 3.3. ACTUALIZACIÓN (UPDATE)
CREATE POLICY role_update ON public.empleados
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_is_superadmin()
        OR (
            public.auth_cuenta_activa()
            AND public.auth_current_role() IN ('admin', 'rh')
            AND cliente_id = public.auth_current_cliente_id()
        )
    )
    WITH CHECK (
        public.auth_is_superadmin()
        OR (
            public.auth_cuenta_activa()
            AND public.auth_current_role() IN ('admin', 'rh')
            AND cliente_id = public.auth_current_cliente_id()
        )
    );

-- 3.4. ELIMINACIÓN FÍSICA (DELETE)
CREATE POLICY role_delete ON public.empleados
    FOR DELETE
    TO authenticated
    USING (
        public.auth_is_superadmin()
        OR (
            public.auth_cuenta_activa()
            AND public.auth_current_role() IN ('admin')
            AND cliente_id = public.auth_current_cliente_id()
        )
    );


-- ============================================================================
-- 4. HARDENING DE SEGURIDAD Y AUTORIZACIÓN EN fn_employee_lifecycle
-- ============================================================================
-- Conserva exactamente contratos de respuesta, códigos, triggers y efectos
-- secundarios de la Migración 050.
-- Endurece: validación de rol autoritativo, search_path seguro y tenant isolation.
CREATE OR REPLACE FUNCTION public.fn_employee_lifecycle(
    p_empleado_id UUID,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cliente_id UUID;
    v_has_active_shifts INT;
    v_has_attendance INT;
    v_has_incidents INT;
    v_has_devices INT;
    v_assignments_affected INT := 0;
    v_user_role TEXT;
    v_user_cliente_id UUID;
    v_cuenta_activa BOOLEAN;
BEGIN
    -- ------------------------------------------------------------------------
    -- VALID ACTION
    -- ------------------------------------------------------------------------
    IF p_action NOT IN ('CHECK', 'DEACTIVATE', 'DELETE', 'ACTIVATE') THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message', 'Invalid action'
        );
    END IF;

    -- ------------------------------------------------------------------------
    -- EMPLOYEE / TENANT RESOLUTION
    -- ------------------------------------------------------------------------
    SELECT cliente_id
      INTO v_cliente_id
      FROM public.empleados
     WHERE id = p_empleado_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'EMPLOYEE_NOT_FOUND'
        );
    END IF;

    -- ------------------------------------------------------------------------
    -- AUTHORITATIVE ROLE & TENANT AUTHORIZATION
    -- ------------------------------------------------------------------------
    IF auth.uid() IS NOT NULL THEN
        SELECT LOWER(rol), cliente_id, (estatus_cuenta = 'activo')
          INTO v_user_role, v_user_cliente_id, v_cuenta_activa
          FROM public.usuarios_perfiles
         WHERE id = auth.uid();

        IF NOT FOUND OR v_cuenta_activa IS NOT TRUE THEN
            RETURN jsonb_build_object('status', 'UNAUTHORIZED');
        END IF;

        IF v_user_role <> 'superadmin' THEN
            -- Debe pertenecer a la misma empresa del colaborador
            IF v_user_cliente_id IS DISTINCT FROM v_cliente_id THEN
                RETURN jsonb_build_object('status', 'UNAUTHORIZED');
            END IF;

            -- Operaciones mutantes (DEACTIVATE, ACTIVATE, DELETE) requieren rol admin o rh
            IF p_action IN ('DEACTIVATE', 'ACTIVATE') AND v_user_role NOT IN ('admin', 'rh') THEN
                RETURN jsonb_build_object('status', 'UNAUTHORIZED');
            END IF;

            IF p_action = 'DELETE' AND v_user_role NOT IN ('admin') THEN
                RETURN jsonb_build_object('status', 'UNAUTHORIZED');
            END IF;

            -- CHECK permite consulta de estatus a admin, rh, supervisor, auditor
            IF p_action = 'CHECK' AND v_user_role NOT IN ('admin', 'rh', 'supervisor', 'auditor') THEN
                RETURN jsonb_build_object('status', 'UNAUTHORIZED');
            END IF;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- DEPENDENCY AUDIT (READ ONLY ACROSS DEPENDENT SCHEMAS)
    -- ------------------------------------------------------------------------
    -- 1. Active / Future shifts
    SELECT COUNT(*)
      INTO v_has_active_shifts
      FROM public.empleados_horarios
     WHERE empleado_id = p_empleado_id
       AND cliente_id = v_cliente_id
       AND activo = TRUE
       AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE);

    -- 2. Historical attendance records
    SELECT COUNT(*)
      INTO v_has_attendance
      FROM public.registro_asistencia
     WHERE empleado_id = p_empleado_id
       AND cliente_id = v_cliente_id;

    -- 3. Incidents
    SELECT COUNT(*)
      INTO v_has_incidents
      FROM public.incidencias
     WHERE empleado_id = p_empleado_id
       AND cliente_id = v_cliente_id;

    -- 4. Device assignments
    SELECT COUNT(*)
      INTO v_has_devices
      FROM public.device_employee_assignments
     WHERE employee_id = p_empleado_id
       AND cliente_id = v_cliente_id;

    -- =========================================================================
    -- CHECK
    -- =========================================================================
    IF p_action = 'CHECK' THEN
        IF v_has_active_shifts > 0 THEN
            RETURN jsonb_build_object(
                'status', 'HAS_ACTIVE_SHIFTS',
                'count', v_has_active_shifts
            );
        ELSIF v_has_attendance > 0 OR v_has_incidents > 0 THEN
            RETURN jsonb_build_object(
                'status', 'CAN_DEACTIVATE',
                'attendance_count', v_has_attendance,
                'incidents_count', v_has_incidents,
                'devices_count', v_has_devices
            );
        ELSIF v_has_devices > 0 THEN
            RETURN jsonb_build_object(
                'status', 'DEVICE_REMOVAL_REQUIRED',
                'devices_count', v_has_devices
            );
        END IF;

        RETURN jsonb_build_object(
            'status', 'CAN_DELETE'
        );
    END IF;

    -- =========================================================================
    -- DEACTIVATE
    -- =========================================================================
    IF p_action = 'DEACTIVATE' THEN
        IF v_has_active_shifts > 0 THEN
            RETURN jsonb_build_object(
                'status', 'ERROR',
                'message', 'Cannot deactivate with active shifts'
            );
        END IF;

        -- Employee state update triggers trg_sync_employee_lifecycle_assignments()
        UPDATE public.empleados
           SET activo = FALSE
         WHERE id = p_empleado_id
           AND cliente_id = v_cliente_id
           AND activo = TRUE;

        SELECT COUNT(*)
          INTO v_assignments_affected
          FROM public.device_employee_assignments
         WHERE employee_id = p_empleado_id
           AND cliente_id = v_cliente_id
           AND activo = FALSE
           AND suspension_reason = 'EMPLOYEE_DEACTIVATED'
           AND sync_status = 'PENDING';

        RETURN jsonb_build_object(
            'status', 'SUCCESS',
            'assignments_pending_removal', v_assignments_affected
        );
    END IF;

    -- =========================================================================
    -- ACTIVATE
    -- =========================================================================
    IF p_action = 'ACTIVATE' THEN
        UPDATE public.empleados
           SET activo = TRUE
         WHERE id = p_empleado_id
           AND cliente_id = v_cliente_id
           AND activo = FALSE;

        SELECT COUNT(*)
          INTO v_assignments_affected
          FROM public.device_employee_assignments
         WHERE employee_id = p_empleado_id
           AND cliente_id = v_cliente_id
           AND activo = TRUE
           AND sync_status = 'PENDING';

        RETURN jsonb_build_object(
            'status', 'SUCCESS',
            'assignments_pending_sync', v_assignments_affected,
            'biometrics', 'RE_ENROLLMENT_REQUIRED'
        );
    END IF;

    -- =========================================================================
    -- HARD DELETE
    -- =========================================================================
    IF v_has_active_shifts > 0
       OR v_has_attendance > 0
       OR v_has_incidents > 0
       OR v_has_devices > 0
    THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message', 'Cannot delete employee with historical records, shifts or device assignments'
        );
    END IF;

    DELETE FROM public.empleados
     WHERE id = p_empleado_id
       AND cliente_id = v_cliente_id;

    RETURN jsonb_build_object(
        'status', 'SUCCESS'
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message', SQLERRM
        );
END;
$$;


-- ============================================================================
-- 5. HARDENING DEFENSIVO EN EL TRIGGER DE PREVENCIÓN DE BORRADO
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_prevent_employee_deletion_with_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_attendance INT;
    v_has_incidents INT;
    v_has_shifts INT;
    v_has_devices INT;
BEGIN
    SELECT COUNT(*) INTO v_has_attendance FROM public.registro_asistencia WHERE empleado_id = OLD.id;
    SELECT COUNT(*) INTO v_has_incidents FROM public.incidencias WHERE empleado_id = OLD.id;
    SELECT COUNT(*) INTO v_has_shifts FROM public.empleados_horarios WHERE empleado_id = OLD.id;
    SELECT COUNT(*) INTO v_has_devices FROM public.device_employee_assignments WHERE employee_id = OLD.id;

    IF v_has_attendance > 0 OR v_has_incidents > 0 OR v_has_shifts > 0 OR v_has_devices > 0 THEN
        RAISE EXCEPTION 'No se puede borrar físicamente el empleado (%). Contiene vínculos históricos activos (asistencias: %, incidencias: %, turnos: %, dispositivos: %). Utilice baja lógica (activo=false).',
            OLD.id, v_has_attendance, v_has_incidents, v_has_shifts, v_has_devices;
    END IF;

    RETURN OLD;
END;
$$;


-- ============================================================================
-- 6. AUDITORÍA OPERACIONAL INTEGRAL EN public.empleados (EVOLUCIÓN DE trg_audit_empleados)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_audit_empleados()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_old_values JSONB := '{}'::jsonb;
    v_new_values JSONB := '{}'::jsonb;
BEGIN
    -- ------------------------------------------------------------------------
    -- INSERT: EMPLOYEE_CREATED
    -- ------------------------------------------------------------------------
    IF TG_OP = 'INSERT' THEN
        PERFORM public.log_audit_event(
            NEW.cliente_id,
            'EMPLOYEE_CREATED',
            'Empleado',
            NEW.id::TEXT,
            'SUCCESS',
            jsonb_build_object(
                'empleado_nombre', TRIM(COALESCE(NEW.nombre, '') || ' ' || COALESCE(NEW.apellido, '')),
                'new_values', jsonb_build_object(
                    'nombre', NEW.nombre,
                    'apellido', NEW.apellido,
                    'clave_empleado', NEW.clave_empleado,
                    'departamento', NEW.departamento,
                    'puesto', NEW.puesto,
                    'pin', NEW.pin,
                    'device_userid', NEW.device_userid,
                    'tarjeta', NEW.tarjeta,
                    'sexo', NEW.sexo,
                    'fecha_ingreso', NEW.fecha_ingreso,
                    'fecha_cumpleanos', NEW.fecha_cumpleanos,
                    'activo', NEW.activo
                )
            )
        );
        RETURN NEW;

    -- ------------------------------------------------------------------------
    -- UPDATE: LIFECYCLE (DEACTIVATE / REACTIVATE) O PROFILE CHANGES
    -- ------------------------------------------------------------------------
    ELSIF TG_OP = 'UPDATE' THEN
        -- Ciclo de vida: Cambio de estatus activo
        IF OLD.activo IS DISTINCT FROM NEW.activo THEN
            IF OLD.activo = TRUE AND NEW.activo = FALSE THEN
                PERFORM public.log_audit_event(
                    NEW.cliente_id,
                    'EMPLOYEE_DEACTIVATED',
                    'Empleado',
                    NEW.id::TEXT,
                    'SUCCESS',
                    jsonb_build_object(
                        'empleado_nombre', TRIM(COALESCE(NEW.nombre, '') || ' ' || COALESCE(NEW.apellido, '')),
                        'old_values', jsonb_build_object('activo', OLD.activo),
                        'new_values', jsonb_build_object('activo', NEW.activo)
                    )
                );
            ELSIF OLD.activo = FALSE AND NEW.activo = TRUE THEN
                PERFORM public.log_audit_event(
                    NEW.cliente_id,
                    'EMPLOYEE_REACTIVATED',
                    'Empleado',
                    NEW.id::TEXT,
                    'SUCCESS',
                    jsonb_build_object(
                        'empleado_nombre', TRIM(COALESCE(NEW.nombre, '') || ' ' || COALESCE(NEW.apellido, '')),
                        'old_values', jsonb_build_object('activo', OLD.activo),
                        'new_values', jsonb_build_object('activo', NEW.activo)
                    )
                );
            END IF;
        END IF;

        -- Auditoría de campos laborales y personales modificados (IS DISTINCT FROM)
        IF OLD.nombre IS DISTINCT FROM NEW.nombre THEN
            v_old_values := v_old_values || jsonb_build_object('nombre', OLD.nombre);
            v_new_values := v_new_values || jsonb_build_object('nombre', NEW.nombre);
            v_changes := v_changes || jsonb_build_object('nombre', jsonb_build_object('before', OLD.nombre, 'after', NEW.nombre));
        END IF;
        IF OLD.apellido IS DISTINCT FROM NEW.apellido THEN
            v_old_values := v_old_values || jsonb_build_object('apellido', OLD.apellido);
            v_new_values := v_new_values || jsonb_build_object('apellido', NEW.apellido);
            v_changes := v_changes || jsonb_build_object('apellido', jsonb_build_object('before', OLD.apellido, 'after', NEW.apellido));
        END IF;
        IF OLD.clave_empleado IS DISTINCT FROM NEW.clave_empleado THEN
            v_old_values := v_old_values || jsonb_build_object('clave_empleado', OLD.clave_empleado);
            v_new_values := v_new_values || jsonb_build_object('clave_empleado', NEW.clave_empleado);
            v_changes := v_changes || jsonb_build_object('clave_empleado', jsonb_build_object('before', OLD.clave_empleado, 'after', NEW.clave_empleado));
        END IF;
        IF OLD.departamento IS DISTINCT FROM NEW.departamento THEN
            v_old_values := v_old_values || jsonb_build_object('departamento', OLD.departamento);
            v_new_values := v_new_values || jsonb_build_object('departamento', NEW.departamento);
            v_changes := v_changes || jsonb_build_object('departamento', jsonb_build_object('before', OLD.departamento, 'after', NEW.departamento));
        END IF;
        IF OLD.puesto IS DISTINCT FROM NEW.puesto THEN
            v_old_values := v_old_values || jsonb_build_object('puesto', OLD.puesto);
            v_new_values := v_new_values || jsonb_build_object('puesto', NEW.puesto);
            v_changes := v_changes || jsonb_build_object('puesto', jsonb_build_object('before', OLD.puesto, 'after', NEW.puesto));
        END IF;
        IF OLD.pin IS DISTINCT FROM NEW.pin THEN
            v_old_values := v_old_values || jsonb_build_object('pin', OLD.pin);
            v_new_values := v_new_values || jsonb_build_object('pin', NEW.pin);
            v_changes := v_changes || jsonb_build_object('pin', jsonb_build_object('before', OLD.pin, 'after', NEW.pin));
        END IF;
        IF OLD.device_userid IS DISTINCT FROM NEW.device_userid THEN
            v_old_values := v_old_values || jsonb_build_object('device_userid', OLD.device_userid);
            v_new_values := v_new_values || jsonb_build_object('device_userid', NEW.device_userid);
            v_changes := v_changes || jsonb_build_object('device_userid', jsonb_build_object('before', OLD.device_userid, 'after', NEW.device_userid));
        END IF;
        IF OLD.tarjeta IS DISTINCT FROM NEW.tarjeta THEN
            v_old_values := v_old_values || jsonb_build_object('tarjeta', OLD.tarjeta);
            v_new_values := v_new_values || jsonb_build_object('tarjeta', NEW.tarjeta);
            v_changes := v_changes || jsonb_build_object('tarjeta', jsonb_build_object('before', OLD.tarjeta, 'after', NEW.tarjeta));
        END IF;
        IF OLD.sexo IS DISTINCT FROM NEW.sexo THEN
            v_old_values := v_old_values || jsonb_build_object('sexo', OLD.sexo);
            v_new_values := v_new_values || jsonb_build_object('sexo', NEW.sexo);
            v_changes := v_changes || jsonb_build_object('sexo', jsonb_build_object('before', OLD.sexo, 'after', NEW.sexo));
        END IF;
        IF OLD.fecha_ingreso IS DISTINCT FROM NEW.fecha_ingreso THEN
            v_old_values := v_old_values || jsonb_build_object('fecha_ingreso', OLD.fecha_ingreso);
            v_new_values := v_new_values || jsonb_build_object('fecha_ingreso', NEW.fecha_ingreso);
            v_changes := v_changes || jsonb_build_object('fecha_ingreso', jsonb_build_object('before', OLD.fecha_ingreso, 'after', NEW.fecha_ingreso));
        END IF;
        IF OLD.fecha_cumpleanos IS DISTINCT FROM NEW.fecha_cumpleanos THEN
            v_old_values := v_old_values || jsonb_build_object('fecha_cumpleanos', OLD.fecha_cumpleanos);
            v_new_values := v_new_values || jsonb_build_object('fecha_cumpleanos', NEW.fecha_cumpleanos);
            v_changes := v_changes || jsonb_build_object('fecha_cumpleanos', jsonb_build_object('before', OLD.fecha_cumpleanos, 'after', NEW.fecha_cumpleanos));
        END IF;

        IF v_changes <> '{}'::jsonb THEN
            PERFORM public.log_audit_event(
                NEW.cliente_id,
                'EMPLOYEE_UPDATED',
                'Empleado',
                NEW.id::TEXT,
                'SUCCESS',
                jsonb_build_object(
                    'empleado_nombre', TRIM(COALESCE(NEW.nombre, '') || ' ' || COALESCE(NEW.apellido, '')),
                    'old_values', v_old_values,
                    'new_values', v_new_values,
                    'changes', v_changes
                )
            );
        END IF;

        RETURN NEW;

    -- ------------------------------------------------------------------------
    -- DELETE: EMPLOYEE_DELETED (BEFORE DELETE O AFTER DELETE)
    -- ------------------------------------------------------------------------
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM public.log_audit_event(
            OLD.cliente_id,
            'EMPLOYEE_DELETED',
            'Empleado',
            OLD.id::TEXT,
            'SUCCESS',
            jsonb_build_object(
                'empleado_nombre', TRIM(COALESCE(OLD.nombre, '') || ' ' || COALESCE(OLD.apellido, '')),
                'old_values', jsonb_build_object(
                    'id', OLD.id,
                    'cliente_id', OLD.cliente_id,
                    'nombre', OLD.nombre,
                    'apellido', OLD.apellido,
                    'clave_empleado', OLD.clave_empleado,
                    'departamento', OLD.departamento,
                    'puesto', OLD.puesto,
                    'pin', OLD.pin,
                    'device_userid', OLD.device_userid,
                    'tarjeta', OLD.tarjeta,
                    'sexo', OLD.sexo,
                    'fecha_ingreso', OLD.fecha_ingreso,
                    'fecha_cumpleanos', OLD.fecha_cumpleanos,
                    'activo', OLD.activo
                )
            )
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

-- Re-vincular trigger de auditoría cubriendo INSERT, UPDATE y DELETE con la función real
DROP TRIGGER IF EXISTS trg_audit_empleados_changes ON public.empleados;
CREATE TRIGGER trg_audit_empleados_changes
AFTER INSERT OR UPDATE OR DELETE ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_empleados();

NOTIFY pgrst, 'reload schema';

COMMIT;

