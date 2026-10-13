-- Display-only numbers. UUID primary keys and every existing relationship remain unchanged.
-- Independent sequences for biometrics (devices) and schedules (horarios).
BEGIN;

ALTER TABLE public.devices ADD COLUMN folio bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.devices ADD CONSTRAINT devices_folio_unique UNIQUE (folio);
ALTER TABLE public.horarios ADD COLUMN folio bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.horarios ADD CONSTRAINT horarios_folio_unique UNIQUE (folio);

CREATE FUNCTION public.reject_catalog_folio_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.folio IS DISTINCT FROM OLD.folio THEN
    RAISE EXCEPTION 'CATALOG_FOLIO_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.reject_catalog_folio_change() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER devices_folio_immutable BEFORE UPDATE OF folio ON public.devices
FOR EACH ROW EXECUTE FUNCTION public.reject_catalog_folio_change();
CREATE TRIGGER horarios_folio_immutable BEFORE UPDATE OF folio ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.reject_catalog_folio_change();

REVOKE ALL ON SEQUENCE public.devices_folio_seq,public.horarios_folio_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.devices_folio_seq,public.horarios_folio_seq TO service_role;

COMMENT ON COLUMN public.devices.folio IS 'Display-only immutable numeric folio; devices.id UUID is the official relational identity. Gaps are normal.';
COMMENT ON COLUMN public.horarios.folio IS 'Display-only immutable numeric folio; horarios.id UUID is the official relational identity. Gaps are normal.';

NOTIFY pgrst,'reload schema';
COMMIT;
