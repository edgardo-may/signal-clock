# Current Database Contract

Estado: auditado parcialmente contra la base configurada el 2026-09-05 mediante
el documento OpenAPI de Supabase y consultas agregadas de solo lectura. Este
documento no trata las migraciones históricas como fuente de verdad.

`cliente_id` es el UUID técnico interno de la Empresa. Se conserva en relaciones,
seguridad y RLS; no debe sustituirse por una clave visible.

## Alcance de verificación

| Marca | Significado |
|---|---|
| **CONFIRMED** | Confirmado contra el endpoint configurado de la base real. |
| **INFERRED** | Deducido de datos o código; no sustituye una definición instalada. |
| **LEGACY** | Referencia histórica sin autoridad en el contrato actual. |
| **DEPRECATED CANDIDATE** | Campo aún usado por consumidores que primero deben migrarse. |
| **MISSING** | No aparece en el esquema público expuesto. No debe asumirse disponible. |
| **TO BE INTRODUCED** | Propuesta; no existe ni ha sido aplicada. |

No se consultaron ni se documentan templates, imágenes, huellas, rostros, secretos
ni valores de PIN.

## Empresa

Tabla canónica: `public.clientes` — **CONFIRMED**.

| Campo | Tipo | Uso canónico |
|---|---|---|
| `id` | UUID | Identificador técnico de Empresa; se propaga como `cliente_id`. |
| `id_empresa` | `character varying` | Identificador funcional visible de Empresa. |
| `nombre_empresa` | text | Nombre visible. |
| `estado`, `estatus` | text | Estado comercial u operativo; semántica pendiente de catálogo y código. |
| `limite_empleados`, `limite_dispositivos` | integer | Límites de plan. |
| `biometric_sync_policy` | text | Política de sincronización biométrica; semántica pendiente de auditoría funcional. |
| `fecha_vencimiento`, `plan_suscripcion` | date, text | Suscripción. |

No existe `clientes.clave_empresa` en el contrato expuesto. La clave visible real
es `id_empresa`.

Los datos actuales no contienen `id_empresa` vacíos ni grupos duplicados. Que
exista una restricción `UNIQUE` sigue **pendiente de catálogo**.

## Colaboradores e identidad

Tabla canónica: `public.empleados` — **CONFIRMED**.

| Identificador | Tipo | Rol |
|---|---|---|
| `id` | UUID | Identidad técnica del colaborador. |
| `cliente_id` | UUID | Frontera obligatoria de Empresa. |
| `clave_empleado` | text | Código administrativo/corporativo. No es PIN físico. |
| `pin` | `character varying` | PIN funcional del colaborador. |
| `device_userid` | text | Campo técnico legacy. No es autoridad de resolución ATTLOG. |

No existe `hikvision_device_userid` ni `zkteco_device_userid` en el contrato
expuesto de `empleados`.

Datos agregados actuales:

| Comprobación | Resultado |
|---|---:|
| Colaboradores | 7 |
| Con `clave_empleado` | 7 |
| Con `device_userid` | 7 |
| Con `pin` | 2 |
| Sin `pin` | 5 |
| `pin` distinto de `clave_empleado` | 2 |
| `pin` distinto de `device_userid` | 2 |
| PIN funcional duplicado dentro de una Empresa | 0 grupos |

Conclusión: no se puede imponer todavía que el PIN físico sea igual a
`empleados.pin`. El saneamiento previo debe resolver los PIN funcionales ausentes
y los tres casos ya detectados de diferencia física.

## Dispositivos ZKTeco

Tabla canónica: `public.devices` — **CONFIRMED**.

Campos relevantes: `id`, `cliente_id`, `serial_number`, `timezone`, `is_active`,
`last_activity`, `device_type`, `name`, `location`, `ip_address`, `port`.

El serial debe resolverse como `UPPER(TRIM(serial_number))`. Los datos actuales
no contienen seriales normalizados duplicados ni timezones vacíos. La existencia
de los índices o constraints correspondientes queda **pendiente de catálogo**.

## Asignación física ZKTeco

Tabla canónica: `public.device_employee_assignments` — **CONFIRMED**.

Campos relevantes: `id`, `cliente_id`, `device_id`, `employee_id`,
`biometric_user_id`, `activo`, `sync_status`, `suspension_reason`,
`last_attempt_at`, `last_synced_at`, `last_error`, `retry_count`.

La identidad física objetivo es:

```text
cliente_id + device_id + biometric_user_id → employee_id
```

Resolución canónica de una checada:

```text
UPPER(TRIM(attendance_logs.device_serial))
→ devices.serial_number
→ devices.id + devices.cliente_id
→ device_employee_assignments(device_id, cliente_id, biometric_user_id)
→ empleados.id del mismo cliente_id
```

