-- Signum Clock: vínculo estructural evento RAW universal -> registro normalizado.
-- PREPARADO, NO APLICADO. Ejecutar solo después de 08, 09 y de capturar la
-- definición instalada de fn_sync_attendance_to_registro().
--
-- No hace backfill por similitud. Conserva raw_payload.source_log_id, los seis
-- WEB_EVENT históricos y los registros manuales con source_event_id = NULL.
--
-- ROLLBACK: antes de COMMIT, ROLLBACK. Después de COMMIT, deshabilitar el código
-- consumidor y conservar la columna/relación para no borrar trazabilidad.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.attendance_source_events') IS NULL THEN
    RAISE EXCEPTION 'attendance_source_events no existe; ejecutar primero el cambio aprobado de la capa RAW universal';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'attendance_source_events'
      AND column_name = 'id'
      AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'attendance_source_events.id no cumple el contrato UUID esperado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'registro_asistencia'
      AND column_name = 'source_event_id'
  ) THEN
    RAISE EXCEPTION 'registro_asistencia.source_event_id ya existe; detener para auditar su contrato real';
  END IF;
END
$$;

ALTER TABLE public.registro_asistencia
  ADD COLUMN source_event_id uuid NULL;

ALTER TABLE public.registro_asistencia
  ADD CONSTRAINT fk_registro_asistencia_source_event
  FOREIGN KEY (source_event_id)
  REFERENCES public.attendance_source_events(id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_registro_asistencia_source_event
  ON public.registro_asistencia (source_event_id)
  WHERE source_event_id IS NOT NULL;

-- POSTCHECK: la historia continúa intacta; no se crean vínculos inferidos.
SELECT
  count(*) AS registro_total,
  count(*) FILTER (WHERE source_event_id IS NOT NULL) AS structured_source_event_links,
  count(*) FILTER (WHERE source_event_id IS NULL) AS historical_or_pending_links,
  count(*) FILTER (WHERE es_manual IS TRUE AND source_event_id IS NOT NULL) AS unexpected_manual_links
FROM public.registro_asistencia;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'registro_asistencia'
  AND indexname = 'uq_registro_asistencia_source_event';

COMMIT;
