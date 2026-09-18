-- Signum Clock / Phase 56: immutable schedule revision storage and deterministic C backfill.
-- Rebind only after reviewing Phase 55 production output. This file fails closed while NULL.
BEGIN ISOLATION LEVEL REPEATABLE READ;
LOCK TABLE public.horarios, public.empleados_horarios IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_expected_snapshot_hash text := 'dad64dfa2920b3c00cb6aae75283a835'; -- PHASE 55 APPROVED
  v_expected_assignment_count integer := 3; -- PHASE 55 APPROVED
  v_expected_active_assignment_count integer := 1; -- PHASE 55 APPROVED
  v_expected_voided_assignment_count integer := 2; -- PHASE 55 APPROVED
  v_expected_deterministic_candidate_count integer := 1; -- PHASE 55 APPROVED
  v_expected_voided_unlinked_count integer := 2; -- PHASE 55 APPROVED
  v_expected_attendance_rows integer := 40; -- PHASE 55 APPROVED
  v_expected_workday_records integer := 0; -- PHASE 55 APPROVED
  v_expected_workday_record_history integer := 0; -- PHASE 55 APPROVED
  v_expected_incidencias integer := 7; -- PHASE 55 APPROVED
  v_current_hash text; v_assignment_count integer; v_active_count integer; v_voided_count integer; v_target_cliente_id uuid;
  v_attendance_rows integer; v_workday_records integer; v_workday_record_history integer; v_incidencias integer;
  v_deterministic_candidate_count integer; v_voided_unlinked_count integer;
BEGIN
  IF v_expected_snapshot_hash IS NULL OR v_expected_assignment_count IS NULL OR v_expected_active_assignment_count IS NULL
     OR v_expected_voided_assignment_count IS NULL OR v_expected_deterministic_candidate_count IS NULL OR v_expected_voided_unlinked_count IS NULL
     OR v_expected_attendance_rows IS NULL OR v_expected_workday_records IS NULL OR v_expected_workday_record_history IS NULL OR v_expected_incidencias IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_REBIND_REQUIRED';
  END IF;
  IF to_regclass('public.schedule_revisions') IS NOT NULL
     OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='empleados_horarios' AND column_name='schedule_revision_id') THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_ALREADY_INSTALLED';
  END IF;
  IF to_regprocedure('public.auth_cliente_id()') IS NULL OR to_regprocedure('public.auth_cuenta_activa()') IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_TENANT_RLS_RESOLVER_MISSING';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pgcrypto') THEN RAISE EXCEPTION 'SCHEDULE_REVISION_PGCRYPTO_UNAVAILABLE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN RAISE EXCEPTION 'SCHEDULE_REVISION_PGCRYPTO_PRECHECK_DRIFT'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='pgcrypto' AND n.nspname='extensions'
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_PGCRYPTO_SCHEMA_UNSUPPORTED';
  END IF;
  SELECT count(*)::int,count(*) FILTER(WHERE activo)::int,count(*) FILTER(WHERE NOT activo)::int,
      md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),''))
    INTO v_assignment_count,v_active_count,v_voided_count,v_current_hash FROM public.empleados_horarios;
  SELECT count(*) FILTER (WHERE eh.activo IS TRUE AND eh.fecha_inicio='2026-09-09'::date AND eh.fecha_fin IS NULL
      AND h.id='5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AND h.cliente_id=eh.cliente_id
      AND h.dias_config IS NOT NULL AND jsonb_typeof(h.dias_config)='object'
      AND h.dias_config ?& ARRAY['lun','mar','mie','jue','vie','sab','dom'] AND h.tolerancia_minutos IS NOT NULL
      AND h.creado_at::date <= eh.fecha_inicio AND h.actualizado_at::date <= eh.fecha_inicio)::int,
    count(*) FILTER (WHERE eh.id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid) AND eh.activo IS FALSE)::int
    INTO v_deterministic_candidate_count,v_voided_unlinked_count
  FROM public.empleados_horarios eh LEFT JOIN public.horarios h ON h.id=eh.horario_id AND h.cliente_id=eh.cliente_id
  WHERE eh.id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid,'2984316c-1c93-4f66-853e-349f90b9f82c'::uuid);
  IF v_current_hash IS DISTINCT FROM v_expected_snapshot_hash OR v_assignment_count<>v_expected_assignment_count OR v_active_count<>v_expected_active_assignment_count OR v_voided_count<>v_expected_voided_assignment_count OR v_deterministic_candidate_count<>v_expected_deterministic_candidate_count OR v_voided_unlinked_count<>v_expected_voided_unlinked_count THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_PRECHECK_DRIFT';
  END IF;
  SELECT cliente_id INTO v_target_cliente_id FROM public.empleados_horarios WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid;
  IF v_target_cliente_id IS NULL THEN RAISE EXCEPTION 'SCHEDULE_REVISION_TARGET_TENANT_MISSING'; END IF;
  SELECT count(*)::int INTO v_attendance_rows FROM public.registro_asistencia WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_workday_records FROM public.workday_records WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_workday_record_history FROM public.workday_record_history WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_incidencias FROM public.incidencias WHERE cliente_id=v_target_cliente_id;
  IF v_attendance_rows<>v_expected_attendance_rows OR v_workday_records<>v_expected_workday_records OR v_workday_record_history<>v_expected_workday_record_history OR v_incidencias<>v_expected_incidencias THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_DOWNSTREAM_PRECHECK_DRIFT';
  END IF;
  PERFORM set_config('app.schedule_revision.expected_assignment_hash',v_expected_snapshot_hash,true);
  PERFORM set_config('app.schedule_revision.expected_attendance_rows',v_expected_attendance_rows::text,true);
  PERFORM set_config('app.schedule_revision.expected_workday_records',v_expected_workday_records::text,true);
  PERFORM set_config('app.schedule_revision.expected_workday_record_history',v_expected_workday_record_history::text,true);
  PERFORM set_config('app.schedule_revision.expected_incidencias',v_expected_incidencias::text,true);
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.schedule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  horario_id uuid NOT NULL REFERENCES public.horarios(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  effective_from date NOT NULL,
  config_snapshot jsonb NOT NULL,
  integrity_hash text NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  CONSTRAINT schedule_revisions_horario_version_unique UNIQUE (horario_id, version),
  CONSTRAINT schedule_revisions_id_tenant_unique UNIQUE (id, cliente_id),
  CONSTRAINT schedule_revisions_snapshot_object CHECK (jsonb_typeof(config_snapshot)='object'),
  CONSTRAINT schedule_revisions_snapshot_keys CHECK (config_snapshot ?& ARRAY['calculation_contract_version','dias_config','tolerancia_minutos','horario_activo'])
);