Datos agregados actuales:

| Comprobación | Resultado |
|---|---:|
| Assignments | 15 |
| PIN físico activo duplicado en el mismo dispositivo | 0 grupos |
| Assignment sin colaborador de la misma Empresa | 0 |
| Assignment sin dispositivo de la misma Empresa | 0 |
| `BIOMETRIC_PIN_MISMATCH` | 3 |
| PIN físico con `empleados.pin` vacío | 12 |

La garantía `UNIQUE(device_id, biometric_user_id)` informada para producción debe
confirmarse en el catálogo antes de usarla como precondición de un cambio.

## ATTLOG RAW

Tabla canónica: `public.attendance_logs` — **CONFIRMED**.

```text
id UUID
device_serial text
user_id text
timestamp timestamptz
status text
verify_type integer
metodo text
created_at timestamptz
```

No existen en el contrato expuesto: `cliente_id`, `biometric_user_id`,
`numero_serie`, `raw_data` ni `source_log_id`.

Contrato funcional vigente (CONFIRMED por decisión de producto): después de
resolver el identificador recibido por el dispositivo mediante Empresa +
dispositivo + `biometric_user_id`, `attendance_logs.user_id` conserva el valor
de `empleados.clave_empleado`. Esto es deliberado y no debe cambiarse en una
corrección de identidad.

La identidad enviada literalmente por el hardware se conserva por separado
como `hardware_user_id` dentro de `attendance_source_events.raw_payload` para
los nuevos eventos ZKTeco. No se reescriben los 20 ATTLOG existentes ni se
mezcla ese valor con `clave_empleado`, `empleados.pin` o `device_userid`.

La resolución debe ser determinística y estar delimitada por:

```text
UPPER(TRIM(device_serial))
→ devices.id + devices.cliente_id
→ device_employee_assignments(device_id, cliente_id, biometric_user_id)
→ empleados.id del mismo cliente_id
→ empleados.clave_empleado para attendance_logs.user_id
```

Si no existe una asignación única, o hay una inconsistencia entre Empresas, se
conserva el RAW y se registra el error; no se realiza una búsqueda global ni se
elige una fila mediante `LIMIT 1`.

Hay 20 ATTLOG RAW. La restricción de idempotencia y los triggers instalados están
pendientes de catálogo.

## Registro normalizado de asistencia

Tabla canónica: `public.registro_asistencia` — **CONFIRMED**.

Campos relevantes: `id`, `cliente_id`, `empleado_id`, `dispositivo_id`,
`verificado_at`, `tipo_verificacion`, `metodo`, `es_manual`, `raw_payload`,
`motivo_manual`, `notas`, `autorizado_por`, `creado_at`.

No existe una columna directa `source_log_id`. Sin embargo, la clave
`raw_payload.source_log_id` está presente en 20 registros automáticos y los 20
apuntan a ATTLOG existentes sin repetición. Los 8 registros sin vínculo son 2
manuales y 6 automáticos; estos últimos requieren clasificación antes de cualquier
backfill.

Por tanto, la relación actual es **INFERRED** desde JSON y no tiene garantía
estructural. Una columna nullable `source_log_id UUID` con índice único parcial es
**TO BE INTRODUCED** solo si el precheck confirma que no existe una protección
equivalente en trigger o índice y que el backfill no encuentra conflictos.

Los seis automáticos sin vínculo están **CONFIRMED** como `WEB_EVENT`: usan método
`web`, no tienen `dispositivo_id`, no contienen contexto de dispositivo o usuario
de hardware en el JSON inspeccionado y son anteriores a la ventana actual de
ATTLOG RAW. No se deben correlacionar por fecha ni completar por aproximación;
permanecerán con `source_log_id = NULL` si se introduce la relación estructural.

## Horarios e incidencias

Tablas canónicas verificadas:

| Tabla | Campos operativos |
|---|---|
| `horarios` | `cliente_id`, `activo`, `dias_config`, `tolerancia_minutos`, `nombre` |
| `empleados_horarios` | `cliente_id`, `empleado_id`, `horario_id`, `activo`, `fecha_inicio`, `fecha_fin` |
| `incidencias` | `cliente_id`, `empleado_id`, `tipo_incidencia`, `estado`, `fecha_inicio`, `fecha_fin` |

Datos agregados actuales:

| Comprobación | Resultado |
|---|---:|
| Horarios activos | 4 / 4 |
| Horarios sin `dias_config` | 0 |
| Horarios sin tolerancia | 0 |
| Asignaciones activas | 1 / 4 |
| Asignaciones activas con rango inválido | 0 |
| Colaboradores con asignaciones activas superpuestas | 0 |
| Incidencias | 5, todas con estado `Aprobado` |
| Incidencias de tipo Retardo | 1 |

