-- ================================================================
-- SIGNUM-CLOCK · Migración 017
-- Sistema REAL de Límites de Capacidad, Estatus y Vencimiento por Tenant
-- ================================================================

-- 1. FUNCIÓN DE VALIDACIÓN Y CONTROL DE LÍMITES PARA EMPLEADOS
CREATE OR REPLACE FUNCTION public.fn_validar_limite_empleados_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente RECORD;
  v_conteo_actual INTEGER;
BEGIN
  -- Obtener configuración y límites reales del tenant
  SELECT id, nombre_empresa, plan_suscripcion, limite_empleados, estatus, fecha_vencimiento
  INTO v_cliente
  FROM public.clientes
  WHERE id = NEW.cliente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tenant (cliente_id: %) especificado no existe.', NEW.cliente_id;
  END IF;

  -- 1. Validar estatus del tenant
  IF v_cliente.estatus IN ('suspendido', 'cancelado') THEN
    RAISE EXCEPTION 'Operación denegada: La empresa "%" se encuentra en estatus "%". No se permite el registro de nuevos colaboradores.',
      v_cliente.nombre_empresa, UPPER(v_cliente.estatus);
  END IF;

  -- 2. Validar fecha de vencimiento si existe
  IF v_cliente.fecha_vencimiento IS NOT NULL AND v_cliente.fecha_vencimiento < CURRENT_DATE THEN
    RAISE EXCEPTION 'Operación denegada: La suscripción de la empresa "%" venció el %. Contacte al administrador de Signum-Clock Central para renovar el servicio.',
      v_cliente.nombre_empresa, to_char(v_cliente.fecha_vencimiento, 'DD/MM/YYYY');
  END IF;

  -- 3. Contar empleados actuales de este tenant exclusivo
  SELECT COUNT(*)
  INTO v_conteo_actual
  FROM public.empleados
  WHERE cliente_id = NEW.cliente_id;

  -- 4. Validar límite estricto de colaboradores
  IF v_cliente.limite_empleados IS NOT NULL AND v_conteo_actual >= v_cliente.limite_empleados THEN
    RAISE EXCEPTION 'Has alcanzado el límite de empleados de tu plan. Límite actual: %. Empleados registrados: %. Contacta al administrador de Signum-Clock Central para ampliar tu capacidad.',
      v_cliente.limite_empleados, v_conteo_actual;
  END IF;

  RETURN NEW;
END;
$$;

-- Vincular Trigger a la tabla empleados BEFORE INSERT
DROP TRIGGER IF EXISTS trg_validar_limite_empleados ON public.empleados;
CREATE TRIGGER trg_validar_limite_empleados
  BEFORE INSERT ON public.empleados
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validar_limite_empleados_tenant();


-- 2. FUNCIÓN DE VALIDACIÓN Y CONTROL DE LÍMITES PARA DISPOSITIVOS
CREATE OR REPLACE FUNCTION public.fn_validar_limite_dispositivos_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente RECORD;
  v_conteo_actual INTEGER;
BEGIN
  -- Obtener configuración y límites reales del tenant
  SELECT id, nombre_empresa, plan_suscripcion, limite_dispositivos, estatus, fecha_vencimiento
  INTO v_cliente
  FROM public.clientes
  WHERE id = NEW.cliente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tenant (cliente_id: %) especificado no existe.', NEW.cliente_id;
  END IF;

  -- 1. Validar estatus del tenant
  IF v_cliente.estatus IN ('suspendido', 'cancelado') THEN
    RAISE EXCEPTION 'Operación denegada: La empresa "%" se encuentra en estatus "%". No se permite el registro de nuevos dispositivos.',
      v_cliente.nombre_empresa, UPPER(v_cliente.estatus);
  END IF;

  -- 2. Validar fecha de vencimiento si existe
  IF v_cliente.fecha_vencimiento IS NOT NULL AND v_cliente.fecha_vencimiento < CURRENT_DATE THEN
    RAISE EXCEPTION 'Operación denegada: La suscripción de la empresa "%" venció el %. Contacte al administrador de Signum-Clock Central para renovar el servicio.',
      v_cliente.nombre_empresa, to_char(v_cliente.fecha_vencimiento, 'DD/MM/YYYY');
  END IF;

  -- 3. Contar dispositivos actuales de este tenant exclusivo
  SELECT COUNT(*)
  INTO v_conteo_actual
  FROM public.dispositivos
  WHERE cliente_id = NEW.cliente_id;

  -- 4. Validar límite estricto de dispositivos
  IF v_cliente.limite_dispositivos IS NOT NULL AND v_conteo_actual >= v_cliente.limite_dispositivos THEN
    RAISE EXCEPTION 'Has alcanzado el límite de dispositivos de este tenant. Límite actual: %. Dispositivos registrados: %. Contacta al administrador de Signum-Clock Central para ampliar tu capacidad.',
      v_cliente.limite_dispositivos, v_conteo_actual;
  END IF;

  RETURN NEW;
