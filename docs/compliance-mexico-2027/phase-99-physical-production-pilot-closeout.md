# Phase 99 — Cierre del piloto físico productivo

**Sistema:** Signum Clock  
**Alcance:** primer ciclo físico productivo completo con terminal ZKTeco  
**Estado:** CLOSED / PASS — observación del piloto activa

## 1. Identificación

| Campo | Valor |
| --- | --- |
| Tenant | `69095bd5-fee5-4237-a1a4-186dd88310ff` |
| Empleado | `6c94a683-1fbd-4427-af9e-8ea154ea50fa` |
| Schedule | `5a753368-f019-4230-89e2-79beaa39ff0f` |
| Schedule revision | `09df6a75-e231-4654-ae70-8448bdf2c312` |
| Revision hash | `77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866` |
| Workday | `99564a66-28bc-4fa8-94cf-41eb2f13538b` |

## 2. Primer punch físico

| Evidencia | ID / resultado |
| --- | --- |
| Attendance log | `8dbf602f-a430-4a4d-b1a8-2f00b81c2ea2` |
| Source event | `172bfeab-4fbe-4278-a9f6-f474898fd419` |
| Registro | `8d5b2af8-7119-4aeb-8205-f4d36b4f4e8e` |
| Outbox | `9510a575-7af3-4300-a2bb-7d3dbf60d73e` |
| Resultado | `SUCCEEDED` |
| Persistence result | `INSERTED` |
| Attempt count | `1` |
| Last error code | `NULL` |
| Workday | `99564a66-28bc-4fa8-94cf-41eb2f13538b` |

La primera persistencia creó una jornada inicial con:

```text
status = INCOMPLETE
first_in = 2026-09-22T00:42:45+00
last_out = NULL
source_event_count = 1
calculation_version = 3
```

La fila correspondiente del historial tuvo `action = INSERTED`.

## 3. Bug de linking y corrección Phase 99

El bug estaba en `link_attendance_source_event(uuid)`. El orden anterior era:

1. Actualizar `registro_asistencia.source_event_id`.
2. Ejecutar el trigger `enqueue_attendance_persist_outbox`.
3. El enqueue exigir que el source event estuviera en `PROCESSED`.
4. Marcar el source event como `PROCESSED` después.

Ese orden producía `PRODUCTIVE_PERSIST_CANONICAL_SOURCE_INVALID`. La transacción hacía rollback completo: el source event permanecía `PENDING`, `registro_asistencia.source_event_id` permanecía `NULL` y `outbox_rows = 0`.

Phase 99 corrigió el orden en [database/live-schema/99_link_attendance_source_event_order_fix.sql](../../database/live-schema/99_link_attendance_source_event_order_fix.sql):

1. Ejecutar las validaciones originales.
2. Marcar `attendance_source_events` como `PROCESSED`.
3. Confirmar el estado procesado.
4. Enlazar `registro_asistencia.source_event_id`.
5. Permitir que el trigger cree el outbox.
6. Mantener todo atómico en la misma transacción.

**Commit:** `1eba2611ff3cbe0b072b8e46665ab4b800e50c24`

Validaciones del cambio:

- Phase 99 static: PASS
- PostgreSQL AD + rollback: 11/11 PASS
- DBREAL Workday Evolution: 15/15 PASS
- Attendance/Workday regression: 86/86 PASS
- `npm test`: 22/22 PASS
- `npm run build`: PASS
- `git diff --check` scoped: PASS

## 4. Segundo punch físico

| Evidencia | ID / resultado |
| --- | --- |
| Attendance log | `d7ab7c24-6285-4995-a4fd-fdb9947ede76` |
| Source event | `7af6c0f6-4dc7-47e1-b2a2-54f3ffdf3a22` |
| Registro | `9da7be9d-2d52-447e-b694-3edc9eb2efb2` |
| Outbox | `3ac879cf-d069-4f67-a4a4-72b7195827c5` |
| Resultado | `SUCCEEDED` |
| Persistence result | `UPDATED` |
| Attempt count | `1` |
| Last error code | `NULL` |
| Workday | el mismo `99564a66-28bc-4fa8-94cf-41eb2f13538b` |

El segundo evento llegó automáticamente: `processing_status = PROCESSED`, `registro_asistencia.source_event_id` quedó enlazado y el outbox se creó sin intervención manual.

## 5. Estado final del workday

