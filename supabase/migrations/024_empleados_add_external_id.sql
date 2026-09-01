-- ================================================================
--  SIGNUM-CLOCK · Migración 024 · external_id para sincronización Consolide
--
--  Agrega el campo external_id a la tabla empleados para identificar
--  colaboradores sincronizados desde la API externa Consolide.
--
--  trab_ID en Consolide → external_id en empleados (por tenant)
--  La unicidad es por (cliente_id, external_id) — idempotente con
--  partial unique index (solo cuando external_id IS NOT NULL).
-- ================================================================

DO $$
BEGIN
  -- 1. Agregar columna external_id si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'external_id'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN external_id TEXT;
    COMMENT ON COLUMN public.empleados.external_id
      IS 'ID externo del colaborador en sistema Consolide (trab_ID). NULL para empleados locales.';
  END IF;

  -- 2. Agregar columna apellido_materno si no existe (para sincronización)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'apellido_materno'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN apellido_materno TEXT;
    COMMENT ON COLUMN public.empleados.apellido_materno
      IS 'Apellido materno separado (obtenido de sync con Consolide).';
  END IF;

  -- 3. Agregar columna curp si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'curp'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN curp TEXT;
    COMMENT ON COLUMN public.empleados.curp
      IS 'CURP del colaborador (obtenido de sync con Consolide).';
  END IF;

  -- 4. Agregar columna rfc si no existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'rfc'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN rfc TEXT;
    COMMENT ON COLUMN public.empleados.rfc
      IS 'RFC del colaborador (obtenido de sync con Consolide).';
  END IF;

  -- 5. Agregar campo external_source para saber la fuente
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'empleados'
       AND column_name  = 'external_source'
  ) THEN
    ALTER TABLE public.empleados ADD COLUMN external_source TEXT DEFAULT NULL;
    COMMENT ON COLUMN public.empleados.external_source
      IS 'Fuente externa de sincronización (ej: "consolide"). NULL para empleados locales.';
  END IF;
END;
$$;

-- Partial unique index: dentro del mismo tenant, no puede haber
-- dos empleados con el mismo external_id (solo aplica si external_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_cliente_external_id
  ON public.empleados (cliente_id, external_id)
  WHERE external_id IS NOT NULL;

-- Índice de búsqueda por external_id
CREATE INDEX IF NOT EXISTS idx_empleados_external_id
  ON public.empleados (external_id)
  WHERE external_id IS NOT NULL;
