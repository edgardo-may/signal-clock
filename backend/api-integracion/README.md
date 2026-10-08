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

## GitHub y Vercel

Conservar la configuración del proyecto Vercel existente y publicar los cambios
de esta carpeta. El entrypoint sigue siendo `server.js`; el nuevo
`sync-request.js` debe incluirse en el despliegue. No desplegar `signum-api` como
sustituto de esta integración. Las variables requeridas se describen en
`.env.example`; los valores secretos no deben subirse a GitHub.

Validación local: `npm test --prefix backend/api-integracion`.
Después del despliegue, comprobar `/api/sync/preview` con una sesión válida antes
de ejecutar cualquier sincronización. Preview no escribe datos de empleados.
