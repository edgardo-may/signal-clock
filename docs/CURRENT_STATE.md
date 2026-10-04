# Signum Clock — Estado actual

La base real de producción es la fuente de verdad. No usar migraciones históricas
para reconstruir contratos u objetos que no existan en producción.

## Flujo físico e identidad

ZKTeco es la integración biométrica activa:

/iclock/cdata → attendance_logs → attendance_source_events → registro_asistencia.

Las fases 08–20 están cerradas. El replay es idempotente: un evento físico genera
exactamente un attendance_log, un attendance_source_event y un registro_asistencia,
con source_event_id y processing_status = PROCESSED.

No cambiar hardware_user_id, biometric_user_id, clave_empleado ni
registro_asistencia.source_event_id.

## Contrato de asistencia y hardening

Producción confirmada: registro_asistencia 31, horarios 4,
empleados_horarios 4, incidencias 5, devices 3 y empleados 7.

Los devices ZKTeco usan America/Cancun. No hay overlaps ni mismatches de Empresa
en asignaciones activas; una jornada 22:00 → 06:00 pertenece a la fecha local de
entrada.

Fases 22, 22.1, 22.2 y 22.3: cerradas. devices tiene RLS tenant-scoped para
authenticated: SELECT con auth_can_read_tenant(cliente_id), INSERT y UPDATE con
auth_can_write_tenant(cliente_id). No hay policy DELETE y los riesgos
cross-tenant son NO.

trg_evaluar_retardo sigue activo y sin cambios. Debe deshabilitarse sólo en la
fase de corte inmediatamente anterior a activar el nuevo motor.

## Workday baseline

Fase 23 precheck, Fase 24 baseline y hotfix 24.1: cerrados.

public.workday_records existe y tiene 0 filas. Su identidad es:

    UNIQUE (cliente_id, empleado_id, workday_date)

schedule_id es evidencia nullable y no pertenece a la identidad. FKs RESTRICT,
triggers SECURITY INVOKER de updated_at e integridad de Empresa, checks de
métricas/timezone/orden temporal y RLS están instalados.

WorkdayState coincide exactamente con el CHECK de status:

    COMPLETE, INCOMPLETE, ABSENT, UNSCHEDULED, INVALID

authenticated conserva únicamente SELECT tenant-scoped; INSERT, UPDATE y DELETE
siguen denegados. No existen workday_record_history ni tenant_features y no hubo
backfill.

## Fase 26 — contrato de integración

Cerrada: PASS. RegistroAttendanceAdapter, ScheduleResolver y
WorkdayRecordAdapter son límites puros y READY. La resolución física de timezone
exige un device de la misma Empresa; ausencia de dispositivo falla con
UNSUPPORTED_SOURCE_TIMEZONE. La resolución de horario falla cerrada con
AMBIGUOUS_SCHEDULE y nunca usa LIMIT 1.

ShiftMatcher, WorkdayCalculator y timezoneUtils son reutilizables. El contrato
nocturno es PASS. WorkdayPersistenceService y WorkdayReprocessService históricos
requieren reemplazo. Ver phase-26-engine-integration-contract.md.

## Fase 27 — persistencia backend-controlled

Cerrada junto con precheck 27, instalación 28 y postcheck 29. Los scripts son:

1. database/live-schema/27_workday_persistence_precheck.sql
2. database/live-schema/28_workday_persistence_rpc.sql
3. database/live-schema/29_workday_persistence_postcheck.sql

La RPC instalada usa SECURITY INVOKER, search_path seguro, la identidad
(cliente_id, empleado_id, workday_date), resultado INSERTED/UPDATED/UNCHANGED y
EXECUTE únicamente para service_role. No modifica RLS ni introduce escritor
frontend.

La implementación real vive bajo backend/services/attendance y recibe un cliente
RPC backend inyectado; no contiene service-role secret. El módulo histórico de
src ahora falla cerrado para impedir escritura desde un bundle browser.

## Fase 30 — runtime orchestrator SHADOW (estado más reciente)

