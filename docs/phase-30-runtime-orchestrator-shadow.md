# Fase 30 — Runtime Orchestrator Shadow

Estado: implementado localmente y no conectado a producción.

## Límite y modo

`backend/services/attendance/AttendanceEngineOrchestrator.js` es el único orquestador de esta fase. No está importado por listeners, triggers, Realtime, webhooks, callbacks ZKTeco, colas ni cron; sólo un backend puede invocar explícitamente `run({ registroId })`.

El modo por defecto es `SHADOW`. `run` no acepta un modo: la decisión pertenece exclusivamente a la configuración backend. En SHADOW sólo hay lecturas de `registro_asistencia`, `devices`, `empleados`, `empleados_horarios` y `horarios`, y cálculo en memoria. No se invoca `WorkdayPersistenceService`, no hay `INSERT`, `UPDATE` ni `DELETE`, y no se construyen ni escriben incidencias.

`PERSIST` existe sólo como camino futuro y requiere inyección backend de `WorkdayPersistenceService`. El orquestador lo llama exactamente una vez y el servicio usa exclusivamente `public.upsert_workday_record`; no hay writer directo ni fallback. Un error devuelve `PERSISTENCE_FAILED` y falla cerrado.

## Fuente, seguridad y ventana

La fuente primaria es exclusivamente `public.registro_asistencia`. `raw_payload` es opaco y nunca participa en relaciones de Empresa, empleado, device u horario. El flujo es:

    registro_asistencia → RegistroAttendanceAdapter → AttendanceNormalizer
    → ShiftMatcher → WorkdayCalculator → WorkdayIntegrityHasher
    → WorkdayRecordAdapter → (sólo PERSIST) WorkdayPersistenceService/RPC

El runtime exige y vuelve a validar `devices.id = dispositivo_id AND devices.cliente_id = registro.cliente_id`, y `empleados.id = empleado_id AND empleados.cliente_id = registro.cliente_id`. Cada evento y device de la ventana debe pertenecer al mismo tenant y empleado. `ScheduleResolver` recibe todos los candidatos tenant-scoped; nunca usa `LIMIT 1` y mantiene `AMBIGUOUS_SCHEDULE` fail-closed.

El timestamp del registro ancla la fecha local usando la timezone IANA del device. Se evalúan esa fecha local y la anterior con `ScheduleResolver` y `ShiftMatcher`; sólo gana un turno cuya ventana contenga el evento, y más de una ventana falla con `AMBIGUOUS_OPERATIVE_WINDOW`. La ventana usa inicio/fin resueltos del turno y tolerancias pre/post. No usa `CURRENT_DATE`, `today`, fecha UTC simple ni timezone del servidor.

El contrato `UNSCHEDULED` usa el día local explícito, sin inventar `schedule_id` (`NULL`). 2026-09-04 22:00 a 2026-09-05 06:00 en America/Cancun produce `operativeDate = 2026-09-04` e incluye ambos eventos.

El resultado no invoca `IncidentDetector`: devuelve sólo WorkdayState estructural y hashea ese estado. No usa el tipo de estado deprecado.

## Observabilidad y legado

El log de éxito incluye registroId, clienteId, empleadoId, deviceId, scheduleId, operativeDate, timezone, workdayState, métricas, integrityHash, mode y, en PERSIST, persistenceResult. Excluye raw payload, biometría, templates, rostros, tokens y claves.

`trg_evaluar_retardo` y `fn_evaluar_retardo_asistencia` no fueron modificados.

    MUST_DISABLE_BEFORE_ENGINE_ACTIVATION = YES

No se generaron incidencias, workday rows, backfill ni SQL de producción.

## Pruebas locales

`node --test tests/compliance/phase-30-runtime-orchestrator-shadow.test.js` cubre entrada, salida, jornada completa, cruce nocturno, mismatches de tenant, ambigüedad, UNSCHEDULED, SHADOW sin persistencia, los tres resultados RPC, error RPC, determinismo, observabilidad y ausencia del tipo de estado deprecado.

El runtime backend consume módulos de dominio TypeScript mediante type stripping nativo de Node 22+. El backend declara `>=22.6.0`; el entorno de despliegue debe cumplirlo antes de ejecutar este módulo.

## Decisión

    PHASE 30: PASS local
    DEFAULT MODE: SHADOW
    REGISTRO SOURCE: registro_asistencia
    SHADOW WRITES DB: NO
    PERSIST PATH: READY (disabled by default)
    PERSIST USES RPC ONLY: YES
    INCIDENTS WRITTEN: NO
    LEGACY TRIGGER MODIFIED: NO
    MUST_DISABLE_BEFORE_ENGINE_ACTIVATION: YES
    SAFE TO ENABLE PERSIST CANARY: NO
    SAFE TO ACTIVATE ENGINE: NO
