-- ================================================================
-- SIGNUM-CLOCK · Migración 018
-- Acceso Seguro de Métricas Globales para SuperAdmin y RLS
-- ================================================================

-- 1. FUNCIÓN DE IDENTIFICACIÓN DE SUPERADMIN
CREATE OR REPLACE FUNCTION public.auth_is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios_perfiles
    WHERE id = auth.uid()
      AND LOWER(rol) = 'superadmin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_is_superadmin() TO authenticated, service_role;


-- 2. POLÍTICA RLS PARA LECTURA DE EMPLEADOS Y DISPOSITIVOS POR SUPERADMIN
-- Los usuarios regulares siguen viendo SOLO su tenant (cliente_id = auth_cliente_id()).
-- El SuperAdmin puede leer todos los tenants para calcular métricas y consumo global.

DROP POLICY IF EXISTS "empleados: SELECT" ON public.empleados;
CREATE POLICY "empleados: SELECT"
  ON public.empleados FOR SELECT TO authenticated
  USING (
    cliente_id = public.auth_cliente_id()
    OR public.auth_is_superadmin()
  );

DROP POLICY IF EXISTS "dispositivos: SELECT" ON public.dispositivos;
CREATE POLICY "dispositivos: SELECT"
  ON public.dispositivos FOR SELECT TO authenticated
  USING (
    cliente_id = public.auth_cliente_id()
    OR public.auth_is_superadmin()
  );


-- 3. RPC: RESUMEN GLOBAL SEGURO PARA DASHBOARD MASTER SUPERADMIN
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar que solo el superadmin pueda ejecutar este RPC
  IF NOT public.auth_is_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: Se requiere rol de SuperAdmin para consultar el resumen global.';
  END IF;

  RETURN QUERY
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
    COALESCE(emp.total, 0::BIGINT) AS empleados_actuales,
    COALESCE(dev.total, 0::BIGINT) AS dispositivos_actuales,
    (c.fecha_vencimiento IS NOT NULL AND c.fecha_vencimiento < CURRENT_DATE) AS vencido
  FROM public.clientes c
  LEFT JOIN (
    SELECT cliente_id, COUNT(*)::BIGINT AS total
    FROM public.empleados
    GROUP BY cliente_id
  ) emp ON emp.cliente_id = c.id
  LEFT JOIN (
    SELECT cliente_id, COUNT(*)::BIGINT AS total
    FROM public.dispositivos
    GROUP BY cliente_id
  ) dev ON dev.cliente_id = c.id
  ORDER BY c.creado_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_resumen_global_tenants() TO authenticated, service_role;
