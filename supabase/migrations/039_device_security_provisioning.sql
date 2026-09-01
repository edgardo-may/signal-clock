-- ================================================================
--  SIGNUM-CLOCK · Migración 039 · ZKTeco Provisioning Security
--  Garantiza que un mismo número de serie físico no pueda registrarse 
--  múltiples veces, ignorando mayúsculas y espacios.
--  NOTA: No se modifica public.dispositivos para no afectar la
--        arquitectura legacy de Hikvision.
-- ================================================================

-- Eliminar la restricción no normalizada si existe (de un borrador anterior)
ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS uq_devices_serial_number;

-- Crear índice único funcional normalizado en public.devices
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_serial_number_normalized 
ON public.devices (UPPER(TRIM(serial_number)));
