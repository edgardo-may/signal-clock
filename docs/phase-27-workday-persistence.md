# Fase 27 — Persistencia backend-controlled de Workday

Estado: preparada y verificada localmente; no ejecutada en producción.

Esta fase no ejecutó SQL remoto ni invocó la RPC. No se creó ninguna fila de
workday, no hubo canary ni backfill, no se modificaron incidencias ni el trigger
legacy y no se activó Attendance Engine.

## Secuencia de scripts

1. 27_workday_persistence_precheck.sql — sólo lectura, con BEGIN TRANSACTION
   READ ONLY y ROLLBACK.
2. 28_workday_persistence_rpc.sql — único cambio de fase. Sólo crea la RPC
   nueva y sus permisos. Su preflight falla cerrado si el baseline difiere,
   workday_records contiene filas o ya existe una RPC con ese nombre.
3. 29_workday_persistence_postcheck.sql — sólo lectura, con BEGIN TRANSACTION
   READ ONLY y ROLLBACK.

Los scripts no usan migraciones históricas ni crean workday_record_history o
tenant_features.

## Contrato RPC

La nueva función propuesta es public.upsert_workday_record con parámetros
explícitos para cliente, empleado, fecha operativa, horario nullable, timezone,
primer y último evento, cinco métricas, WorkdayState e integrity hash.

Retorna exactamente una fila:

    workday_id uuid
    persistence_result INSERTED | UPDATED | UNCHANGED
    integrity_hash text nullable

La identidad de conflicto es solamente:

    (cliente_id, empleado_id, workday_date)

schedule_id no forma parte de ella. La inserción usa INSERT ... ON CONFLICT DO
NOTHING para que la UNIQUE instalada sea la autoridad bajo concurrencia. Sólo
después intenta UPDATE con comparaciones IS DISTINCT FROM. Si el contenido es
idéntico, no hay UPDATE; por eso el trigger updated_at tampoco se ejecuta.

Los campos comparados para UNCHANGED son schedule_id, timezone, first_in,
last_out, worked_minutes, break_minutes, overtime_minutes, late_minutes,
early_leave_minutes, status e integrity_hash. created_at y updated_at no se
comparan.

La RPC valida los UUID lógicos obligatorios, timezone no vacía, WorkdayState
literal, métricas no nulas/no negativas y orden first_in/last_out. El trigger
existente enforce_workday_record_tenant_integrity mantiene la última defensa de
Empresa para empleado y horario.

## Seguridad

La RPC propuesta es SECURITY INVOKER con search_path igual a
pg_catalog, public. No contiene SQL dinámico.

Después de instalarse, el script revoca EXECUTE de PUBLIC, anon y authenticated,
y concede EXECUTE sólo a service_role. El postcheck verifica exactamente:

    anon_can_execute = false
    authenticated_can_execute = false
    service_role_can_execute = true

No se añade policy de escritura a workday_records. RLS permanece con el SELECT
tenant-scoped de authenticated y sin INSERT, UPDATE ni DELETE directos.

## Servicio server-only

La implementación real está en:

    backend/services/attendance/WorkdayPersistenceService.js

No crea cliente Supabase ni referencia SUPABASE_SERVICE_ROLE_KEY. Recibe por
inyección un cliente RPC que el composition root backend ya configurará como
service_role. Sólo invoca rpc('upsert_workday_record', params); no tiene
fallback de INSERT/UPDATE directo y rechaza cualquier resultado distinto de
INSERTED, UPDATED o UNCHANGED.

El antiguo archivo compartido src/services/attendance/WorkdayPersistenceService.ts
ahora es un guard de compatibilidad que devuelve
WORKDAY_PERSISTENCE_SERVER_ONLY. No puede escribir desde el bundle de navegador.
WorkdayReprocessService permanece sin reemplazar y por ello también queda
bloqueado de forma segura; no se implementó reprocesado en esta fase.

El servicio backend espera ya el output snake_case de WorkdayRecordAdapter.
No recibe WorkdayCalculationResult ni WorkdayStatus. p_status procede
exclusivamente de WorkdayState.

## Pruebas locales

node --test tests/compliance/phase-27-workday-persistence.test.js: 12/12 PASS.

Cubren INSERTED, UPDATED, UNCHANGED, respuesta desconocida, error RPC, estado
estructural, exclusión de WorkdayStatus, horario nullable, identidad sin
schedule_id, actualización con horario cambiado, ausencia de escritura
authenticated y el contrato estático de seguridad/idempotencia de la RPC.

También pasa npx.cmd tsc --noEmit y node --check sobre el servicio backend.

## Estado y siguiente paso

    PHASE 27 PERSISTENCE: PASS (artefactos locales)
    PRECHECK: NOT RUN IN PRODUCTION
    RPC DESIGN: PASS
    RPC SECURITY: PASS (validación estática)
    PERSISTENCE IDEMPOTENCY: PASS (contrato y tests)
    UNCHANGED DOES NOT UPDATE: PASS (contrato y tests)
    WORKDAY PERSISTENCE SERVICE: READY
    SERVICE_ROLE SERVER-ONLY: PASS
    TESTS: 12/12 PASS
    WORKDAY ROWS: 0 (estado de producción confirmado antes de esta fase)
    BACKFILL: NO
    LEGACY TRIGGER MODIFIED: NO
    SAFE TO APPLY RPC TO PRODUCTION: YES, sólo después de 27 PRECHECK PASS
    SAFE TO IMPLEMENT RUNTIME ORCHESTRATOR: YES
    SAFE TO ACTIVATE ENGINE: NO

MUST_DISABLE_BEFORE_ENGINE_ACTIVATION permanece YES. El trigger legacy no debe
retirarse hasta la fase de corte controlado inmediatamente anterior a activar el
nuevo pipeline.
