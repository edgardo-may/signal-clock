# Phase 2 Independent Validation

Fecha de auditoría: 2026-09-01. Alcance limitado a la Fase 2 (`045_workday_records`, persistencia y reproceso). No se inició trabajo de Fase 3.

## Executive Summary

**VERDICT: FAIL**

**PHASE 2 VALIDATION: FAIL**

**READY FOR PHASE 3: NO**

La afirmación `PHASE 2: PASS / READY FOR PHASE 3: YES / 18/18` no es sostenible. La mutación `SECURITY DEFINER` carece tanto de autorización interna como de revocación explícita de `EXECUTE`; por el privilegio por defecto de PostgreSQL una función nueva es ejecutable por `PUBLIC` salvo que los privilegios por defecto del servidor hayan sido alterados fuera del repositorio. En Supabase estándar esto deja la RPC invocable por `anon` y `authenticated`, saltando RLS, con un payload que controla todos los datos materiales y el hash.

La estación auditada no tiene CLI Supabase, Docker ni `psql`, y `.env.local` no contiene URL/clave configurada. Por tanto no fue posible afirmar resultados de catálogo, RLS/JWT, rollback o concurrencia contra una instancia PostgreSQL real. Esos puntos se declaran **no verificados**, no “aprobados”. Se añadió una suite de auditoría que separa pruebas estáticas de cinco casos de integración bloqueados hasta proporcionar una base desechable.

## Database Architecture

La migración crea `tenant_features`, `workday_records` y `workday_record_history`; los IDs de `attendance_logs` son UUID, por lo que `source_log_ids UUID[]` tiene el tipo correcto.

Aspectos correctos por inspección:

- FKs básicas a `clientes`, `empleados`, `horarios` y el registro padre de history.
- Checks no negativos para los siete campos de minutos.
- Índices por empleado/fecha y cliente/fecha, y unicidad funcional de identidad.
- `uq_workday_history_version(workday_record_id, version)` impide colisión de versión por registro.
- `tenant_features.state` sólo permite `OFF`, `SHADOW` y `ACTIVE`.

Pero no hay checks para `workday_state`, `timezone`, `calculation_version`, forma/tamaño de JSON, ni relación de los logs al tenant, empleado o fecha. Las FKs separadas tampoco garantizan que `empleado_id` y `schedule_id` pertenezcan al mismo tenant si alguien inserta fuera de la RPC.

## Identity Model

El modelo real de `horarios` es un catálogo reutilizable de configuración semanal; `empleados_horarios` es la asignación con vigencia. `schedule_id` identifica el **template de horario**, no una instancia de asignación, segmento ni jornada individual.

La clave `(cliente_id, empleado_id, workday_date, COALESCE(schedule_id::text, 'UNSCHEDULED'))` permite dos templates distintos el mismo día, por ejemplo doblete 06–14 y 14–22. No permite dos jornadas distintas que reutilicen el mismo template el mismo día. Tampoco captura la asignación concreta ni resuelve solapamientos: `empleados_horarios` no tiene constraint de no solapamiento y el reproceso hace `limit(1)` sin orden.

El turno partido sí cabe como una sola jornada si está modelado dentro de un `horario`; el nocturno usa correctamente la fecha operativa de inicio en el motor. Sin embargo, el recuperador RAW no delimita ninguna ventana temporal.

## UNSCHEDULED Reconciliation

**Resultado: vulnerable.** Un registro con `schedule_id NULL` usa la identidad `UNSCHEDULED`; al reprocesar con un UUID de horario se busca otra identidad y se inserta otra fila. No existe una actualización que cambie `schedule_id`, ni una reconciliación transaccional.

El resultado es exactamente dos registros para el mismo empleado/fecha: uno `UNSCHEDULED` y uno programado. Un cambio de schedule A a B repite el problema. Es un finding HIGH de identidad lógica.

Recomendación: antes de automatizar consumo, definir una identidad estable de jornada/asignación. Una corrección segura y acotada es una transacción de reconciliación que bloquee la identidad estable, relacione el registro provisional con el definitivo (`superseded_by` o `record_state`), preserve el historial y nunca borre silenciosamente. No se recomienda purgar ni fusionar filas históricas de forma automática.

