# Signum Clock — estado del proyecto

**Corte documental:** 2026-10-15. Esta página separa hechos del código, evidencia aportada por el operador y trabajo pendiente. No constituye una autorización de despliegue ni de cambios de base de datos.

## Estado operativo reportado

| Componente | Estado | Evidencia / alcance |
|---|---|---|
| Release de código | VALIDADO (operador) | Commit `bf376f292c47cc6c4d318a5018c1e70692a547ea`; el checkout local también está en ese HEAD y limpio al inicio de esta documentación. |
| Attendance Runtime | VALIDADO (operador) | `bf376f2-main` con 100% de tráfico; `/health` y `/ready` PASS según el operador. No reconsultado en esta fase. |
| Vercel | VALIDADO (operador) | Proyecto `signal-clock`, deployment READY para el commit indicado; no reconsultado en esta fase. |
| Employee Portal | BLOQUEADO | API/UI en mantenimiento según el operador. El operador reportó que `public.fn_employee_portal` falta en el catálogo de Supabase Production. |
| SQL 1/2/3 Employee/seguridad/WEB_CLOCK | BLOQUEADO / PENDIENTE | Revisión documental confirma guardas DBREAL-only y efectos ACL/policies/outbox/RPC20; RPC ausente según operador, resto del catálogo no verificado. Ver [plan SQL Employee](docs/03-database/employee-contract-install-plan.md). **READY TO APPLY: NO.** |
| SQL 125 ZKTeco-only | VALIDADO (operador) | Aplicación y postcheck en Production fueron reportados como PASS; DBREAL post-125 reportada 235 PASS / 0 FAIL / 0 SKIP. Codex no revalidó esos entornos en este trabajo. |
| WEB_CLOCK | PENDIENTE / OFF | OFF según el operador; la activación queda fuera de esta fase. |
| Rama `reconcile/main-employee-serverless` | PENDIENTE | Limpieza de la rama reportada pendiente. No se modifican ramas en esta fase. |

## Fuente y confianza

- **IMPLEMENTADO** indica que existe código o configuración en el checkout; no certifica su despliegue.
- **VALIDADO** indica evidencia identificada. Si dice “operador”, es evidencia reportada por el operador, no una comprobación ejecutada por Codex en este trabajo.
- **PENDIENTE** indica que falta revisión, aprobación o evidencia suficiente.
- **BLOQUEADO** indica un impedimento operativo reportado que impide habilitar el flujo.
- **PROPUESTO** indica un diseño o SQL candidato no aplicado.

El código confirma `api/employee.js` como adaptador Vercel que delega a `backend/employee-portal/http.mjs`; el handler llama a `fn_employee_portal`. El SQL candidato contiene esa definición. La ausencia productiva de la función se registra como evidencia del operador y no se deduce de los archivos locales.

## Inconsistencia documental

`docs/current-stack-zkteco.md` y snapshots previos decían que SQL 125 no estaba aplicado. Esa afirmación quedó supersedida por el resultado productivo reportado posteriormente por el operador. Ver el aviso de vigencia en `docs/CURRENT_STATE.md`; los informes históricos se conservan como evidencia de su momento.

## Próximos cierres

1. Obtener snapshot de catálogo Production solo lectura y preparar una variante SQL Production revisada; los candidatos actuales no se aplican tal cual. Mantener Employee en mantenimiento y WEB_CLOCK OFF.
2. Revisar/aprobar por separado los cambios globales ACL (SQL1), policies/RPC legacy (SQL2) y outbox/RPC20 (SQL3).
3. Cerrar la limpieza de la rama temporal cuando el release owner lo autorice.
4. Documentar módulos restantes con fuentes actuales y evidencia atribuible; no inferir estado productivo desde pruebas locales.

Véase [índice documental](docs/README.md) y [matriz de módulos](docs/04-modules/module-status.md).
