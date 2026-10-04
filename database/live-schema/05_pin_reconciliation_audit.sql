-- Signum Clock: conciliación de PIN funcional y PIN físico.
-- SOLO LECTURA. Muestra únicamente UUIDs internos, estados y longitudes; nunca PINes.

BEGIN TRANSACTION READ ONLY;

WITH assignment_identity AS (
  SELECT
    a.id AS assignment_id,
    a.cliente_id,
    a.device_id,
    a.employee_id,
    a.activo AS assignment_activo,
    CASE
      WHEN NULLIF(BTRIM(a.biometric_user_id::text), '') IS NULL THEN 'ASSIGNMENT_PIN_EMPTY'
      WHEN e.id IS NULL THEN 'EMPLOYEE_NOT_IN_SAME_EMPRESA'
      WHEN NULLIF(BTRIM(e.pin::text), '') IS NULL THEN 'EMPLOYEE_PIN_EMPTY'
      WHEN BTRIM(a.biometric_user_id::text) = BTRIM(e.pin::text) THEN 'PIN_MATCH'
      ELSE 'BIOMETRIC_PIN_MISMATCH'
    END AS assignment_vs_functional_pin,
    CASE
      WHEN e.id IS NULL THEN 'EMPLOYEE_NOT_IN_SAME_EMPRESA'
      WHEN NULLIF(BTRIM(e.device_userid::text), '') IS NULL THEN 'DEVICE_USERID_EMPTY'
      WHEN NULLIF(BTRIM(a.biometric_user_id::text), '') IS NULL THEN 'ASSIGNMENT_PIN_EMPTY'
      WHEN BTRIM(a.biometric_user_id::text) = BTRIM(e.device_userid::text) THEN 'LEGACY_VALUE_MATCH'
      ELSE 'LEGACY_VALUE_DIFFERS'
    END AS assignment_vs_legacy_field,
    length(NULLIF(BTRIM(a.biometric_user_id::text), '')) AS physical_pin_length,
    length(NULLIF(BTRIM(e.pin::text), '')) AS functional_pin_length,
    length(NULLIF(BTRIM(e.device_userid::text), '')) AS legacy_value_length
  FROM public.device_employee_assignments a
  LEFT JOIN public.empleados e
    ON e.id = a.employee_id
   AND e.cliente_id = a.cliente_id
)
SELECT
  assignment_vs_functional_pin,
  assignment_vs_legacy_field,
  assignment_activo,
  count(*) AS assignment_count
FROM assignment_identity
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3 DESC;

-- Casos a conciliar mediante IDs internos. No expone valores de PIN.
SELECT
  assignment_id,
  cliente_id,
  device_id,
  employee_id,
  assignment_activo,
  assignment_vs_functional_pin,
  assignment_vs_legacy_field,
  physical_pin_length,
  functional_pin_length,
  legacy_value_length
FROM assignment_identity
WHERE assignment_vs_functional_pin <> 'PIN_MATCH'
ORDER BY cliente_id, device_id, employee_id, assignment_id;

-- Ningún cambio se permite mientras existan estas categorías activas.
SELECT
  count(*) FILTER (WHERE assignment_activo IS TRUE AND assignment_vs_functional_pin = 'BIOMETRIC_PIN_MISMATCH') AS mismatch_activo,
  count(*) FILTER (WHERE assignment_activo IS TRUE AND assignment_vs_functional_pin = 'EMPLOYEE_PIN_EMPTY') AS pin_funcional_ausente_activo,
  count(*) FILTER (WHERE assignment_activo IS TRUE AND assignment_vs_functional_pin = 'ASSIGNMENT_PIN_EMPTY') AS pin_fisico_ausente_activo,
  count(*) FILTER (WHERE assignment_activo IS TRUE AND assignment_vs_functional_pin = 'EMPLOYEE_NOT_IN_SAME_EMPRESA') AS colaborador_fuera_de_empresa_activo
FROM assignment_identity;

ROLLBACK;
