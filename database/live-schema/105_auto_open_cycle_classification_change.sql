-- Forward-only definition change. No historical attendance updates or backfill.
-- Apply only after 104 and isolated DBREAL pass; never auto-run at application startup.
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Prevent ingestion across the definition change; this is not the runtime cycle lock.
LOCK TABLE public.attendance_logs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
DECLARE v_source text;
BEGIN
    SELECT p.prosrc INTO v_source FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.fn_sync_attendance_to_registro()')
      AND p.prorettype = 'trigger'::regtype AND p.prosecdef
      AND p.provolatile = 'v' AND p.proconfig IS NULL;
    IF v_source IS NULL OR md5(regexp_replace(regexp_replace(v_source, '--[^\n]*', '', 'g'), '[[:space:]]', '', 'g')) <> 'b70db7f79ce614289dbd78ba355e84fb' THEN
        RAISE EXCEPTION 'AUTO_CYCLE_ORIGINAL_FUNCTION_DRIFT';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.attendance_logs'::regclass
          AND t.tgname = 'trg_attendance_to_registro'
          AND t.tgfoid = 'public.fn_sync_attendance_to_registro()'::regprocedure
          AND t.tgtype = 5 AND t.tgenabled = 'O'
          AND t.tgqual IS NULL AND t.tgnargs = 0 AND NOT t.tgisinternal
    ) THEN RAISE EXCEPTION 'AUTO_CYCLE_TRIGGER_DRIFT'; END IF;
END;
$guard$;
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

    v_previous_cycle_type TEXT;
    v_latest_cycle RECORD;
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

    -- 3. Limpiar status de hardware
    v_status_clean := LOWER(TRIM(COALESCE(NEW.status, '')));

    -- AUTO classification: the database is the sole cycle authority.
    IF v_status_clean IN ('255', '-1', 'auto', 'undefined', '') THEN
        -- A fixed transaction snapshot would stay stale after waiting for a lock.
        IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
            RAISE EXCEPTION 'AUTO_CYCLE_REQUIRES_READ_COMMITTED' USING ERRCODE = '40001';
        END IF;

        -- Held until commit/rollback. Independent tenants/employees do not share
        -- an intentional lock. Read the previous event in a SEPARATE statement
        -- after acquisition: a VOLATILE function gets a fresh READ COMMITTED snapshot.
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            'attendance-auto-cycle-v1:' || v_empleado.cliente_id::text || ':' || v_empleado.id::text, 0
        ));

        -- Equal or reverse event-time arrival is rejected explicitly. The
        -- lock serializes writers, but it must not turn an older event that
        -- arrives later into a second false opening of the cycle.
        SELECT r.tipo_verificacion, r.verificado_at
        INTO v_latest_cycle
        FROM public.registro_asistencia r
        WHERE r.cliente_id = v_empleado.cliente_id
          AND r.empleado_id = v_empleado.id
          AND r.tipo_verificacion IN ('entrada', 'salida')
        ORDER BY r.verificado_at DESC, r.creado_at DESC, r.id DESC
        LIMIT 1;

        IF v_latest_cycle.verificado_at >= NEW.timestamp THEN
            RAISE EXCEPTION 'AUTO_CYCLE_OUT_OF_ORDER'
                USING ERRCODE = '22023';
        END IF;

        SELECT r.tipo_verificacion
        INTO v_previous_cycle_type
        FROM public.registro_asistencia r
        WHERE r.cliente_id = v_empleado.cliente_id
          AND r.empleado_id = v_empleado.id
          AND r.tipo_verificacion IN ('entrada', 'salida')
          AND r.verificado_at >= NEW.timestamp - interval '18 hours'
          AND r.verificado_at < NEW.timestamp
        ORDER BY r.verificado_at DESC, r.creado_at DESC, r.id DESC
        LIMIT 1;

        v_tipo_verif := CASE WHEN v_previous_cycle_type = 'entrada'
                            THEN 'salida' ELSE 'entrada' END;

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

COMMIT;
