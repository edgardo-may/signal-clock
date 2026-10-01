BEGIN READ ONLY;
DO $check$
BEGIN
  IF to_regclass('public.workday_calculation_revisions') IS NOT NULL
     OR to_regclass('public.workday_revision_promotions') IS NOT NULL THEN
    RAISE EXCEPTION 'CALCULATION_REVISIONS_ALREADY_INSTALLED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.workday_record_history'::regclass AND conname='workday_record_history_identity_key') THEN
    RAISE EXCEPTION 'HISTORY_HOTFIX_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.workday_records'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (cliente_id, empleado_id, workday_date)') THEN
    RAISE EXCEPTION 'WORKDAY_IDENTITY_MISMATCH';
  END IF;
  IF to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer)') IS NULL THEN
    RAISE EXCEPTION 'WORKDAY_97_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled) THEN
    RAISE EXCEPTION 'PERSIST_GATE_MUST_BE_CLOSED';
  END IF;
END $check$;
ROLLBACK;
