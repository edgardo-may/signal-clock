# Fase 26 — Contrato de integración del Attendance Engine

Estado: contrato preparado; runtime de producción no activado.

Esta fase no ejecutó SQL, no consultó ni modificó producción, no creó jornadas,
no hizo backfill y no generó incidencias. El baseline instalado de
public.workday_records sigue con 0 filas.

## Límites implementados

Se añadieron tres módulos puros, sin cliente Supabase ni efectos de escritura:

- src/domain/attendance/adapters/RegistroAttendanceAdapter.ts
- src/domain/attendance/adapters/ScheduleResolver.ts
- src/domain/attendance/adapters/WorkdayRecordAdapter.ts

RegistroAttendanceAdapter acepta exclusivamente el contrato real de
registro_asistencia: id, cliente_id, empleado_id, dispositivo_id, verificado_at,
tipo_verificacion, metodo, source_event_id, raw_payload y es_manual. Produce un
RawAttendancePunch de dominio y mantiene deviceId, sourceEventId, método y
payload como metadatos. El payload es opaco: no se usa para resolver Empresa,
empleado, device ni horario.

Para checadas físicas, el adaptador exige un device recibido bajo este lookup:

    devices.id = registro_asistencia.dispositivo_id
    AND devices.cliente_id = registro_asistencia.cliente_id

Un device ausente, timezone vacía o de otra Empresa falla cerrado. Si
dispositivo_id es NULL, devuelve UNSUPPORTED_SOURCE_TIMEZONE; Web/App no tiene
aún contrato de timezone y no se inventó uno basado en navegador o servidor.
localEventDate es sólo la fecha local del evento; no se usa como sustituto
automático de workday_date.

El ajuste mínimo a RawAttendancePunch.inOutState permite number | string. Es
necesario porque el contrato real trae tipo_verificacion textual y el
normalizador ya soportaba literalmente entrada y salida.

## Resolución de horario

ScheduleResolver recibe filas ya leídas de empleados_horarios y horarios, más
clienteId, empleadoId y candidateDate explícitos. Revalida:

    assignment.cliente_id = clienteId
    assignment.empleado_id = empleadoId
    assignment.activo = true
    fecha_inicio <= candidateDate
    (fecha_fin IS NULL OR fecha_fin >= candidateDate)

    schedule.id = assignment.horario_id
    schedule.cliente_id = clienteId
    schedule.activo = true

Cero candidatos devuelve UNSCHEDULED; exactamente uno convierte el día
lun…dom de dias_config a ShiftWindowConfig; dos o más lanzan
AMBIGUOUS_SCHEDULE. Una referencia rota o cross-tenant lanza error; nunca se
degrada a una selección arbitraria. El valor persistible es siempre horarios.id;
empleados_horarios.id queda sólo como metadato de trazabilidad.

Un día inactivo del horario equivale a ausencia de turno para esa fecha:
UNSCHEDULED. Entrada, salida y ambos extremos de descanso se validan antes de
construir el turno.

## Jornadas nocturnas y timezone

ShiftMatcher y timezoneUtils son reutilizables. Con un operativeDate explícito,
ShiftMatcher reconoce salida <= entrada, extiende el fin al día siguiente y
conserva esa fecha operativa. La prueba de contrato confirma que los eventos
locales 2026-09-04 22:00 y 2026-09-05 06:00 pertenecen a
workday_date = 2026-09-04 en America/Cancun.

La orquestación runtime deberá construir explícitamente la fecha candidata y,
para un evento posterior a medianoche, evaluar también la ventana nocturna del
día anterior. No puede agrupar por DATE(verificado_at) ni por timezone del
servidor. Este orquestador todavía no existe ni está conectado.

## Auditoría de componentes existentes

| Componente | Clasificación | Evidencia / contrato de Fase 26 |
| --- | --- | --- |
| AttendanceNormalizer | ADAPT | Es puro y ya normaliza inOutState textual, pero requiere RawAttendancePunch camelCase. RegistroAttendanceAdapter cubre esa diferencia. |
| ShiftMatcher | REUSABLE | Soporta cruces de medianoche si recibe operativeDate explícito. |
| WorkdayCalculator | REUSABLE | Calcula sobre ShiftMatchResult y timezone explícitos, sin SQL. |
| timezoneUtils | REUSABLE | Valida IANA y calcula componentes locales deterministas. |
| WorkdayIntegrityHasher | ADAPT | Es puro y determinista, pero el pipeline actual le entrega el status deprecado. La integración debe hashear workdayState como estado estructural antes de persistir integrity_hash. |
| WorkdayPersistenceService | REPLACE | Envía schedule_assignment_id, actual_start, workday_state y otros campos históricos a la RPC inexistente upsert_workday_record; no coincide con el baseline real. |
| WorkdayReprocessService | REPLACE | Depende de tenant_features, clientes.timezone, attendance_logs, identidad HIKVision y el persistence service histórico; no lee registro_asistencia ni timezone por device. |

