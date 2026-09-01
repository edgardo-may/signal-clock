-- ================================================================
-- SIGNUM-CLOCK · Migración 020
-- Agregar campo id_empresa a la tabla clientes y actualizar RPC
-- ================================================================

-- 1. Agregar columna id_empresa a la tabla clientes
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS id_empresa VARCHAR(50);

-- 2. Crear índice para búsquedas rápidas por id_empresa
CREATE INDEX IF NOT EXISTS idx_clientes_id_empresa ON public.clientes(id_empresa);

-- 3. Actualizar función RPC fn_resumen_global_tenants
DROP FUNCTION IF EXISTS public.fn_resumen_global_tenants();
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
  vencido BOOLEAN,
  id_empresa VARCHAR
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
    (c.fecha_vencimiento IS NOT NULL AND c.fecha_vencimiento < CURRENT_DATE) AS vencido,
    c.id_empresa
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
