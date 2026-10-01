BEGIN;
CREATE TABLE public.workday_calculation_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  empleado_id uuid NOT NULL REFERENCES public.empleados(id) ON DELETE RESTRICT,
  workday_date date NOT NULL,
  calculation_version integer NOT NULL CHECK(calculation_version>=1),
  evidence_manifest_version integer NOT NULL CHECK(evidence_manifest_version=1),
  evidence_manifest jsonb NOT NULL CHECK(jsonb_typeof(evidence_manifest)='object'),
  evidence_fingerprint text NOT NULL CHECK(evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  context_manifest_version integer NOT NULL CHECK(context_manifest_version=1),
  context_manifest jsonb NOT NULL CHECK(jsonb_typeof(context_manifest)='object'),
  context_fingerprint text NOT NULL CHECK(context_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  integrity_hash text NOT NULL CHECK(btrim(integrity_hash)<>''),
  source_observed_at timestamptz NOT NULL,
  source_event_count integer NOT NULL CHECK(source_event_count>=1),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(id,cliente_id,empleado_id,workday_date),
  UNIQUE(cliente_id,empleado_id,workday_date,evidence_fingerprint,context_fingerprint)
);
ALTER TABLE public.workday_records ADD COLUMN current_revision_id uuid NULL;
ALTER TABLE public.workday_records ADD CONSTRAINT workday_current_revision_identity_fkey
  FOREIGN KEY(current_revision_id,cliente_id,empleado_id,workday_date)
  REFERENCES public.workday_calculation_revisions(id,cliente_id,empleado_id,workday_date) ON DELETE RESTRICT;
CREATE TABLE public.workday_revision_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL,
  empleado_id uuid NOT NULL,
  workday_date date NOT NULL,
  previous_revision_id uuid NULL,
  promoted_revision_id uuid NOT NULL,
  expected_current_revision_id uuid NULL,
  expected_evidence_fingerprint text NULL,
  operation text NOT NULL CHECK(operation IN ('INITIAL','EVIDENCE_UPDATE','PROMOTION')),
  promoted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  actor text NOT NULL DEFAULT current_user,
  FOREIGN KEY(promoted_revision_id,cliente_id,empleado_id,workday_date)
    REFERENCES public.workday_calculation_revisions(id,cliente_id,empleado_id,workday_date),
  FOREIGN KEY(previous_revision_id,cliente_id,empleado_id,workday_date)
    REFERENCES public.workday_calculation_revisions(id,cliente_id,empleado_id,workday_date),
  UNIQUE(promoted_revision_id)
);
CREATE FUNCTION public.reject_workday_revision_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'WORKDAY_REVISION_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER workday_calculation_revision_immutable BEFORE UPDATE OR DELETE ON public.workday_calculation_revisions
FOR EACH ROW EXECUTE FUNCTION public.reject_workday_revision_mutation();
CREATE TRIGGER workday_promotion_audit_immutable BEFORE UPDATE OR DELETE ON public.workday_revision_promotions
FOR EACH ROW EXECUTE FUNCTION public.reject_workday_revision_mutation();
-- Version numbers on newly generated history facts can match an authorized CURRENT.
-- No existing row is rewritten.
ALTER TABLE public.workday_record_history DROP CONSTRAINT workday_record_history_version_check;
ALTER TABLE public.workday_record_history ADD CONSTRAINT workday_record_history_version_check CHECK(calculation_version>=1);
ALTER TABLE public.workday_calculation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workday_revision_promotions ENABLE ROW LEVEL SECURITY;
COMMIT;
