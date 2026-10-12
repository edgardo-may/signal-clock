-- Separate credential operation; NEVER part of the zero-row structural install.
-- DBREAL validation only until explicitly authorized. Caller owns transaction/rollback.
-- No PIN values, employee IDs or employee names are returned or logged.
DO $conversion$
DECLARE company uuid; expected_new bigint; converted bigint; expected_cleanup bigint; cleaned bigint; missing_credentials bigint;
BEGIN
 IF current_setting('signum.employee_design',true) IS DISTINCT FROM 'DBREAL_ROLLBACK_ONLY'
 THEN RAISE EXCEPTION 'EMPLOYEE_DBREAL_CONTEXT_REQUIRED'; END IF;
 company:=nullif(current_setting('signum.employee_company',true),'')::uuid;
 IF company IS NULL THEN RAISE EXCEPTION 'EXPLICIT_CREDENTIAL_COMPANY_REQUIRED'; END IF;
 IF to_regclass('employee_private.credentials') IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_CREDENTIAL_TABLE_REQUIRED'; END IF;

 -- Lock active employees in the selected company against concurrent PIN changes.
 PERFORM e.id FROM public.empleados e
 WHERE e.cliente_id=company AND e.activo IS TRUE ORDER BY e.id FOR UPDATE;

 -- Employees with an existing private credential keep it unchanged; the
 -- trigger treats that credential as authoritative and only clears old PIN text.
 -- Employees without one need an exact five-digit legacy PIN for safe conversion.
 IF EXISTS(
  SELECT 1 FROM public.empleados e
  LEFT JOIN employee_private.credentials c ON c.empleado_id=e.id
  WHERE e.cliente_id=company AND e.activo IS TRUE AND c.empleado_id IS NULL
    AND nullif(e.pin,'') IS NOT NULL AND e.pin !~ '^[0-9]{5}$'
 ) THEN RAISE EXCEPTION 'LEGACY_PIN_RESET_REQUIRED_INVALID'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.empleados e
  LEFT JOIN employee_private.credentials c ON c.empleado_id=e.id
  WHERE e.cliente_id=company AND e.activo IS TRUE AND c.empleado_id IS NULL
    AND nullif(e.pin,'') IS NULL
 ) THEN RAISE EXCEPTION 'LEGACY_PIN_RESET_REQUIRED_MISSING'; END IF;

 SELECT count(*) INTO expected_new FROM public.empleados e
 WHERE e.cliente_id=company AND e.activo IS TRUE AND e.pin ~ '^[0-9]{5}$'
   AND NOT EXISTS(SELECT 1 FROM employee_private.credentials c WHERE c.empleado_id=e.id);
 SELECT count(*) INTO expected_cleanup FROM public.empleados e
 JOIN employee_private.credentials c ON c.empleado_id=e.id
 WHERE e.cliente_id=company AND e.activo IS TRUE AND nullif(e.pin,'') IS NOT NULL;
 -- For rows without a credential, the BEFORE trigger inserts the bcrypt hash
 -- first and clears NEW.pin only after that insert succeeds. ON CONFLICT is
 -- DO NOTHING, so a concurrent/existing credential is never overwritten.
 UPDATE public.empleados e SET pin=e.pin
 WHERE e.cliente_id=company AND e.activo IS TRUE AND e.pin ~ '^[0-9]{5}$'
   AND NOT EXISTS(SELECT 1 FROM employee_private.credentials c WHERE c.empleado_id=e.id);
 GET DIAGNOSTICS converted=ROW_COUNT;

 SELECT count(*) INTO missing_credentials FROM public.empleados e
 WHERE e.cliente_id=company AND e.activo IS TRUE
   AND NOT EXISTS(SELECT 1 FROM employee_private.credentials c WHERE c.empleado_id=e.id);
 IF converted<>expected_new OR missing_credentials<>0 OR EXISTS(
  SELECT 1 FROM public.empleados e WHERE e.cliente_id=company AND e.activo IS TRUE
    AND NOT EXISTS(SELECT 1 FROM employee_private.credentials c WHERE c.empleado_id=e.id)
 ) THEN RAISE EXCEPTION 'CREDENTIAL_CONVERSION_INCOMPLETE'; END IF;

 -- Clean legacy PIN text separately for employees who already had a new credential.
 UPDATE public.empleados e SET pin=e.pin
 FROM employee_private.credentials c
 WHERE e.cliente_id=company AND e.activo IS TRUE AND c.empleado_id=e.id
   AND nullif(e.pin,'') IS NOT NULL;
 GET DIAGNOSTICS cleaned=ROW_COUNT;
 IF cleaned<>expected_cleanup OR EXISTS(
  SELECT 1 FROM public.empleados e WHERE e.cliente_id=company AND e.activo IS TRUE AND nullif(e.pin,'') IS NOT NULL
 ) THEN RAISE EXCEPTION 'LEGACY_PIN_CLEANUP_INCOMPLETE'; END IF;

 RAISE NOTICE 'New credentials created: %; existing credentials preserved and legacy PINs cleaned: %; active employees without credentials: %; no attendance or Workday rows changed',converted,cleaned,missing_credentials;
END $conversion$;
