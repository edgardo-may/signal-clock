# Fase 22 — Blockers del Attendance Engine y auditoría legacy

Estado: precheck preparado; pendiente adjuntar su salida de producción. La
fuente de verdad es la base Supabase real. El script
`database/live-schema/22_attendance_engine_blockers_precheck.sql` usa
`BEGIN TRANSACTION READ ONLY` y termina con `ROLLBACK`; no ejecuta la función,
el trigger ni una RPC.

## Hechos confirmados

- `registro_asistencia`: 31 filas; `horarios`: 4;
  `empleados_horarios`: 4; `incidencias`: 5; `devices`: 3; `empleados`: 7.
- `horarios` contiene `cliente_id`, `nombre`, `tolerancia_minutos`,
  `dias_config` JSONB y `activo`.
- `empleados_horarios` contiene `cliente_id`, `empleado_id`, `horario_id`,
  `fecha_inicio`, `fecha_fin` y `activo`.
- Las cinco incidencias existentes usan `tipo_incidencia` y `estado`; el default
  de `estado` es `Pendiente` y el valor observado es `Aprobado`. No se alteran.
- `devices.timezone = America/Cancun` es la timezone ZKTeco observada.
- `tenant_features`, `workday_records` y `workday_record_history` no existen.
- Existe `trg_evaluar_retardo`, `AFTER INSERT` por fila en
  `registro_asistencia`, que llama
  `public.fn_evaluar_retardo_asistencia()`.

Por tanto, `WORKDAY TABLES EXIST: NO` y
`NEW WORKDAY BASELINE REQUIRED: YES`. Las migraciones históricas no son
autoridad ni deben ejecutarse para reconstruir esos objetos.

## Auditoría del mecanismo legacy

El precheck obtiene desde `pg_proc` y `pg_get_functiondef()` la firma,
propietario, lenguaje, `SECURITY DEFINER`/`INVOKER`, `search_path`, settings y
ACL `EXECUTE` reales. Conserva también el DDL del trigger, dependencias de
`pg_depend`, referencias textuales a relaciones y las líneas relevantes de la
definición instalada.

Esto permite decidir con evidencia si la función consulta/modifica tablas,
inserta `incidencias`, qué `tipo_incidencia`/`estado` usa, cómo resuelve
horario y tolerancia, cómo trata ausencia de horario, entrada/salida, Empresa,
empleado, fechas, timezone, noche y duplicados. La definición completa es la
autoridad: las banderas de texto sólo son ayuda de navegación, particularmente
para PL/pgSQL y SQL dinámico, que pueden no dejar todas sus dependencias en
catálogo.

El DDL del trigger prueba que la función se invoca inmediatamente después de
cada inserción de `registro_asistencia`. No prueba por sí mismo que cree una
incidencia, qué estado asigne, ni que sea idempotente.

Las cinco incidencias se listan sin descripción libre. SQL no puede certificar
que texto libre no contenga datos sensibles; una descripción sólo se puede
resumir después de clasificación humana. Una coincidencia de tipo o fecha con
la función es compatibilidad potencial, no prueba de procedencia: no existe aún
una llave de fuente, jornada o detección en `incidencias`.

## Integridad, horarios y RLS

El precheck compara `incidencias.cliente_id` con `empleados.cliente_id`, lista
FKs/índices sin crear ninguno, y calcula los mismatches. Para asignaciones,
compara Empresa de asignación, empleado y horario. Dos asignaciones activas del
mismo empleado con rangos cerrados superpuestos (`fecha_fin NULL` es abierto)
son un blocker: el futuro motor debe fallar por ambigüedad, no escoger una.

Para cada día `lun` a `dom`, un día activo requiere `entrada` y `salida` en
`HH:MM`; descansos se validan únicamente si están definidos. `salida <= entrada`
es `NIGHT_SHIFT_CANDIDATE`, nunca inválido: `22:00 → 06:00` pertenece a la
fecha de entrada.

Se listan todas las policies reales de `public.devices`. El veredicto falla si
RLS está apagado o una policy `PERMISSIVE` aplicable a `authenticated`/`PUBLIC`
permite `SELECT`/`ALL`, `INSERT`/`ALL` o `UPDATE`/`ALL` sin frontera textual de
`cliente_id` en el lado pertinente. La salida identifica por nombre las
policies que abren lectura, creación o modificación. Si la frontera está
delegada a una función, debe probarse manualmente antes de declarar PASS.

