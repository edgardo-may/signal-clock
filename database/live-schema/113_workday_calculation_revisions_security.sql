BEGIN;
REVOKE ALL ON public.workday_calculation_revisions,public.workday_revision_promotions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.workday_calculation_revisions,public.workday_revision_promotions TO service_role;
DO $security$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT oid::regprocedure signature,proname,pronargs FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname=ANY(ARRAY['workday_manifest_fingerprint','workday_revision_snapshot','live_workday_evidence_manifest','validate_workday_revision_manifests','store_workday_calculation_revision','create_workday_revision_candidate','promote_workday_revision','reject_workday_revision_mutation','upsert_workday_record']) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn.signature);
    IF fn.proname<>'upsert_workday_record' OR fn.pronargs IN (18,20) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);
    END IF;
  END LOOP;
END $security$;
COMMIT;
