# Contrato SQL Employee — plan de instalación y aceptación

**Estado:** PENDIENTE de verificación de catálogo, revisión de alcance y aprobación. Este documento no autoriza ni ejecuta cambios productivos.

## Evidencia y alcance

La revisión fue documental/local. El operador reportó que una consulta de catálogo en Supabase Production no encontró `public.fn_employee_portal` (0 filas). No se consultó Production en esta fase. La ausencia de otros objetos, permisos o políticas NO se infiere de ese resultado. SQL 125 se considera aplicado según evidencia reportada anteriormente por el operador; no se revalidó.

Los SHA-256 siguientes se calcularon sobre los candidatos presentes en el checkout:

| Orden previsto | Candidato | SHA-256 | Alcance |
|---|---|---|---|
| 1 | `database/live-schema/proposals/global_security_minimum_candidate.sql` | `54A857EC2F494048A6CAA9D1D31F9CE9F213C159261D7E937553B3F47080BF48` | Endurecimiento parcial de ACL para tablas y rutinas existentes. |
| 2 | `database/live-schema/proposals/employee_web_clock_candidate.sql` | `F1C0A27143DC5FC8A0D1DD2BA4C4AAF21EE5A476D047866C05990242D44A8B52` | Esquema privado, PIN, sesión, autorizaciones, WEB_CLOCK y RPC Employee; también cambia contratos legacy de asistencia y políticas. |
| 3 | `database/live-schema/proposals/web_clock_canonical_source_delta.sql` | `EC954271070701A0E85962DC08600777652A64B2A45BF9BB09506B64045ACF6A` | Evidencia canónica WEB_CLOCK e integración con outbox y RPC20 de Workday. |
| Separado | `database/live-schema/proposals/employee_pin_conversion_candidate.sql` | `DC5B2DB38EC8BB04574B6AFF1E2AD66E113454EA6CC11063A77E8890E1E3F22A` | Conversión PIN legacy; no forma parte de SQL 1/2/3 ni de la habilitación de Directory/Session. |

El orden previsto es SQL 1 → SQL 2 → SQL 3: SQL 2 define la capa Employee que SQL 3 modifica, y SQL 3 requiere que exista esa definición. SQL 1 es el endurecimiento previo del paquete. Los candidatos declaran que el llamador controla la transacción y exigen el ajuste local `DBREAL_ROLLBACK_ONLY`; SQL 1 también exige PostgreSQL 17 o superior y SQL 2 verifica `extensions.crypt(text,text)`. Estos guardas hacen que los archivos actuales no sean ejecutables en Production tal como están.

SQL 4 `global_security_hardening_v2_defaults.sql` queda fuera: workstream separado y abierto.

## Matriz de dependencias

| Flujo | Objetos y datos usados directamente | Operaciones y límites |
|---|---|---|
| Directory | `public.clientes(id, nombre_empresa, estatus)`; solo filas `estatus='activo'`. Respuesta `{success:true, companies:[{id,nombre_empresa}]}`. | Lectura agregada. No depende de `employee_private`, PIN, sesiones, horarios ni WEB_CLOCK. La función completa, sin embargo, referencia objetos de otros flujos en su cuerpo. |
| Login / credencial | `public.clientes`, `public.empleados`, `public.rate_limits_logs`, `public.audit_logs`, `employee_private.credentials`; `extensions.digest/crypt/gen_salt`. | Registra intentos y auditoría; verifica PIN bcrypt de cinco dígitos y crea sesión. Conversión PIN es operación separada. |
| Session / logout | `employee_private.sessions`, `employee_private.credentials`, `public.empleados`, `public.clientes`; actividad, expiración, revocación y versión de credencial. | Identidad/tenant derivan de la sesión verificada. Logout actualiza revocación y auditoría. La función completa también incluye otros flujos. |
| Estado del portal | Sesión y empleado/empresa; además `employee_private.web_clocks`, `company_authorizations`, `public.devices`, `empleados_horarios`, `horarios`, `registro_asistencia`. | Construye perfil, horario y asistencia reciente; revisar campos expuestos y joins tenant-scoped. |
| WEB_CLOCK / PUNCH | `web_clocks`, `company_authorizations`, `devices`, `attendance_source_events`, `registro_asistencia`, `audit_logs`, horarios; SQL 3 añade `web_clock_receipts` y verificador canónico. | Inserta evidencia/asistencia y valida empresa, terminal, empleado, dirección, request ID e idempotencia. No ejecutar PUNCH en las pruebas de aceptación de este plan. |