## Revisión limitada de código

Se revisaron sólo `src/domain/attendance/*` y los servicios Workday directos.
No se tomaron migraciones como evidencia de producción.

| Parte | Clasificación | Contraste con el contrato real |
| --- | --- | --- |
| `AttendanceNormalizer` | NEEDS ADAPTATION | Valida Empresa/empleado y timezone; requiere adaptador explícito desde `registro_asistencia.verificado_at`, `tipo_verificacion`, `empleado_id`, `cliente_id` y `dispositivo_id`. |
| `ShiftMatcher` | REUSABLE | Modela `salida <= entrada` y conserva como `operativeDate` la fecha de entrada. |
| `WorkdayCalculator` | REUSABLE | Cálculo puro de pares, descansos, retardos, salida anticipada y horas extra; la dirección/tipo de verificación debe venir del adaptador. |
| `timezoneUtils` | REUSABLE | Usa IANA explícita; debe recibir `devices.timezone`, no timezone de servidor. |
| `WorkdayIntegrityHasher` | REUSABLE | Justifica `integrity_hash` mediante un payload canónico con identidad, horario, métricas y fuentes. |
| `WorkdayPersistenceService` | BLOCKED | Depende de `upsert_workday_record` y del contrato workday que no existen en producción. |
| `WorkdayReprocessService` | OBSOLETE para producción actual | Requiere `tenant_features`, presupone timezone de cliente, usa contratos de `attendance_logs` no contrastados para Workday y termina en la persistencia bloqueada. Debe rediseñarse. |

Resultado agregado: `ATTENDANCE ENGINE CODE REUSABLE: PARTIAL`.

## Baseline recomendado de workday_records

Propuesta, no implementación. La futura tabla debe partir exclusivamente del
contrato real y contener al menos:

| Área | Campos candidatos |
| --- | --- |
| Identidad | `id`, `cliente_id`, `empleado_id`, `workday_date`, `schedule_id`, `timezone` |
| Marcajes | `first_in`, `last_out`, y opcionalmente inicio/fin programados y `schedule_assignment_id` para trazabilidad |
| Métricas | `worked_minutes`, `break_minutes`, `overtime_minutes`, `late_minutes`, `early_leave_minutes` |
| Estado | `status`, `created_at`, `updated_at`, versión de cálculo y evidencia fuente si se aprueba |
| Integridad | `integrity_hash`, justificado por el hasher existente |

La identidad idempotente debe equivaler a
`(cliente_id, empleado_id, workday_date, schedule_id)`. `schedule_id` sólo debe
ser nullable si se aprueba un caso de dominio sin horario y una regla/índice que
impida duplicados con `NULL`. Un overlap nunca se resuelve por orden arbitrario.

## Evolución propuesta de incidencias

Propuesta aditiva, no implementación. Preservar las cinco filas tal como están
y evaluar posteriormente:

- `origen`: `AUTOMATICA` o `MANUAL`, con valor histórico que no afirme una
  procedencia no demostrada;
- `workday_record_id` nullable, con FK sólo tras crear y aislar workday;
- `detection_key` nullable para filas automáticas, única por Empresa y derivada
  de empleado, jornada, tipo y versión de detección; y
- evidencia estructurada de detección separada de texto humano.

Los estados objetivo preliminares son `Pendiente`, `Aprobado` y `Rechazado`.
No se cambian estados, tipos ni filas existentes hasta auditar constraints y
consumidores reales.

## Salida final al adjuntar ejecución

```text
LEGACY LATE TRIGGER EXISTS: YES / NO
LEGACY FUNCTION AUDITED: YES / NO
LEGACY CREATES INCIDENTS: YES / NO / UNKNOWN
LEGACY INCIDENT STATE: <valor o UNKNOWN>
LEGACY IDEMPOTENT: YES / NO / UNKNOWN
LEGACY NIGHT SHIFT SAFE: YES / NO / UNKNOWN

INCIDENT ROWS: 5
INCIDENT TYPES: [<DISTINCT tipo_incidencia>]
INCIDENT STATES: [<DISTINCT estado>]
INCIDENT EMPRESA MISMATCHES: <N>

SCHEDULE ROWS: 4
ASSIGNMENT EMPRESA MISMATCHES: <N>
SCHEDULE OVERLAPS: <N>
INVALID DAY CONFIGS: <N>
NIGHT SHIFT CANDIDATES: <N>

DEVICES TENANT RLS: PASS / FAIL
WORKDAY TABLES EXIST: NO
NEW WORKDAY BASELINE REQUIRED: YES
INCIDENT CONTRACT REQUIRES EXTENSION: YES / NO
ATTENDANCE ENGINE CODE REUSABLE: PARTIAL
LEGACY TRIGGER RECOMMENDATION: BLOCKED
SAFE TO CREATE PHASE 23: NO
```