END;
$$;

-- Vincular Trigger a la tabla dispositivos BEFORE INSERT
DROP TRIGGER IF EXISTS trg_validar_limite_dispositivos ON public.dispositivos;
CREATE TRIGGER trg_validar_limite_dispositivos
  BEFORE INSERT ON public.dispositivos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validar_limite_dispositivos_tenant();


-- 3. FUNCIÓN RPC: CONSULTAR CONSUMO Y CAPACIDAD EN TIEMPO REAL POR TENANT
CREATE OR REPLACE FUNCTION public.fn_obtener_limites_tenant(p_cliente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente RECORD;
  v_empleados_count INTEGER;
  v_dispositivos_count INTEGER;
  v_vencido BOOLEAN;
BEGIN
  SELECT *
  INTO v_cliente
  FROM public.clientes
  WHERE id = p_cliente_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado');
  END IF;

  SELECT COUNT(*) INTO v_empleados_count
  FROM public.empleados
  WHERE cliente_id = p_cliente_id;

  SELECT COUNT(*) INTO v_dispositivos_count
  FROM public.dispositivos
  WHERE cliente_id = p_cliente_id;

  v_vencido := (v_cliente.fecha_vencimiento IS NOT NULL AND v_cliente.fecha_vencimiento < CURRENT_DATE);

  RETURN jsonb_build_object(
    'cliente_id', v_cliente.id,
    'nombre_empresa', v_cliente.nombre_empresa,
    'plan_suscripcion', COALESCE(v_cliente.plan_suscripcion, 'starter'),
    'estatus', v_cliente.estatus,
    'fecha_vencimiento', v_cliente.fecha_vencimiento,
    'vencido', v_vencido,
    'bloqueado', (v_cliente.estatus IN ('suspendido', 'cancelado') OR v_vencido),
    'empleados_actuales', v_empleados_count,
    'limite_empleados', COALESCE(v_cliente.limite_empleados, 50),
    'empleados_disponibles', GREATEST(0, COALESCE(v_cliente.limite_empleados, 50) - v_empleados_count),
    'puede_crear_empleado', (v_cliente.estatus NOT IN ('suspendido', 'cancelado') AND NOT v_vencido AND v_empleados_count < COALESCE(v_cliente.limite_empleados, 50)),
    'dispositivos_actuales', v_dispositivos_count,
    'limite_dispositivos', COALESCE(v_cliente.limite_dispositivos, 5),
    'dispositivos_disponibles', GREATEST(0, COALESCE(v_cliente.limite_dispositivos, 5) - v_dispositivos_count),
    'puede_crear_dispositivo', (v_cliente.estatus NOT IN ('suspendido', 'cancelado') AND NOT v_vencido AND v_dispositivos_count < COALESCE(v_cliente.limite_dispositivos, 5))
  );
END;
$$;

-- 4. FUNCIÓN RPC: CONSULTAR RESUMEN GLOBAL PARA SUPERADMIN (CALCULADO EN VIVO)
CREATE OR REPLACE FUNCTION public.fn_resumen_global_tenants()
RETURNS TABLE (
  id UUID,
  nombre_empresa TEXT,
  rfc VARCHAR,
  plan_suscripcion TEXT,
  estatus TEXT,
  limite_empleados INTEGER,
  limite_dispositivos INTEGER,
  fecha_vencimiento DATE,
  contacto_nombre TEXT,
  contacto_email TEXT,
  contacto_telefono VARCHAR,
  ciudad TEXT,
  estado TEXT,
  pais TEXT,
  direccion TEXT,
  notas TEXT,
  creado_at TIMESTAMPTZ,
  empleados_actuales BIGINT,
  dispositivos_actuales BIGINT,
  vencido BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.nombre_empresa,
    c.rfc,
    COALESCE(c.plan_suscripcion, 'starter') AS plan_suscripcion,
    c.estatus,
    COALESCE(c.limite_empleados, 50) AS limite_empleados,
    COALESCE(c.limite_dispositivos, 5) AS limite_dispositivos,
    c.fecha_vencimiento,
    c.contacto_nombre,
    c.contacto_email,
    c.contacto_telefono,
    c.ciudad,
    c.estado,
    c.pais,
    c.direccion,
    c.notas,
    c.creado_at,
    COALESCE(emp.total, 0) AS empleados_actuales,
    COALESCE(dev.total, 0) AS dispositivos_actuales,
    (c.fecha_vencimiento IS NOT NULL AND c.fecha_vencimiento < CURRENT_DATE) AS vencido
  FROM public.clientes c
  LEFT JOIN (
    SELECT cliente_id, COUNT(*) AS total
    FROM public.empleados
    GROUP BY cliente_id
  ) emp ON emp.cliente_id = c.id
  LEFT JOIN (
    SELECT cliente_id, COUNT(*) AS total
    FROM public.dispositivos
    GROUP BY cliente_id
  ) dev ON dev.cliente_id = c.id
  ORDER BY c.creado_at DESC;
$$;
