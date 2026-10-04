# Arquitectura de fuentes de asistencia

La base real es la autoridad. `attendance_source_events` fue aplicada y validada
en PostgreSQL para nuevos eventos ZKTeco; Web y App siguen planificadas e inactivas.

## Flujo común

```text
ZKTeco / Web / App
        |
        v
attendance_source_events (RAW universal)
        |
        v
normalizador único -> registro_asistencia -> Attendance Engine (fase futura)
```

ZKTeco conserva además su RAW especializado:

```text
/iclock/cdata -> attendance_logs -> attendance_source_events (ZKTECO)
```

El endpoint ADMS responde después de guardar `attendance_logs`; un fallo de
normalización nunca debe perder ni rechazar el ATTLOG.

## Identidad e idempotencia

- ZKTeco: `devices.serial_number` normalizado + `device_employee_assignments`
  (`device_id`, `cliente_id`, `biometric_user_id`) resuelven al colaborador.
  No se usa una búsqueda global por `clave_empleado`, `empleados.pin` ni
  `empleados.device_userid`.
- `attendance_logs.user_id` conserva `empleados.clave_empleado` resuelta.
- `raw_payload.hardware_user_id` conserva exactamente el identificador recibido
  por el dispositivo.
- Web/App: el colaborador se obtiene de la sesión autenticada; el frontend no
  es autoridad para `employee_id`. `request_id` UUID es la clave de reintento.
- Los índices únicos PostgreSQL resuelven la carrera de reintentos. La futura
  normalización enlazará `registro_asistencia.source_event_id`; los históricos
  sin evidencia permanecerán sin vínculo.

## Fuentes y políticas

`ZKTECO` es la única fuente CURRENT. `WEB` y `MOBILE_APP` son PLANNED e
inactivas. No se exponen endpoints hasta existir una política explícita de
Empresa, autenticación, rate limiting y pruebas de idempotencia.

## Datos sensibles

`raw_payload` admite únicamente contexto operativo mínimo. Nunca se guardan
tokens, cookies, contraseñas, templates, huellas, rostros, fotografías ni
headers de autorización. `received_at` lo genera el backend; `client_timestamp`
es solo contexto para Web/App.

## Orden seguro

1. Mantener la validación de 07 y la aplicación ya confirmada de 08.
2. Crear source events después de persistir `attendance_logs`, usando el UUID
   real y `createOrGet` respaldado por índices UNIQUE.
3. Aplicar `registro_asistencia.source_event_id` solo después de su precheck y
   sin backfill por similitud.
4. Mantener Web/App deshabilitadas hasta aprobar sus políticas y endpoints.

No se modifican migraciones históricas ni se realizan cambios destructivos.
