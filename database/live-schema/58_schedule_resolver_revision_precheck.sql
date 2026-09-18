-- Signum Clock / Phase 58: resolver immutable-revision parity precheck.
-- Read-only evidence only; no resolver activation and no persistence.
BEGIN TRANSACTION READ ONLY;

WITH approval AS (
  SELECT
    '2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AS expected_assignment_id,
    '5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AS expected_horario_id,
    '09df6a75-e231-4654-ae70-8448bdf2c312'::uuid AS expected_revision_id,
    '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866'::text AS expected_integrity_hash,
    '2026-09-14'::date AS monday_probe_date,
    '2026-09-12'::date AS saturday_probe_date
), target AS (
  SELECT eh.id AS assignment_id,eh.cliente_id,eh.empleado_id,eh.horario_id,eh.schedule_revision_id,eh.fecha_inicio,eh.fecha_fin,eh.activo,
    sr.id AS revision_id,sr.version,sr.config_snapshot,sr.integrity_hash,
    h.id AS live_horario_id,h.cliente_id AS live_horario_cliente_id,h.dias_config,h.tolerancia_minutos,h.activo AS horario_activo
  FROM public.empleados_horarios eh
  LEFT JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id
  LEFT JOIN public.horarios h ON h.id=eh.horario_id
  WHERE eh.id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid
), parity AS (
  SELECT t.*,
    jsonb_build_object('calculation_contract_version',1,'dias_config',t.dias_config,'tolerancia_minutos',t.tolerancia_minutos,'horario_activo',t.horario_activo) AS live_calculation_snapshot,
    jsonb_build_object('calculation_contract_version',t.config_snapshot->'calculation_contract_version','dias_config',t.config_snapshot->'dias_config','tolerancia_minutos',t.config_snapshot->'tolerancia_minutos','horario_activo',t.config_snapshot->'horario_activo') AS revision_calculation_snapshot
  FROM target t
), comparison AS (
  SELECT p.*,
    p.live_calculation_snapshot=p.revision_calculation_snapshot AS live_parent_matches_revision_snapshot,
    (p.fecha_inicio<='2026-09-14'::date AND (p.fecha_fin IS NULL OR p.fecha_fin>='2026-09-14'::date) AND p.activo) AS monday_assignment_applicable,
    coalesce((p.config_snapshot->'dias_config'->'lun'->>'activo')::boolean,false) AS monday_active,
    p.config_snapshot->'dias_config'->'lun'->>'entrada' AS monday_entrada,
    p.config_snapshot->'dias_config'->'lun'->>'salida' AS monday_salida,
    coalesce((p.config_snapshot->'dias_config'->'sab'->>'activo')::boolean,false) AS saturday_active,
    coalesce((p.config_snapshot->'dias_config'->'dom'->>'activo')::boolean,false) AS sunday_active
  FROM parity p
)
SELECT
  '58_schedule_resolver_revision_precheck' AS phase,
  true AS read_only,
  p.assignment_id,p.cliente_id,p.empleado_id,p.horario_id,p.schedule_revision_id,p.fecha_inicio,p.fecha_fin,p.activo,
  p.revision_id,p.version,p.integrity_hash,
  public.schedule_revision_calculation_hash(p.config_snapshot) AS db_computed_integrity_hash,
  p.revision_calculation_snapshot::text AS db_canonical_calculation_payload,
  public.schedule_revision_calculation_hash(p.live_calculation_snapshot) AS live_parent_calculation_hash,
  p.live_calculation_snapshot=p.revision_calculation_snapshot AS live_parent_matches_revision_snapshot,
  p.config_snapshot->>'calculation_contract_version' AS calculation_contract_version,
  p.config_snapshot->'dias_config'->'lun' AS revision_lunes,
  p.config_snapshot->'dias_config'->'sab' AS revision_sabado,
  p.config_snapshot->'dias_config'->'dom' AS revision_domingo,
  (p.fecha_inicio<=a.monday_probe_date AND (p.fecha_fin IS NULL OR p.fecha_fin>=a.monday_probe_date) AND p.activo) AS monday_assignment_applicable,
  p.monday_active,
  p.config_snapshot->'dias_config'->'lun'->>'entrada' AS monday_entrada,
  p.config_snapshot->'dias_config'->'lun'->>'salida' AS monday_salida,
  p.saturday_active,p.sunday_active,
  (p.assignment_id=a.expected_assignment_id AND p.horario_id=a.expected_horario_id AND p.schedule_revision_id=a.expected_revision_id AND p.revision_id=a.expected_revision_id AND p.version=1 AND p.activo IS TRUE AND p.integrity_hash=a.expected_integrity_hash AND public.schedule_revision_calculation_hash(p.config_snapshot)=a.expected_integrity_hash AND p.live_horario_id=p.horario_id AND p.live_horario_cliente_id=p.cliente_id AND p.live_parent_matches_revision_snapshot IS TRUE AND p.config_snapshot->>'calculation_contract_version'='1' AND p.monday_assignment_applicable AND p.monday_active AND p.monday_entrada='09:00' AND p.monday_salida='18:00' AND NOT p.saturday_active AND NOT p.sunday_active) AS safe_to_run_revision_resolver_shadow
FROM comparison p CROSS JOIN approval a;

ROLLBACK;