AttendanceEngine puede seguir siendo el orquestador matemático, pero el nuevo
runtime debe siempre proporcionar timezone y fecha operativa explícitas. Su
fallback de jornada sin horario no es aceptable para producción cuando no se
haya resuelto una fecha operativa explícita.

## Contrato de persistencia propuesto

WorkdayRecordAdapter transforma un WorkdayCalculationResult a los nombres del
baseline instalado:

| Dominio | public.workday_records |
| --- | --- |
| operativeDate | workday_date |
| horarios.id resuelto | schedule_id |
| timezone | timezone |
| actualStart | first_in |
| actualEnd | last_out |
| workedMinutes | worked_minutes |
| breakMinutes | break_minutes |
| overtimeMinutes | overtime_minutes |
| lateMinutes | late_minutes |
| earlyLeaveMinutes | early_leave_minutes |
| workdayState | status |
| integrityHash | integrity_hash |

No persiste WorkdayStatus, scheduleAssignmentId, campos de historial ni campos
ausentes del baseline. La identidad estructural es exactamente:

    (cliente_id, empleado_id, workday_date)

schedule_id no participa en ella. Un reproceso con horario corregido debe
actualizar la misma fila mediante esa identidad, no insertar otra.

La recomendación de seguridad es BACKEND_RPC: una RPC nueva y acotada,
ejecutable sólo por service_role, con anon y authenticated sin EXECUTE,
validará el payload, hará el upsert por la identidad anterior y se apoyará en
los triggers y FKs instalados. No se creó ninguna RPC en esta fase. Mientras no
exista, no hay writer aprobado y el frontend no obtiene INSERT, UPDATE ni DELETE
por RLS.

## Legacy de retardo

trg_evaluar_retardo y fn_evaluar_retardo_asistencia() siguen intactos. La
auditoría real demostró que el legacy crea incidencias Retardo con estado
Aprobado, sin idempotencia estructural fuerte, sin garantías suficientes de
Empresa y sin soporte seguro de turnos nocturnos. Por lo tanto:

    MUST_DISABLE_BEFORE_ENGINE_ACTIVATION = YES

No deben coexistir el trigger legacy y el nuevo motor de incidencias.

## Pruebas ejecutadas

node --test tests/compliance/phase-26-adapters.test.js: 11/11 PASS.

Los casos verifican timezone ZKTeco mismo tenant, device de otra Empresa,
empleado sin horario, horario único, ambigüedad, vigencia, horario de otra
Empresa, jornada diurna, jornada nocturna, identidad de reproceso y persistencia
de WorkdayState en lugar de WorkdayStatus. También pasó npx.cmd tsc --noEmit.

## Decisión de fase

    PHASE 26: PASS
    ATTENDANCE NORMALIZER: ADAPT
    REGISTRO DOMAIN ADAPTER: READY
    TIMEZONE RESOLUTION: READY
    SCHEDULE RESOLUTION: READY
    SCHEDULE_ID SOURCE: public.horarios.id, joined through public.empleados_horarios.horario_id
    AMBIGUOUS SCHEDULE BEHAVIOR: FAIL_CLOSED
    NIGHT SHIFT CONTRACT: PASS
    WORKDAY PERSISTENCE: REPLACE
    PERSISTENCE IDENTITY: (cliente_id, empleado_id, workday_date)
    PERSISTENCE SECURITY RECOMMENDATION: BACKEND_RPC
    WORKDAY REPROCESS: REPLACE
    LEGACY INCIDENT TRIGGER: MUST_DISABLE_BEFORE_ENGINE_ACTIVATION = YES
    DB CHANGES REQUIRED NOW: NO
    CODE CHANGES IMPLEMENTED: YES
    TESTS: 11/11 PASS
    SAFE TO IMPLEMENT ENGINE RUNTIME: YES
    SAFE TO ACTIVATE ENGINE: NO

La próxima fase puede implementar el runtime backend y su RPC de persistencia,
pero no debe activar el motor ni crear incidencias hasta que exista un plan de
corte controlado para el trigger legacy.
