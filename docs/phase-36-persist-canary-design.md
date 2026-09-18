# Fase 36 — diseño del Persist Canary

Estado: diseño y auditoría local completados. No existe un escritor de canary
ni se ha ejecutado persistencia contra Supabase.

## Identidad autorizable (aún no autorizada para escribir)

El único posible canary es la identidad lógica:

- `registro_id`: `7f99cef9-4100-48ff-9aaf-68548c80c948`
- `cliente_id`: `69095bd5-fee5-4237-a1a4-186dd88310ff`
- `empleado_id`: `6c94a683-1fbd-4427-af9e-8ea154ea50fa`
- `workday_date`: `2026-09-03`
- `schedule_id`: `be4035c8-042c-473b-b25d-b5bf3fb99701`
- `calculation_version`: `3`

El resultado canónico V3 que un manifest fresco de SHADOW debe transportar al
precheck/postcheck incluye firstIn, firstOut, todas las métricas, estado e
integrity hash. El hash nunca se fija en SQL: se toma del replay SHADOW fresco
aprobado para la ejecución concreta.

## Write path auditado

El camino actual sería:

`AttendanceEngineOrchestrator` → `WorkdayPersistenceService.persist` →
`public.upsert_workday_record` → `public.workday_records`.

La RPC actual devuelve `INSERTED`, `UPDATED` o `UNCHANGED` por identidad
`(cliente_id, empleado_id, workday_date)`. No escribe `incidencias`,
`registro_asistencia` ni `attendance_source_events`.

El contrato instalado no recibe/persiste `calculation_version` y no escribe
`workday_record_history`. Por eso no puede demostrar los invariantes V3 ni el
historial solicitados para un primer canary. Esta fase no cambia ese contrato.

## Guardas independientes

Un futuro escritor debe exigir, además de una comprobación interna de toda la
identidad aprobada:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (sólo presencia; jamás imprimirla)
- `PERSIST_CANARY_ALLOWED_HOST`
- `PERSIST_CANARY_ENVIRONMENT=PRODUCTION_PERSIST_CANARY`
- `PERSIST_CANARY_CONFIRMATION=I_APPROVE_ONE_CANONICAL_WORKDAY_PERSIST_CANARY`
- `PERSIST_CANARY_REGISTRO_ID`
- `PERSIST_CANARY_CLIENTE_ID`
- `PERSIST_CANARY_EMPLEADO_ID`
- `PERSIST_CANARY_SCHEDULE_ID`
- `PERSIST_CANARY_OPERATIVE_DATE`
- `PERSIST_CANARY_CALCULATION_VERSION=3`

Estas guardas no reutilizan autorización de SHADOW. Host, entorno,
confirmación, registro o cualquier componente de identidad diferente fallan
cerrados antes de que exista un cliente de escritura.

## Precheck, write y postcheck futuros

La evidencia local de la ejecucion debe incluir una regresion V3 aprobada y
el fingerprint concreto de la RPC aprobado para esa ejecucion. El SQL los
reporta pero no inventa su aprobacion ni los almacena en Supabase.

`database/live-schema/36_persist_canary_precheck.sql` es read-only y verifica
la identidad, Empresa, timezone, asignación única, estado de la identidad
lógica, RPC/fingerprint y capacidad de schema. También expone bloqueadores.

El futuro write sólo podrá comenzar tras un precheck PASS y un manifest V3
fresco. El alcance máximo será una sola identidad lógica. Antes de invocar la
RPC, verificará de nuevo dicha identidad y que el conteo es cero o uno. Más de
uno bloquea.

El postcheck diseñado debe consumir el mismo manifest de ejecución, no conteos
históricos: exige una identidad lógica, cero identidades adicionales, cero
incidencias, versión 3, history esperado y coincidencia exacta de firstIn,
lastOut, métricas, estado e integrity hash. `verifyPersistCanaryPostcheck` es
el contrato puro y testeado para esa comparación; no contacta Supabase.

## Write set esperado (condicional)

| Tabla | Antes | Operación permitida | Después |
| --- | --- | --- | --- |
| `public.workday_records` | 0 para la identidad | un `INSERTED` vía RPC | 1 |
| `public.workday_records` | 1 idéntica | `UNCHANGED` vía RPC | 1 |
| `public.workday_records` | 1 distinta | bloqueado; no hay `UPDATED` automático | 1 sin cambio |
| `public.workday_record_history` | contrato no disponible | bloqueado | sin cambio |
| `public.incidencias` | cualquiera | ninguna | sin cambio |
| `public.registro_asistencia` / `attendance_source_events` | cualquiera | ninguna | sin cambio |

El primer run pretendido sería `INSERTED`; un segundo replay exacto debe ser
`UNCHANGED`. Un snapshot existente distinto bloquea el canary en vez de
autorizar un UPDATE. El contrato de history aún no existe, por lo que no se autoriza
ninguna de estas operaciones productivas.

## Recuperación

No habrá DELETE automático. Si un canary futuro inserta una jornada correcta,
se conserva como evidencia auditable. Cualquier corrección o reversión exige
una fase separada, precheck/postcheck, análisis del history y un mecanismo
aprobado de compensación; borrar una jornada y su evidencia para restaurar
conteos no es una recuperación aceptable.

## Estado de autorización

`SAFE TO RUN PERSIST CANARY = NO` hasta que una fase separada defina e instale
un contrato productivo para `calculation_version = 3`, history auditable y la
compatibilidad de tenant feature, seguido de sus propios precheck, pruebas y
postcheck. `SAFE TO ACTIVATE ENGINE = NO`.
