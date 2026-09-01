# 12 - Estrategia y Resultados de Pruebas Unitarias e Integración

> **Suite:** `tests/compliance/attendance-engine.test.js`  
> **Comando de Ejecución:** `npm test` o `node --test tests/compliance/attendance-engine.test.js`  
> **Fase:** Fase 1 — 100% PASS  

---

## 1. Resultados de la Suite de Pruebas

| Caso | Escenario Evaluado | Resultado | Estado |
| :--- | :--- | :--- | :--- |
| **A** | Entrada y salida normales puntuales (08:00 - 17:00) | `status: 'PRESENT'`, `workedMinutes: 540`, `lateMinutes: 0`, `earlyLeaveMinutes: 0` | **PASS** |
| **B** | Retardo en entrada (08:15 en turno de 08:00) | `status: 'LATE'`, `lateMinutes: 15`, incidente `LATE` registrado | **PASS** |
| **C** | Salida anticipada (16:30 en turno de 17:00) | `status: 'EARLY_LEAVE'`, `earlyLeaveMinutes: 30`, incidente `EARLY_LEAVE` | **PASS** |
| **D** | Entrada sin salida (solo 08:00) | `status: 'INCOMPLETE'`, `missingExit: true`, `actualEnd: undefined` | **PASS** |
| **E** | Sin marcajes en jornada programada | `status: 'ABSENT'`, incidente `ABSENT` generado | **PASS** |
| **F** | Turno partido (08:00, 13:00, 14:00, 18:00) | 2 segmentos de trabajo (540m efectivas), 1 segmento de descanso (60m) | **PASS** |
| **G** | Turno nocturno que cruza medianoche (22:00 a 06:00) | Operative date es día de inicio, `shiftType: 'NOCTURNA'`, horas nocturnas contabilizadas | **PASS** |
| **H** | Cruce de medianoche continuo (20:00 a 04:00 con descanso) | Continuidad de jornada sin fragmentación por cambio de día | **PASS** |
| **I** | Checada duplicada exacta (08:00, 08:00, 17:00) | Deduplicación limpia conservando tiempos reales | **PASS** |
| **J** | Ráfaga de checadas en 4 segundos (Debounce) | Agrupación en un solo evento de entrada | **PASS** |
| **K** | Múltiples pares de marcajes (6 checadas) | 3 segmentos de trabajo y 2 descansos consolidados | **PASS** |
| **L** | Marcaje a las 03:00 AM fuera de ventana (08:00 - 17:00) | Incidente `OUT_OF_WINDOW_PUNCH` generado sin corromper la jornada | **PASS** |
| **M** | Turnos consecutivos en días sucesivos | Marcajes aislados estrictamente a su fecha operativa | **PASS** |
| **N** | Independencia de zona horaria (Cancún UTC-5 vs CDMX UTC-6) | Cálculo exacto basado en el timezone objetivo | **PASS** |
| **O** | Aislamiento multi-tenant (Tenant A vs Tenant B) | Rechazo inmediato y arrojo de `TenantMismatchError` | **PASS** |
| **P** | Idempotencia en 10 ejecuciones sucesivas | Exactamente el mismo hash SHA-256 y métricas en cada corrida | **PASS** |
| **Q** | Reglas legales desacopladas (Mock Provider) | Límite ordinario configurable sin alterar el motor | **PASS** |
| **R** | Día festivo laborado | `status: 'HOLIDAY_WORK'`, horas contabilizadas como tiempo adicional | **PASS** |
| **S** | Día de descanso semanal laborado | `status: 'REST_DAY_WORK'`, horas contabilizadas | **PASS** |
| **T** | Llegada a las 08:08 con 10m de tolerancia | `status: 'PRESENT'`, `lateMinutes: 0` | **PASS** |
| **U** | Salida registrada sin entrada (17:00) | `status: 'INCOMPLETE'`, `missingEntry: true`, `actualStart: undefined` | **PASS** |
| **V** | Zona horaria inválida | Arrojo controlado de `InvalidTimezoneError` | **PASS** |

**Total:** 22/22 Pruebas Superadas (100%).
