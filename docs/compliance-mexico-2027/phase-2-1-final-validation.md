# Phase 2.1 Final Validation

Fecha: 2026-09-01. Alcance: Fase 2.1 Security & Persistence Hardening únicamente. No se inició ni autorizó Fase 3.

## Verdict

**PHASE 2.1: NOT FULLY VERIFIED**

**READY FOR PHASE 3: NO**

El criterio de aprobación no se cumple: los DBREAL críticos están todos skipped, no hay instancia PostgreSQL/Supabase TEST/STAGING configurada, no se pudo aplicar 001–046 en una base limpia y hay regresiones funcionales locales. Además, `tests/compliance/db-real.test.js` no implementa pruebas reales: cada cuerpo contiene `assert.fail('Not implemented yet. Need real DB.')` y sólo queda oculto detrás del skip.

## Environment

| Elemento | Resultado |
|---|---|
| `git status` | Worktree con cambios de implementación sin commit; se preservaron sin modificar. |
| `.env.test.local` | No existe. |
| Exclusión Git | `git check-ignore -v .env.test.local` confirma `.gitignore:15:.env.*`. |
| Credenciales test | No configuradas ni inspeccionadas/expuestas. |
| Supabase CLI / Docker / psql | No disponibles en esta estación. |
| Base aislada | No disponible. Producción no fue contactada. |
| Database version | No verificable sin una instancia real. |

## Migration Results

No se aplicaron migraciones: la regla exige 001–046 en una base limpia y el entorno no puede crear ni conectar una base TEST/STAGING.

Existe además un bloqueador estático previo: 029 crea `attendance_logs(numero_serie, biometric_user_id, timestamp)`, mientras 041 crea el índice sobre `attendance_logs(device_serial, user_id, timestamp)`. No hay migración posterior que agregue/renombre esas columnas. En una base limpia, 041 debe fallar por columnas inexistentes y, por ende, impedir llegar a 045/046. Esto debe resolverse y comprobarse con un log de duración/resultado por migración antes de validar 046.

## RPC Grants and Search Path

Inspección de 046:

- `upsert_workday_record(jsonb)` ahora declara `SECURITY DEFINER SET search_path = public, pg_temp`.
- 046 revoca `PUBLIC`, `anon` y `authenticated`, y concede `EXECUTE` a `service_role`.

Es el SQL esperado, pero **no está verificado en catálogo**. No se ejecutaron `has_function_privilege` para `anon`, `authenticated`, `service_role` y `PUBLIC`, ni se consultó `pg_proc.proconfig`. Hasta hacerlo, el claim “backend-only” permanece no demostrado.

`auth_current_employee_id()` usa `SECURITY DEFINER SET search_path = public` y no revoca el EXECUTE por defecto de PUBLIC antes de otorgar a roles. Su lectura está calificada y un `auth.uid()` nulo produce NULL, pero debe endurecerse y verificarse igual que toda función definer.

## RLS and Employee Links

046 cambia workday RLS para usar `auth_current_cliente_id()`, `auth_current_role()` y `auth_current_employee_id()`, en lugar de `user_metadata`. El helper de 031 toma identidad de `usuarios_perfiles`, por lo que el cambio de metadata solicitado parece mitigado por inspección.

No hubo JWT/sesiones reales para Admin A/B ni empleados A1/A2/B1. En consecuencia no hay evidencia real de RLS, ni de que cambiar `user_metadata.cliente_id`/`empleado_id` no cambie acceso.

`employee_user_links` sí tiene unique por `empleado_id` y por `auth_user_id`, por lo que impide dos enlaces para un empleado o usuario, incluso inactivos. Pero no existe constraint, FK compuesta ni trigger que garantice `employee_user_links.cliente_id = empleados.cliente_id`. Un administrador del tenant A puede crear una fila con `cliente_id=A` y `empleado_id` perteneciente a B si conoce el UUID; la FK individual lo permite. El caso cross-tenant requerido no está asegurado.

## History

046 sustituye las rules silenciosas por un trigger `BEFORE UPDATE OR DELETE` que lanza excepción. Por inspección, el trigger satisface el requisito de bloquear explícitamente incluso al rol que bypass RLS.

