-- ================================================================
-- SIGNUM-CLOCK · Migración 021
-- Extender tabla devices con IP, Puerto, Zona Horaria y Tipo/Propósito
-- ================================================================

-- 1. Agregar columnas a la tabla devices
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS port INTEGER DEFAULT 7660,
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Mexico_City',
  ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'general'
    CHECK (device_type IN ('general', 'entrada', 'salida', 'comedor', 'rh', 'acceso'));

-- 2. Índices de optimización
CREATE INDEX IF NOT EXISTS idx_devices_device_type ON public.devices (device_type);
CREATE INDEX IF NOT EXISTS idx_devices_is_active ON public.devices (is_active);
