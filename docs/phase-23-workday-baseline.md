# Fase 23 — Nuevo baseline de Workday

Estado: preparado y no ejecutado. Fase 22.1–22.3 cerró con RLS de `devices` tenant-scoped, sin DELETE para `authenticated`, riesgos cross-tenant en NO y huellas before/after idénticas para todos los datos protegidos. Por tanto, `SAFE TO CREATE PHASE 23: YES`.

La base real de producción es la autoridad. No se reutilizan migraciones históricas, no se activa Attendance Engine, no se crea historial/feature flag y no se procesa ningún marcaje histórico.

## Secuencia

1. Ejecutar `23_workday_baseline_precheck.sql`.
2. Ejecutar `24_workday_baseline.sql` sólo si el precheck pasa.
3. Ejecutar `25_workday_baseline_postcheck.sql` inmediatamente después.

Los scripts 23 y 25 son READ ONLY y siempre hacen `ROLLBACK`. El 24 es una única transacción; cualquier preflight o error revierte el cambio completo.

## Contrato y decisión de identidad

La tabla nueva `public.workday_records` representa una sola jornada por Empresa, empleado y fecha operativa:

```text
UNIQUE (cliente_id, empleado_id, workday_date)
```

`schedule_id` es evidencia del horario resuelto y puede ser NULL únicamente para una jornada `UNSCHEDULED`. No forma parte de la identidad, para que un cambio de horario no genere una segunda jornada en la misma fecha.

El CHECK de `status` coincide literalmente con `WorkdayState` en `src/domain/attendance/AttendanceTypes.ts`:

```text
COMPLETE | INCOMPLETE | ABSENT | UNSCHEDULED | INVALID
```

Se almacenan `first_in`, `last_out`, las métricas requeridas, timezone IANA no vacía, `integrity_hash` nullable y timestamps. Todos los minutos son no negativos y, cuando ambos valores existen, `last_out >= first_in`.

## Integridad y RLS

Las FKs a cliente, empleado y horario usan `ON DELETE RESTRICT`. El trigger `enforce_workday_record_tenant_integrity()` es `SECURITY INVOKER`, con `search_path = pg_catalog, public`, y falla cerradamente cuando empleado u horario no pertenecen a `NEW.cliente_id`.

`public.set_updated_at()` no se reutiliza ni modifica: su contrato real asigna `NEW.actualizado_at`, incompatible con `updated_at`. El baseline crea `public.set_workday_updated_at()` como `SECURITY INVOKER`, con el mismo search_path seguro, y `trg_workday_records_set_updated_at` antes de UPDATE.

RLS tiene una sola policy authenticated:

```sql
FOR SELECT USING (public.auth_can_read_tenant(cliente_id))
```

No existen policies authenticated de INSERT, UPDATE o DELETE. La futura persistencia queda backend-controlled; no se inventa bypass para service role.

## Exclusiones

- No `workday_record_history` ni `tenant_features`.
- No incidencias, extensión de incidencias, backfill, canary ni cálculo automático.
- No cambios a horarios, asignaciones, asistencia, devices, ZKTeco, `trg_evaluar_retardo` o `fn_evaluar_retardo_asistencia()`.

Tras el cambio, `workday_records` debe tener exactamente cero filas.

## Veredictos esperados

```text
WORKDAY PRECHECK: PASS / FAIL
WORKDAY BASELINE DESIGN: PASS / FAIL
LOGICAL IDENTITY: UNIQUE(cliente_id, empleado_id, workday_date)
UPDATED_AT STRATEGY: PASS / FAIL
TIME ORDER CHECK: PASS / FAIL
TENANT INTEGRITY: PASS / FAIL
STATUS CONTRACT VERIFIED AGAINST CODE: PASS / FAIL
RLS DESIGN: PASS / FAIL
BACKFILL PRESENT: YES / NO
WORKDAY ROW COUNT AFTER CHANGE: 0 / N
LEGACY TRIGGER MODIFIED: YES / NO
SAFE TO RUN 24: YES / NO
```