### Objetos y seguridad de SQL 2

- Crea `employee_private.credentials`, `sessions`, `company_authorizations`, `web_clocks`: RLS habilitado y acceso directo revocado a PUBLIC/anon/authenticated/service_role.
- Crea `employee_private.capture_pin()` y trigger `employee_pin_capture` en `public.empleados`: SECURITY DEFINER con search_path fijo; la lógica procesa PIN nuevo y limpia plaintext. Ejecución directa revocada.
- Crea `public.manage_web_clock(text,jsonb)`: SECURITY DEFINER; concede EXECUTE a authenticated. No es dependencia de Directory.
- Crea `public.fn_employee_portal(p_action text,p_input jsonb) RETURNS jsonb`: SECURITY DEFINER, search_path `pg_catalog,public,pg_temp`; revoca EXECUTE a PUBLIC, anon y authenticated y concede a service_role. El script no fija explícitamente owner: lo determina el rol que aplique el DDL.
- También revoca EXECUTE de RPC legacy de login/checadas para anon/authenticated; elimina dos políticas anon de `registro_asistencia`, cambia ACLs de tabla/columnas y políticas, y añade políticas restrictivas. Esos cambios afectan acceso de asistencia existente; no son dependencias de la rama Directory y necesitan revisión coordinada.

### Efectos de SQL 1 y SQL 3 fuera de Directory/Session

SQL 1 recorre 19 tablas y revoca a PUBLIC/anon/authenticated capacidades no-row-level (`TRUNCATE`, `TRIGGER`, `MAINTAIN`, `REFERENCES` y referencias por columna). Ajusta EXECUTE y search_path de `fn_employee_insert_sync(uuid,jsonb)` y `fn_generar_faltas_diarias()`. No instala la RPC Employee ni configura políticas de identidad globales.

SQL 3 crea `employee_private.web_clock_receipts`, `is_canonical_web_clock_source` y una vista accesible a service_role; modifica el cuerpo de `fn_employee_portal`, el trigger `enqueue_attendance_persist_outbox()` y RPC20 `upsert_workday_record`. Depende de fragmentos congelados exactos de SQL 2 y del contrato RPC20. Sus guardas de texto deben detenerse ante cualquier drift del cuerpo.

## Estado del catálogo Production

| Objeto o condición | Estado | Evidencia |
|---|---|---|
| `public.fn_employee_portal(text,jsonb)` | **AUSENTE según operador** | Consulta previa reportada con cero filas; Codex no reconsultó. |
| `public.clientes` y columnas usadas | **NO VERIFICADO** | Debe comprobarse en catálogo, sin leer filas. |
| `employee_private`, tablas, trigger PIN y auxiliares | **PENDIENTE / no demostrado** | No inferir ausencia a partir de la RPC faltante. |
| RLS, policies, owners y ACL objetivo | **PENDIENTE** | Sin snapshot de catálogo en esta fase. |
| `extensions.crypt`, `digest`, `gen_salt` | **PENDIENTE** | SQL2 comprueba crypt; digest/gen_salt y permisos requieren verificación. |
| `devices`, eventos, outbox, RPC20 y trigger | **PENDIENTE de comparar con SQL3** | SQL125 no demuestra que SQL3 esté instalado. |
| Schema `public` expuesto por PostgREST | **NO VERIFICADO** | Privilegios SQL y schemas expuestos en configuración API son controles distintos. |
| SQL125 ZKTeco-only | **VALIDADO (operador reportado)** | Aplicación/postcheck reportados previamente; no revalidado ni necesario en esta fase. |

No se ejecutaron consultas de catálogo productivo en esta fase. Las consultas siguientes quedan preparadas para una revisión autorizada. No leen filas de `clientes` ni ejecutan RPC.

## Consultas preparadas de catálogo (solo lectura)

### Firma, retorno, seguridad, owner y EXECUTE de la RPC

```sql
SELECT n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner_name, p.proacl,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
               WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
       md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='fn_employee_portal';
```

### Relaciones, columnas, RLS y owner