La regla futura es que un retardo detectado automáticamente se cree en estado
`Pendiente`, siempre que el catálogo real admita ese valor. La validación del
constraint o catálogo de `incidencias.estado` está **pendiente de catálogo**.

## Jornada electrónica

`workday_records`, `workday_record_history` y `tenant_features` están **MISSING**
en el contrato público expuesto de la base real. Por lo tanto no se pueden usar como
fuente operativa, ni para Dashboard, ni para calcular presentes, faltantes,
retardos, salidas faltantes u horas trabajadas.

## Campos legacy y deprecación

`empleados.device_userid` es **DEPRECATED CANDIDATE** en el modelo de identidad
final, pero todavía tiene consumidores en sincronización y enrolamiento. No se
elimina ni se marca como deprecated en base hasta migrar esos consumidores a la
asignación física por dispositivo.

Los nombres históricos de índices no determinan el fabricante operativo ni deben
provocar cambios cosméticos durante el endurecimiento funcional.

## Scripts de auditoría

## Fuentes universales de asistencia — preparación

`attendance_source_events` existe en la base real y fue aplicada/validada
directamente contra PostgreSQL (**CONFIRMED**). Los scripts
`07_attendance_source_events_precheck.sql` y `08_attendance_source_events.sql`
documentan su precheck y evolución fuera de las migraciones históricas.

El contrato previsto conserva tres fuentes conceptuales:

| Fuente | Estado | Identidad de origen | Política actual |
|---|---|---|---|
| `ZKTECO` | CURRENT | `attendance_logs.id` + dispositivo ZKTeco | Activa en el flujo existente y conectada a la tabla universal para nuevos eventos. |
| `WEB` | PLANNED | `request_id` UUID por Empresa | Inactiva; no existe endpoint productivo. |
| `MOBILE_APP` | PLANNED | `request_id` UUID por Empresa | Inactiva; no existe aplicación ni endpoint productivo. |

La propuesta usa `cliente_id` como UUID técnico de Empresa, `source_type` y
`source_reference` estructurados, y `raw_payload` únicamente como evidencia
acotada. La idempotencia prevista es un índice único parcial para ATTLOG y otro
por Empresa + `request_id` para Web/App. La propuesta no modifica ni elimina
`attendance_logs`.

La implementación TypeScript en `zkteco-push-ta/src/attendance-sources/` es el
contrato/adaptador de ZKTeco. El repositorio se conecta únicamente después de
persistir `attendance_logs`; Web/App permanecen deliberadamente **DORMANT** y
no cambian el ACK ADMS. La creación de source events nuevos requiere que la
tabla validada permanezca disponible y sus índices únicos activos.

No existe todavía una tabla confirmada de políticas por fuente. `clientes` y el
sistema de módulos deben auditarse antes de decidir si se reutilizan o se crea
una configuración específica; no se agregan columnas por anticipación.

| Archivo | Uso |
|---|---|
| `database/live-schema/01_current_schema_audit.sql` | Catálogo PostgreSQL manual, solo lectura: constraints, índices, triggers, funciones, RLS, grants y roles. |
| `database/live-schema/02_identity_and_attendance_precheck.sql` | Conteos y coherencia de identidad/asistencia, solo lectura. |
| `database/live-schema/03_attendance_linkage_audit.sql` | Conteos RAW → normalizado mediante `raw_payload.source_log_id`, solo lectura. |
| `database/live-schema/04_attendance_identity_idempotency_precheck.sql` | Precondiciones para endurecer identidad e idempotencia, solo lectura. |
| `database/live-schema/05_pin_reconciliation_audit.sql` | Clasifica cada assignment por IDs internos y longitudes, sin revelar PINes. |
| `database/live-schema/06_unlinked_automatic_records_audit.sql` | Clasifica automáticos no vinculados por evidencia, sin valores de payload. |
| `scripts/read-live-openapi-schema.mjs` | Descubrimiento no mutante del contrato público configurado. |
| `scripts/audit-live-identity.mjs` | Conteos agregados de Empresa, identidad, dispositivos y assignments. |
| `scripts/audit-live-attendance-contract.mjs` | Conteos agregados de horarios, incidencias y asistencia. |
| `scripts/audit-unlinked-normalized-records.mjs` | Clasificación agregada de automáticos sin vínculo RAW. |

No se generó `schema-current.sql`: el workspace no dispone de una conexión
PostgreSQL directa de auditoría y el generador existente rechaza expresamente
producción. No se debe fabricar un DDL inferido desde migraciones.