Fases 27–29: CERRADAS. La RPC instalada es SECURITY INVOKER, con ejecución
exclusiva para `service_role`, identidad `(cliente_id, empleado_id,
workday_date)` e idempotencia INSERTED / UPDATED / UNCHANGED. `workday_records`
permanece con 0 filas; no hubo backfill, cambios de negocio ni cambios al
trigger legacy.

El runtime backend de Fase 30 se implementó sin conexión automática. Lee
`registro_asistencia`, resuelve relaciones tenant-scoped, timezone, horario y
ventana determinista, y calcula/adapta la jornada. El modo por defecto es
SHADOW: no escribe base de datos ni incidencias. PERSIST está desactivado por
defecto y sólo puede usar `WorkdayPersistenceService` / `upsert_workday_record`
desde backend.

    MUST_DISABLE_BEFORE_ENGINE_ACTIVATION = YES

Ver `phase-30-runtime-orchestrator-shadow.md`. Persist canary y activación del
motor siguen sin autorización hasta validar el runtime backend y un canary
SHADOW controlado.

## Fase 31 — local SHADOW canary y readiness

Cerrada localmente: el harness manual backend-only ejecutó una jornada normal y
una nocturna dos veces cada una, con resultados deterministas y cero llamadas
de persistencia/escritura. Node local `24.11.1` cumple el requisito
`>=22.6.0`. No hubo SQL remoto, RPC, workday rows, incidencias ni cambios al
legacy.

El precheck read-only de candidato futuro está listo en
`31_production_shadow_candidate_precheck.sql`, pero no fue ejecutado ni eligió
registro alguno. Production SHADOW permanece bloqueado: falta un runner manual
con cliente backend dedicado/configurado, verificar runtime y variables del
despliegue, validar la ventana de eventos contra DB real y aprobar un candidato
del precheck. PERSIST y activación del engine siguen en NO.

Ver `phase-31-local-shadow-canary.md`.

## Fase 32.1 — audit de operative date

El precheck de Fase 31 fue ejecutado por el operador y devolvió 19 candidatos,
sin candidatos nocturnos. Se detectó que podía listar `local_event_date - 1`
sin verificar la ventana temporal de ShiftMatcher: dos registros del 2026-09-06
mostraron el 2026-09-05 aun con `has_night_schedule = false`. Es un bug de
aprobación del precheck, no un fallo demostrado del engine.

El post-audit `32_1_production_shadow_candidate_postaudit.sql` está listo y es
read-only. Debe ejecutarse y revisarse antes de aprobar cualquier registro:
expondrá dias_config sábado/domingo, hora local, cruces de medianoche y la
ventana real. Hasta entonces no hay candidato normal o nocturno aprobado y
Production SHADOW continúa bloqueado.

Existe un runner manual con guard de destino, sin writer/RPC, pero faltan la
configuración de producción verificada, el runtime desplegado, lecturas reales
y un registro aprobado. Ver `phase-32_1-operative-date-candidate-audit.md`.

## Fase 32.2 — candidate classification fix

El post-audit real confirmó que los dos registros Sep-06/Sep-05 son
`OPERATIVE_DATE_MISMATCH`: domingo inactivo y sábado 06:00–14:00 no nocturno,
con eventos fuera de ventana. El engine no presenta bug.

Se creó `32_2_production_shadow_candidate_final.sql` para eliminar el leak de
estado entre `EVENT_LOCAL_DATE` y `PREVIOUS_LOCAL_DATE`. Clasifica cada relación
por su propia evidencia y produce detalle más consolidado por registro. El SQL
final aún no se ejecuta; se espera que `7f99cef9-4100-48ff-9aaf-68548c80c948`
sea el único `APPROVED_NORMAL` con fecha 2026-09-03 y schedule
`be4035c8-042c-473b-b25d-b5bf3fb99701`.

No hay candidato nocturno real ni autorización para Production SHADOW/PERSIST.
Ver `phase-32_2-candidate-classification-fix.md`.

## Fase 33 — production SHADOW execution readiness

