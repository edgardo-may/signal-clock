-- Local hotfix precheck. No application data or schema mutation.
BEGIN READ ONLY;
DO $precheck$
BEGIN
  IF to_regclass('public.workday_record_history') IS NULL THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_TABLE_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.workday_record_history'::regclass
      AND c.conname='workday_record_history_identity_key'
      AND c.contype='u' AND c.convalidated
      AND pg_get_constraintdef(c.oid)='UNIQUE (workday_record_id, integrity_hash, action)'
  ) THEN RAISE EXCEPTION 'HISTORY_UNIQUENESS_CONSTRAINT_MISMATCH'; END IF;
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer)') IS NULL THEN
    RAISE EXCEPTION 'HISTORY_UNIQUENESS_RPC_MISSING';
  END IF;
END $precheck$;
COMMIT;
