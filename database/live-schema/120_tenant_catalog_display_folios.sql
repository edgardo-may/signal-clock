-- Display identity is now (cliente_id, catalog, folio). UUID remains the official PK.
-- Requires 119. Renumbers existing display folios within each company, ordered by
-- their previous folio then UUID. No UUID, tenant, configuration or relationship changes.
BEGIN;
LOCK TABLE public.devices,public.horarios IN ACCESS EXCLUSIVE MODE;

CREATE TABLE public.tenant_catalog_folio_counters (
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  catalog text NOT NULL CHECK (catalog IN ('devices','horarios')),
  last_value bigint NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (cliente_id,catalog)
);
ALTER TABLE public.tenant_catalog_folio_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_catalog_folio_counters FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.devices ALTER COLUMN folio DROP IDENTITY;
ALTER TABLE public.horarios ALTER COLUMN folio DROP IDENTITY;
ALTER TABLE public.devices DROP CONSTRAINT devices_folio_unique;
ALTER TABLE public.horarios DROP CONSTRAINT horarios_folio_unique;

-- Only the display-field immutability guards are temporarily suspended under the lock.
-- Audit, tenant integrity and all other triggers remain enabled.
ALTER TABLE public.devices DISABLE TRIGGER devices_folio_immutable;
ALTER TABLE public.horarios DISABLE TRIGGER horarios_folio_immutable;
WITH numbered AS (
  SELECT id,row_number() OVER (PARTITION BY cliente_id ORDER BY folio,id) n FROM public.devices
) UPDATE public.devices d SET folio=n.n FROM numbered n WHERE d.id=n.id AND d.folio IS DISTINCT FROM n.n;
WITH numbered AS (
  SELECT id,row_number() OVER (PARTITION BY cliente_id ORDER BY folio,id) n FROM public.horarios
) UPDATE public.horarios h SET folio=n.n FROM numbered n WHERE h.id=n.id AND h.folio IS DISTINCT FROM n.n;
ALTER TABLE public.devices ENABLE TRIGGER devices_folio_immutable;
ALTER TABLE public.horarios ENABLE TRIGGER horarios_folio_immutable;

ALTER TABLE public.devices ADD CONSTRAINT devices_tenant_folio_unique UNIQUE(cliente_id,folio);
ALTER TABLE public.horarios ADD CONSTRAINT horarios_tenant_folio_unique UNIQUE(cliente_id,folio);

INSERT INTO public.tenant_catalog_folio_counters(cliente_id,catalog,last_value)
SELECT cliente_id,'devices',max(folio) FROM public.devices GROUP BY cliente_id
UNION ALL
SELECT cliente_id,'horarios',max(folio) FROM public.horarios GROUP BY cliente_id;

CREATE FUNCTION public.assign_tenant_catalog_folio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN ('devices','horarios')
     OR NEW.cliente_id IS NULL THEN
    RAISE EXCEPTION 'CATALOG_FOLIO_INVALID_SCOPE';
  END IF;
  IF NEW.folio IS NOT NULL THEN
    RAISE EXCEPTION 'CATALOG_FOLIO_SERVER_ASSIGNED';
  END IF;
  INSERT INTO public.tenant_catalog_folio_counters AS counter(cliente_id,catalog,last_value)
  VALUES(NEW.cliente_id,TG_TABLE_NAME,1)
  ON CONFLICT(cliente_id,catalog) DO UPDATE SET last_value=counter.last_value+1
  RETURNING last_value INTO NEW.folio;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_tenant_catalog_folio() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER devices_assign_tenant_folio BEFORE INSERT ON public.devices
FOR EACH ROW EXECUTE FUNCTION public.assign_tenant_catalog_folio();
CREATE TRIGGER horarios_assign_tenant_folio BEFORE INSERT ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.assign_tenant_catalog_folio();

COMMENT ON COLUMN public.devices.folio IS 'Immutable display-only number scoped to this tenant and devices catalog. Official relational identity remains devices.id UUID.';
COMMENT ON COLUMN public.horarios.folio IS 'Immutable display-only number scoped to this tenant and horarios catalog. Official relational identity remains horarios.id UUID.';
NOTIFY pgrst,'reload schema';
COMMIT;
