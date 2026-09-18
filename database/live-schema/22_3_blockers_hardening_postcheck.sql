-- Signum Clock — Fase 22.1D: postcheck de hardening.
-- Producción, 100% READ ONLY. Comparar data_snapshot_after con el JSON emitido
-- por 22_1: dos huellas iguales demuestran que las filas (incluyendo seriales)
-- no cambiaron entre ambas ejecuciones.

BEGIN TRANSACTION READ ONLY;

WITH device_policies AS (
  SELECT policyname, permissive, roles, cmd, qual, with_check,
         COALESCE(roles @> ARRAY['authenticated'::name]
                  OR roles @> ARRAY['public'::name], false) AS applies_to_authenticated
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'devices'
), device_exposure AS (
  SELECT policyname,
         cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE'
           AND applies_to_authenticated AND COALESCE(qual, 'true') NOT ILIKE '%cliente_id%' AS read_risk,
         cmd IN ('INSERT', 'ALL') AND permissive = 'PERMISSIVE'
           AND applies_to_authenticated AND COALESCE(with_check, 'true') NOT ILIKE '%cliente_id%' AS insert_risk,
         cmd IN ('UPDATE', 'ALL') AND permissive = 'PERMISSIVE'
           AND applies_to_authenticated
           AND (COALESCE(qual, 'true') NOT ILIKE '%cliente_id%'
                OR COALESCE(with_check, 'true') NOT ILIKE '%cliente_id%') AS update_risk
  FROM device_policies
), device_stats AS (
  SELECT COALESCE(bool_or(read_risk), false) AS read_risk,
         COALESCE(bool_or(insert_risk), false) AS insert_risk,
         COALESCE(bool_or(update_risk), false) AS update_risk,
         COALESCE(jsonb_agg(DISTINCT policyname::text)
                  FILTER (WHERE read_risk OR insert_risk OR update_risk), '[]'::jsonb) AS problematic_policies
  FROM device_exposure
), device_meta AS (
  SELECT relrowsecurity AS rls_enabled FROM pg_class WHERE oid = 'public.devices'::regclass
), snapshots AS (
  SELECT jsonb_build_object(
    'devices', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(d)::text), ',' ORDER BY d.id::text), '')))
      FROM public.devices d),
    'registro_asistencia', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(r)::text), ',' ORDER BY r.id::text), '')))
      FROM public.registro_asistencia r),
    'incidencias', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(i)::text), ',' ORDER BY i.id::text), '')))
      FROM public.incidencias i),
    'horarios', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(h)::text), ',' ORDER BY h.id::text), '')))
      FROM public.horarios h),
    'empleados_horarios', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(eh)::text), ',' ORDER BY eh.id::text), '')))
      FROM public.empleados_horarios eh),
    'attendance_source_events', (SELECT jsonb_build_object('rows', count(*), 'fingerprint',
        md5(COALESCE(string_agg(md5(to_jsonb(ase)::text), ',' ORDER BY ase.id::text), '')))
      FROM public.attendance_source_events ase)
  ) AS data_snapshot
), trigger_snapshot AS (
  SELECT COALESCE(md5(pg_get_triggerdef(t.oid, true)), 'MISSING') AS definition_fingerprint
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.registro_asistencia'::regclass
    AND NOT t.tgisinternal
    AND t.tgname = 'trg_evaluar_retardo'
)
SELECT jsonb_build_object(
  'phase', '22.3_postcheck',
  'read_only', current_setting('transaction_read_only'),
  'devices_tenant_rls_after', CASE WHEN NOT dm.rls_enabled OR ds.read_risk OR ds.insert_risk OR ds.update_risk
                                   THEN 'FAIL' ELSE 'PASS' END,
  'devices_cross_tenant_read_risk_after', CASE WHEN NOT dm.rls_enabled OR ds.read_risk THEN 'YES' ELSE 'NO' END,
  'devices_cross_tenant_insert_risk_after', CASE WHEN NOT dm.rls_enabled OR ds.insert_risk THEN 'YES' ELSE 'NO' END,
  'devices_cross_tenant_update_risk_after', CASE WHEN NOT dm.rls_enabled OR ds.update_risk THEN 'YES' ELSE 'NO' END,
  'devices_problematic_policies_after', ds.problematic_policies,
  'data_snapshot_after', s.data_snapshot,
  'legacy_trigger_definition_fingerprint_after', COALESCE((SELECT definition_fingerprint FROM trigger_snapshot), 'MISSING'),
  'snapshot_comparison_required', true,
  'production_data_modified', 'UNKNOWN — compare data_snapshot_before and data_snapshot_after',
  'device_rows_modified', 'UNKNOWN — compare devices fingerprints before and after',
  'workday_tables_created', 'NO',
  'safe_to_create_phase_23', false
) AS phase_22_3_postcheck_result
FROM device_meta dm
CROSS JOIN device_stats ds
CROSS JOIN snapshots s;

ROLLBACK;
