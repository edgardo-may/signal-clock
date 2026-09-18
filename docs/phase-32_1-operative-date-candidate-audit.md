# Fase 32.1 — Operative Date Candidate Audit

Estado: auditoría de código completada; clasificación de candidatos reales pendiente de post-audit read-only. Production SHADOW no fue ejecutado.

## Hallazgo: 2026-09-06 → 2026-09-05

El precheck de Fase 31 construye dos fechas por registro: `local_event_date` y `local_event_date - 1`. Para ambas acepta una asignación vigente y `dias_config` activo con `entrada`/`salida` no vacías. No evalúa la hora del evento ni la ventana pre/post de `ShiftMatcher`.

Por eso `ede89226-c2ef-464b-809d-c571013a8c25` puede mostrar `operative_date = 2026-09-05`: la fecha previa fue incluida por la heurística y tenía una configuración válida bajo ese predicado. `has_night_schedule = false` significa sólo que para esa fila `salida <= entrada` fue falso; no impedía que el SQL mostrara la fecha previa. Lo mismo aplica a `13006bce-63d0-47da-8999-ee5b551c3de0`.

Es un bug de aprobación del precheck: `ELIGIBLE_REVIEW_REQUIRED` no había sido contrastado con la ventana real del motor. No demuestra un error de datos ni que el engine asigne incorrectamente el sábado.

## Equivalencia con el motor

`AttendanceEngineOrchestrator._selectWorkday` evalúa fecha local y previa, pero normaliza el evento y llama `ShiftMatcher.match`. Sólo selecciona una fecha si el evento cae en esa ventana. Si hay horario previo pero el evento no cae en su ventana, falla cerrado con `EVENT_OUTSIDE_SCHEDULE_WINDOW`.

Un turno no nocturno puede incluir un evento posterior sólo si cae en la ventana posterior de 180 minutos de ShiftMatcher. Sin hora local del evento ni valores exactos de `entrada`/`salida`, no se puede concluir si existe esa razón válida o un `OPERATIVE_DATE_MISMATCH`.

Para schedule `be4035c8-042c-473b-b25d-b5bf3fb99701`, la evidencia actual es:

| Fecha | Conocido | Pendiente |
| --- | --- | --- |
| Sábado 2026-09-05 | Día activo con entrada/salida no vacías; no cruza medianoche. | Valores exactos y pertenencia del evento a la ventana. |
| Domingo 2026-09-06 | No satisfizo el predicado de candidato válido. | Si está inactivo, faltan horas o hay otra condición inválida. |

No se inventaron valores de `dias_config`.

## Post-audit

Se añadió `database/live-schema/32_1_production_shadow_candidate_postaudit.sql`. Es `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` y revisa sólo los tres IDs reportados. Expone `day_config` completo, activo, entrada, salida, cruce de medianoche, hora local, inicio/fin UTC, ventana equivalente a ShiftMatcher y `event_in_shiftmatcher_window`.

Clasifica sin seleccionar automáticamente: `APPROVED_NORMAL`, `APPROVED_NIGHT`, `OPERATIVE_DATE_MISMATCH`, `AMBIGUOUS_SCHEDULE`, `INVALID`, `UNSCHEDULED` o `REVIEW_REQUIRED`.

Hasta ejecutar y revisar el post-audit:

    APPROVED_NORMAL_CANDIDATE = NONE
    APPROVED_NIGHT_CANDIDATE = NONE
    NIGHT_CANDIDATES_FOUND = 0

Los turnos nocturnos siguen demostrados por fixtures/tests, no por candidato real.

## Production runner audit

Se añadió `backend/scripts/run-production-workday-shadow-canary.js`, pero no se ejecutó. La Fase 33 fija el UUID aprobado como argumento explícito y alinea URL/key con el contrato backend existente; ver documentación de Fase 33 para la guard de destino y variables requeridas.

El guard de destino pasó pruebas estáticas. Configuración real, host, credenciales, runtime desplegado, logger operativo y lecturas contra DB real no se verificaron: el runner está bloqueado operacionalmente.

## Verificación

- Fase 32.1: 10/10 PASS (guard, static zero-write y SQL read-only).
- Regresión Fases 26, 27, 30, 31 y 32.1: 67/67 PASS.
- Typecheck: PASS.
- No hubo SQL remoto, RPC, workday rows, incidencias, backfill ni cambios legacy.

## Estado

    PHASE 32.1: FAIL — falta ejecutar/revisar post-audit read-only para clasificar datos reales
    PRECHECK BUG: YES
    ENGINE BUG: NO
    SCHEDULE CONFIGURATION ISSUE: NOT DETERMINED
    PRODUCTION RUNNER: BLOCKED (environment and candidate approval)
    DESTINATION GUARD: PASS
    PRODUCTION ENV: BLOCKED
    PRODUCTION READ REPOSITORIES: BLOCKED (not exercised against real DB)
    ZERO-WRITE STATIC AUDIT: PASS
    WORKDAY PERSISTENCE ACCESSIBLE: NO
    RPC UPSERT ACCESSIBLE: NO
    SAFE TO RUN PRODUCTION SHADOW CANARY: NO
