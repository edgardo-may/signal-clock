-- ================================================================
-- SIGNUM-CLOCK · Migración 023 · Políticas de Sincronización Biométrica
-- Agrega columna biometric_sync_policy a clientes, trigger y políticas RLS
-- ================================================================

-- ── 1. AGREGAR COLUMNA A CLIENTES ─────────────────────────────────────────────
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS biometric_sync_policy TEXT DEFAULT 'PERSONALIZADA'
  CONSTRAINT chk_biometric_sync_policy CHECK (biometric_sync_policy IN ('GLOBAL', 'EMPRESA', 'SUBEMPRESA', 'PERSONALIZADA'));

COMMENT ON COLUMN public.clientes.biometric_sync_policy IS 'Política de sincronización: GLOBAL (todos), EMPRESA (por id_empresa), SUBEMPRESA (sucursal), PERSONALIZADA (manual)';

-- ── 2. FUNCIÓN PARA SINCRONIZAR AUTOMÁTICAMENTE LAS ASIGNACIONES ───────────────
CREATE OR REPLACE FUNCTION public.sync_device_employee_assignments(p_cliente_id UUID)
RETURNS VOID AS $$
DECLARE
  v_policy TEXT;
  v_id_empresa TEXT;
  v_cliente_ids UUID[];
  v_emp_rec RECORD;
  v_dev_rec RECORD;
BEGIN
  -- Obtener la política y el id_empresa del cliente
  SELECT biometric_sync_policy, id_empresa 
    INTO v_policy, v_id_empresa 
    FROM public.clientes 
   WHERE id = p_cliente_id;

  IF v_policy IS NULL OR v_policy = 'PERSONALIZADA' THEN
    RETURN;
  END IF;

  -- Determinar los clientes involucrados en el alcance
  IF v_policy = 'EMPRESA' AND v_id_empresa IS NOT NULL AND v_id_empresa <> '' THEN
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) 
      INTO v_cliente_ids 
      FROM public.clientes 
     WHERE id_empresa = v_id_empresa;
  ELSE
    -- GLOBAL o SUBEMPRESA
    v_cliente_ids := ARRAY[p_cliente_id];
  END IF;

  -- 1. Crear o activar asignaciones para todos los empleados en el alcance
  -- Recorrer todos los empleados activos de los clientes en el alcance
  FOR v_emp_rec IN 
    SELECT id, cliente_id, clave_empleado, hikvision_device_userid 
      FROM public.empleados 
     WHERE cliente_id = ANY(v_cliente_ids) 
       AND activo = TRUE
  LOOP
    -- Recorrer todos los dispositivos de los clientes en el alcance
    FOR v_dev_rec IN
      SELECT d.id, disp.cliente_id AS device_cliente_id
        FROM public.devices d
        JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number
       WHERE disp.cliente_id = ANY(v_cliente_ids)
         AND disp.estatus = 'activo'
         AND d.is_active = TRUE
    LOOP
      -- Insertar o actualizar a activo
      INSERT INTO public.device_employee_assignments (
        cliente_id,
        device_id,
        employee_id,
        biometric_user_id,
        activo,
        sync_status
      )
      VALUES (
        v_dev_rec.device_cliente_id,
        v_dev_rec.id,
        v_emp_rec.id,
        COALESCE(NULLIF(v_emp_rec.clave_empleado, ''), NULLIF(v_emp_rec.hikvision_device_userid, ''), v_emp_rec.id::text),
        TRUE,
        'PENDING'
      )
      ON CONFLICT (device_id, biometric_user_id) 
      DO UPDATE SET 
        activo = TRUE,
        actualizado_at = NOW()
      WHERE public.device_employee_assignments.activo = FALSE;
    END LOOP;
  END LOOP;

  -- 2. Desactivar asignaciones automáticas que ya no aplican (empleado o dispositivo inactivo)
  UPDATE public.device_employee_assignments
     SET activo = FALSE,
         actualizado_at = NOW()
   WHERE cliente_id = ANY(v_cliente_ids)
     AND activo = TRUE
     AND (
       employee_id NOT IN (
         SELECT id FROM public.empleados 
          WHERE cliente_id = ANY(v_cliente_ids) AND activo = TRUE
       )
       OR
       device_id NOT IN (
         SELECT d.id FROM public.devices d
           JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number
          WHERE disp.cliente_id = ANY(v_cliente_ids) AND disp.estatus = 'activo' AND d.is_active = TRUE
       )
     );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. TRIGGERS DE BASE DE DATOS ──────────────────────────────────────────────