Esta consulta devuelve metadatos; no valores empresariales.

```sql
SELECT n.nspname AS schema_name, c.relname, c.relkind,
       pg_get_userbyid(c.relowner) AS owner_name,
       c.relrowsecurity, c.relforcerowsecurity,
       a.attname AS column_name, format_type(a.atttypid,a.atttypmod) AS data_type,
       c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE (n.nspname='public' AND c.relname IN (
 'clientes','empleados','rate_limits_logs','audit_logs','devices',
 'empleados_horarios','horarios','attendance_source_events','registro_asistencia',
 'web_clock_canonical_sources'))
 OR (n.nspname='employee_private' AND c.relname IN (
 'credentials','sessions','company_authorizations','web_clocks','web_clock_receipts'))
ORDER BY n.nspname,c.relname,a.attnum;
```

### Funciones, trigger y extensiones

```sql
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef,pg_get_userbyid(p.proowner) AS owner_name,
       md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN (
 'manage_web_clock','fn_employee_insert_sync','fn_generar_faltas_diarias',
 'is_canonical_web_clock_source','enqueue_attendance_persist_outbox','upsert_workday_record'))
 OR (n.nspname='employee_private' AND p.proname='capture_pin')
ORDER BY n.nspname,p.proname;

SELECT t.tgname,t.tgenabled,c.relname AS table_name,p.proname AS trigger_function
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal
 AND ((n.nspname='public' AND c.relname IN ('empleados','registro_asistencia'))
      OR n.nspname='employee_private');

SELECT e.extname,e.extversion,en.nspname AS extension_schema
FROM pg_extension e JOIN pg_namespace en ON en.oid=e.extnamespace
WHERE e.extname IN ('pgcrypto','btree_gist');
```

Estas consultas no revelan dependencias dinámicas de PL/pgSQL ni prueban que PostgREST publique `public`. Comparar definiciones y hashes con el candidato, revisar manualmente, y verificar la configuración efectiva de schemas expuestos por el canal administrativo autorizado. No ejecutar `fn_employee_portal`.

## Evaluación de seguridad

1. **Privilegio RPC:** comprobar ACL efectiva: PUBLIC/anon/authenticated sin EXECUTE y service_role con EXECUTE. Confirmar owner controlado y confiable; SQL2 no fija el owner.
2. **SECURITY DEFINER:** confirmar `search_path`, owner, objetos cualificados y cuerpo exacto. SECURITY DEFINER no reemplaza la autorización tenant.
3. **Tablas privadas:** revisar RLS, FORCE RLS si aplica, grants y policies; confirmar que el owner de funciones puede operar las tablas tras revocar grants directos.
4. **Directory y privacidad:** devuelve UUID y nombre de todas las empresas activas. No expone PIN ni empleados, pero permite enumerar nombres/IDs a quien alcance el endpoint. Aceptar explícitamente esa exposición mínima o definir control aprobado, sin alterar el contrato por cuenta propia.
5. **Aislamiento multiempresa:** tras autenticación, la sesión liga cliente, empleado y versión de credencial; el body rechaza identidades/tenant discordantes. Directory es global. Verificar joins tenant-scoped de horarios, asistencia, dispositivos y clocks.
6. **Alcance ampliado:** revisar por separado los cambios de SQL2 en RPCs legacy/ACL/policies de `registro_asistencia` y de SQL3 en outbox/RPC20.
7. **SQL1:** comprobar consumidores de ACL no-row-level y las dos rutinas cuya ACL/search_path modifica.
8. **SQL4:** default privileges excluido/hold; no incluirlo.

## Procedimiento de instalación propuesto (no ejecutar)

### Gates previos

- Mantener `EMPLOYEE_PORTAL_MAINTENANCE=true`, `VITE_EMPLOYEE_PORTAL_MAINTENANCE=true` y WEB_CLOCK OFF.
- Capturar las consultas anteriores sin datos empresariales ni secretos; verificar versión PostgreSQL, extensiones, tablas/columnas, firma RPC20, triggers, RLS/policies, owners y ACL.
- Comparar cada modificación contra el catálogo actual. Resolver drift antes de preparar la ventana.
- **No aplicar estos candidatos directamente:** sus guardas exigen `DBREAL_ROLLBACK_ONLY`. Preparar una variante Production revisada con nuevos hashes; no quitar guardas ad hoc durante la ejecución.
- Aprobar separadamente el efecto global de SQL1, los cambios de RPC/policies de asistencia de SQL2 y la integración outbox/RPC20 de SQL3.
- Acordar límites de lock/statement timeout y confirmar respaldo/PITR aprobado.