```text
status = COMPLETE
first_in = 2026-09-22T00:42:45+00
last_out = 2026-09-22T01:47:09+00
worked_minutes = 64
late_minutes = 643
early_leave_minutes = 0
overtime_minutes = 0
source_event_count = 2
source_observed_at = 2026-09-22T01:47:09+00
calculation_version = 3
integrity_hash = f73f20d120ed50ea3f1131477287322b96276b7ccd6f6a94408be2c53bded492
```

## 6. Evolución e historial

| Fila | Acción | Status | Source events | Integrity hash |
| --- | --- | --- | --- | --- |
| 1 | `INSERTED` | `INCOMPLETE` | 1 | `91f78b78512f9ce585f7e33b1f89c88c2ebd3a2c4339efd776fdd2461c3dba34` |
| 2 | `UPDATED` | `COMPLETE` | 2 | `f73f20d120ed50ea3f1131477287322b96276b7ccd6f6a94408be2c53bded492` |

La evolución fue `INSERTED → UPDATED` sobre un único `workday_id`; no se creó un segundo workday.

## 7. Validación de `late_minutes`

La revisión canónica tiene lunes activo, entrada `09:00`, salida `18:00`, tolerancia de 10 minutos y timezone del workday `America/Cancun`.

El primer punch fue `2026-09-21 19:42:45 America/Cancun`. El retraso bruto desde las `09:00` fue `38565` segundos, es decir, `642.75` minutos.

`WorkdayCalculator.calculateMultiplePunches` y `calculateSinglePunch` aplican la misma regla:

```text
si arrival <= start + tolerance:
    late_minutes = 0
si arrival > start + tolerance:
    late_minutes = Math.round(arrival - scheduled_start)
```

La tolerancia funciona como **umbral**. Hasta `09:10:00` inclusive el resultado es cero; después se cuenta la diferencia completa desde las `09:00`. `Math.round(642.75) = 643`.

**Veredicto:** `late_minutes = 643` es **CORRECTO**.

## 8. Vercel

Existía un fallo previo de deployment, independiente de Phase 99, en `src/features/employees/pages/EmpleadosPage.jsx`:

```diff
- ../../features/biometrics/services/syncService
+ ../../biometrics/services/syncService
```

El fix quedó en main mediante el commit `3655c8662063f1a24ed68e028003192afecda3cb`. Los checks quedaron en `SUCCESS`:

- Vercel `signal-clock`
- Vercel `signal-clock-api-integracion-test`

Este bloqueo de deployment no forma parte de Attendance ni de Phase 99.

## 9. Política de observación del piloto

| Campo | Política |
| --- | --- |
| Tenant piloto | `69095bd5-fee5-4237-a1a4-186dd88310ff` |
| Feature | `WORKDAY_PERSIST_ACTIVE` |
| Modo | `PERSIST_ACTIVE` |
| Periodo | 7 días calendario de operación real |

Durante el periodo se observarán errores terminales inesperados, `PERSIST_SNAPSHOT_CONFLICT`, `PRODUCTIVE_PERSIST_CANONICAL_SOURCE_INVALID`, duplicados, pérdida de checadas, inconsistencias workday/history, acumulación anormal de outbox, errores repetitivos de runtime/dispatcher, jornadas nocturnas, `worked_minutes`, `late_minutes`, `early_leave`, `overtime` y aislamiento tenant.

La expansión requiere: 7 días completados, cero errores críticos de persistencia, cero corrupción workday/history, cero pérdida de checadas, idempotencia y reintentos sin efectos secundarios, y operación estable.

## 10. Estado final

| Componente | Estado |
| --- | --- |
| Physical ZKTeco input | PASS |
| `attendance_logs` | PASS |
| `attendance_source_events` | PASS |
| Source-event linking | PASS |
| `registro_asistencia` | PASS |
| Outbox | PASS |
| Dispatcher | PASS |
| Runtime v3 | PASS |
| Workday `INSERTED` | PASS |
| Workday `UPDATED` | PASS |
| History `INSERTED/UPDATED` | PASS |
| Phase 99 DBREAL/regression | PASS |
| `late_minutes` validation | PASS |
| Vercel deployment | PASS |

**FINAL VERDICT:** `PRODUCTIVE PILOT CORE FLOW = PASS`  
**ROLLOUT STATUS:** `CLOSED / PILOT OBSERVATION ACTIVE`
