# API de integración Consolide

Backend usado por las vistas Integraciones del cliente y Sincronización Global
de Central. Atiende `POST /api/sync/test`, `/api/sync/preview` y
`/api/sync/execute`. Es independiente de `backend/signum-api` (CRUD de empleados).

## Consulta histórica

Si no se envían fechas, tanto las consultas generales como las individuales usan
`2020-01-01` hasta hoy en `America/Cancun`. Un rango explícito se conserva,
incluido uno anterior a 2020. Consolide recibe fechas de movimiento; este rango
no garantiza incluir empleados cuyo último movimiento sea anterior a 2020.

La vista cliente envía `trabId` para una consulta individual. Central envía el
UUID Signum en `targetClienteId`. El backend resuelve el ID numérico de Consolide
desde `clientes.id_empresa`. Los usuarios de empresa conservan el tenant de su
perfil autenticado; sólo superadmin puede elegir el destino.

Cada consulta de colaboradores obtiene un token nuevo de Consolide y lo envía
en `Authorization: Bearer ...`; no hay caché de tokens entre consultas.
Si la consulta responde 401, se permite una sola renovación y repetición.
Los tokens y las credenciales permanecen exclusivamente en el backend.
El endpoint de consulta es
`/API_RelojesIncidenciasv2/api/Empleados/PostListEmpleados`: la prueba de lectura
contra QA encontró HTTP 404 en la ruta sin `v2` y HTTP 200 en esta ruta.
Un body con `tipo_Estatus: "Error"` se reporta como error, aunque el HTTP sea 200;
no se convierte en un resultado sin colaboradores. `CONSOLIDE_API_URL` debe contener
únicamente la URL base, por ejemplo `https://qa.consolide.com.mx`.

## GitHub y Vercel

Conservar la configuración del proyecto Vercel existente y publicar los cambios
de esta carpeta. El entrypoint sigue siendo `server.js`; el nuevo
`sync-request.js` debe incluirse en el despliegue. No desplegar `signum-api` como
sustituto de esta integración. Las variables requeridas se describen en
`.env.example`; los valores secretos no deben subirse a GitHub.

Validación local: `npm test --prefix backend/api-integracion`.
Después del despliegue, comprobar `/api/sync/preview` con una sesión válida antes
de ejecutar cualquier sincronización. Preview no escribe datos de empleados.