No se probaron UPDATE/DELETE bajo authenticated, admin ni service_role. Sigue presente la eliminación en cascada de history al borrar registro/empleado/cliente; no es retención inmutable absoluta.

## Creation, Idempotency, Concurrency, and Rollback

La ruta normal crea snapshot con `to_jsonb(workday_records)`, que es una mejora: el snapshot de create/update se forma después de materializar defaults de la fila.

Sin embargo, el tratamiento de carrera de inserción ahora atrapa `unique_violation` y lanza `Concurrency conflict ... Please retry`. `WorkdayPersistenceService` no implementa ese retry. Con 10 invocaciones reales que pasan el SELECT sin fila, una puede crear y las demás chocarán; no devolverán todas `UNCHANGED`. El diseño no satisface todavía la expectativa de 10 llamadas concurrentes idempotentes sin coordinación del caller.

No se ejecutaron DBREAL de creación, 10× idempotencia, cambios de hash, concurrencia ni fault injection de history. El rollback es por tanto no verificado.

## Identity and UNSCHEDULED Reconciliation

`schedule_assignment_id` mejora la identidad frente al template de horario. Pero la reconciliación es incompleta:

- al pasar de UNSCHEDULED a asignada hace `record_state='SUPERSEDED'`, pero nunca rellena `superseded_by` con el registro definitivo;
- no inserta un evento/history que documente la supersesión;
- al cambiar Assignment A por Assignment B sólo supersede registros con assignment NULL. A y B quedan ambos ACTIVE para la misma jornada lógica;
- el UPDATE de supersesión no bloquea la fila provisional antes de la carrera.

Por tanto DBREAL-014 y el escenario de cambio de asignación no pueden aprobarse por inspección.

## Source Logs, Night Shifts, and Ambiguous Assignment

046 valida que cada `source_log_id` exista y pertenezca a tenant + biometric user correctos. No valida `attendance_logs.timestamp` contra la ventana de jornada, así que acepta un log histórico del mismo empleado fuera de la jornada. El requisito de ventana/contrato no se cumple en la RPC.

`WorkdayReprocessService` sí añade una consulta acotada, pero la ventana está fija a `America/Mexico_City`/UTC-06 y no se deriva del timezone real ni de los límites del turno. No es una demostración suficiente de 21:58–06:03 para un turno nocturno en todos los timezones.

La detección de más de una asignación vigente devuelve `AMBIGUOUS_SCHEDULE_ASSIGNMENT`, una mejora estática. No se verificó con base real.

Para jornadas sin horario, `AttendanceEngine` construye la fecha operativa desde el primer timestamp en UTC y descarta `context.operativeDate`. Esto es incorrecto cerca de medianoche local: un punch 22:00 America/Mexico_City puede convertirse en fecha UTC siguiente. La reproducción local con timestamp diurno devolvió UNSCHEDULED, pero no acredita el caso nocturno/local.

## Feature Flags

`WorkdayReprocessService` bloquea `OFF`; `SHADOW` y `ACTIVE` persisten. No hay consumidores productivos de `workday_records` encontrados, así que no se observó integración con prenómina u otros módulos oficiales. Falta ejecutar OFF/SHADOW/ACTIVE contra base real y comprobar persistencia/no efectos.

## Snapshot Integrity and JSON

El snapshot canónico usa `to_jsonb(wr)` después de INSERT/UPDATE, que debe reflejar campos materializados de esa versión. Esto requiere comparación DBREAL de v2 contra history v2.

046 añade checks para que dispositions/incidents/warnings sean arrays. No existe limitación de tamaño de JSON. No se realizaron intentos reales con object/string/null ni payload grande.

## Test Results

| Suite | Total | Pass | Fail | Skip | Resultado |
|---|---:|---:|---:|---:|---|
| Fase 1 original + adversarial + hardening | 75 | 71 | 4 | 0 | FAIL |
| Fase 2 persistence mock | 15 | 14 | 1 | 0 | FAIL |
| Fase 2 simulated | N/A | N/A | N/A | N/A | HANG (>10 s; mock incompatible con nuevo contrato de asignaciones) |
| Fase 2 adversarial anterior | 20 | 15 | 0 | 5 | No es prueba PostgreSQL; lee 045 y quedó obsoleta frente a 046 |
| Fase 2.1 DBREAL | 12 | 0 | 0 | 12 | SKIPPED; cuerpos no implementados |

