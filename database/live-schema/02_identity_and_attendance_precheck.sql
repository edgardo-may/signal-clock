-- Signum Clock: auditoría de identidad y asistencia sobre la base real.
-- SOLO LECTURA. No muestra PINes, templates, nombres ni identificadores personales.

BEGIN TRANSACTION READ ONLY;

-- Empresa: el campo visible existente se audita como id_empresa.
SELECT
  count(*) AS empresas_totales,
  count(*) FILTER (WHERE NULLIF(BTRIM(id_empresa::text), '') IS NULL) AS id_empresa_vacio_o_null,
  count(*) FILTER (WHERE NULLIF(BTRIM(id_empresa::text), '') IS NOT NULL) AS id_empresa_presente
FROM public.clientes;

SELECT
  count(*) AS grupos_id_empresa_duplicada,
  COALESCE(sum(row_count), 0) AS empresas_involucradas
FROM (
  SELECT BTRIM(id_empresa::text), count(*) AS row_count
  FROM public.clientes
  WHERE NULLIF(BTRIM(id_empresa::text), '') IS NOT NULL
  GROUP BY BTRIM(id_empresa::text)
  HAVING count(*) > 1
) duplicates;

-- Colaboradores: los identificadores se cuentan por separado.
SELECT
  count(*) AS colaboradores_totales,
  count(*) FILTER (WHERE NULLIF(BTRIM(clave_empleado::text), '') IS NULL) AS clave_empleado_vacia_o_null,
  count(*) FILTER (WHERE NULLIF(BTRIM(pin::text), '') IS NULL) AS pin_vacio_o_null,
  count(*) FILTER (WHERE NULLIF(BTRIM(device_userid::text), '') IS NULL) AS device_userid_vacio_o_null,
  count(*) FILTER (
    WHERE NULLIF(BTRIM(pin::text), '') IS NOT NULL
      AND NULLIF(BTRIM(clave_empleado::text), '') IS NOT NULL
      AND BTRIM(pin::text) = BTRIM(clave_empleado::text)
  ) AS pin_igual_clave_empleado,
  count(*) FILTER (
    WHERE NULLIF(BTRIM(pin::text), '') IS NOT NULL
      AND NULLIF(BTRIM(clave_empleado::text), '') IS NOT NULL
      AND BTRIM(pin::text) <> BTRIM(clave_empleado::text)
  ) AS pin_distinto_clave_empleado,
  count(*) FILTER (
    WHERE NULLIF(BTRIM(pin::text), '') IS NOT NULL
      AND NULLIF(BTRIM(device_userid::text), '') IS NOT NULL
      AND BTRIM(pin::text) <> BTRIM(device_userid::text)
  ) AS pin_distinto_device_userid
FROM public.empleados;

-- PIN funcional duplicado por empresa; no se revelan valores.
SELECT
  count(*) AS grupos_pin_duplicado_por_empresa,
  COALESCE(sum(row_count), 0) AS colaboradores_involucrados
FROM (
  SELECT cliente_id, BTRIM(pin::text), count(*) AS row_count
  FROM public.empleados
  WHERE NULLIF(BTRIM(pin::text), '') IS NOT NULL
  GROUP BY cliente_id, BTRIM(pin::text)
  HAVING count(*) > 1
) duplicates;

-- La identidad física debe ser única por dispositivo, al menos entre assignments activos.
SELECT
  count(*) AS grupos_assignment_activo_duplicado_por_dispositivo_pin,
  COALESCE(sum(row_count), 0) AS assignments_activos_involucrados
FROM (
  SELECT device_id, BTRIM(biometric_user_id::text), count(*) AS row_count
  FROM public.device_employee_assignments
  WHERE activo IS TRUE
    AND NULLIF(BTRIM(biometric_user_id::text), '') IS NOT NULL
  GROUP BY device_id, BTRIM(biometric_user_id::text)
  HAVING count(*) > 1
) duplicates;

-- Coherencia assignment → colaborador y assignment → dispositivo, sin exponer valores.
SELECT
  count(*) FILTER (WHERE e.id IS NULL) AS assignment_sin_colaborador_de_la_misma_empresa,
  count(*) FILTER (WHERE d.id IS NULL) AS assignment_sin_dispositivo_de_la_misma_empresa,
  count(*) FILTER (
    WHERE e.id IS NOT NULL
      AND NULLIF(BTRIM(a.biometric_user_id::text), '') IS NOT NULL
      AND NULLIF(BTRIM(e.pin::text), '') IS NOT NULL
      AND BTRIM(a.biometric_user_id::text) <> BTRIM(e.pin::text)
  ) AS biometric_pin_mismatch,
  count(*) FILTER (
    WHERE e.id IS NOT NULL
      AND NULLIF(BTRIM(a.biometric_user_id::text), '') IS NOT NULL
      AND NULLIF(BTRIM(e.pin::text), '') IS NULL
  ) AS assignment_con_pin_fisico_y_pin_funcional_ausente
