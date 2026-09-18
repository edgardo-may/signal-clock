-- Phase 60: prospective pilot SHADOW flag only. Do not execute before a
-- deployed backend entrypoint explicitly enforces REVISION_SCHEDULE_RESOLVER.
BEGIN ISOLATION LEVEL REPEATABLE READ;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;

DO $activation$
DECLARE
  v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid;
  v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid;
  v_assignment uuid := '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid;
  v_schedule uuid := '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid;
  v_revision uuid := '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid;
  v_hash text := '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866';
  v_mode text;
  v_enabled boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.empleados_horarios eh JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id
    WHERE eh.id=v_assignment AND eh.cliente_id=v_tenant AND eh.empleado_id=v_employee AND eh.horario_id=v_schedule
      AND eh.activo IS TRUE AND eh.schedule_revision_id=v_revision AND sr.version=1 AND sr.integrity_hash=v_hash
      AND public.schedule_revision_calculation_hash(sr.config_snapshot)=v_hash
  ) THEN RAISE EXCEPTION 'REVISION_RESOLVER_SHADOW_PRECHECK_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled) THEN
    RAISE EXCEPTION 'REVISION_RESOLVER_OTHER_ACTIVE_TENANT_EXISTS';
  END IF;
  SELECT mode,enabled INTO v_mode,v_enabled FROM public.tenant_features
  WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' FOR UPDATE;
  IF FOUND AND (v_mode IS DISTINCT FROM 'OFF' OR v_enabled IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'REVISION_RESOLVER_FLAG_REBIND_REQUIRED';
  END IF;
  INSERT INTO public.tenant_features(cliente_id,feature_key,mode,enabled)
  VALUES(v_tenant,'REVISION_SCHEDULE_RESOLVER','SHADOW',true)
  ON CONFLICT (cliente_id,feature_key) DO UPDATE SET mode='SHADOW',enabled=true,
    updated_at=clock_timestamp();
END
$activation$;

COMMIT;
