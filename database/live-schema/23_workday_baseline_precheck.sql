-- Signum Clock — Fase 23: precheck del baseline nuevo de workday.
-- Producción, 100% READ ONLY. No usa migraciones históricas como autoridad.

BEGIN TRANSACTION READ ONLY;

WITH expected_relations AS (
  SELECT relname, to_regclass('public.' || relname) IS NOT NULL AS exists
  FROM unnest(ARRAY['workday_records', 'workday_record_history', 'tenant_features']) AS expected(relname)
), required_columns AS (
  SELECT * FROM (VALUES
    ('clientes', 'id'),
    ('empleados', 'id'), ('empleados', 'cliente_id'),
    ('horarios', 'id'), ('horarios', 'cliente_id'),
    ('empleados_horarios', 'cliente_id'), ('empleados_horarios', 'empleado_id'),
    ('empleados_horarios', 'horario_id'), ('empleados_horarios', 'fecha_inicio'),
    ('empleados_horarios', 'fecha_fin'), ('empleados_horarios', 'activo'),
    ('registro_asistencia', 'id'), ('registro_asistencia', 'cliente_id'),
    ('registro_asistencia', 'empleado_id'), ('registro_asistencia', 'dispositivo_id'),
    ('registro_asistencia', 'verificado_at'), ('registro_asistencia', 'tipo_verificacion'),
    ('registro_asistencia', 'source_event_id'),
    ('devices', 'id'), ('devices', 'cliente_id'), ('devices', 'timezone')
  ) AS required(table_name, column_name)
), column_contract AS (
  SELECT r.table_name, r.column_name,
         c.data_type, c.udt_name, c.is_nullable,
         (c.column_name IS NOT NULL) AS exists
  FROM required_columns r
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = r.table_name
   AND c.column_name = r.column_name
), assignment_integrity AS (
  SELECT count(*) AS assignment_rows,
         count(*) FILTER (WHERE eh.cliente_id IS DISTINCT FROM e.cliente_id
                           OR eh.cliente_id IS DISTINCT FROM h.cliente_id) AS assignment_empresa_mismatches
  FROM public.empleados_horarios eh
  LEFT JOIN public.empleados e ON e.id = eh.empleado_id
  LEFT JOIN public.horarios h ON h.id = eh.horario_id
), schedule_overlaps AS (
  SELECT count(*) AS schedule_overlaps
  FROM public.empleados_horarios left_assignment
  JOIN public.empleados_horarios right_assignment
    ON left_assignment.empleado_id = right_assignment.empleado_id
   AND left_assignment.id < right_assignment.id
   AND left_assignment.activo IS TRUE
   AND right_assignment.activo IS TRUE
   AND daterange(left_assignment.fecha_inicio, COALESCE(left_assignment.fecha_fin, 'infinity'::date), '[]')
       && daterange(right_assignment.fecha_inicio, COALESCE(right_assignment.fecha_fin, 'infinity'::date), '[]')
), current_counts AS (
  SELECT jsonb_build_object(
    'registro_asistencia', (SELECT count(*) FROM public.registro_asistencia),
    'incidencias', (SELECT count(*) FROM public.incidencias),
    'horarios', (SELECT count(*) FROM public.horarios),
    'empleados_horarios', (SELECT count(*) FROM public.empleados_horarios),
    'attendance_source_events', (SELECT count(*) FROM public.attendance_source_events),
    'devices', (SELECT count(*) FROM public.devices)
  ) AS counts
), tenant_auth_contract AS (
  SELECT COALESCE(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text), '[]'::jsonb) AS functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid IN (to_regprocedure('public.auth_can_read_tenant(uuid)'),
                  to_regprocedure('public.auth_can_write_tenant(uuid)'))
)
SELECT jsonb_build_object(
  'phase', '23_precheck',
  'read_only', current_setting('transaction_read_only'),
  'expected_relations', (SELECT jsonb_object_agg(relname, exists) FROM expected_relations),
  'workday_tables_absent', NOT EXISTS (SELECT 1 FROM expected_relations WHERE exists),
  'required_columns', (SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'exists', exists,
      'data_type', data_type, 'udt_name', udt_name, 'nullable', is_nullable
    ) ORDER BY table_name, column_name) FROM column_contract),
  'missing_required_columns', (SELECT count(*) FROM column_contract WHERE NOT exists),
  'assignment_rows', ai.assignment_rows,
  'assignment_empresa_mismatches', ai.assignment_empresa_mismatches,
  'schedule_overlaps', so.schedule_overlaps,
  'current_counts', cc.counts,
  'tenant_auth_functions', tac.functions,
  'ready_to_run_24_after_precheck', (
    NOT EXISTS (SELECT 1 FROM expected_relations WHERE exists)
    AND NOT EXISTS (SELECT 1 FROM column_contract WHERE NOT exists)
    AND ai.assignment_empresa_mismatches = 0
    AND so.schedule_overlaps = 0
  )
) AS phase_23_precheck_result
FROM assignment_integrity ai
CROSS JOIN schedule_overlaps so
CROSS JOIN current_counts cc
CROSS JOIN tenant_auth_contract tac;

ROLLBACK;
