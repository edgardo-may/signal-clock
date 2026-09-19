-- Phase 76: deliberately non-executable ACTIVE transition guard.
-- The approved live artifact advertises execution_mode=SHADOW_ONLY, creates the
-- orchestrator with mode=SHADOW, and exposes only /internal/attendance/shadow.
-- Therefore this file MUST fail closed and MUST NOT update tenant_features.
-- A future ACTIVE-capable runtime requires a new, separately reviewed phase.
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.tenant_features IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.workday_records IN SHARE MODE;
LOCK TABLE public.workday_record_history IN SHARE MODE;

DO $active_blocked$
DECLARE
  v_tenant uuid := '69095bd5-fee5-4237-a1a4-186dd88310ff';
  v_employee uuid := '6c94a683-1fbd-4427-af9e-8ea154ea50fa';
  v_assignment uuid := '2984316c-1c93-4f66-853e-349f90b9f82c';
  v_schedule uuid := '5a753368-f019-4230-89e2-79beaa39ff0f';
  v_revision uuid := '09df6a75-e231-4654-ae70-8448bdf2c312';
  v_date date := '2026-09-09';
BEGIN
  IF (SELECT count(*) FROM public.tenant_features WHERE feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='ACTIVE' AND enabled IS TRUE) <> 0 THEN RAISE EXCEPTION 'ACTIVE_CHANGE_GLOBAL_ACTIVE_TENANT_EXISTS'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_features WHERE cliente_id=v_tenant AND feature_key='REVISION_SCHEDULE_RESOLVER' AND mode='SHADOW' AND enabled IS TRUE) THEN RAISE EXCEPTION 'ACTIVE_CHANGE_EXPECTS_EXACT_SHADOW_FLAG'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_features WHERE feature_key='WORKDAY_PERSIST_CANARY') THEN RAISE EXCEPTION 'ACTIVE_CHANGE_PERSIST_CANARY_AUTHORIZATION_EXISTS'; END IF;
  IF (SELECT count(*) FROM public.empleados_horarios WHERE cliente_id=v_tenant AND empleado_id=v_employee AND activo IS TRUE AND fecha_inicio<=v_date AND (fecha_fin IS NULL OR fecha_fin>=v_date)) <> 1 THEN RAISE EXCEPTION 'ACTIVE_CHANGE_ASSIGNMENT_AMBIGUITY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empleados_horarios eh JOIN public.schedule_revisions sr ON sr.id=eh.schedule_revision_id AND sr.cliente_id=eh.cliente_id WHERE eh.id=v_assignment AND eh.cliente_id=v_tenant AND eh.empleado_id=v_employee AND eh.horario_id=v_schedule AND eh.schedule_revision_id=v_revision AND sr.horario_id=v_schedule AND sr.version=1 AND sr.integrity_hash='77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866' AND public.schedule_revision_calculation_hash(sr.config_snapshot)=sr.integrity_hash) THEN RAISE EXCEPTION 'ACTIVE_CHANGE_REVISION_EVIDENCE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.workday_records WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 OR (SELECT count(*) FROM public.workday_record_history WHERE cliente_id=v_tenant AND empleado_id=v_employee AND workday_date=v_date) <> 1 THEN RAISE EXCEPTION 'ACTIVE_CHANGE_CANARY_EVIDENCE_INVALID'; END IF;
  RAISE EXCEPTION 'ACTIVE_RUNTIME_COMPATIBILITY_NOT_IMPLEMENTED: approved runtime is SHADOW_ONLY; no tenant_features update is permitted';
END
$active_blocked$;

ROLLBACK;