FROM public.device_employee_assignments a
LEFT JOIN public.empleados e
  ON e.id = a.employee_id
 AND e.cliente_id = a.cliente_id
LEFT JOIN public.devices d
  ON d.id = a.device_id
 AND d.cliente_id = a.cliente_id;

-- Seriales normalizados deben permanecer únicos.
SELECT
  count(*) AS grupos_serial_normalizado_duplicado,
  COALESCE(sum(row_count), 0) AS dispositivos_involucrados
FROM (
  SELECT UPPER(BTRIM(serial_number)), count(*) AS row_count
  FROM public.devices
  WHERE NULLIF(BTRIM(serial_number), '') IS NOT NULL
  GROUP BY UPPER(BTRIM(serial_number))
  HAVING count(*) > 1
) duplicates;

-- Timezone: source temporal del dispositivo.
SELECT
  count(*) AS dispositivos_totales,
  count(*) FILTER (WHERE NULLIF(BTRIM(timezone), '') IS NULL) AS timezone_vacio_o_null,
  count(*) FILTER (WHERE NULLIF(BTRIM(timezone), '') IS NOT NULL) AS timezone_presente
FROM public.devices;

-- ATTLOG RAW: identidad lógica actual y resolución mediante dispositivo + PIN físico.
SELECT
  count(*) AS attlog_totales,
  count(*) FILTER (WHERE NULLIF(BTRIM(device_serial), '') IS NULL) AS serial_vacio_o_null,
  count(*) FILTER (WHERE NULLIF(BTRIM(user_id::text), '') IS NULL) AS user_id_vacio_o_null
FROM public.attendance_logs;

SELECT
  count(*) AS grupos_attlog_duplicado_por_serial_pin_timestamp,
  COALESCE(sum(row_count), 0) AS eventos_involucrados
FROM (
  SELECT
    UPPER(BTRIM(device_serial)),
    BTRIM(user_id::text),
    timestamp,
    count(*) AS row_count
  FROM public.attendance_logs
  WHERE NULLIF(BTRIM(device_serial), '') IS NOT NULL
    AND NULLIF(BTRIM(user_id::text), '') IS NOT NULL
  GROUP BY UPPER(BTRIM(device_serial)), BTRIM(user_id::text), timestamp
  HAVING count(*) > 1
) duplicates;

SELECT
  count(*) FILTER (WHERE d.id IS NULL) AS attlog_sin_dispositivo_resoluble,
  count(*) FILTER (WHERE d.id IS NOT NULL AND a.id IS NULL) AS attlog_sin_assignment_fisico_activo,
  count(*) FILTER (WHERE a.id IS NOT NULL AND e.id IS NULL) AS attlog_assignment_sin_colaborador_de_la_misma_empresa,
  count(*) FILTER (WHERE a.id IS NOT NULL AND e.id IS NOT NULL) AS attlog_resoluble_por_dispositivo_pin
FROM public.attendance_logs l
LEFT JOIN public.devices d
  ON UPPER(BTRIM(d.serial_number)) = UPPER(BTRIM(l.device_serial))
LEFT JOIN public.device_employee_assignments a
  ON a.device_id = d.id
 AND a.cliente_id = d.cliente_id
 AND BTRIM(a.biometric_user_id::text) = BTRIM(l.user_id::text)
 AND a.activo IS TRUE
LEFT JOIN public.empleados e
  ON e.id = a.employee_id
 AND e.cliente_id = d.cliente_id;

-- Normalización actual: posibles duplicados operativos. No afirma aún relación RAW
-- porque registro_asistencia no expone source_log_id en el contrato real observado.
SELECT
  count(*) AS grupos_registro_duplicado_por_empleado_dispositivo_fecha,
  COALESCE(sum(row_count), 0) AS registros_involucrados
FROM (
  SELECT empleado_id, dispositivo_id, verificado_at, count(*) AS row_count
  FROM public.registro_asistencia
  GROUP BY empleado_id, dispositivo_id, verificado_at
  HAVING count(*) > 1
) duplicates;

ROLLBACK;
