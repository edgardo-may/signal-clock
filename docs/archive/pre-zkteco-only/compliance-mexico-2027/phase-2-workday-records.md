# Phase 2: Registro Electrónico de Jornada (workday_records)

## 1. Arquitectura y Objetivo
El objetivo de la Fase 2 es persistir de manera segura, versionada, idempotente y auditable los resultados producidos por el `AttendanceEngine`.

**Flujo:**
1. Marcajes crudos inmutables (`attendance_logs`)
2. Procesamiento puro en memoria (`AttendanceEngine`)
3. `WorkdayCalculationResult`
4. Servicio de persistencia idempotente (`WorkdayPersistenceService` + RPC en PostgreSQL)
5. Almacenamiento en `workday_records` (estado actual) y `workday_record_history` (historial append-only).

## 2. Identidad Lógica de Jornada

Para garantizar la idempotencia, debemos evitar procesar la misma jornada dos veces y generar registros duplicados. La identidad lógica de una jornada se define mediante un índice único funcional:

```sql
CREATE UNIQUE INDEX idx_workday_records_identity
ON public.workday_records (
    cliente_id,
    empleado_id,
    workday_date,
    COALESCE(schedule_id::text, 'UNSCHEDULED')
);
```

### Resolución de Escenarios (Identidad Lógica)

1. **¿Cómo se identifica una jornada diurna?**
   - `workday_date` corresponde a la fecha calendario.
   - `schedule_id` es el UUID del horario asignado.
   - *Resultado*: 1 registro único para ese día y horario.

2. **¿Cómo se identifica una jornada nocturna?**
   - `workday_date` corresponde siempre a la **fecha de inicio del turno** (el *operative date*). Aunque el empleado salga al día siguiente, la jornada lógica pertenece al día en que inició.
   - `schedule_id` es el UUID del horario nocturno.
   - *Resultado*: 1 registro asignado al día de entrada.

3. **¿Cómo se identifica un turno partido?**
   - El modelo de `horarios` en Signum-Clock almacena la configuración de todo el día (incluyendo `descanso_inicio` y `descanso_fin`). Por lo tanto, un turno partido sigue perteneciendo a **un solo** `schedule_id`.
   - `workday_date` es la fecha calendario.
   - *Resultado*: 1 solo registro en `workday_records` que contiene múltiples segmentos de trabajo dentro de su estructura JSON de `punch_dispositions` y tiempos consolidados.

4. **¿Cómo se identifica una jornada sin horario?**
   - `schedule_id` será `NULL`.
   - El índice funcional evalúa `COALESCE(NULL, 'UNSCHEDULED')`, generando la clave lógica `[cliente_id, empleado_id, date, 'UNSCHEDULED']`.
   - *Resultado*: 1 registro único para las checadas "huérfanas" de ese día.

5. **¿Qué ocurre si un empleado tiene dos jornadas legítimas el mismo día?**
   - Ejemplo: Cubre un turno de 06:00 a 14:00 (`schedule_id = UUID-A`) y luego hace un doblete de 14:00 a 22:00 (`schedule_id = UUID-B`).
   - Al tener distintos `schedule_id`, la clave lógica es diferente.
   - *Resultado*: Se crearán **dos registros separados** en `workday_records` para el mismo `workday_date`, permitiendo contabilizar y pagar ambos turnos correctamente sin colisiones.

## 3. Versionado e Inmutabilidad (workday_record_history)

- **Primera ejecución:** Crea el registro en `workday_records` (current_version = 1) y un registro en `workday_record_history` (version = 1) con el snapshot completo (JSONB) y su `integrity_hash`.
- **Reproceso sin cambios semánticos:** Si el resultado produce el mismo `integrity_hash`, la capa de persistencia (RPC) realiza un "NO-OP" y devuelve `UNCHANGED`. No se incrementa la versión.
- **Reproceso con cambios:** (Ej. se agregó un nuevo marcaje o cambió el horario). El `integrity_hash` cambia. La RPC actualiza `workday_records` (`current_version` = 2) e inserta un nuevo registro inmutable en `workday_record_history` con `version` = 2.
- **Concurrencia:** La RPC en PostgreSQL maneja esto mediante un bloqueo `FOR UPDATE` o al usar el comportamiento nativo de transacciones con `INSERT ... ON CONFLICT`. Dos intentos simultáneos no producirán dos "versiones 2".

## 4. Estructura y Feature Flags

Se implementa una nueva tabla `tenant_features` para activar la Fase 2 a nivel de tenant (en modo `SHADOW` para evitar interferir con flujos de producción actuales).

El servicio no se conectará automáticamente a la ingesta `ADMS/ISUP` (POST `/iclock/cdata`). La ingesta cruda continuará siendo rápida y delegará el procesamiento al servicio asíncrono o procesamiento batch futuro.