No se fuerza un YES para Fase 23. La recomendación del trigger debe derivarse
de la función instalada y de la estrategia de coexistencia/idempotencia; esta
fase no mantiene, desactiva, reemplaza ni adapta objetos de producción.

## Resultado real de Fase 22

La ejecución contra producción confirmó: 5 incidencias, 4 horarios, 4
asignaciones, cero overlaps, cero configuraciones de día inválidas y seis
`NIGHT_SHIFT_CANDIDATE`. Los mismatches de Empresa son cero tanto para
incidencias como para asignaciones. Los tipos reales son `Falta Injustificada`,
`Permiso sin Goce de Sueldo` y `Retardo`; el único estado observado es
`Aprobado`.

La función legacy existe, fue capturada y crea incidencias; además menciona
`tolerancia_minutos`. Siguen sin veredicto demostrado su tipo/estado exacto,
idempotencia, aislamiento por Empresa y seguridad en turnos nocturnos. Por eso
la recomendación actual del trigger es `BLOCKED` y Fase 23 no es segura.

RLS de `devices` falló: las policies permissive detectadas abren lectura,
creación y actualización cross-tenant:

- `Active profiles can create devices`
- `Active profiles can view devices`
- `Admins can update ZKTeco devices`
- `Admins can update devices`

## Fase 22.1 — Cierre de blockers previo a Workday

La Fase 22.1 no crea Workday y se ejecuta estrictamente en este orden:

1. `22_1_blockers_hardening_precheck.sql`: READ ONLY; conserva definición
   completa de la función, policies y huellas de todas las filas protegidas.
2. `22_2_devices_rls_hardening.sql`: único cambio autorizado. Reemplaza sólo
   las cuatro policies amplias observadas por policies que usan
   `auth_can_read_tenant(cliente_id)` y `auth_can_write_tenant(cliente_id)`.
   No añade bypass de superadmin ni una capacidad DELETE nueva.
3. `22_3_blockers_hardening_postcheck.sql`: READ ONLY; verifica riesgos RLS y
   vuelve a emitir las huellas.

Comparar `data_snapshot_before` con `data_snapshot_after`, y las huellas del
trigger, es obligatorio. Un precheck y postcheck en transacciones separadas no
pueden por sí solos demostrar que ninguna fila cambió entre dos instantes; las
huellas cubren cada columna de cada fila, incluidos los seriales de devices, sin
exponer datos sensibles.

La Fase 22.1 no toca `registro_asistencia`, incidencias, horarios,
asignaciones, source events, ZKTeco, trigger legacy ni la función legacy.

## Cierre real de Fase 22.1–22.3

Los tres pasos pasaron en producción. Se corrigió la lista inicial de policies:
eran seis, no cuatro. Las seis legacy fueron reemplazadas por exactamente tres
policies `authenticated`: SELECT con `auth_can_read_tenant(cliente_id)`, INSERT
con `auth_can_write_tenant(cliente_id)` y UPDATE con
`auth_can_write_tenant(cliente_id)` en `USING` y `WITH CHECK`. DELETE sigue sin
policy y denegado.

Los riesgos cross-tenant de lectura, inserción y actualización son NO; no hay
policies problemáticas. Las huellas before/after fueron idénticas para devices,
horarios, incidencias, empleados_horarios, registro_asistencia y
attendance_source_events. El fingerprint del trigger legacy también permaneció
en `4cf2a9c9af606713aadb6209886d66af`.

Conclusión: `DEVICE ROWS MODIFIED: NO`, `PRODUCTION BUSINESS DATA MODIFIED: NO`,
`LEGACY TRIGGER MODIFIED: NO` y `SAFE TO CREATE PHASE 23: YES`. El siguiente
artefacto autorizado es el baseline nuevo de Workday; no es una autorización
para activar todavía el Attendance Engine o modificar el mecanismo legacy.