### Orden y checkpoints

1. **SQL1:** ejecutar una variante Production revisada en transacción controlada. Pre/postcheck de ACL de las tablas de su lista, ACL por columna y EXECUTE/search_path de ambas funciones. Drift u objeto inesperado: rollback de esa transacción y STOP.
2. **SQL2:** aplicar la variante aprobada. Verificar schema/tablas, columnas/FKs/CHECKs, RLS, policies, trigger PIN, owner/search_path, ACL de manage_web_clock/fn_employee_portal y RPC legacy. Confirmar que autorización WEB_CLOCK permanece OFF. Cualquier fallo: rollback de la transacción y STOP.
3. **SQL3:** sólo si definición Employee y RPC20 coinciden con los fragmentos esperados. Verificar receipts, ACL/RLS, función canónica, vista, trigger outbox y RPC20. Fallo de guard de texto o postcheck: rollback y STOP.
4. Registrar hashes y resultados sanitizados por checkpoint. No avanzar tras un gate fallido.
5. Conversión PIN es separada y requiere autorización e inventario propios; no forma parte de Directory/Session.
6. No desactivar mantenimiento ni habilitar WEB_CLOCK en esta instalación.

### Recuperación

- Antes del commit de cada etapa, error o postcheck distinto => rollback de esa transacción y detenerse.
- Después del commit, no improvisar DROP ni SQL inverso. Mantener mantenimiento y WEB_CLOCK OFF; conservar evidencia y usar PITR/backup aprobado o corrección forward revisada por DBA tras evaluar dependencias/datos.
- No avanzar hasta que catálogo y permisos del checkpoint estén revisados.

## Pruebas de aceptación (sin checadas)

Sólo tras una futura aplicación autorizada. Para probar respuestas normales, requerir ventana posterior aprobada con API maintenance OFF y UI maintenance ON; no cambiar esas variables como parte de esta fase.

| Caso | Solicitud | Criterio |
|---|---|---|
| Directory con mantenimiento | GET `/api/employee?action=directory` | HTTP 503, `EMPLOYEE_PORTAL_MAINTENANCE`; no invocar RPC si la instrumentación aprobada lo permite. |
| Directory operativo | Misma ruta en ventana aprobada | HTTP 200, `success=true`, `companies` array. Evidencia sin nombres/IDs productivos; usar forma/conteo agregado o fixture aprobado. |
| Session anónima | GET `/api/employee?action=session`, sin cookie | HTTP 401, `SESSION_DENIED`; nunca SERVER_CONFIG_REQUIRED, PORTAL_UNAVAILABLE, mantenimiento inesperado ni error SQL. |
| Token inválido | GET session con token sintético aleatorio | Denegación controlada; sin identidad aceptada desde cliente. Ejecutar en entorno aislado/fixture, no con persona real. |
| Exposición | Revisar respuesta sanitizada | Sin PIN, pin_hash, session_hash, service key, token ni datos de otro tenant. No llamar PUNCH. |

Estas pruebas no demuestran conversión PIN, WEB_CLOCK, outbox ni pipeline completo de asistencia.

## Bloqueadores y veredicto

- RPC Production ausente según el operador; no se verificó el resto del catálogo.
- Owner, grants, RLS, columnas, extensiones, dependencias y PostgREST exposure pendientes de snapshot.
- Los candidatos actuales son DBREAL-only y no están aprobados para Production tal como están.
- SQL2 combina Employee con cambios de acceso/policies de asistencia; SQL3 altera outbox y RPC20.
- Directory expone IDs/nombres de empresas activas; falta aceptación explícita de privacidad para ese comportamiento.
- Falta una variante Production revisada, con pre/postchecks y rollback aprobado.

**READY TO APPLY: NO.** Próxima acción: obtener un snapshot autorizado READ ONLY del catálogo Production, resolver diferencias y preparar la variante Production para revisión. Este trabajo documental no consultó ni modificó Production.
