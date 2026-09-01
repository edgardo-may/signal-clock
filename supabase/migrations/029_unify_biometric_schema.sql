-- ================================================================
-- SIGNUM-CLOCK · Migración 029
-- Unificar base de datos biométrica y dual protocol
-- ================================================================

-- 1. Renombrar la tabla asistencias a registro_asistencia
ALTER TABLE public.asistencias RENAME TO registro_asistencia;

-- 2. Asegurar que dispositivos tenga los campos universales (ISUP Key, Marca, Num_Serie)
ALTER TABLE public.dispositivos 
  ADD COLUMN IF NOT EXISTS marca TEXT DEFAULT 'zkteco' CHECK (marca IN ('zkteco', 'hikvision')),
  ADD COLUMN IF NOT EXISTS isup_key TEXT,
  ADD COLUMN IF NOT EXISTS numero_serie TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Mexico_City',
  ADD COLUMN IF NOT EXISTS puerto INTEGER;

-- 3. Crear tabla attendance_logs para respaldar marcajes crudos de ZKTeco e ISUP
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    numero_serie TEXT NOT NULL,
    biometric_user_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    verify_type INTEGER,
    in_out_state INTEGER,
    raw_data TEXT,
    creado_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_attendance_log UNIQUE (numero_serie, biometric_user_id, timestamp)
);

-- 4. Crear tabla biometric_templates para enrolar rostros y huellas
CREATE TABLE IF NOT EXISTS public.biometric_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('rostro', 'huella', 'tarjeta', 'pin')),
    indice INTEGER DEFAULT 0, -- ej: 0-9 para los 10 dedos
    template_data TEXT NOT NULL,
    creado_at TIMESTAMPTZ DEFAULT NOW(),
    actualizado_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_biometric_template UNIQUE (empleado_id, tipo, indice)
);

-- 5. Crear tabla device_commands para la cola PUSH (ZKTeco/ISUP)
CREATE TABLE IF NOT EXISTS public.device_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    numero_serie TEXT NOT NULL,
    command_string TEXT NOT NULL,
    is_executed BOOLEAN DEFAULT FALSE,
    executed_at TIMESTAMPTZ,
    return_code TEXT,
    creado_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Trigger para convertir automáticamente attendance_logs a registro_asistencia
CREATE OR REPLACE FUNCTION public.trg_process_attendance_log()
RETURNS TRIGGER AS $$
DECLARE
    v_empleado_id UUID;
    v_dispositivo_id UUID;
BEGIN
    -- Encontrar el dispositivo
    SELECT id INTO v_dispositivo_id FROM public.dispositivos WHERE numero_serie = NEW.numero_serie AND cliente_id = NEW.cliente_id LIMIT 1;
    
    -- Encontrar el empleado (primero intentamos usando la asignación oficial)
    SELECT employee_id INTO v_empleado_id 
    FROM public.device_employee_assignments 
    WHERE device_id = v_dispositivo_id AND biometric_user_id = NEW.biometric_user_id 
    LIMIT 1;

    -- Si no, por fallback buscar hikvision_device_userid en empleados
    IF v_empleado_id IS NULL THEN
        SELECT id INTO v_empleado_id FROM public.empleados WHERE hikvision_device_userid = NEW.biometric_user_id AND cliente_id = NEW.cliente_id LIMIT 1;
    END IF;

    -- Insertar en la tabla limpia
    IF v_empleado_id IS NOT NULL AND v_dispositivo_id IS NOT NULL THEN
        INSERT INTO public.registro_asistencia (
            cliente_id,
            empleado_id, 
            dispositivo_id, 
            verificado_at, 
            tipo_verificacion, 
            metodo
        ) VALUES (
            NEW.cliente_id,
            v_empleado_id, 
            v_dispositivo_id, 
            NEW.timestamp, 
            'entrada', -- El panel o un cron luego pueden deducir si fue salida
            'rostro'   -- Valor default, se puede ajustar
        ) ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_to_registro ON public.attendance_logs;
CREATE TRIGGER trg_attendance_to_registro
AFTER INSERT ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.trg_process_attendance_log();
