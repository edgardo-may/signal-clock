# Fase 31 — Local Shadow Canary + Production Readiness

Estado: canary local aislado ejecutado; canary SHADOW de producción bloqueado.

## Local SHADOW

El harness manual es `backend/scripts/run-workday-shadow-canary.js`. No tiene cliente Supabase, red, RPC, listener, cron, trigger ni importación desde un runtime productivo. Sólo acepta la invocación sin argumentos:

    node backend/scripts/run-workday-shadow-canary.js

Un argumento, incluido `--mode=PERSIST`, termina con código 2. El harness fuerza `SHADOW`, usa fixtures fieles a los contratos de `registro_asistencia`, `devices`, `empleados`, `empleados_horarios` y `horarios`, y ejecuta cada caso dos veces.

CANARY NORMAL resolvió horario `normal-schedule`, `America/Cancun`, fecha operativa 2026-09-04, 08:00–17:00, 540 minutos y estado `COMPLETE`. CANARY NIGHT resolvió `night-schedule`, entrada local 2026-09-04 22:00, salida local 2026-09-05 06:00, `operativeDate = 2026-09-04`, 480 minutos y estado `COMPLETE`.

La comparación determinista incluye operativeDate, scheduleId, timezone, actualStart, actualEnd, worked/break/overtime/late/early-leave minutes, workdayState e integrityHash. Ambos replays fueron idénticos.

El repositorio fixture cuenta intentos de escritura y el spy de persistencia lanza si fuese invocado. Resultado:

    PERSISTENCE CALL COUNT = 0
    WRITE CALL COUNT = 0
    SHADOW WRITES DB = NO

La salida sólo contiene identidad operativa, métricas, estado y hash; no imprime raw payload, biometría, tokens ni secretos. Node local fue `24.11.1`; cumple el mínimo `>=22.6.0` declarado en `backend/package.json`. No se cambió la versión instalada.

## Casos límite locales

La suite cubre device y employee cross-tenant, horario cross-tenant, dos horarios válidos (`AMBIGUOUS_SCHEDULE`), timezone de device ausente, asignación vencida (no se usa), `UNSCHEDULED`, evento repetido determinista, ausencia de incidencias y ausencia del tipo de estado deprecado.

## Production SHADOW: contrato futuro, no ejecutado

El futuro canary debe ser una operación manual y aprobada:

    1. Ejecutar precheck READ ONLY.
    2. Revisar todos los candidatos y elegir un registroId manualmente.
    3. Construir SupabaseAttendanceReadRepository con cliente backend aprobado.
    4. Construir AttendanceEngineOrchestrator con mode SHADOW y sin PersistenceService.
    5. Ejecutar run({ registroId }) una vez e imprimir sólo el resultado estructurado.
    6. Verificar que no existe persistenceResult ni cambios en tablas de negocio.

No crea filas en `workday_records` ni cambia `registro_asistencia`, `attendance_source_events`, `incidencias`, horarios, devices o empleados. No genera incidencias ni toca el trigger legacy.

El precheck diseñado es `database/live-schema/31_production_shadow_candidate_precheck.sql`. Usa `BEGIN TRANSACTION READ ONLY` y `ROLLBACK`; lista, sin `LIMIT` ni selección automática, registros físicos con tenant/device/employee válidos, timezone no vacía y exactamente un candidato de horario vigente. También expone `has_night_schedule` para revisión manual de candidatos nocturnos. No fue ejecutado contra producción, por lo que no hay candidatos ni candidato nocturno confirmados.

## Bloqueadores concretos de Production SHADOW

1. El repositorio real existe en `SupabaseAttendanceReadRepository` (`backend/services/attendance/AttendanceEngineOrchestrator.js`, líneas 101–184), pero no existe todavía un composition root/manual runner que cree su cliente y lo ejecute contra una instancia real.
2. El único cliente Supabase configurado está en `backend/server.js`, líneas 23–36, dentro del proceso de ingestión que tiene capacidad de escritura. No existe un cliente dedicado, configuración de destino verificada ni guard operacional para el canary manual read-only.
3. El runtime de despliegue y sus variables backend no se verificaron. Local usa Node 24.11.1; el despliegue debe cumplir `>=22.6.0` para cargar el dominio TypeScript nativo y aportar configuración Supabase válida sin exponer secretos.
4. La consulta real de ventana de eventos (`loadAttendanceEvents`, líneas 164–173) no se ejecutó contra una base real; falta confirmar contrato/RLS/orden y observabilidad operacional.
5. El precheck de candidatos está listo pero no fue ejecutado, no hay `registroId` aprobado y no se comprobó si existe un candidato nocturno real.

Por ello, el código de repositorios está preparado localmente, pero la capacidad operacional de Production SHADOW permanece bloqueada. `PERSIST` sigue prohibido y no debe recibir `WorkdayPersistenceService` en el futuro canary.

`trg_evaluar_retardo` y `fn_evaluar_retardo_asistencia` siguen intactos:

    MUST_DISABLE_BEFORE_ENGINE_ACTIVATION = YES

## Verificación

- Fase 31: 17/17 PASS.
- Regresión Fases 26, 27, 30 y 31: 57/57 PASS.
- `npx.cmd tsc --noEmit`: PASS.
- No se ejecutó SQL remoto, RPC, persistencia, backfill ni canary productivo.

## Decisión

    PHASE 31: PASS
    LOCAL SHADOW CANARY: PASS
    PRODUCTION READ REPOSITORIES: BLOCKED (operational wiring absent)
    PRODUCTION CANDIDATE PRECHECK: READY, NOT RUN
    SAFE TO RUN PRODUCTION SHADOW PRECHECK: YES
    SAFE TO RUN PRODUCTION SHADOW CANARY: NO
    SAFE TO ENABLE PERSIST CANARY: NO
    SAFE TO ACTIVATE ENGINE: NO
