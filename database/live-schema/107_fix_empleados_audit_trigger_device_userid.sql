-- ============================================================================
-- SIGNUM-CLOCK · Live Schema 107
-- Corrección de Trigger de Auditoría en public.empleados
-- Soluciona: record "old" has no field "hikvision_device_userid"
-- Actualiza public.trg_audit_empleados para usar exclusivamente la columna canónica device_userid
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
    -- UPDATE: LIFECYCLE O CAMBIOS EN DATOS PERSONALES / LABORALES / BIOMÉTRICOS
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
            v_old_values := v_old_values || jsonb_build_object('pin', '***');
            v_new_values := v_new_values || jsonb_build_object('pin', '***');
            v_changes := v_changes || jsonb_build_object('pin', jsonb_build_object('before', '***', 'after', '***'));
        END IF;
        -- Canónico: device_userid (NUNCA hikvision_device_userid)
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
    -- DELETE: EMPLOYEE_DELETED
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

-- Reemplazar trigger para aplicar la función canónica
DROP TRIGGER IF EXISTS trg_audit_empleados_changes ON public.empleados;
CREATE TRIGGER trg_audit_empleados_changes
AFTER INSERT OR UPDATE OR DELETE ON public.empleados
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_empleados();

-- ============================================================================
-- 2. FUNCIÓN DE AUTENTICACIÓN SEGURA PARA EL PORTAL DE COLABORADORES
-- Permite login mediante Empresa + Clave de Colaborador / Device UserID + PIN
-- Bypassea RLS anónimo sin exponer la tabla completa a consultas no autorizadas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_login_colaborador(
    p_cliente_id UUID,
    p_clave TEXT,
    p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_emp RECORD;
    v_clean_clave TEXT := TRIM(COALESCE(p_clave, ''));
    v_clean_pin TEXT := TRIM(COALESCE(p_pin, ''));
BEGIN
    IF p_cliente_id IS NULL OR v_clean_clave = '' OR v_clean_pin = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Por favor ingresa tu empresa, clave y contraseña.'
        );
    END IF;

    -- Buscar colaborador por clave_empleado o por device_userid dentro del tenant
    SELECT id, cliente_id, nombre, apellido, clave_empleado, pin, departamento, puesto, device_userid, avatar_url, activo
      INTO v_emp
      FROM public.empleados
     WHERE cliente_id = p_cliente_id
       AND (
           LOWER(TRIM(COALESCE(clave_empleado, ''))) = LOWER(v_clean_clave)
           OR TRIM(COALESCE(device_userid, '')) = v_clean_clave
       )
     LIMIT 1;

    -- 1. Si no existe
    IF v_emp.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Colaborador no encontrado. Verifica tu Clave o consulta con Recursos Humanos.'
        );
    END IF;

    -- 2. Si está inactivo
    IF v_emp.activo = FALSE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Tu perfil de colaborador se encuentra inactivo. Contacta al Administrador.'
        );
    END IF;

    -- 3. Si no tiene PIN configurado
    IF v_emp.pin IS NULL OR TRIM(v_emp.pin) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Aún no tienes un PIN asignado. Solicita a Recursos Humanos que configure tu contraseña o PIN.'
        );
    END IF;

    -- 4. Si el PIN no coincide
    IF TRIM(v_emp.pin) <> v_clean_pin THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Contraseña o PIN incorrecto. Verifica los caracteres e intenta nuevamente.'
        );
    END IF;

    -- 5. Éxito: Retornar datos seguros del colaborador
    RETURN jsonb_build_object(
        'success', true,
        'empleado', jsonb_build_object(
            'id', v_emp.id,
            'cliente_id', v_emp.cliente_id,
            'nombre', v_emp.nombre,
            'apellido', COALESCE(v_emp.apellido, ''),
            'clave_empleado', COALESCE(v_emp.clave_empleado, v_emp.device_userid),
            'departamento', COALESCE(v_emp.departamento, 'General'),
            'puesto', COALESCE(v_emp.puesto, 'Colaborador'),
            'device_userid', v_emp.device_userid,
            'avatar_url', v_emp.avatar_url,
            'activo', v_emp.activo
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_login_colaborador(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 3. PERMISOS Y FUNCIÓN AUTORIZADA PARA REGISTRO DE ASISTENCIA WEB
-- Soluciona: new row violates row-level security policy for table "registro_asistencia"
-- ============================================================================

-- A. Función RPC con privilegios elevados (bypassea RLS anónimo de forma autorizada)
CREATE OR REPLACE FUNCTION public.fn_registrar_asistencia_colaborador(
    p_cliente_id UUID,
    p_empleado_id UUID,
    p_tipo_verificacion TEXT,
    p_verificado_at TIMESTAMPTZ DEFAULT now(),
    p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_emp RECORD;
    v_new_id UUID;
BEGIN
    IF p_cliente_id IS NULL OR p_empleado_id IS NULL OR p_tipo_verificacion IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Parámetros incompletos para registrar marcaje.');
    END IF;

    -- Validar que el empleado pertenezca a la empresa
    SELECT id, cliente_id, activo
      INTO v_emp
      FROM public.empleados
     WHERE id = p_empleado_id
       AND cliente_id = p_cliente_id;

    IF v_emp.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Colaborador no encontrado en la empresa.');
    END IF;

    IF v_emp.activo = FALSE THEN
        RETURN jsonb_build_object('success', false, 'error', 'El colaborador se encuentra inactivo.');
    END IF;

    -- Insertar el marcaje
    INSERT INTO public.registro_asistencia (
        cliente_id,
        empleado_id,
        dispositivo_id,
        verificado_at,
        tipo_verificacion,
        metodo,
        es_manual,
        raw_payload
    ) VALUES (
        p_cliente_id,
        p_empleado_id,
        NULL,
        COALESCE(p_verificado_at, now()),
        p_tipo_verificacion,
        'web',
        FALSE,
        COALESCE(p_raw_payload, '{}'::jsonb)
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_new_id,
        'message', 'Marcaje registrado exitosamente.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_registrar_asistencia_colaborador(UUID, UUID, TEXT, TIMESTAMPTZ, JSONB) TO anon, authenticated, service_role;

-- B. Políticas RLS para registro_asistencia (inserción directa y lectura del colaborador)
DROP POLICY IF EXISTS anon_colaborador_insert ON public.registro_asistencia;
CREATE POLICY anon_colaborador_insert 
ON public.registro_asistencia 
FOR INSERT 
TO anon, authenticated
WITH CHECK (
    cliente_id IS NOT NULL 
    AND empleado_id IS NOT NULL
);

DROP POLICY IF EXISTS anon_colaborador_select ON public.registro_asistencia;
CREATE POLICY anon_colaborador_select 
ON public.registro_asistencia 
FOR SELECT 
TO anon, authenticated
USING (
    cliente_id IS NOT NULL 
    AND empleado_id IS NOT NULL
);

NOTIFY pgrst, 'reload schema';