CREATE OR REPLACE FUNCTION public.schedule_revision_calculation_hash(p_snapshot jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'calculation_contract_version', p_snapshot->'calculation_contract_version',
    'dias_config', p_snapshot->'dias_config',
    'tolerancia_minutos', p_snapshot->'tolerancia_minutos',
    'horario_activo', p_snapshot->'horario_activo'
  )::text,'UTF8'),'sha256'::text),'hex')
$$;

CREATE OR REPLACE FUNCTION public.trg_validate_schedule_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_hash text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.horarios h WHERE h.id=NEW.horario_id AND h.cliente_id=NEW.cliente_id) THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_TENANT_MISMATCH';
  END IF;
  IF jsonb_typeof(NEW.config_snapshot->'dias_config') <> 'object' OR jsonb_typeof(NEW.config_snapshot->'tolerancia_minutos') <> 'number' OR jsonb_typeof(NEW.config_snapshot->'horario_activo') <> 'boolean' OR NEW.config_snapshot->>'calculation_contract_version' <> '1' THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_INVALID_CALCULATION_SNAPSHOT';
  END IF;
  v_hash := public.schedule_revision_calculation_hash(NEW.config_snapshot);
  IF NEW.integrity_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'SCHEDULE_REVISION_HASH_MISMATCH'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_schedule_revision BEFORE INSERT ON public.schedule_revisions FOR EACH ROW EXECUTE FUNCTION public.trg_validate_schedule_revision();

CREATE OR REPLACE FUNCTION public.trg_prevent_schedule_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'SCHEDULE_REVISION_IMMUTABLE';
END $$;
CREATE TRIGGER trg_prevent_schedule_revision_update BEFORE UPDATE OR DELETE ON public.schedule_revisions FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_schedule_revision_mutation();

ALTER TABLE public.empleados_horarios ADD COLUMN schedule_revision_id uuid;
ALTER TABLE public.empleados_horarios ADD CONSTRAINT empleados_horarios_schedule_revision_tenant_fkey FOREIGN KEY (schedule_revision_id,cliente_id) REFERENCES public.schedule_revisions(id,cliente_id) DEFERRABLE INITIALLY IMMEDIATE;

INSERT INTO public.schedule_revisions(cliente_id,horario_id,version,effective_from,config_snapshot,integrity_hash,created_by,reason)
SELECT h.cliente_id,h.id,1,eh.fecha_inicio,
  jsonb_build_object('calculation_contract_version',1,'dias_config',h.dias_config,'tolerancia_minutos',h.tolerancia_minutos,'horario_activo',h.activo),
  public.schedule_revision_calculation_hash(jsonb_build_object('calculation_contract_version',1,'dias_config',h.dias_config,'tolerancia_minutos',h.tolerancia_minutos,'horario_activo',h.activo)),
  auth.uid(),'PHASE_56_DETERMINISTIC_CURRENT_ASSIGNMENT_BACKFILL'
FROM public.empleados_horarios eh JOIN public.horarios h ON h.id=eh.horario_id AND h.cliente_id=eh.cliente_id
WHERE eh.id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid;