## RPC Security

`public.upsert_workday_record(payload jsonb)` es `SECURITY DEFINER` y referencia objetos con `public.`; eso reduce sustitución de tabla/función en las sentencias calificadas, pero no sustituye `SET search_path` seguro. La función no declara `SET search_path = public, pg_temp` (o equivalente), por lo que falla el requisito de endurecimiento contra hijacking.

Más grave: la migración no contiene `REVOKE EXECUTE ... FROM PUBLIC` ni un `GRANT` acotado para esta RPC. PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto al crear funciones. Con los grants estándar de Supabase, `anon`, `authenticated`, colaboradores, RH y admins pueden invocarla; `service_role` también. RLS no protege las operaciones internas de la función propietaria `SECURITY DEFINER`.

La función valida que empleado y horario pertenezcan a `payload.cliente_id`, por lo que los casos employee/client y schedule/client cruzados deberían producir excepción **si** se llega a la función. Pero no valida al invocador (`auth.uid`, rol, tenant efectivo, cuenta activa o permiso de backend), así que cualquier invocador con IDs válidos del tenant objetivo puede crear o modificar sus jornadas. `creado_por`, hash, minutos, timestamps, JSON y razón también provienen del payload.

El hash se calcula normalmente en `WorkdayIntegrityHasher`, dentro del dominio, pero la RPC no lo recalcula ni verifica una firma/trust boundary. Un llamador directo puede enviar cualquier `integrity_hash`, incluso repetir el hash actual para recibir `UNCHANGED`, o cambiar datos y hash arbitrarios. Es un control de idempotencia, no integridad frente a un cliente no confiable.

## RLS Verification

Las tablas nuevas tienen RLS y sólo políticas `SELECT`; por ello escrituras directas de los roles frontend deberían denegarse por RLS. Esto no aplica a la RPC definer.

Las políticas de lectura además usan directamente `user_metadata.cliente_id` y `user_metadata.empleado_id`, en vez de los helpers de identidad existentes. En Supabase, `user_metadata` es modificable por el propio usuario; un admin válido puede sustituir su `cliente_id` por el de otro tenant y un colaborador puede sustituir `empleado_id` por el de otra persona. La rama de empleado ni siquiera ata dicho empleado al `cliente_id`. Es un riesgo HIGH de aislamiento de tenant/empleado.

No se ejecutaron consultas con JWT reales para adminA, empleadoA, adminB, RH ni superadmin: no existe ambiente local conectado. La verificación obligatoria posterior debe ejecutar esas consultas con tokens emitidos por Auth, incluyendo la modificación de `user_metadata` como prueba negativa.

## Concurrency

Por lectura del SQL, el patrón `SELECT ... FOR UPDATE` para fila existente + unique index para carrera de inserción evita teóricamente duplicar la misma versión bajo `READ COMMITTED`. Tras un conflicto de inserción, la transacción vuelve a buscar la fila; hashes iguales deberían dejar versión 1 y hashes diferentes serializarse a versiones consecutivas. El orden final de hashes diferentes es no determinista.

No hay prueba real: DBADV-006 a DBADV-009 permanecen skipped sin PostgreSQL. El bloque `EXCEPTION WHEN unique_violation` captura cualquier `unique_violation`, no sólo `idx_workday_records_identity`, y reintenta sin contador ni distinción de constraint. Un conflicto no esperado puede causar reintento infinito. Debe limitarse al constraint esperado o usar un patrón determinista `INSERT ... ON CONFLICT`/advisory lock probado con 10 conexiones.

## Versioning

Para la ruta normal, create inserta current/history versión 1; update con hash distinto calcula `current_version + 1` bajo lock e inserta la misma versión en history. Un error no capturado en history revierte el update porque la llamada RPC es transaccional.

No se comprobó rollback real por falta de base. Además, history almacena el **payload de entrada**, no una serialización canónica de la fila materializada: en create los minutos faltantes se convierten a cero en la fila mediante `COALESCE`, pero el snapshot conserva `null`/ausencia; el snapshot también incluye `change_reason` y `creado_por`, no columnas materializadas. La correspondencia snapshot-versión debe reconstruirse desde la fila devuelta o validarse contra un JSON canónico.

