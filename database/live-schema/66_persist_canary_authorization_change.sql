-- Phase 66: the only prospective authorization write for the new C canary.
-- Execute only after Phase 65 and a fresh manifest have been reviewed.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;

DO $authorize$
DECLARE
  v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff';
  v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa';
  v_registro uuid := '5707fc4d-833a-48ab-bf49-90f5b30e0174';
  v_assignment uuid := '2984316c-1c93-4f66-853e-349f90b9f82c';
  v_schedule uuid := '5a753368-f019-4230-89e2-79beaa39ff0f';
  v_revision uuid := '09df6a75-e231-4654-ae70-8448bdf2c312';
  v_date date := '2026-09-09';
  v_hash text := '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866';
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') THEN
    RAISE EXCEPTION 'PERSIST_CANARY_AUTHORIZATION_ALREADY_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='ACTIVE') THEN
    RAISE EXCEPTION 'REVISION_RESOLVER_ACTIVE_TENANT_EXISTS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND enabled AND mode='SHADOW') THEN
    RAISE EXCEPTION 'REVISION_RESOLVER_SHADOW_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.registro_asistencia r JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
    WHERE r.id=v_registro AND r.cliente_id=v_tenant AND r.empleado_id=v_employee AND d.timezone='America/Cancun'
  ) THEN RAISE EXCEPTION 'CANARY_REGISTRO_IDENTITY_INVALID'; END IF;
  IF (SELECT count(*) FROM public.empleados_horarios eh WHERE eh.cliente_id=v_tenant AND eh.empleado_id=v_employee AND eh.activo
        AND eh.fecha_inicio<=v_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=v_date)) <> 1 THEN
    RAISE EXCEPTION 'CANARY_APPLICABLE_ASSIGNMENT_NOT_EXACTLY_ONE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.empleados_horarios eh JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id
    WHERE eh.id=v_assignment AND eh.cliente_id=v_tenant AND eh.empleado_id=v_employee AND eh.horario_id=v_schedule AND eh.activo
      AND eh.fecha_inicio<=v_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=v_date) AND eh.schedule_revision_id=v_revision
      AND sr.horario_id=v_schedule AND sr.version=1 AND sr.integrity_hash=v_hash AND public.schedule_revision_calculation_hash(sr.config_snapshot)=v_hash
  ) THEN RAISE EXCEPTION 'CANARY_REVISION_IDENTITY_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date)
     OR EXISTS (SELECT 1 FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) THEN
    RAISE EXCEPTION 'CANARY_LOGICAL_IDENTITY_ALREADY_EXISTS';
  END IF;
  INSERT INTO public.tenant_features(cliente_id,feature_key,mode,enabled,canary_registro_id,canary_empleado_id,canary_schedule_id,canary_workday_date)
  VALUES(v_tenant,'WORKDAY_PERSIST_CANARY','PERSIST_CANARY',true,v_registro,v_employee,v_schedule,v_date);
END
$authorize$;

COMMIT;
