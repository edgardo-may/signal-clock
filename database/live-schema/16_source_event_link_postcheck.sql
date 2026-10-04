-- Signum Clock: Fase 16, POSTCHECK de la RPC de enlace de source events.
-- SOLO LECTURA. No invoca la RPC, no actualiza el canary y no hace backfill.

BEGIN TRANSACTION READ ONLY;

-- 1 a 6. Existencia, firma, propietario, modo de seguridad y configuracion.
SELECT
  p.oid::regprocedure AS function_signature,
  p.pronargs AS argument_count,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS return_type,
  p.proowner::regrole AS owner,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
  p.proconfig AS function_config,
  EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS config_item
    WHERE config_item = 'search_path=pg_catalog, public'
  ) AS has_safe_search_path,
  p.oid = 'public.link_attendance_source_event(uuid)'::regprocedure
    AND p.pronargs = 1
    AND pg_get_function_identity_arguments(p.oid) = 'p_source_event_id uuid'
    AS exact_uuid_signature
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.link_attendance_source_event(uuid)');

-- 6 a 8. EXECUTE solo para backend service_role; anon y authenticated quedan
-- explicitamente sin permiso, incluso si heredaran privilegios desde PUBLIC.
SELECT
  p.oid::regprocedure AS function_signature,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl_item
    WHERE acl_item.grantee = 0
      AND acl_item.privilege_type = 'EXECUTE'
  ) AS public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.link_attendance_source_event(uuid)');

-- 9. La columna continua nullable y de tipo UUID.
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  (data_type = 'uuid' AND udt_name = 'uuid' AND is_nullable = 'YES') AS uuid_nullable_contract
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'registro_asistencia'
  AND column_name = 'source_event_id';

-- 10. FK a attendance_source_events(id) con ON DELETE RESTRICT.
SELECT
  con.conname AS constraint_name,
  con.convalidated AS is_validated,
  con.confdeltype = 'r' AS on_delete_restrict,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.registro_asistencia'::regclass
  AND con.confrelid = 'public.attendance_source_events'::regclass
  AND con.contype = 'f'
ORDER BY con.conname;

-- 11. Indice UNIQUE parcial para preservar la cardinalidad uno a uno.
SELECT
  i.indexrelid::regclass AS index_name,
  i.indisunique AS is_unique,
  pg_get_expr(i.indpred, i.indrelid) AS predicate,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
WHERE i.indrelid = 'public.registro_asistencia'::regclass
  AND i.indisunique
  AND i.indpred IS NOT NULL
  AND pg_get_indexdef(i.indexrelid) ILIKE '%source_event_id%'
ORDER BY i.indexrelid::regclass::text;

-- 12, 13 y 15. El instalador no invoca la RPC: los 30 registros historicos
-- deben continuar sin source_event_id y no debe existir ningun backfill.
SELECT
  count(*) AS registro_asistencia_total,
  count(*) FILTER (WHERE source_event_id IS NOT NULL) AS source_event_id_not_null,
  count(*) FILTER (WHERE source_event_id IS NULL) AS source_event_id_null,
  count(*) = 30 AS expected_total_30,
  count(*) FILTER (WHERE source_event_id IS NOT NULL) = 0 AS no_historical_backfill,
  count(*) FILTER (WHERE source_event_id IS NULL) = 30 AS expected_null_30
FROM public.registro_asistencia;

-- 14. El canary comprobado en Fase 14 debe conservarse PENDING hasta que una
-- llamada backend explicita a la RPC sea autorizada y ejecutada por separado.
SELECT
  e.id AS source_event_id,
  e.source_type,
  e.processing_status,
  e.processing_error,
  e.id = 'fcc67f56-d0ae-44c7-8b6e-1957420e8ccb'::uuid
    AND e.source_type = 'ZKTECO'
    AND e.processing_status = 'PENDING' AS canary_remains_pending
FROM public.attendance_source_events e
WHERE e.id = 'fcc67f56-d0ae-44c7-8b6e-1957420e8ccb'::uuid;

ROLLBACK;