El candidato único queda fijado a `7f99cef9-4100-48ff-9aaf-68548c80c948`.
El runner manual sólo permite ese UUID como `--registro-id`, hardcodea SHADOW,
usa las variables backend existentes y una allowlist de hostname. Su grafo no
carga el escritor de workday ni RPC de upsert; los repositorios reales son de
lectura explícita tenant-safe.

Los scripts `33_production_shadow_baseline.sql` y
`34_production_shadow_postcheck.sql` están listos para comparar conteos reales
y fingerprint legacy inmediatamente antes/después. No se verificó entorno,
destino, runtime ni lectura real contra producción; por ello smoke y canary
siguen bloqueados, igual que PERSIST y activación. Ver
`phase-33-production-shadow-execution-readiness.md`.

## Fase 34.1 — production environment + READ_SMOKE

El runner backend-only separa un `--check-env` sin conexiÃ³n y un
`--read-smoke --registro-id 7f99cef9-4100-48ff-9aaf-68548c80c948` manual. El
segundo comando estÃ¡ limitado al Ãºnico candidato `APPROVED_NORMAL`, valida
host HTTPS allowlisted, environment y confirmaciÃ³n backend, y sÃ³lo puede leer
registro, empleado, device, horario y ventana tenant-scoped.

READ_SMOKE no ejecuta el Attendance Engine. No importa el persistence service,
no puede llamar la RPC de upsert, bloquea todas las operaciones de escritura y
expone contadores `writeCalls`, `persistenceCalls` y `rpcWriteCalls`, que deben
permanecer en cero. Tampoco selecciona `raw_payload` ni revela secrets.

La validaciÃ³n unitaria de este contrato estÃ¡ cerrada, pero el estado operativo
de producciÃ³n depende de ejecutar manualmente `--check-env`, el read smoke y
el baseline/postcheck inmediato correspondiente. Esto sigue siendo distinto de
un Production SHADOW Canary; PERSIST y activaciÃ³n siguen en NO. Ver
`phase-34_1-production-env-read-smoke.md`.

## Fase 35 — Production Attendance Engine SHADOW Canary

El runner manual separa `ENGINE_SHADOW` de READ_SMOKE y admite exclusivamente
el candidato aprobado. Reutiliza AttendanceEngineOrchestrator en modo SHADOW,
con el cliente Supabase envuelto por un guard que bloquea escrituras y RPC. El
runner entrega la ventana completa y ordenada al motor, repite el cÃ¡lculo para
comprobar determinismo y sÃ³lo emite evidencia sanitizada.

Antes de cualquier ejecuciÃ³n real se requiere un baseline Phase 33 nuevo e
inmediatamente posterior el postcheck Phase 34 con ese baseline. La ejecuciÃ³n
real y la revisiÃ³n de su resultado de 16 eventos siguen pendientes; por tanto
PERSIST, incidencias, activaciÃ³n y cambios legacy siguen en NO. Ver
`phase-35-production-attendance-engine-shadow.md`.

## Fase 35.1 — Sanitized Calculation Trace

El ENGINE_SHADOW real del candidato aprobado leyÃ³ 16 eventos (7 entradas, 9
salidas) sin escritura ni RPC y produjo de forma determinista `INCOMPLETE`,
`firstIn` 2026-09-03T16:26:04.000Z, `lastOut` null, 315 minutos trabajados, 7
minutos de break, 326 minutos de retardo e integrity hash
`8474202d4f39d2f21e211406f39ed3a378ba5b5daa7daf72db71b8c411bcfa45`.
La ejecuciÃ³n es PASS, pero la aceptaciÃ³n semÃ¡ntica permanece bloqueada.

Fase 35.1 aÃ±ade una traza manual y sanitizada de eventos, normalizaciÃ³n,
ShiftMatcher, pairing, segmentos, conciliaciones y procedencia de estado. Es
observacional y no modifica la lÃ³gica. Su revisiÃ³n sobre los eventos reales es
requisito antes de cualquier decisiÃ³n de PERSIST. Ver
`phase-35_1-sanitized-calculation-trace.md`.

## Fase 35.2 — Workday Calculation Semantic Hardening

