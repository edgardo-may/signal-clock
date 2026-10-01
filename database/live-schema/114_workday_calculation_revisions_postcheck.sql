BEGIN READ ONLY;
DO $check$
DECLARE fn record;
BEGIN
  IF to_regclass('public.workday_calculation_revisions') IS NULL OR to_regclass('public.workday_revision_promotions') IS NULL THEN RAISE EXCEPTION 'REVISION_TABLES_MISSING'; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workday_records' AND column_name='current_revision_id' AND is_nullable='YES') THEN RAISE EXCEPTION 'CURRENT_POINTER_MISSING'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('workday_calculation_revision_immutable','workday_promotion_audit_immutable') AND NOT tgisinternal)<>2 THEN RAISE EXCEPTION 'IMMUTABILITY_GUARD_MISSING'; END IF;
  FOR fn IN SELECT oid,prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_workday_revision_candidate','promote_workday_revision') LOOP
    IF fn.prosecdef OR has_function_privilege('anon',fn.oid,'EXECUTE') OR has_function_privilege('authenticated',fn.oid,'EXECUTE') OR NOT has_function_privilege('service_role',fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'REVISION_RPC_SECURITY_MISMATCH'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.workday_records w LEFT JOIN public.workday_calculation_revisions r ON r.id=w.current_revision_id
    WHERE w.current_revision_id IS NOT NULL AND (r.id IS NULL OR r.cliente_id<>w.cliente_id OR r.empleado_id<>w.empleado_id OR r.workday_date<>w.workday_date OR r.snapshot IS DISTINCT FROM public.workday_revision_snapshot(to_jsonb(w)))) THEN RAISE EXCEPTION 'CURRENT_PROJECTION_MISMATCH'; END IF;
END $check$;
ROLLBACK;
