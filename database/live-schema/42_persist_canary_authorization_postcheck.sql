-- Phase 36.2: read-only authorization scope audit.
BEGIN TRANSACTION READ ONLY;

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
    (SELECT count(*) FROM public.tenant_features feature, expected e
      WHERE feature.feature_key = e.feature_key) AS global_feature_rows,
    (SELECT count(*) FROM public.tenant_features feature, expected e
      WHERE feature.cliente_id = e.cliente_id
        AND feature.feature_key = e.feature_key
        AND feature.mode = 'PERSIST_CANARY'
        AND feature.enabled = true
        AND feature.canary_registro_id = e.registro_id
        AND feature.canary_empleado_id = e.empleado_id
        AND feature.canary_schedule_id = e.schedule_id
        AND feature.canary_workday_date = e.workday_date) AS exact_authorization_rows
)
SELECT jsonb_build_object(
  'phase', '36_2_persist_canary_authorization_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'global_feature_rows', global_feature_rows,
  'exact_authorization_rows', exact_authorization_rows,
  'no_extra_scope', global_feature_rows = 1,
  'postcheck_pass', global_feature_rows = 1 AND exact_authorization_rows = 1
) AS persist_canary_authorization_postcheck
FROM state;

ROLLBACK;
