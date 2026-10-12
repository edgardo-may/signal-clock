-- Separate credential operation, NEVER part of the zero-row structural install.
-- DBREAL only; caller owns transaction and rollback. No PIN values are returned.
DO $conversion$
DECLARE company uuid; expected bigint; converted bigint;
BEGIN
 IF current_setting('signum.employee_design',true) IS DISTINCT FROM 'DBREAL_ROLLBACK_ONLY'
 THEN RAISE EXCEPTION 'EMPLOYEE_DBREAL_CONTEXT_REQUIRED'; END IF;
 company:=nullif(current_setting('signum.employee_company',true),'')::uuid;
 IF company IS NULL THEN RAISE EXCEPTION 'EXPLICIT_CREDENTIAL_COMPANY_REQUIRED'; END IF;
 PERFORM id FROM public.empleados WHERE cliente_id=company ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.empleados WHERE cliente_id=company AND nullif(pin,'') IS NOT NULL AND pin !~ '^[0-9]{5}$')
 THEN RAISE EXCEPTION 'LEGACY_PIN_RESET_REQUIRED'; END IF;
 SELECT count(*) INTO expected FROM public.empleados WHERE cliente_id=company AND nullif(pin,'') IS NOT NULL;
 UPDATE public.empleados SET pin=pin WHERE cliente_id=company AND nullif(pin,'') IS NOT NULL;
 GET DIAGNOSTICS converted=ROW_COUNT;
 IF converted<>expected OR EXISTS(SELECT 1 FROM public.empleados WHERE cliente_id=company AND nullif(pin,'') IS NOT NULL)
 THEN RAISE EXCEPTION 'CREDENTIAL_CONVERSION_INCOMPLETE'; END IF;
 RAISE NOTICE 'Credential conversion rows: %; no attendance or Workday rows changed',converted;
END $conversion$;
