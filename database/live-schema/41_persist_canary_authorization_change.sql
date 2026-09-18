-- Phase 36.2: creates exactly one authorization. Prepared only; do not run until
-- 40_persist_canary_authorization_precheck.sql has passed for this exact state.
BEGIN;

DO $guard$
DECLARE
  v_tenant_feature_rows bigint;
  v_global_feature_rows bigint;
BEGIN
  IF to_regclass('public.tenant_features') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.tenant_features is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.registro_asistencia
    WHERE id = '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid
      AND cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
      AND empleado_id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: approved registro identity is absent or mismatched';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.empleados
    WHERE id = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid
      AND cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
  ) OR NOT EXISTS (
    SELECT 1 FROM public.horarios
    WHERE id = 'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid
      AND cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: approved employee or schedule identity is absent or mismatched';
  END IF;

  LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_tenant_feature_rows
  FROM public.tenant_features
  WHERE cliente_id = '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid
    AND feature_key = 'WORKDAY_PERSIST_CANARY';
  SELECT count(*) INTO v_global_feature_rows
  FROM public.tenant_features
  WHERE feature_key = 'WORKDAY_PERSIST_CANARY';
  IF v_tenant_feature_rows <> 0 OR v_global_feature_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL CLOSED: a WORKDAY_PERSIST_CANARY authorization already exists';
  END IF;
END
$guard$;

INSERT INTO public.tenant_features (
  cliente_id, feature_key, mode, enabled,
  canary_registro_id, canary_empleado_id, canary_schedule_id, canary_workday_date
) VALUES (
  '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid,
  'WORKDAY_PERSIST_CANARY',
  'PERSIST_CANARY',
  true,
  '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid,
  '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid,
  'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid,
  '2026-09-03'::date
);

COMMIT;