## History Immutability

La tabla usa rules `DO INSTEAD NOTHING` para UPDATE y DELETE. Para un usuario normal sin políticas de escritura, RLS debe denegar antes; para un rol que bypass RLS, UPDATE/DELETE se reporta exitoso con cero filas afectadas, no falla como exige la especificación. Además los FKs `ON DELETE CASCADE` desde registro, empleado y cliente destruyen history en una eliminación padre. No es retención inmutable fuerte.

La RPC solamente inserta history y no actualiza versiones anteriores en su flujo normal. Falta ejecutar los intentos reales para anon/authenticated/colaborador/admin/RH y service role.

## Feature Flags

El enum lógico de `state` es correcto y no existe policy de INSERT/UPDATE/DELETE para `authenticated`, por lo que un admin tenant no debería modificar la tabla directamente bajo RLS. Sólo la lectura está expuesta.

No hay ningún uso de `tenant_features` en `WorkdayPersistenceService`, `WorkdayReprocessService` ni en la RPC. Por tanto `OFF`, `SHADOW` y `ACTIVE` no cambian comportamiento: no existe gate ni una semántica ejecutable de shadow mode. El repositorio no tiene consumidores productivos de `workday_records`; tampoco hay conexión automática a ADMS/ISUP/ATTLOG, prenómina o incidencias oficiales. Esto evita impacto actual, pero no acredita SHADOW.

## Shadow Mode

La ausencia de referencias desde la ingesta y de consumidores de `workday_records` indica que Fase 2 no altera actualmente ADMS, ISUP, `attendance_logs`, `registro_asistencia`, prenómina ni incidencias oficiales. Aun así, “calcular/persistir sólo en SHADOW” no está implementado ni comprobado por un feature flag.

## Service Layer

El dominio no importa Supabase y no se encontró `service_role`, `SUPABASE_SERVICE_ROLE` ni un cliente admin en `src`; Vite sólo ve variables públicas `VITE_*`. Eso es positivo.

No obstante, `WorkdayPersistenceService` acepta `any supabaseClient`, no exige contexto confiable y reenvía el resultado a una RPC públicamente ejecutable. `WorkdayReprocessService` tiene problemas operativos:

- ejecuta una primera consulta de `attendance_logs` que no se espera ni se usa;
- la segunda lee todos los logs del biométrico/tenant, sin rango de fecha ni ventana nocturna;
- ignora `fecha_fin`, no ordena y elige arbitrariamente con `limit(1)` una asignación;
- pasa `shiftConfig` posiblemente `undefined` a `AttendanceEngine.process`.

La reproducción local de una jornada sin horario lanzó `TypeError: Cannot read properties of undefined (reading 'operativeDate')`. El typecheck también lo diagnostica. Para nocturno, el bug no es perder exclusivamente post-medianoche: recupera también post-medianoche, pero junto con todo el histórico, lo cual es incorrecto, costoso y puede contaminar el cálculo.

## Tests

Se ejecutaron las suites existentes de Fase 1, adversarial Fase 1, hardening y Fase 2 en un único comando:

```
tests 93; pass 93; fail 0
```

El desglose real es 75 pruebas de Fase 1 y 18 de Fase 2. Las 18 no son integración DB: `persistence.test.js` contiene 15 casos sobre `MockSupabaseDB` en memoria y `persistence-simulated.test.js` contiene 3 casos con mock. Los identificadores PERSIST-012, PERSIST-015 y PERSIST-016 ni existen. PERSIST-013/014 simulan RLS y PERSIST-017 simula la carrera recursivamente; no prueban PostgreSQL, grants, RLS/JWT, locks ni transacciones.

Se añadió `tests/compliance/persistence-adversarial.test.js`. Su corrida local dio 15 hallazgos/proofs estáticos y 5 skips de integración (concurrencia, rollback y RAW nocturno), explícitamente condicionados a `PHASE2_AUDIT_DATABASE_URL`. No se deben interpretar los skips como éxito.