La traza confirmÃ³ que `workedMinutes` usaba incorrectamente el span bruto de
315 minutos en vez de los segmentos WORK de 21 + 65. El contrato se corrigiÃ³
en dominio: `workedMinutes` suma sÃ³lo WORK; BREAK queda fuera y
`breakMinutes` sigue sumando BREAK. El span continÃºa sÃ³lo como evidencia de
traza y no se modificÃ³ schema alguno.

`firstIn` ahora representa la primera entrada retenida en un segmento WORK, no
una entrada consecutiva descartada. `lastOut = null` ante ENTRY huÃ©rfana final
preserva `INCOMPLETE`. Las secuencias ambiguas se exponen como warnings
deterministas sin crear incidencias, y dichos codes ya forman parte del hash
versiÃ³n 2. El hash Phase 35 previo debe considerarse supersedido para un
replay, no persistido.

No hubo acceso ni cambios de BD. Falta ejecutar un nuevo Production SHADOW y
revisar la salida recalculada antes de cualquier PERSIST. Ver
`phase-35_2-workday-calculation-semantic-hardening.md`.

## Fase 35.3 — Production SHADOW Validation V2

El runner V2 expone `calculationVersion = 2` y estÃ¡ listo para repetir el
candidato aprobado y su trace con semÃ¡ntica WORK/BREAK corregida. La ejecuciÃ³n
requiere check-env PASS, baseline Phase 33 inmediato y postcheck Phase 34 con
ese baseline. No se puede inferir `firstIn`, retardo ni hash V2 desde el
resultado V1: deben venir del replay real.

PERSIST y activaciÃ³n continÃºan en NO. Ver
`phase-35_3-production-shadow-validation-v2.md`.

## Fase 35.4 - Canonical First-In / First-Out Policy

La politica definitiva sustituye el pairing como autoridad de la jornada:
`firstIn` es la primera `ENTRY` normalizada de la ventana ordenada y `lastOut`
es la primera `EXIT` posterior. Las demas marcaciones se conservan como
`supplementalEvents` sanitizados y no pueden alterar la jornada canonica,
retardo, salida anticipada, overtime ni estado.

`workedMinutes` es exclusivamente el intervalo canonico y no el span global ni
la suma de pares analiticos. No se infiere BREAK desde eventos suplementarios;
`breakMinutes` queda en cero hasta que exista un contrato separado de intervalo
de descanso programado. Un ENTRY adicional posterior no convierte una jornada
canonica completa en `INCOMPLETE`.

La version de calculo/hashing es 3. La fixture sanitizada de 16 eventos valida
primera entrada `2026-09-03T16:26:04.000Z`, primera salida posterior
`2026-09-03T17:55:13.000Z`, 14 eventos suplementarios y 89 minutos canonicos.
No hubo cambios de BD, PERSIST, RPC, incidencias, legacy ni produccion. Debe
ejecutarse un nuevo Production SHADOW guardado antes de evaluar cualquier
siguiente gate. Ver `phase-35_4-canonical-first-in-first-out-policy.md`.

## Fase 35.5 - Production SHADOW V3 + Contract Regression Reconciliation

El check de entorno sin red queda bloqueado con `SHADOW_ENV_MISSING`: faltan
`SHADOW_CANARY_ALLOWED_HOST`, `SHADOW_CANARY_ENVIRONMENT` y
`SHADOW_CANARY_CONFIRMATION` en el entorno backend. Por tanto no se ejecutaron
baseline, ENGINE_SHADOW V3, trace ni postcheck contra produccion.

El barrido completo de compliance fue auditado, no ocultado: 352 pruebas, 264
PASS, 65 FAIL, 23 skipped, 0 todo y 0 cancelled; `264+65+23=352`. Los 23 skips
son DBREAL protegido (22 subtests y su suite), sin credenciales aisladas. Las
65 se clasifican en 3 regresiones validas de
ZKTeco (fuera de alcance), 43 contratos de asistencia supersedidos por Fase
35.4 y 19 simulaciones de persistencia obsoletas frente al RPC backend-only.
No se modifico, deshabilito ni borro ninguna prueba durante el audit. Ver
`phase-35_5-production-shadow-v3-and-contract-regression-audit.md`.
