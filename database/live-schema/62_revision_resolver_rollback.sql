-- Phase 62: rollback ACTIVE to tenant-scoped SHADOW only. It never touches
-- assignments, revisions, attendance, workday_records, or persistence state.
BEGIN ISOLATION LEVEL REPEATABLE READ;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;

DO $rollback$
DECLARE v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid;
BEGIN
  UPDATE public.tenant_features
  SET mode='SHADOW',enabled=true,updated_at=clock_timestamp()
  WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_RESOLVER_ACTIVE_FLAG_NOT_FOUND'; END IF;
END
$rollback$;

COMMIT;