## Regression

El diff `17261f6..d4ad7ae` añade 045 y los servicios, pero también modifica seis archivos del motor de Fase 1 y el test adversarial; no es un cambio aislado de persistencia. Las migraciones 001–044, ADMS/ISUP y `attendance_logs` no se modifican en ese commit. Las 75 pruebas de Fase 1 pasaron, lo que da cobertura de dominio, no una garantía de esquema desplegado. Se detectó una inconsistencia preexistente en 041 (`device_serial`, `user_id`) frente a 029 (`numero_serie`, `biometric_user_id`); no fue introducida por Fase 2 y no se evaluó como cambio de Fase 2.

`npm run build` pasó. Vite emitió únicamente su aviso de chunk minificado mayor a 500 kB. No existe script `lint`. `tsc --noEmit` falla con 10 errores, incluidos el `shiftConfig` opcional de reproceso y variables no usadas; por tanto typecheck no está verde.

## Findings

### P2-001

**SEVERITY:** CRITICAL  
**FILE:** `supabase/migrations/045_workday_records.sql`  
**DESCRIPTION:** RPC `SECURITY DEFINER` sin autorización interna, sin revocar EXECUTE de PUBLIC y sin grant limitado.  
**IMPACT:** anon/authenticated puede mutar jornadas de cualquier tenant con IDs válidos, omitiendo RLS.  
**REPRODUCTION:** En un proyecto estándar, consultar `has_function_privilege('anon', 'public.upsert_workday_record(jsonb)', 'EXECUTE')`; llamar `rpc/upsert_workday_record` con payload válido de otro tenant.  
**RECOMMENDATION:** `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; conceder sólo a un rol backend dedicado/service role y añadir autorización/tenant de invocador en la función. No exponer la RPC en PostgREST.

### P2-002

**SEVERITY:** HIGH  
**FILE:** `supabase/migrations/045_workday_records.sql`  
**DESCRIPTION:** SECURITY DEFINER no fija `search_path`.  
**IMPACT:** superficie de hijacking de search path y no cumplimiento de la regla de funciones privilegiadas.  
**REPRODUCTION:** inspeccionar `pg_proc.proconfig`; la definición no contiene `SET search_path`.  
**RECOMMENDATION:** declarar `SET search_path = public, pg_temp` (con objetos calificados) y revisar owner/permisos.

### P2-003

**SEVERITY:** HIGH  
**FILE:** `045_workday_records.sql`  
**DESCRIPTION:** Identidades `UNSCHEDULED`, schedule A y schedule B son filas distintas.  
**IMPACT:** doble jornada para mismo empleado/fecha tras asignación o cambio de horario.  
**REPRODUCTION:** insertar con `schedule_id null`; reprocesar con UUID válido; el unique index no colisiona.  
**RECOMMENDATION:** reconciliación explícita y auditable con identidad estable; no borrado automático.

### P2-004

**SEVERITY:** HIGH  
**FILE:** `045_workday_records.sql`  
**DESCRIPTION:** Políticas RLS confían en `user_metadata` editable por el usuario.  
**IMPACT:** fuga cross-tenant/cross-empleado modificando metadata y refrescando JWT.  
**REPRODUCTION:** authenticated actualiza `cliente_id` o `empleado_id` en user_metadata y consulta las tablas.  
**RECOMMENDATION:** usar sólo claims administrados (`app_metadata`) o una tabla de perfil ligada a `auth.uid()` mediante helper SECURITY DEFINER seguro; incluir tenant en la rama de empleado.

### P2-005

**SEVERITY:** HIGH  
**FILE:** `045_workday_records.sql`  
**DESCRIPTION:** `source_log_ids` se castea a UUID[] sin validar existencia, tenant, empleado ni ventana de jornada.  
**IMPACT:** procedencia falsificable y auditoría de marcajes no confiable.  
**REPRODUCTION:** invocar RPC con UUIDs existentes de otro tenant o UUIDs inventados.  
**RECOMMENDATION:** validar todos los IDs contra `attendance_logs` del tenant/empleado y ventana esperada dentro de la transacción.

### P2-006

**SEVERITY:** HIGH  
**FILE:** `WorkdayPersistenceService.ts`, `045_workday_records.sql`  
**DESCRIPTION:** Hash y todos los campos materiales son input no confiable de RPC.  
**IMPACT:** idempotencia/integridad eludible por P2-001.  
**REPRODUCTION:** mismo `integrity_hash` con payload distinto devuelve UNCHANGED; hash arbitrario crea una nueva versión.  
**RECOMMENDATION:** invocación exclusiva de backend y validación de contrato; calcular hash desde datos confiables o firmar el payload en backend.

### P2-007

**SEVERITY:** HIGH  
**FILE:** `src/services/attendance/WorkdayReprocessService.ts`  
**DESCRIPTION:** RAW sin rango temporal, asignación sin fecha_fin/orden y crash sin horario.  
**IMPACT:** jornadas contaminadas, consumo no acotado y fallo del caso UNSCHEDULED.  
**REPRODUCTION:** ejecutar sin asignación: TypeError reproducido; inspeccionar consulta de logs sin `gte/lte`.  
**RECOMMENDATION:** ventana explícita timezone-aware (incluido nocturno), filtrar vigencia, ordenar/desambiguar asignación y soportar `shiftConfig` opcional antes de persistir.

### P2-008

**SEVERITY:** MEDIUM  
**FILE:** `045_workday_records.sql`  
**DESCRIPTION:** History usa rules silenciosas y cascadas de borrado.  
**IMPACT:** no cumple “UPDATE/DELETE deben fallar” para bypass roles y puede perder historial por deletes padre.  
**REPRODUCTION:** service role intenta UPDATE/DELETE; las rules producen cero filas, no error; borrar padre cascada history.  
**RECOMMENDATION:** denegar permisos, trigger que lance excepción y política de retención sin cascada si el requisito legal exige preservación.

### P2-009

**SEVERITY:** MEDIUM  
**FILE:** `045_workday_records.sql`  
**DESCRIPTION:** Snapshot no es la fila materializada canónica y JSON no tiene validación de esquema/tamaño.  
**IMPACT:** historia no comparable de forma determinista; payload malformado/masivo causa error o DoS de almacenamiento.  
**REPRODUCTION:** omitir minutos en create (fila 0, snapshot ausente) o enviar JSON no array/muy grande.  
**RECOMMENDATION:** construir snapshot desde `INSERT/UPDATE ... RETURNING`, validar JSON y limitar tamaño.

### P2-010

**SEVERITY:** MEDIUM  
**FILE:** `045_workday_records.sql`, servicios  
**DESCRIPTION:** feature flag no se consulta ni impone; SHADOW no tiene comportamiento efectivo.  
**IMPACT:** estados de flag engañosos y ausencia de control central de activación.  
**REPRODUCTION:** buscar referencias a `tenant_features`: sólo migración.  
**RECOMMENDATION:** gate backend explícito, permisos centralizados de modificación y prueba OFF/SHADOW/ACTIVE.

### P2-011

**SEVERITY:** MEDIUM  
**FILE:** `045_workday_records.sql`  
**DESCRIPTION:** retry de `unique_violation` no distingue constraint ni tiene límite.  
**IMPACT:** posible bucle no acotado ante conflicto inesperado.  
**REPRODUCTION:** provocar una unique_violation distinta dentro del bloque de inserción.  
**RECOMMENDATION:** filtrar por `CONSTRAINT_NAME`, limitar/reporter reintentos y probar carga real.

### P2-012

**SEVERITY:** MEDIUM  
**FILE:** pruebas y `tsconfig`  
**DESCRIPTION:** 18/18 es conteo de mocks; typecheck falla y no hay lint configurado.  
**IMPACT:** falsos positivos de calidad y defectos no bloqueados.  
**REPRODUCTION:** `node --test ...` pasa 93; `tsc --noEmit` falla; `npm run lint` informa script faltante.  
**RECOMMENDATION:** hacer obligatorias integración PostgreSQL/RLS/concurrencia y typecheck/lint verdes antes de liberar.
