-- READ ONLY. Fails closed unless the supplied productive contract matches.
BEGIN READ ONLY;
DO $guard$
DECLARE v_source text;
BEGIN
    SELECT p.prosrc INTO v_source FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.fn_sync_attendance_to_registro()')
      AND p.prorettype = 'trigger'::regtype AND p.prosecdef
      AND p.provolatile = 'v' AND p.proconfig IS NULL;
    IF v_source IS NULL OR md5(regexp_replace(regexp_replace(v_source, '--[^\n]*', '', 'g'), '[[:space:]]', '', 'g')) <> 'b70db7f79ce614289dbd78ba355e84fb' THEN
        RAISE EXCEPTION 'AUTO_CYCLE_ORIGINAL_FUNCTION_DRIFT';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.attendance_logs'::regclass
          AND t.tgname = 'trg_attendance_to_registro'
          AND t.tgfoid = 'public.fn_sync_attendance_to_registro()'::regprocedure
          AND t.tgtype = 5 AND t.tgenabled = 'O'
          AND t.tgqual IS NULL AND t.tgnargs = 0 AND NOT t.tgisinternal
    ) THEN RAISE EXCEPTION 'AUTO_CYCLE_TRIGGER_DRIFT'; END IF;
END;
$guard$;
SELECT 'AUTO_CYCLE_PRECHECK_PASS' AS result;
ROLLBACK;
