-- Phase 64: read-only verification immediately after a human-approved Phase 60
-- SHADOW transition. It does not authorize ACTIVE or any persistence behavior.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AS assignment_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AS horario_id,
    '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid AS revision_id,
    '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text AS integrity_hash,
    'REVISION_SCHEDULE_RESOLVER'::text AS feature_key
), target AS (
  SELECT eh.*,sr.version,sr.config_snapshot,sr.integrity_hash
  FROM expected e
  LEFT JOIN public.empleados_horarios eh ON eh.id=e.assignment_id AND eh.cliente_id=e.cliente_id
  LEFT JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id
), features AS (
  SELECT f.cliente_id,f.feature_key,f.mode,f.enabled
  FROM public.tenant_features f CROSS JOIN expected e WHERE f.feature_key=e.feature_key
)
SELECT jsonb_build_object(
  'phase','64_revision_resolver_shadow_postcheck',
  'read_only',current_setting('transaction_read_only'),
  'pilot_feature',COALESCE((SELECT jsonb_agg(jsonb_build_object('mode',f.mode,'enabled',f.enabled)) FROM features f CROSS JOIN expected e WHERE f.cliente_id=e.cliente_id),'[]'::jsonb),
  'active_tenants',COALESCE((SELECT jsonb_agg(f.cliente_id) FROM features f WHERE f.mode='ACTIVE' AND f.enabled),'[]'::jsonb),
  'c_revision',jsonb_build_object('assignment_id',t.id,'revision_id',t.schedule_revision_id,'version',t.version,'integrity_hash',t.integrity_hash,'db_hash',public.schedule_revision_calculation_hash(t.config_snapshot)),
  'shadow_postcheck_pass',
    EXISTS(SELECT 1 FROM features f CROSS JOIN expected e WHERE f.cliente_id=e.cliente_id AND f.mode='SHADOW' AND f.enabled)
    AND NOT EXISTS(SELECT 1 FROM features f WHERE f.mode='ACTIVE' AND f.enabled)
    AND t.id=e.assignment_id AND t.cliente_id=e.cliente_id AND t.empleado_id=e.empleado_id AND t.horario_id=e.horario_id
    AND t.schedule_revision_id=e.revision_id AND t.version=1 AND t.integrity_hash=e.integrity_hash
    AND public.schedule_revision_calculation_hash(t.config_snapshot)=e.integrity_hash
) AS revision_resolver_shadow_postcheck
FROM expected e CROSS JOIN target t;

ROLLBACK;
