-- Emergency authorization rollback: it never changes resolver, outbox facts,
-- workday_records, or history. Existing leased work must still be denied by
-- the runtime/RPC gate after this commit.
BEGIN ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
DO $rows$ DECLARE v_rows bigint; BEGIN
  DELETE FROM public.tenant_features WHERE cliente_id='69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AND feature_key='WORKDAY_PERSIST_ACTIVE' AND mode='PERSIST_ACTIVE' AND enabled AND canary_registro_id IS NULL AND canary_empleado_id IS NULL AND canary_schedule_id IS NULL AND canary_workday_date IS NULL;
  GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'PRODUCTIVE_PERSIST_ROLLBACK_ROW_COUNT_INVALID:%',v_rows; END IF;
END $rows$;
COMMIT;
