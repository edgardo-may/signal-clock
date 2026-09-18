-- Signum Clock — Fase 22.1B: hardening acotado de RLS para public.devices.
-- Único cambio autorizado: reemplazar las seis policies legacy por tres
-- policies tenant-scoped para authenticated. No modifica tablas, filas, datos,
-- funciones, trigger legacy, ZKTeco ni ninguna otra relación.

BEGIN;

-- Fail closed: comprobar el contrato exacto antes de ejecutar el primer DROP.
DO $preflight$
DECLARE
  expected_policy text;
  expected_policies constant text[] := ARRAY[
    'Active profiles can create devices',
    'Active users can create ZKTeco devices',
    'Active profiles can view devices',
    'Active users can view ZKTeco devices',
    'Admins can update ZKTeco devices',
    'Admins can update devices'
  ];
BEGIN
  IF to_regclass('public.devices') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.devices no existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.devices'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: RLS no está habilitado en public.devices';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.devices'::regclass
      AND attname = 'cliente_id'
      AND atttypid = 'uuid'::regtype
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.devices.cliente_id no es uuid';
  END IF;

  IF to_regprocedure('public.auth_can_read_tenant(uuid)') IS NULL
     OR to_regprocedure('public.auth_can_write_tenant(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL CLOSED: faltan auth_can_read_tenant(uuid) y/o auth_can_write_tenant(uuid)';
  END IF;

  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.devices'::regclass) <> 6 THEN
    RAISE EXCEPTION 'FAIL CLOSED: public.devices debe tener exactamente seis policies antes del cambio';
  END IF;

  FOREACH expected_policy IN ARRAY expected_policies LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = 'public.devices'::regclass
        AND p.polname = expected_policy
        AND p.polpermissive
    ) THEN
      RAISE EXCEPTION 'FAIL CLOSED: falta la policy legacy permissive esperada: %', expected_policy;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'devices'
      AND p.cmd IN ('DELETE', 'ALL')
      AND p.roles @> ARRAY['authenticated'::name]
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: existe una policy DELETE/ALL para authenticated no esperada';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.devices'::regclass
      AND p.polname IN ('devices_select_tenant', 'devices_insert_tenant', 'devices_update_tenant')
  ) THEN
    RAISE EXCEPTION 'FAIL CLOSED: ya existe una policy destino; revisar manualmente';
  END IF;
END
$preflight$;

DROP POLICY "Active profiles can create devices" ON public.devices;
DROP POLICY "Active users can create ZKTeco devices" ON public.devices;
DROP POLICY "Active profiles can view devices" ON public.devices;
DROP POLICY "Active users can view ZKTeco devices" ON public.devices;
DROP POLICY "Admins can update ZKTeco devices" ON public.devices;
DROP POLICY "Admins can update devices" ON public.devices;

CREATE POLICY devices_select_tenant
ON public.devices
FOR SELECT
TO authenticated
USING (
  public.auth_can_read_tenant(cliente_id)
);

CREATE POLICY devices_insert_tenant
ON public.devices
FOR INSERT
TO authenticated
WITH CHECK (
  public.auth_can_write_tenant(cliente_id)
);

CREATE POLICY devices_update_tenant
ON public.devices
FOR UPDATE
TO authenticated
USING (
  public.auth_can_write_tenant(cliente_id)
)
WITH CHECK (
  public.auth_can_write_tenant(cliente_id)
);

-- Postcheck semántico dentro de la misma transacción. pg_policies normaliza
-- expresiones; se remueven schema, espacios, paréntesis, cast uuid y prefijo de
-- relación antes de comparar la forma canónica, no la representación literal.
DO $postcheck$
DECLARE
  authenticated_policy_count integer;
  select_policy_count integer;
  insert_policy_count integer;
  update_policy_count integer;
  delete_policy_count integer;
  total_policy_count integer;
BEGIN
  SELECT count(*) INTO total_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'devices';

  SELECT count(*) INTO authenticated_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND roles = ARRAY['authenticated'::name];

  SELECT count(*) INTO select_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND roles = ARRAY['authenticated'::name]
    AND cmd = 'SELECT';

  SELECT count(*) INTO insert_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND roles = ARRAY['authenticated'::name]
    AND cmd = 'INSERT';

  SELECT count(*) INTO update_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND roles = ARRAY['authenticated'::name]
    AND cmd = 'UPDATE';

  SELECT count(*) INTO delete_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'devices'
    AND roles @> ARRAY['authenticated'::name]
    AND cmd IN ('DELETE', 'ALL');

  IF total_policy_count <> 3
     OR authenticated_policy_count <> 3
     OR select_policy_count <> 1
     OR insert_policy_count <> 1
     OR update_policy_count <> 1
     OR delete_policy_count <> 0 THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: total=%, authenticated=%, select=%, insert=%, update=%, delete=%',
      total_policy_count, authenticated_policy_count, select_policy_count,
      insert_policy_count, update_policy_count, delete_policy_count;
  END IF;

  IF EXISTS (
    WITH normalized AS (
      SELECT policyname, cmd,
             regexp_replace(lower(COALESCE(qual, '')),
               '(public[.]|devices[.]|[[:space:]()]|::uuid)', '', 'g') AS using_norm,
             regexp_replace(lower(COALESCE(with_check, '')),
               '(public[.]|devices[.]|[[:space:]()]|::uuid)', '', 'g') AS check_norm
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'devices'
        AND roles = ARRAY['authenticated'::name]
    )
    SELECT 1 FROM normalized
    WHERE (policyname = 'devices_select_tenant'
           AND (cmd <> 'SELECT' OR using_norm <> 'auth_can_read_tenantcliente_id' OR check_norm <> ''))
       OR (policyname = 'devices_insert_tenant'
           AND (cmd <> 'INSERT' OR using_norm <> '' OR check_norm <> 'auth_can_write_tenantcliente_id'))
       OR (policyname = 'devices_update_tenant'
           AND (cmd <> 'UPDATE' OR using_norm <> 'auth_can_write_tenantcliente_id'
                OR check_norm <> 'auth_can_write_tenantcliente_id'))
       OR policyname NOT IN ('devices_select_tenant', 'devices_insert_tenant', 'devices_update_tenant')
  ) THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: la semántica de las tres policies tenant no coincide con el contrato requerido';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.devices'::regclass
      AND p.polname IN (
        'Active profiles can create devices',
        'Active users can create ZKTeco devices',
        'Active profiles can view devices',
        'Active users can view ZKTeco devices',
        'Admins can update ZKTeco devices',
        'Admins can update devices'
      )
  ) THEN
    RAISE EXCEPTION 'POSTCHECK FAIL: permanece al menos una policy legacy';
  END IF;
END
$postcheck$;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'devices'
ORDER BY policyname;

COMMIT;
