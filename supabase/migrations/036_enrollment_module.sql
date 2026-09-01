-- ============================================================================
-- SIGNUM-CLOCK · Migración 036
-- Registro del módulo de Enrolamiento de forma independiente a Biométricos.
-- ============================================================================

-- 1. Insertar el módulo en el catálogo
INSERT INTO public.module_catalog (module_key, label, description, module_group, sort_order)
VALUES
  ('enrollment', 'Enrolamiento', 'Registro biométrico de rostros y huellas.', 'Dispositivos', 95)
ON CONFLICT (module_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    module_group = EXCLUDED.module_group,
    sort_order = EXCLUDED.sort_order,
    actualizado_at = NOW();

-- 2. Habilitar el módulo para todos los tenants existentes que tengan Biométricos habilitado
--    o habilitarlo por defecto para que no pierdan acceso.
INSERT INTO public.cliente_modulos (cliente_id, module_key, habilitado)
SELECT
  c.id         AS cliente_id,
  'enrollment' AS module_key,
  TRUE         AS habilitado
FROM
  public.clientes c
ON CONFLICT (cliente_id, module_key) DO NOTHING;