Fallos concretos de Fase 1: ADV-K1, ADV-K2, HARD-009 (deduplicación fija) y Caso Q (proveedor de reglas). La causa es que `AttendanceEngine.process` cambió su quinto argumento a `context` y sólo pasa timezone al constructor; descarta `deduplication`, `laborRuleProvider` y otras opciones. PERSIST-007 falla porque las pruebas/mocks aún usan `scheduleId` mientras la capa usa `scheduleAssignmentId`.

Calidad de build:

| Comando | Resultado |
|---|---|
| `tsc --noEmit` | PASS, 0 errores |
| `npm run build` | PASS; advertencia Vite de chunk minificado >500 kB |

## Remaining Findings

### F21-001 — CRITICAL — DBREAL no implementado ni ejecutado

**File:** `tests/compliance/db-real.test.js`  
**Impact:** no se puede demostrar grants, RLS, trigger, transacciones o concurrencia en PostgreSQL real.  
**Evidence:** 12 skips por falta de entorno; cada test contiene `assert.fail` placeholder.  
**Recommendation:** provisionar una base Supabase local o TEST desechable, aplicar 001–046 y reemplazar stubs con fixtures/JWT reales y consultas de catálogo.

### F21-002 — HIGH — Migración limpia bloqueada en 041

**File:** `supabase/migrations/029_unify_biometric_schema.sql`, `041_zkteco_attlog_ingestion_hardening.sql`  
**Impact:** no puede cumplirse la aplicación limpia 001–046.  
**Recommendation:** alinear nombres de columnas y registrar resultado/duración de cada migración en una base nueva.

### F21-003 — HIGH — Concurrencia de creación devuelve errores sin retry

**File:** `046_phase2_security_hardening.sql`, `WorkdayPersistenceService.ts`  
**Impact:** peticiones concurrentes legítimas fallan en vez de converger a CREATED/UNCHANGED.  
**Recommendation:** implementar reintento determinista en backend o serializar dentro de RPC, y probar 10 conexiones reales.

### F21-004 — HIGH — Reconciliación de identidad incompleta

**File:** `046_phase2_security_hardening.sql`  
**Impact:** `superseded_by` queda NULL y un cambio A→B deja dos ACTIVE.  
**Recommendation:** bloquear identidad, crear definitivo, actualizar provisional con enlace, versionar el evento y definir política para Assignment A→B.

### F21-005 — HIGH — Regresiones Fase 1 y Fase 2

**File:** `AttendanceEngine.ts`, `WorkdayCalculator.ts`, pruebas de persistencia  
**Impact:** 4/75 pruebas Fase 1 y PERSIST-007 fallan; el mock de reproceso cuelga.  
**Recommendation:** restaurar compatibilidad de opciones del motor y actualizar tests/contratos antes de repetir validación.

### F21-006 — HIGH — Provenance de logs no valida ventana temporal

**File:** `046_phase2_security_hardening.sql`  
**Impact:** logs históricos del mismo empleado pueden declararse fuente de otra jornada.  
**Recommendation:** validar timestamps contra la ventana operativa calculada y probar cross-date/nocturno.

### F21-007 — MEDIUM — Cross-tenant employee link no está restringido

**File:** `046_phase2_security_hardening.sql`  
**Impact:** el requisito de rechazo cross-tenant no queda garantizado.  
**Recommendation:** trigger o FK compuesta que compruebe tenant de empleado y enlace.

### F21-008 — MEDIUM — Ventana UNSCHEDULED/nocturna no conserva fecha operativa solicitada

**File:** `AttendanceEngine.ts`, `WorkdayReprocessService.ts`  
**Impact:** fecha de jornada puede derivarse de UTC y no de la fecha local solicitada.  
**Recommendation:** propagar `context.operativeDate` y calcular ventana con timezone real del tenant/empleado.
