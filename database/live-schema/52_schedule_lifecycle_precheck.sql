-- Signum Clock / Phase 52: schedule lifecycle precheck
-- READ ONLY. Run this first in Supabase and return the complete result.
BEGIN TRANSACTION READ ONLY;

WITH contract AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS btree_gist_installed,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'empleados_horarios'
        AND column_name = 'fecha_inicio' AND is_nullable = 'NO'
    ) AS fecha_inicio_not_null,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.empleados_horarios'::regclass
        AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%fecha_fin%fecha_inicio%'
    ) AS range_check_present,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.empleados_horarios'::regclass
        AND contype = 'x' AND pg_get_constraintdef(oid) ILIKE '%daterange%'
    ) AS active_exclusion_present
), assignments AS (
  SELECT
    count(*)::int AS assignment_count,
    count(*) FILTER (WHERE activo IS TRUE)::int AS active_assignment_count,
    count(*) FILTER (WHERE fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio)::int AS invalid_ranges,
    md5(coalesce(string_agg(
      concat_ws('|', id, cliente_id, empleado_id, horario_id, fecha_inicio, fecha_fin, activo),
      '||' ORDER BY id
    ), '')) AS assignment_snapshot_hash
  FROM public.empleados_horarios
), active_overlap_scan AS (
  SELECT count(*)::int AS active_overlap_pairs
  FROM public.empleados_horarios a
  JOIN public.empleados_horarios b
    ON a.id < b.id
   AND a.cliente_id = b.cliente_id
   AND a.empleado_id = b.empleado_id
   AND a.activo IS TRUE AND b.activo IS TRUE
   AND daterange(a.fecha_inicio, coalesce(a.fecha_fin, 'infinity'::date), '[]')
       && daterange(b.fecha_inicio, coalesce(b.fecha_fin, 'infinity'::date), '[]')
), integrity AS (
  SELECT
    count(*) FILTER (WHERE e.id IS NULL OR e.cliente_id IS DISTINCT FROM eh.cliente_id)::int AS employee_tenant_inconsistent_rows,
    count(*) FILTER (WHERE h.id IS NULL OR h.cliente_id IS DISTINCT FROM eh.cliente_id)::int AS schedule_tenant_inconsistent_rows,
    count(*) FILTER (
      WHERE eh.activo IS FALSE
        AND NOT EXISTS (
          SELECT 1 FROM public.audit_logs al
          WHERE al.cliente_id = eh.cliente_id
            AND al.resource_id = eh.id::text
            AND al.action = 'SCHEDULE_VOIDED'
            AND al.result = 'SUCCESS'
        )
    )::int AS unaudited_inactive_rows
  FROM public.empleados_horarios eh
  LEFT JOIN public.empleados e ON e.id = eh.empleado_id
  LEFT JOIN public.horarios h ON h.id = eh.horario_id
), security AS (
  SELECT
    to_regprocedure('public.auth_current_role()') IS NOT NULL AS role_resolver_present,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.empleados_horarios'::regclass
        AND tgname = 'trg_audit_empleados_horarios_changes' AND NOT tgisinternal
    ) AS legacy_assignment_audit_trigger_present,
    coalesce((
      SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'empleados_horarios'
        AND grantee = 'authenticated'
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    ), '') AS authenticated_direct_write_grants
)
SELECT
  '52_schedule_lifecycle_precheck' AS phase,
  true AS read_only,
  a.assignment_count,
  a.active_assignment_count,
  a.invalid_ranges,
  o.active_overlap_pairs,
  i.employee_tenant_inconsistent_rows,
  i.schedule_tenant_inconsistent_rows,
  i.unaudited_inactive_rows,
  a.assignment_snapshot_hash,
  c.btree_gist_installed,
  c.fecha_inicio_not_null,
  c.range_check_present,
  c.active_exclusion_present,
  s.role_resolver_present,
  s.legacy_assignment_audit_trigger_present,
  s.authenticated_direct_write_grants,
  (
    c.btree_gist_installed AND c.fecha_inicio_not_null AND c.range_check_present
    AND c.active_exclusion_present AND s.role_resolver_present
    AND a.invalid_ranges = 0 AND o.active_overlap_pairs = 0
    AND i.employee_tenant_inconsistent_rows = 0 AND i.schedule_tenant_inconsistent_rows = 0
    AND i.unaudited_inactive_rows = 0
  ) AS safe_to_apply_lifecycle_change
FROM contract c CROSS JOIN assignments a CROSS JOIN active_overlap_scan o CROSS JOIN integrity i CROSS JOIN security s;

ROLLBACK;
