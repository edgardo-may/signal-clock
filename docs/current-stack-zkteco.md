# Stack vigente de Signum Clock

Frontend y Employee se despliegan juntos en Vercel: api/employee.js delega al
handler stateless backend/employee-portal/http.mjs. Las sesiones verificables
se almacenan en employee_private.sessions. Desarrollo E2E: npx vercel dev.
No hay servidor Employee permanente ni puerto 4004. La ruta de compatibilidad
/portal-colaborador/login permanece junto con /employee-portal/login.

Consolide conserva backend/api-integracion, su package/lockfile y el proxy
/api/sync/* a signal-clock-api-integracion-test.vercel.app. backend/signum-api
conserva su API de empleados, Dockerfile, tests y compose.yaml independientes.

Dispositivos físicos: ZKTeco ADMS. El gateway vive exclusivamente en el repositorio
independiente zkteco-push-ta; este checkout no lo copia ni lo modifica.
public.devices es el catálogo único. La asignación física autoritativa usa
device_employee_assignments.biometric_user_id; empleados.device_userid se
conserva y nunca se sustituye por PIN funcional o clave administrativa.
WEB_CLOCK usa sesión Employee y terminal autorizado; no crea device por persona.

El runtime vigente de código es backend/attendance-runtime-v3. Su servicio y
backend/attendance-persist-dispatcher usan backend/package.json y su lockfile
compartidos (Express y Supabase en producción). dotenv queda sólo en desarrollo
porque tres CLI existentes lo usan; cors raíz y scripts de sync raíz se retiraron.
No se modifican cálculo Attendance/Workday, revisiones, promociones ni RPC20.
Esta clasificación del código no afirma que se haya cambiado el runtime desplegado.

## Contrato de DB y estado reportado

proposals/125_retire_hikvision_zkteco_only_precheck.sql es SELECT-only.
El operador reportó que `125_retire_hikvision_zkteco_only.sql` fue aplicado en
producción con precheck y postcheck PASS, y que la matriz DBREAL post-125 cerró
235/0/0. Codex no reconsultó producción ni DBREAL durante la documentación.
Esto supersede las notas anteriores de este archivo que decían que 125 no se
había aplicado. No reaplicar 125 ni usar este reporte como autorización SQL.

Los candidatos de seguridad/Employee/WEB_CLOCK SQL 1/2/3 permanecen PENDIENTES
de revisión y aprobación según el estado reportado en esta fase. El operador
reportó que `public.fn_employee_portal` está ausente del catálogo de producción;
Employee API/UI permanecen en mantenimiento hasta resolver el contrato. No
aplicar 029, 117 o 124 de nuevo. Los valores de hashes y el contenido de
candidatos se verifican desde sus archivos fuente, no desde producción.

Los informes antiguos se preservan en docs/archive/pre-zkteco-only. Las referencias
de protocolo que permanecen en tipos del motor sólo permiten interpretar evidencia
histórica; no hay listener, selector ni ruta de ingesta activa para ellos.
Las salidas temporales .runtime-evidence se retiraron por autorización explícita.
No ejecutar probes históricos de persistencia: sus sentinels locales ya no existen;
requieren una nueva revisión operativa y autorización aunque los scripts se conserven.

## Validación local

- npm.cmd test y npm.cmd run build
- npm.cmd test --prefix backend/api-integracion
- npm.cmd test --prefix backend/signum-api
- npm.cmd test --prefix backend
- node --test tests/compliance/zkteco-only-cleanup.test.js
- node scripts/validate-employee-local.mjs (sólo DBREAL local)
- git diff --check

No commit/push/deploy ni SQL productivo están autorizados.
