# Fase 33 — Production Shadow Execution Readiness

Estado: implementación y auditoría local listas; ninguna operación productiva fue ejecutada.

## Candidato fijo

El runner sólo acepta `7f99cef9-4100-48ff-9aaf-68548c80c948`, entregado de forma explícita:

    node backend/scripts/run-production-workday-shadow-canary.js --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948

Cualquier UUID distinto, argumento adicional, `--mode` o `--persist` falla cerrado. No hay selección automática y los registros Sep-06 no están permitidos.

## Runner y zero-write boundary

`run-production-workday-shadow-canary.js` es backend-only, manual y hardcodea `mode: 'SHADOW'`. No está importado desde frontend, listeners, Realtime, webhooks, cron, queue o ZKTeco.

El grafo directo llega a `AttendanceEngineOrchestrator` y a un contrato inerte, pero no carga `WorkdayPersistenceService`. El runner no recibe ese servicio, no referencia `upsert_workday_record`, no llama `.rpc()` y no contiene DML. Sin un servicio de persistencia, cualquier alteración accidental a PERSIST falla cerrado.

La salida sanitizada contiene sólo modo, identidad operativa, schedule/timezone/operativeDate, métricas, WorkdayState, hash, eventCount y `persistenceCalled: false`. No expone raw payload, biometría ni secretos.

## Entorno backend requerido

- `SUPABASE_URL` — contrato existente del backend.
- `SUPABASE_SERVICE_ROLE_KEY` — contrato existente del backend; nunca se imprime.
- `SHADOW_CANARY_ALLOWED_HOST` — allowlist server-side para el guard de destino.
- `SHADOW_CANARY_ENVIRONMENT` — debe ser `PRODUCTION_SHADOW`.
- `SHADOW_CANARY_CONFIRMATION` — debe ser `I_APPROVE_READ_ONLY_SHADOW`.

El guard exige HTTPS y coincidencia exacta entre hostname de `SUPABASE_URL` y la allowlist antes de crear cliente o consultar. Node requerido: `>=22.6.0` según `backend/package.json`.

## Repositorios de lectura

`SupabaseAttendanceReadRepository` expone sólo `getAttendanceById`, `getDeviceForTenant`, `getEmployeeForTenant`, `getScheduleAssignments` y `getAttendanceWindow`. Usa columnas explícitas y filtros tenant/employee. La ventana se consulta por timestamps, no por fecha UTC; para el candidato es 2026-09-03 09:00:00Z a 22:00:00Z.

## Baseline y postcheck

`33_production_shadow_baseline.sql` toma conteos reales de workday_records, registro_asistencia, incidencias, horarios, empleados_horarios, attendance_source_events y devices, más fingerprint de `trg_evaluar_retardo`.

`34_production_shadow_postcheck.sql` compara la fotografía exacta después del canary. Para este único canary contiene el baseline aprobado de Fase 33 como CTE `VALUES` read-only, por lo que funciona en una sesión independiente. No presupone esos conteos para futuros canaries: éstos deben ejecutar Fase 33 y sustituir el baseline de su postcheck correspondiente; no usa timestamps como única prueba.

## Estado operacional

No se verificaron valores reales de entorno, hostname, runtime desplegado o lecturas Supabase contra producción. Tampoco se ejecutó baseline, smoke read-only ni canary.

    PHASE 33: PASS local readiness
    PRODUCTION RUNNER: BLOCKED operationally
    RUNNER MODE: SHADOW
    PERSIST OPTION EXISTS: NO
    DESTINATION GUARD: PASS
    PRODUCTION ENV: BLOCKED
    PRODUCTION READ REPOSITORIES: READY in code / BLOCKED operationally
    REAL EVENT WINDOW READ: BLOCKED
    ZERO-WRITE DEPENDENCY AUDIT: PASS
    PERSISTENCE SERVICE REACHABLE: NO
    UPSERT RPC REACHABLE: NO
    BASELINE SQL: READY
    POSTCHECK SQL: READY
    LEGACY TRIGGER MODIFIED: NO
    WORKDAY ROWS CREATED: 0
    INCIDENTS WRITTEN: NO
    SAFE TO RUN PRODUCTION READ SMOKE: NO
    SAFE TO RUN PRODUCTION SHADOW CANARY: NO
    SAFE TO ENABLE PERSIST CANARY: NO
    SAFE TO ACTIVATE ENGINE: NO