-- Trigger para cambios en la política de clientes
CREATE OR REPLACE FUNCTION public.proc_trg_clientes_sync_policy()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND (OLD.biometric_sync_policy IS DISTINCT FROM NEW.biometric_sync_policy OR OLD.id_empresa IS DISTINCT FROM NEW.id_empresa)) THEN
    PERFORM public.sync_device_employee_assignments(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_clientes_sync_policy ON public.clientes;
CREATE TRIGGER trg_clientes_sync_policy
  AFTER UPDATE OF biometric_sync_policy, id_empresa ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.proc_trg_clientes_sync_policy();

-- Trigger para cambios en empleados (altas / bajas / cambios clave)
CREATE OR REPLACE FUNCTION public.proc_trg_empleados_sync_policy()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND (OLD.activo IS DISTINCT FROM NEW.activo OR OLD.clave_empleado IS DISTINCT FROM NEW.clave_empleado)) THEN
    PERFORM public.sync_device_employee_assignments(NEW.cliente_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_empleados_sync_policy ON public.empleados;
CREATE TRIGGER trg_empleados_sync_policy
  AFTER INSERT OR UPDATE OF activo, clave_empleado ON public.empleados
  FOR EACH ROW EXECUTE FUNCTION public.proc_trg_empleados_sync_policy();

-- Trigger para cambios en dispositivos
CREATE OR REPLACE FUNCTION public.proc_trg_dispositivos_sync_policy()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND (OLD.estatus IS DISTINCT FROM NEW.estatus)) THEN
    PERFORM public.sync_device_employee_assignments(NEW.cliente_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_dispositivos_sync_policy ON public.dispositivos;
CREATE TRIGGER trg_dispositivos_sync_policy
  AFTER INSERT OR UPDATE OF estatus ON public.dispositivos
  FOR EACH ROW EXECUTE FUNCTION public.proc_trg_dispositivos_sync_policy();


-- ── 4. ACTUALIZACIÓN DE POLÍTICAS RLS PARA ACCESO CORPORATIVO ────────────────
DROP POLICY IF EXISTS "device_employee_assignments: SELECT propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: SELECT propio"
  ON public.device_employee_assignments FOR SELECT TO authenticated
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.clientes c1
      JOIN public.clientes c2 ON c1.id_empresa = c2.id_empresa
      WHERE c1.id = device_employee_assignments.cliente_id
        AND c2.id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
        AND c1.id_empresa IS NOT NULL
        AND c1.id_empresa <> ''
    )
  );

DROP POLICY IF EXISTS "device_employee_assignments: INSERT propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: INSERT propio"
  ON public.device_employee_assignments FOR INSERT TO authenticated
  WITH CHECK (
    (
      cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.empleados e WHERE e.id = employee_id AND e.cliente_id = device_employee_assignments.cliente_id)
      AND EXISTS (SELECT 1 FROM public.devices d JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number WHERE d.id = device_id AND disp.cliente_id = device_employee_assignments.cliente_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.clientes c1
      JOIN public.clientes c2 ON c1.id_empresa = c2.id_empresa
      WHERE c1.id = device_employee_assignments.cliente_id
        AND c2.id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
        AND c1.id_empresa IS NOT NULL
        AND c1.id_empresa <> ''
        AND EXISTS (SELECT 1 FROM public.empleados e WHERE e.id = employee_id AND e.cliente_id = ANY(SELECT id FROM public.clientes WHERE id_empresa = c1.id_empresa))
        AND EXISTS (SELECT 1 FROM public.devices d JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number WHERE d.id = device_id AND disp.cliente_id = ANY(SELECT id FROM public.clientes WHERE id_empresa = c1.id_empresa))
    )
  );

DROP POLICY IF EXISTS "device_employee_assignments: UPDATE propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: UPDATE propio"
  ON public.device_employee_assignments FOR UPDATE TO authenticated
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.clientes c1
      JOIN public.clientes c2 ON c1.id_empresa = c2.id_empresa
      WHERE c1.id = device_employee_assignments.cliente_id
        AND c2.id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
        AND c1.id_empresa IS NOT NULL
        AND c1.id_empresa <> ''
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.empleados e WHERE e.id = employee_id AND e.cliente_id = device_employee_assignments.cliente_id)
    AND EXISTS (SELECT 1 FROM public.devices d JOIN public.dispositivos disp ON disp.device_id_hikvision = d.serial_number WHERE d.id = device_id AND disp.cliente_id = device_employee_assignments.cliente_id)
  );

DROP POLICY IF EXISTS "device_employee_assignments: DELETE propio" ON public.device_employee_assignments;
CREATE POLICY "device_employee_assignments: DELETE propio"
  ON public.device_employee_assignments FOR DELETE TO authenticated
  USING (
    cliente_id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.clientes c1
      JOIN public.clientes c2 ON c1.id_empresa = c2.id_empresa
      WHERE c1.id = device_employee_assignments.cliente_id
        AND c2.id = (SELECT cliente_id FROM public.usuarios_perfiles WHERE id = auth.uid())
        AND c1.id_empresa IS NOT NULL
        AND c1.id_empresa <> ''
    )
  );
