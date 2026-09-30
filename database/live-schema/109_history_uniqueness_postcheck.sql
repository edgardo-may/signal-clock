-- Read-only postcheck; exact catalog preservation is also checked by the local runner.
BEGIN READ ONLY;
DO $postcheck$
DECLARE rpc regprocedure := to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer)');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.workday_record_history'::regclass AND conname='workday_record_history_identity_key') THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_DEFECTIVE_CONSTRAINT_PRESENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.workday_record_history'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_PRIMARY_KEY_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.workday_record_history'::regclass AND contype='f' AND conname='workday_record_history_workday_record_id_fkey' AND convalidated) THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_FOREIGN_KEY_MISSING';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.workday_record_history'::regclass AND contype='c' AND convalidated AND conname IN ('workday_record_history_action_check','workday_record_history_version_check','workday_record_history_source_event_count_check'))<>3 THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_CHECK_CONSTRAINT_MISSING';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.workday_record_history'::regclass) THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_RLS_MISSING';
  END IF;
  IF rpc IS NULL OR NOT has_function_privilege('service_role',rpc,'EXECUTE')
    OR has_function_privilege('anon',rpc,'EXECUTE') OR has_function_privilege('authenticated',rpc,'EXECUTE') THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_RPC_SECURITY_MISMATCH';
  END IF;
END $postcheck$;
COMMIT;
