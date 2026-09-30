-- History identity is its existing primary key, not the calculated snapshot hash.
-- Replay/no-op protection remains entirely in the unchanged Phase 97 RPC.
BEGIN;
LOCK TABLE public.workday_record_history IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.workday_record_history'::regclass
      AND c.conname='workday_record_history_identity_key'
      AND c.contype='u' AND c.convalidated
      AND pg_get_constraintdef(c.oid)='UNIQUE (workday_record_id, integrity_hash, action)'
  ) THEN RAISE EXCEPTION 'HISTORY_UNIQUENESS_CONSTRAINT_MISMATCH'; END IF;
END $guard$;
ALTER TABLE public.workday_record_history
  DROP CONSTRAINT workday_record_history_identity_key;
COMMIT;