UPDATE public.empleados_horarios eh SET schedule_revision_id=sr.id
FROM public.schedule_revisions sr
WHERE eh.id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AND sr.horario_id=eh.horario_id AND sr.version=1;

CREATE OR REPLACE FUNCTION public.trg_attach_schedule_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.activo IS TRUE AND NEW.schedule_revision_id IS NULL THEN
    SELECT id INTO NEW.schedule_revision_id FROM public.schedule_revisions
    WHERE cliente_id=NEW.cliente_id AND horario_id=NEW.horario_id AND effective_from<=NEW.fecha_inicio
    ORDER BY effective_from DESC, version DESC LIMIT 1;
    IF NEW.schedule_revision_id IS NULL THEN RAISE EXCEPTION 'SCHEDULE_REVISION_REQUIRED_FOR_ACTIVE_ASSIGNMENT'; END IF;
  END IF;
  IF NEW.schedule_revision_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.schedule_revisions sr
    WHERE sr.id=NEW.schedule_revision_id AND sr.cliente_id=NEW.cliente_id AND sr.horario_id=NEW.horario_id
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_ASSIGNMENT_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_attach_schedule_revision BEFORE INSERT OR UPDATE OF horario_id,fecha_inicio,activo,schedule_revision_id ON public.empleados_horarios FOR EACH ROW EXECUTE FUNCTION public.trg_attach_schedule_revision();

CREATE OR REPLACE FUNCTION public.trg_prevent_mutable_schedule_calculation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (NEW.dias_config IS DISTINCT FROM OLD.dias_config OR NEW.tolerancia_minutos IS DISTINCT FROM OLD.tolerancia_minutos OR NEW.activo IS DISTINCT FROM OLD.activo)
     AND EXISTS(SELECT 1 FROM public.schedule_revisions sr WHERE sr.horario_id=OLD.id) THEN
    RAISE EXCEPTION 'SCHEDULE_MUTABLE_CALCULATION_UPDATE_FORBIDDEN: create a new revision through the future revision service';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_prevent_mutable_schedule_calculation_update BEFORE UPDATE OF dias_config,tolerancia_minutos,activo ON public.horarios FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_mutable_schedule_calculation_update();

REVOKE ALL ON public.schedule_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.schedule_revisions TO authenticated;
ALTER TABLE public.schedule_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedule_revisions: SELECT tenant active" ON public.schedule_revisions FOR SELECT TO authenticated
  USING (cliente_id=public.auth_cliente_id() AND public.auth_cuenta_activa());

DO $$
DECLARE v_hash text; v_revision_id uuid; v_assignment_hash text; v_target_cliente_id uuid;
  v_attendance_rows integer; v_workday_records integer; v_workday_record_history integer; v_incidencias integer;
BEGIN
  SELECT sr.id,sr.integrity_hash INTO v_revision_id,v_hash FROM public.schedule_revisions sr WHERE sr.horario_id='5a753368-f019-4230-89e2-79beaa39ff0f'::uuid AND sr.version=1;
  IF v_revision_id IS NULL OR v_hash IS NULL OR NOT EXISTS(SELECT 1 FROM public.empleados_horarios WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid AND schedule_revision_id=v_revision_id)
     OR EXISTS(SELECT 1 FROM public.empleados_horarios WHERE id IN ('a290fc73-7ee6-4ea8-9e0e-8e92a683245f'::uuid,'56f8c98d-5fe1-49d2-abe2-42182a4a830a'::uuid) AND schedule_revision_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_BACKFILL_VERIFICATION_FAILED';
  END IF;
  SELECT md5(coalesce(string_agg(concat_ws('|',id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo),'||' ORDER BY id),'')) INTO v_assignment_hash FROM public.empleados_horarios;
  IF v_assignment_hash IS DISTINCT FROM current_setting('app.schedule_revision.expected_assignment_hash') THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_INSTALLATION_CHANGED_ASSIGNMENTS';
  END IF;
  SELECT cliente_id INTO v_target_cliente_id FROM public.empleados_horarios WHERE id='2984316c-1c93-4f66-853e-349f90b9f82c'::uuid;
  SELECT count(*)::int INTO v_attendance_rows FROM public.registro_asistencia WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_workday_records FROM public.workday_records WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_workday_record_history FROM public.workday_record_history WHERE cliente_id=v_target_cliente_id;
  SELECT count(*)::int INTO v_incidencias FROM public.incidencias WHERE cliente_id=v_target_cliente_id;
  IF v_attendance_rows<>current_setting('app.schedule_revision.expected_attendance_rows')::integer
     OR v_workday_records<>current_setting('app.schedule_revision.expected_workday_records')::integer
     OR v_workday_record_history<>current_setting('app.schedule_revision.expected_workday_record_history')::integer
     OR v_incidencias<>current_setting('app.schedule_revision.expected_incidencias')::integer THEN
    RAISE EXCEPTION 'SCHEDULE_REVISION_INSTALLATION_CHANGED_DOWNSTREAM_DATA';
  END IF;
END $$;
COMMIT;
