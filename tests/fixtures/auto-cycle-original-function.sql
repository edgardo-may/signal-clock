-- Productive definition supplied by the operator. Test/reference only.
CREATE OR REPLACE FUNCTION public.fn_sync_attendance_to_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_empleado RECORD;
    v_device_id UUID;
    v_tz TEXT;
    v_tipo_verif TEXT;
    v_metodo TEXT;
    v_status_clean TEXT;

    -- Variables para resolución inteligente de horario
    v_fecha_local DATE;
    v_hora_local TIME;
    v_dow INTEGER;
    v_dia_key TEXT;
    v_horario RECORD;
    v_dia_config JSONB;
    v_hora_ent_txt TEXT;
    v_hora_sal_txt TEXT;
    v_hora_entrada TIME;
    v_hora_salida TIME;
    v_punto_medio TIME;
    v_tiene_entrada_hoy BOOLEAN;
BEGIN
    -- 1. Buscar colaborador
    SELECT id, cliente_id
    INTO v_empleado
    FROM empleados
    WHERE device_userid = NEW.user_id
       OR clave_empleado = NEW.user_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- 2. Resolver dispositivo y zona horaria
    SELECT id, COALESCE(timezone, 'America/Cancun')
    INTO v_device_id, v_tz
    FROM devices
    WHERE serial_number = NEW.device_serial
      AND cliente_id = v_empleado.cliente_id
    LIMIT 1;

    IF v_tz IS NULL THEN
        v_tz := 'America/Cancun';
    END IF;

    -- Calcular fecha y hora local del evento
    v_fecha_local := (NEW.timestamp AT TIME ZONE v_tz)::DATE;
    v_hora_local  := (NEW.timestamp AT TIME ZONE v_tz)::TIME;
    v_dow         := EXTRACT(DOW FROM (NEW.timestamp AT TIME ZONE v_tz));

    v_dia_key := CASE v_dow
        WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar'
        WHEN 3 THEN 'mie' WHEN 4 THEN 'jue' WHEN 5 THEN 'vie' WHEN 6 THEN 'sab'
    END;

    -- 3. Limpiar status de hardware
    v_status_clean := LOWER(TRIM(COALESCE(NEW.status, '')));

    -- 4. Si el status es 255, auto o indefinido -> Deducir por horario
    IF v_status_clean IN ('255', '-1', 'auto', 'undefined', '') THEN

        -- Verificar si ya marcó entrada hoy
        SELECT EXISTS (
            SELECT 1 FROM registro_asistencia
            WHERE empleado_id = v_empleado.id
              AND (verificado_at AT TIME ZONE v_tz)::DATE = v_fecha_local
              AND tipo_verificacion = 'entrada'
        ) INTO v_tiene_entrada_hoy;

        -- Obtener horario programado
        SELECT h.dias_config INTO v_horario
        FROM empleados_horarios eh
        JOIN horarios h ON h.id = eh.horario_id
        WHERE eh.empleado_id = v_empleado.id AND h.activo = true
        LIMIT 1;

        v_dia_config   := v_horario.dias_config -> v_dia_key;
        v_hora_ent_txt := v_dia_config ->> 'entrada';
        v_hora_sal_txt := v_dia_config ->> 'salida';

        IF v_hora_ent_txt IS NOT NULL AND v_hora_ent_txt <> ''
           AND v_hora_sal_txt IS NOT NULL AND v_hora_sal_txt <> '' THEN

            v_hora_entrada := v_hora_ent_txt::TIME;
            v_hora_salida  := v_hora_sal_txt::TIME;

            -- Calcular punto medio del turno: Entrada + (Duración / 2)
            v_punto_medio := v_hora_entrada + ((v_hora_salida - v_hora_entrada) / 2);

            IF NOT v_tiene_entrada_hoy AND v_hora_local < v_punto_medio THEN
                v_tipo_verif := 'entrada';
            ELSE
                v_tipo_verif := 'salida';
            END IF;
        ELSE
            -- Sin horario configurado: primera del día entrada, siguientes salida
            IF NOT v_tiene_entrada_hoy THEN
                v_tipo_verif := 'entrada';
            ELSE
                v_tipo_verif := 'salida';
            END IF;
        END IF;

    ELSE
        -- Mapeo manual si el usuario presionó teclas de función
        v_tipo_verif := CASE
            WHEN v_status_clean IN ('4', 'ot_in', 'otin', 'overtime_in', 'extra_in', 'inicio_extra')
                 OR v_status_clean ILIKE '%ot%in%' THEN 'inicio_extra'

            WHEN v_status_clean IN ('5', 'ot_out', 'otout', 'overtime_out', 'extra_out', 'fin_extra')
                 OR v_status_clean ILIKE '%ot%out%' THEN 'fin_extra'

            WHEN v_status_clean IN ('2', 'break_out', 'breakout', 'descanso_inicio')
                 OR v_status_clean ILIKE '%break%out%' THEN 'descanso_inicio'

            WHEN v_status_clean IN ('3', 'break_in', 'breakin', 'descanso_fin')
                 OR v_status_clean ILIKE '%break%in%' THEN 'descanso_fin'

            WHEN v_status_clean IN ('1', 'check_out', 'checkout', 'salida')
                 OR v_status_clean ILIKE '%out%' THEN 'salida'

            WHEN v_status_clean IN ('0', 'check_in', 'checkin', 'entrada')
                 OR v_status_clean ILIKE '%in%' THEN 'entrada'

            ELSE 'entrada'
        END;
    END IF;

    -- 5. Mapeo de método biométrico
    v_metodo := CASE
        WHEN NEW.verify_type IN (15, 25) OR NEW.metodo = 'rostro'  THEN 'rostro'
        WHEN NEW.verify_type = 1         OR NEW.metodo = 'huella'  THEN 'huella'
        WHEN NEW.verify_type = 3         OR NEW.metodo = 'tarjeta' THEN 'tarjeta'
        WHEN NEW.verify_type = 2         OR NEW.metodo = 'pin'     THEN 'pin'
        WHEN NEW.verify_type > 3         OR NEW.metodo = 'combinado' THEN 'combinado'
        ELSE COALESCE(NEW.metodo, 'pin')
    END;

    -- 6. Insertar en registro_asistencia
    INSERT INTO registro_asistencia (
        cliente_id,
        empleado_id,
        dispositivo_id,
        verificado_at,
        tipo_verificacion,
        metodo,
        raw_payload,
        creado_at,
        es_manual,
        notas
    ) VALUES (
        v_empleado.cliente_id,
        v_empleado.id,
        v_device_id,
        NEW.timestamp,
        v_tipo_verif,
        v_metodo,
        jsonb_build_object(
            'device_serial', NEW.device_serial,
            'hardware_user_id', NEW.user_id,
            'raw_status', NEW.status,
            'verify_type', NEW.verify_type,
            'source_log_id', NEW.id,
            'auto_resolved', (v_status_clean IN ('255', '-1', 'auto', 'undefined', ''))
        ),
        NOW(),
        FALSE,
        'Terminal ' || NEW.device_serial || ' [Modo ' || v_tipo_verif || ']'
    );

    RETURN NEW;
END;
$function$;
