-- ============================================================================
-- SIGNUM-CLOCK · Migration 050 · Employee deactivation / physical removal
-- CORRECTED / FAIL-CLOSED VERSION
--
-- IMPORTANT:
-- - device_employee_assignments remains the sole producer of USERINFO commands.
-- - DELETE USERINFO producer ALWAYS uses exact:
--
--       DATA DELETE USERINFO PIN=<numeric>
--
-- - NEVER generate:
--
--       DATA DELETE USERINFO Pin=<numeric>
--
-- - Pending commands for the same device + PIN are superseded safely.
-- - Historical rows in device_commands are preserved.
-- - Reactivation cancels a pending DELETE for offline devices before
--   enqueueing UPDATE USERINFO.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 0. SAFETY CLEANUP
-- ============================================================================
-- Neutralize any legacy / malformed pending DELETE USERINFO command.
-- This is especially important for devices that are currently offline.
--
-- We DO NOT DELETE history. We mark unsafe commands as consumed so they can
-- never be dispatched by /getrequest.
-- ============================================================================

UPDATE public.device_commands
SET
    is_executed = TRUE,
    updated_at = NOW()
WHERE is_executed = FALSE
  AND command_string ILIKE 'DATA DELETE USERINFO%'
  AND command_string !~ '^DATA DELETE USERINFO PIN=[0-9]+$';


-- ============================================================================
-- 1. ASSIGNMENT -> DEVICE COMMAND PRODUCER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.proc_sync_employee_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    var_serial TEXT;
    var_nombre TEXT;
    var_cmd TEXT;
    var_pin TEXT;
BEGIN

    -- ------------------------------------------------------------------------
    -- IDEMPOTENCY GUARD
    --
    -- The trigger fires when activo or biometric_user_id are mentioned in an
    -- UPDATE statement. Do not enqueue another command if neither value
    -- actually changed.
    -- ------------------------------------------------------------------------

    IF TG_OP = 'UPDATE' THEN
        IF NEW.activo IS NOT DISTINCT FROM OLD.activo
           AND NEW.biometric_user_id IS NOT DISTINCT FROM OLD.biometric_user_id
        THEN
            RETURN NEW;
        END IF;
    END IF;


    -- ------------------------------------------------------------------------
    -- TENANT-SAFE DEVICE RESOLUTION
    -- ------------------------------------------------------------------------

    SELECT UPPER(TRIM(serial_number))
      INTO var_serial
      FROM public.devices
     WHERE id = NEW.device_id
       AND cliente_id = NEW.cliente_id;

    IF var_serial IS NULL THEN
        RAISE EXCEPTION
            'Dispositivo % no encontrado para tenant % en public.devices',
            NEW.device_id,
            NEW.cliente_id;
    END IF;


    -- ------------------------------------------------------------------------
    -- TENANT-SAFE EMPLOYEE RESOLUTION
    -- ------------------------------------------------------------------------

    SELECT TRIM(
               COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')
           )
      INTO var_nombre
      FROM public.empleados
     WHERE id = NEW.employee_id
       AND cliente_id = NEW.cliente_id;

    IF var_nombre IS NULL THEN
        RAISE EXCEPTION
            'Empleado % no encontrado para tenant % en public.empleados',
            NEW.employee_id,
            NEW.cliente_id;
    END IF;


    -- ------------------------------------------------------------------------
    -- CANONICAL PIN
    --
    -- IMPORTANT:
    -- var_pin is calculated for BOTH activation and deactivation.
    --
    -- This allows an ACTIVATE to safely supersede a DELETE that is still
    -- pending because a device was offline.
    -- ------------------------------------------------------------------------

    var_pin := BTRIM(NEW.biometric_user_id);

    IF var_pin IS NULL
       OR var_pin = ''
       OR var_pin !~ '^[0-9]+$'
    THEN
        RAISE EXCEPTION
            'USERINFO requires a strictly numeric biometric_user_id';
    END IF;


    -- ------------------------------------------------------------------------
    -- BUILD DESIRED DEVICE STATE
    -- ------------------------------------------------------------------------

    IF NEW.activo IS TRUE THEN

        -- Physically validated USERINFO payload.
        -- Keep real TAB separators.
        var_cmd :=
            'DATA UPDATE USERINFO PIN=' || var_pin ||
            E'\tName=' ||
            COALESCE(NULLIF(var_nombre, ''), 'User') ||
            E'\tPrivilege=0';

    ELSIF NEW.activo IS FALSE THEN

        -- CRITICAL:
        --
        -- The prior "Pin=" form is physically rejected because it caused
        -- deletion of all users on test hardware.
        --
        -- ONLY uppercase PIN= is allowed.
        var_cmd :=
            'DATA DELETE USERINFO PIN=' || var_pin;

    ELSE

        RAISE EXCEPTION
            'device_employee_assignments.activo cannot be NULL';

    END IF;


    -- ------------------------------------------------------------------------
    -- SUPERSEDE PREVIOUS PENDING USERINFO DESIRED STATE
    --
    -- Preserve history:
    -- We DO NOT DELETE device_commands rows.
    --
    -- Any pending USERINFO/DELETE for this exact device + PIN is marked
    -- consumed before inserting the newest desired state.
    --
    -- This is critical for OFFLINE devices.
    --
    -- Example:
    --
    --   employee deactivated
    --       DELETE PIN=4 pending
    --
    --   employee reactivated while device still offline
    --       old DELETE becomes consumed
    --       UPDATE USERINFO PIN=4 becomes the desired state
    --
    -- PIN=1 cannot match PIN=10 because the regex captures only the complete
    -- PIN token.
    -- ------------------------------------------------------------------------

    UPDATE public.device_commands dc
       SET
           is_executed = TRUE,
           updated_at = NOW()
     WHERE dc.device_serial = var_serial
       AND dc.is_executed = FALSE
       AND (
            substring(
                dc.command_string
                FROM '^DATA UPDATE USERINFO [Pp][Ii][Nn]=([^[:space:]]+)'
            ) = var_pin

            OR

            substring(
                dc.command_string
                FROM '^DATA USER [Pp][Ii][Nn]=([^[:space:]]+)'
            ) = var_pin

            OR

            -- Case-insensitive ONLY for recognizing historical pending rows.
            -- The producer below still emits uppercase PIN= exclusively.
            substring(
                dc.command_string
                FROM '(?i)^DATA DELETE USERINFO PIN=([0-9]+)$'
            ) = var_pin
       );


    -- ------------------------------------------------------------------------
    -- ENQUEUE CURRENT DESIRED STATE
    -- ------------------------------------------------------------------------

    INSERT INTO public.device_commands (
        id,
        device_serial,
        command_string,
        is_executed
    )
    VALUES (
        gen_random_uuid(),
        var_serial,
        var_cmd,
        FALSE
    );


    NEW.sync_status := 'PENDING';
    NEW.last_error := NULL;

    RETURN NEW;
