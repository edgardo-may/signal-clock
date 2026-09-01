-- ================================================================
--  SIGNUM-CLOCK · Migración 022 · Relación Dispositivos-Empleados
--  Crea la tabla device_employee_assignments con RLS, trigger y deduplicación
-- ================================================================

-- ── 1. CREACIÓN DE LA TABLA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_employee_assignments (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        UUID         NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  device_id         UUID         NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  employee_id       UUID         NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
  biometric_user_id TEXT         NOT NULL,
  activo            BOOLEAN      NOT NULL DEFAULT TRUE,
  sync_status       TEXT         NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'ERROR')),
  last_synced_at    TIMESTAMPTZ  NULL,
  last_attempt_at   TIMESTAMPTZ  NULL,
  last_error        TEXT         NULL,
  retry_count       INTEGER      NOT NULL DEFAULT 0,
  creado_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  actualizado_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  
  -- Unicidad de ID biométrico por dispositivo
  CONSTRAINT uq_device_biometric_user UNIQUE (device_id, biometric_user_id)
);

-- Trigger para actualizado_at
CREATE OR REPLACE TRIGGER trg_device_employee_assignments_updated_at
  BEFORE UPDATE ON public.device_employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índices de Rendimiento
CREATE INDEX IF NOT EXISTS idx_assignments_cliente  ON public.device_employee_assignments (cliente_id);
CREATE INDEX IF NOT EXISTS idx_assignments_employee ON public.device_employee_assignments (employee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_lookup   ON public.device_employee_assignments (device_id, biometric_user_id, activo);

-- ── 2. TRIGGER POSTGRESQL PARA ENCOLAR Y DEDUPLICAR COMANDOS ADMS ──────────
CREATE OR REPLACE FUNCTION public.proc_sync_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  var_serial TEXT;
  var_nombre TEXT;
  var_tarjeta TEXT;
  var_cmd TEXT;
  var_cmd_id UUID;
BEGIN
  -- 1. Obtener el número de serie del biométrico
  SELECT serial_number INTO var_serial FROM public.devices WHERE id = NEW.device_id;
  
  -- 2. Obtener datos del colaborador
  SELECT (nombre || ' ' || apellido), tarjeta 
    INTO var_nombre, var_tarjeta 
    FROM public.empleados 
   WHERE id = NEW.employee_id;

  -- 3. Construir el comando según el estado activo
  IF NEW.activo = TRUE THEN
    var_cmd := 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || 
               E'\tName=' || COALESCE(var_nombre, 'User') || 
               E'\tPri=0' || 
               CASE WHEN var_tarjeta IS NOT NULL AND var_tarjeta <> '' THEN E'\tCardNo=' || var_tarjeta ELSE '' END;
  ELSE
    var_cmd := 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id;
  END IF;

  -- 4. DEDUPLICACIÓN: Eliminar comandos de sincronización idénticos o previos 
  -- que no hayan sido ejecutados por esta terminal para evitar saturar la cola.
  DELETE FROM public.device_commands
   WHERE device_serial = var_serial
     AND is_executed = FALSE
     AND (command_string LIKE 'DATA UPDATE USERINFO Pin=' || NEW.biometric_user_id || '%'
          OR command_string LIKE 'DATA DELETE USERINFO Pin=' || NEW.biometric_user_id || '%');

  -- 5. Insertar el nuevo comando en la cola
  var_cmd_id := gen_random_uuid();
  INSERT INTO public.device_commands (id, device_serial, command_string, is_executed)
  VALUES (var_cmd_id, var_serial, var_cmd, FALSE);

  -- 6. Reiniciar estados de sincronización
  NEW.sync_status := 'PENDING';
  NEW.last_error := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para inserción y actualización de asignaciones
CREATE OR REPLACE TRIGGER trg_sync_employee_assignment
  BEFORE INSERT OR UPDATE OF activo, biometric_user_id ON public.device_employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.proc_sync_employee_assignment();

-- ── 3. SEGURIDAD Y AISLAMIENTO POR TENANT (RLS) ─────────────────────────────
ALTER TABLE public.device_employee_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_employee_assignments: SELECT propio"
  ON public.device_employee_assignments FOR SELECT TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));

CREATE POLICY "device_employee_assignments: INSERT propio"
  ON public.device_employee_assignments FOR INSERT TO authenticated
  WITH CHECK (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.empleados e WHERE e.id = employee_id AND e.cliente_id = device_employee_assignments.cliente_id)
    AND EXISTS (SELECT 1 FROM public.devices d JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number WHERE d.id = device_id AND disp.cliente_id = device_employee_assignments.cliente_id)
  );

CREATE POLICY "device_employee_assignments: UPDATE propio"
  ON public.device_employee_assignments FOR UPDATE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.empleados e WHERE e.id = employee_id AND e.cliente_id = device_employee_assignments.cliente_id)
    AND EXISTS (SELECT 1 FROM public.devices d JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number WHERE d.id = device_id AND disp.cliente_id = device_employee_assignments.cliente_id)
  );

CREATE POLICY "device_employee_assignments: DELETE propio"
  ON public.device_employee_assignments FOR DELETE TO authenticated
  USING (cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid()));
