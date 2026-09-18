-- Phase 36.2: read-only precheck before creating the sole canary authorization.
BEGIN TRANSACTION READ ONLY;

DO $guard$
BEGIN
  IF to_regclass('public.tenant_features') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.tenant_features is absent';
  END IF;
  IF to_regclass('public.registro_asistencia') IS NULL
     OR to_regclass('public.empleados') IS NULL
     OR to_regclass('public.horarios') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: required canary identity relation is absent';
  END IF;
END
$guard$;

WITH expected AS (
  SELECT
    '7f99cef9-4100-48ff-9aaf-68548c80c948'::uuid AS registro_id,
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    'be4035c8-042c-473b-b25d-b5bf3fb99701'::uuid AS schedule_id,
    '2026-09-03'::date AS workday_date,
    'WORKDAY_PERSIST_CANARY'::text AS feature_key
), state AS (
  SELECT
    EXISTS (SELECT 1 FROM public.registro_asistencia r, expected e
      WHERE r.id = e.registro_id AND r.cliente_id = e.cliente_id AND r.empleado_id = e.empleado_id) AS registro_exact,
    EXISTS (SELECT 1 FROM public.empleados employee, expected e
      WHERE employee.id = e.empleado_id AND employee.cliente_id = e.cliente_id) AS empleado_exact,
    EXISTS (SELECT 1 FROM public.horarios schedule, expected e
      WHERE schedule.id = e.schedule_id AND schedule.cliente_id = e.cliente_id) AS schedule_exact,
    (SELECT count(*) FROM public.tenant_features feature, expected e
      WHERE feature.cliente_id = e.cliente_id AND feature.feature_key = e.feature_key) AS tenant_feature_rows,
    (SELECT count(*) FROM public.tenant_features feature, expected e
      WHERE feature.feature_key = e.feature_key) AS global_feature_rows
)
SELECT jsonb_build_object(
  'phase', '36_2_persist_canary_authorization_precheck',
  'read_only', current_setting('transaction_read_only'),
  'candidate_exact', registro_exact AND empleado_exact AND schedule_exact,
  'tenant_feature_rows', tenant_feature_rows,
  'global_feature_rows', global_feature_rows,
  'authorization_conflict_exists', tenant_feature_rows <> 0 OR global_feature_rows <> 0,
  'safe_to_apply_authorization', registro_exact AND empleado_exact AND schedule_exact
    AND tenant_feature_rows = 0 AND global_feature_rows = 0
) AS persist_canary_authorization_precheck
FROM state;

ROLLBACK;