END;
$$;


-- ============================================================================
-- 2. ASSIGNMENT TRIGGER
-- ============================================================================
--
-- ACK updates of:
--   sync_status
--   last_error
--   last_attempt_at
--   last_synced_at
--   retry_count
--
-- MUST NOT generate another device command.
--
-- Only changes to desired state:
--   activo
--   biometric_user_id
--
-- invoke the producer.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_employee_assignment
ON public.device_employee_assignments;

CREATE TRIGGER trg_sync_employee_assignment
BEFORE INSERT OR UPDATE OF activo, biometric_user_id
ON public.device_employee_assignments
FOR EACH ROW
EXECUTE FUNCTION public.proc_sync_employee_assignment();


-- ============================================================================
-- 3. EMPLOYEE LIFECYCLE -> ASSIGNMENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_sync_employee_lifecycle_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN

    -- ------------------------------------------------------------------------
    -- DEACTIVATE EMPLOYEE
    -- ------------------------------------------------------------------------

    IF OLD.activo = TRUE
       AND NEW.activo = FALSE
    THEN

        UPDATE public.device_employee_assignments
           SET
               activo = FALSE,
               sync_status = 'PENDING',
               last_error = NULL,
               suspension_reason = 'EMPLOYEE_DEACTIVATED',
               actualizado_at = NOW()
         WHERE employee_id = NEW.id
           AND cliente_id = NEW.cliente_id
           AND activo = TRUE;


    -- ------------------------------------------------------------------------
    -- REACTIVATE EMPLOYEE
    --
    -- IMPORTANT:
    -- Only assignments suspended by EMPLOYEE_DEACTIVATED are restored.
    --
    -- MANUAL_UNASSIGN and other suspension causes remain untouched.
    -- ------------------------------------------------------------------------

    ELSIF OLD.activo = FALSE
          AND NEW.activo = TRUE
    THEN

        UPDATE public.device_employee_assignments
           SET
               activo = TRUE,
               sync_status = 'PENDING',
               last_error = NULL,
               suspension_reason = NULL,
               actualizado_at = NOW()
         WHERE employee_id = NEW.id
           AND cliente_id = NEW.cliente_id
           AND activo = FALSE
           AND suspension_reason = 'EMPLOYEE_DEACTIVATED';

    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_sync_employee_lifecycle_assignments
