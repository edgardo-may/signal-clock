-- Phase 65: read-only readiness for the NEW revision-based V3 persist canary.
-- This is not an authorization and never writes tenant_features, attendance,
-- workday records, history, incidents, or source data.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    '5707fc4d-833a-48ab-bf49-90f5b30e0174'::uuid AS registro_id,
    '69095bd5-fee5-4237-a1a4-186dd88310ff'::uuid AS cliente_id,
    '6c94a683-1fbd-4427-af9e-8ea154ea50fa'::uuid AS empleado_id,
    '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AS assignment_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AS schedule_id,
    '2026-09-09'::date AS operative_date,
    'America/Cancun'::text AS timezone,
    '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid AS revision_id,
    1::integer AS revision_version,
    '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text AS revision_hash,
    3::integer AS calculation_version,
    'REVISION_SCHEDULE_RESOLVER'::text AS revision_feature_key,
    'WORKDAY_PERSIST_CANARY'::text AS persist_feature_key
), rpc AS (
  SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS fingerprint
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)')
), target AS (
  SELECT r.id AS registro_id, r.cliente_id AS registro_cliente_id, r.empleado_id AS registro_empleado_id,
    d.id AS device_id, d.cliente_id AS device_cliente_id, d.timezone AS device_timezone,
    eh.id AS assignment_id, eh.cliente_id AS assignment_cliente_id, eh.empleado_id AS assignment_empleado_id,
    eh.horario_id, eh.schedule_revision_id, eh.fecha_inicio, eh.fecha_fin, eh.activo,
    sr.cliente_id AS revision_cliente_id, sr.horario_id AS revision_horario_id, sr.version AS revision_version,
    sr.integrity_hash AS revision_integrity_hash, sr.config_snapshot
  FROM expected e
  LEFT JOIN public.registro_asistencia r ON r.id=e.registro_id
  LEFT JOIN public.devices d ON d.id=r.dispositivo_id AND d.cliente_id=r.cliente_id
  LEFT JOIN public.empleados_horarios eh ON eh.id=e.assignment_id AND eh.cliente_id=e.cliente_id
  LEFT JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id
), state AS (
  SELECT
    (SELECT count(*) FROM public.empleados_horarios eh, expected e
      WHERE eh.cliente_id=e.cliente_id AND eh.empleado_id=e.empleado_id AND eh.activo IS TRUE
        AND eh.fecha_inicio<=e.operative_date AND (eh.fecha_fin IS NULL OR eh.fecha_fin>=e.operative_date)) AS applicable_assignment_count,
    (SELECT count(*) FROM public.tenant_features f, expected e
      WHERE f.cliente_id=e.cliente_id AND f.feature_key=e.revision_feature_key AND f.enabled IS TRUE AND f.mode='SHADOW') AS revision_shadow_rows,
    (SELECT count(*) FROM public.tenant_features f, expected e
      WHERE f.feature_key=e.revision_feature_key AND f.enabled IS TRUE AND f.mode='ACTIVE') AS active_tenant_count,
    (SELECT count(*) FROM public.tenant_features f, expected e WHERE f.feature_key=e.persist_feature_key) AS persist_authorization_rows,
    (SELECT count(*) FROM public.workday_records w, expected e
      WHERE w.cliente_id=e.cliente_id AND w.empleado_id=e.empleado_id AND w.workday_date=e.operative_date) AS target_workday_rows,
    (SELECT count(*) FROM public.workday_record_history h, expected e
      WHERE h.cliente_id=e.cliente_id AND h.empleado_id=e.empleado_id AND h.workday_date=e.operative_date) AS target_history_rows,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workday_records' AND column_name='calculation_version') AS calculation_version_ready,
    NOT EXISTS (SELECT 1 FROM (VALUES ('workday_record_id'),('cliente_id'),('empleado_id'),('workday_date'),('calculation_version'),('integrity_hash'),('action')) required(column_name)
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='workday_record_history' AND c.column_name=required.column_name)) AS history_contract_ready
)
SELECT jsonb_build_object(
  'phase','65_persist_canary_revision_precheck',
  'read_only',current_setting('transaction_read_only'),
  'identity',jsonb_build_object('registro_id',e.registro_id,'cliente_id',e.cliente_id,'empleado_id',e.empleado_id,'assignment_id',e.assignment_id,'schedule_id',e.schedule_id,'operative_date',e.operative_date,'timezone',e.timezone,'schedule_revision_id',e.revision_id,'revision_version',e.revision_version,'revision_integrity_hash',e.revision_hash,'calculation_version',e.calculation_version),
  'candidate_exact',t.registro_id=e.registro_id AND t.registro_cliente_id=e.cliente_id AND t.registro_empleado_id=e.empleado_id
    AND t.device_id IS NOT NULL AND t.device_cliente_id=e.cliente_id AND t.device_timezone=e.timezone
    AND t.assignment_id=e.assignment_id AND t.assignment_cliente_id=e.cliente_id AND t.assignment_empleado_id=e.empleado_id AND t.horario_id=e.schedule_id
    AND t.activo IS TRUE AND t.fecha_inicio<=e.operative_date AND (t.fecha_fin IS NULL OR t.fecha_fin>=e.operative_date)
    AND t.schedule_revision_id=e.revision_id AND t.revision_cliente_id=e.cliente_id AND t.revision_horario_id=e.schedule_id
    AND t.revision_version=e.revision_version AND t.revision_integrity_hash=e.revision_hash
    AND public.schedule_revision_calculation_hash(t.config_snapshot)=e.revision_hash,
  'applicable_assignment_count',s.applicable_assignment_count,
  'revision_feature_mode',CASE WHEN s.revision_shadow_rows=1 THEN 'SHADOW' ELSE 'INVALID' END,
  'active_tenants',s.active_tenant_count,
  'persist_authorization_rows',s.persist_authorization_rows,
  'rpc_v3_available',EXISTS(SELECT 1 FROM rpc),
  'rpc_fingerprint',(SELECT fingerprint FROM rpc),
  'history_contract_ready',s.history_contract_ready,
  'calculation_version_ready',s.calculation_version_ready,
  'target_workday_rows',s.target_workday_rows,
  'target_history_rows',s.target_history_rows,
  'logical_identity_conflict',(s.target_workday_rows>1 OR s.target_history_rows>1),
  'operative_date_at_or_after_revision_start',e.operative_date>='2026-09-09'::date,
  'safe_to_authorize_persist_canary',
    t.registro_id=e.registro_id AND t.registro_cliente_id=e.cliente_id AND t.registro_empleado_id=e.empleado_id
    AND t.device_cliente_id=e.cliente_id AND t.device_timezone=e.timezone
    AND t.assignment_id=e.assignment_id AND t.assignment_cliente_id=e.cliente_id AND t.assignment_empleado_id=e.empleado_id AND t.horario_id=e.schedule_id
    AND t.activo IS TRUE AND t.fecha_inicio<=e.operative_date AND (t.fecha_fin IS NULL OR t.fecha_fin>=e.operative_date)
    AND t.schedule_revision_id=e.revision_id AND t.revision_cliente_id=e.cliente_id AND t.revision_horario_id=e.schedule_id
    AND t.revision_version=e.revision_version AND t.revision_integrity_hash=e.revision_hash
    AND public.schedule_revision_calculation_hash(t.config_snapshot)=e.revision_hash
    AND e.operative_date>='2026-09-09'::date AND s.applicable_assignment_count=1 AND s.revision_shadow_rows=1 AND s.active_tenant_count=0 AND s.persist_authorization_rows=0
    AND EXISTS(SELECT 1 FROM rpc) AND s.history_contract_ready AND s.calculation_version_ready
    AND s.target_workday_rows=0 AND s.target_history_rows=0
) AS persist_canary_revision_precheck
FROM expected e CROSS JOIN target t CROSS JOIN state s;

ROLLBACK;