ON public.empleados;

CREATE TRIGGER trg_sync_employee_lifecycle_assignments
AFTER UPDATE OF activo
ON public.empleados
FOR EACH ROW
WHEN (OLD.activo IS DISTINCT FROM NEW.activo)
EXECUTE FUNCTION public.trg_sync_employee_lifecycle_assignments();


-- ============================================================================
-- 4. AUTHORITATIVE EMPLOYEE LIFECYCLE RPC
-- ============================================================================

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
BEGIN

    -- ------------------------------------------------------------------------
    -- VALID ACTION
    -- ------------------------------------------------------------------------

    IF p_action NOT IN (
        'CHECK',
        'DEACTIVATE',
        'DELETE',
        'ACTIVATE'
    ) THEN

        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message', 'Invalid action'
        );

    END IF;


    -- ------------------------------------------------------------------------
    -- EMPLOYEE / TENANT
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
    -- AUTHORIZATION
    -- ------------------------------------------------------------------------

    IF auth.uid() IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
              FROM public.usuarios_perfiles
             WHERE id = auth.uid()
               AND (
                    cliente_id = v_cliente_id
                    OR rol IN ('superadmin', 'auditor')
               )
       )
    THEN

        RETURN jsonb_build_object(
            'status', 'UNAUTHORIZED'
        );

    END IF;


    -- ------------------------------------------------------------------------
    -- ACTIVE SHIFTS
    -- ------------------------------------------------------------------------

    SELECT COUNT(*)
      INTO v_has_active_shifts
      FROM public.empleados_horarios
     WHERE empleado_id = p_empleado_id
       AND cliente_id = v_cliente_id
       AND activo = TRUE
       AND (
            fecha_fin IS NULL
            OR fecha_fin >= CURRENT_DATE
       );


    -- ------------------------------------------------------------------------
    -- ATTENDANCE HISTORY
    -- ------------------------------------------------------------------------

    SELECT COUNT(*)
      INTO v_has_attendance
      FROM public.registro_asistencia
     WHERE empleado_id = p_empleado_id
       AND cliente_id = v_cliente_id;


    -- ------------------------------------------------------------------------
    -- INCIDENT HISTORY
    -- ------------------------------------------------------------------------

    SELECT COUNT(*)
      INTO v_has_incidents
      FROM public.incidencias
     WHERE empleado_id = p_empleado_id
       AND cliente_id = v_cliente_id;


    -- ------------------------------------------------------------------------
    -- DEVICE ASSIGNMENTS
    -- ------------------------------------------------------------------------

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

        ELSIF v_has_attendance > 0
              OR v_has_incidents > 0
        THEN

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


        -- Employee state is authoritative.
        --
        -- The AFTER UPDATE lifecycle trigger:
        --
        -- empleados.activo true -> false
        --
        -- causes every currently active assignment to become:
        --
        -- activo=false
        -- suspension_reason=EMPLOYEE_DEACTIVATED
        -- sync_status=PENDING
        --
        -- The assignment BEFORE trigger then generates one:
        --
        -- DATA DELETE USERINFO PIN=<numeric>
        --
        -- per assigned device.
        --
        -- A repeated DEACTIVATE does not change empleados.activo and therefore
        -- generates no duplicate physical removal command.

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
            'assignments_pending_removal',
            v_assignments_affected
        );

    END IF;


    -- =========================================================================
    -- ACTIVATE
    -- =========================================================================

    IF p_action = 'ACTIVATE' THEN

        -- Only assignments suspended because of employee deactivation are
        -- restored by trg_sync_employee_lifecycle_assignments().
        --
        -- For an offline device:
        --
        -- pending DELETE PIN=X
        --
        -- is superseded by proc_sync_employee_assignment(), then:
        --
        -- UPDATE USERINFO PIN=X
        --
        -- becomes the newest desired state.

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
            'assignments_pending_sync',
            v_assignments_affected,
            'biometrics', 'RE_ENROLLMENT_REQUIRED'
        );

    END IF;


    -- =========================================================================
    -- HARD DELETE
    -- =========================================================================
    --
    -- Historical records or device assignments prevent physical deletion.
    -- ============================================================================

    IF v_has_attendance > 0
       OR v_has_incidents > 0
       OR v_has_devices > 0
    THEN

        RETURN jsonb_build_object(
            'status', 'ERROR',
            'message',
            'Cannot delete employee with historical records or device assignments'
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
-- 5. POSTGREST SCHEMA RELOAD
-- ============================================================================

NOTIFY pgrst, 'reload schema';


COMMIT;