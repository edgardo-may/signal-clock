# Fase 32.2 — Candidate Classification Fix

Estado: corrección SQL local terminada; SQL final no ejecutado contra producción.

## Evidencia real recibida

El post-audit confirmó para los registros `13006bce-63d0-47da-8999-ee5b551c3de0` y `ede89226-c2ef-464b-809d-c571013a8c25`:

- Domingo 2026-09-06: `day_config.activo = false`.
- Sábado 2026-09-05: 06:00–14:00, sin cruce de medianoche.
- Los eventos están fuera de la ventana de ShiftMatcher.
- Clasificación correcta: `OPERATIVE_DATE_MISMATCH`.

Esto confirma el bug conceptual del precheck Fase 31 y confirma que el engine no tiene bug.

Para `7f99cef9-4100-48ff-9aaf-68548c80c948`, el evento 2026-09-03 11:26:04 local cae dentro de la ventana 09:00–22:00 UTC del horario `be4035c8-042c-473b-b25d-b5bf3fb99701` (06:00–14:00). La relación `EVENT_LOCAL_DATE` cumple `APPROVED_NORMAL`.

## Bug corregido

`32_1_production_shadow_candidate_postaudit.sql` calculaba un resumen por registro y usaba sus conteos al clasificar cada fila. Así una relación `PREVIOUS_LOCAL_DATE` sin assignment/schedule podía heredar `APPROVED_NORMAL` de la relación de evento válida.

El nuevo archivo `database/live-schema/32_2_production_shadow_candidate_final.sql` calcula primero `relation_summary` por `(registro_id, candidate_relation)` y después clasifica cada fila desde sus propios campos. No propaga estados de aprobación entre relaciones.

Reglas relevantes:

- `APPROVED_NORMAL` requiere la propia relación `EVENT_LOCAL_DATE`, assignment/schedule, día activo, no cruce y evento dentro de su propia ventana.
- `APPROVED_NIGHT` requiere su propio horario activo que cruce medianoche y evento dentro de su propia ventana.
- `PREVIOUS_LOCAL_DATE` no nocturna es `OPERATIVE_DATE_MISMATCH`.
- Una relación sin assignment es `UNSCHEDULED`; jamás hereda aprobación.
- Más de un horario válido en la misma relación es `AMBIGUOUS_SCHEDULE`.

El mismo query entrega `DETAIL` por relación y `CONSOLIDATED` por registro, con conteos de aprobados/mismatch/ambigüedad y `final_candidate_status`, `final_operative_date` y `final_schedule_id`.

Resultado esperado al ejecutar el SQL final:

| Registro | EVENT_LOCAL_DATE | PREVIOUS_LOCAL_DATE | Final |
| --- | --- | --- | --- |
| `7f99cef9-4100-48ff-9aaf-68548c80c948` | `APPROVED_NORMAL` | `UNSCHEDULED`, nunca aprobado | `APPROVED_NORMAL`, 2026-09-03, `be4035c8-042c-473b-b25d-b5bf3fb99701` |
| `ede89226-c2ef-464b-809d-c571013a8c25` | `UNSCHEDULED` | `OPERATIVE_DATE_MISMATCH` | `OPERATIVE_DATE_MISMATCH` |
| `13006bce-63d0-47da-8999-ee5b551c3de0` | `UNSCHEDULED` | `OPERATIVE_DATE_MISMATCH` | `OPERATIVE_DATE_MISMATCH` |

No existe candidato nocturno real en la muestra.

## Seguridad y siguiente paso

El SQL final sigue usando `BEGIN TRANSACTION READ ONLY` y `ROLLBACK`; no contiene DML, RPC ni selección automática. Es seguro ejecutarlo manualmente para verificar las expectativas anteriores. Production SHADOW sigue sin ejecutarse; el runner guardado permanece SHADOW-only, sin servicio de persistencia ni upsert RPC.

## Verificación

- Pruebas Fase 32.2: incluidas en la suite de candidate audit.
- No se ejecutó SQL remoto, Production Shadow, PERSIST, workday rows ni incidencias.

    PHASE 32.2: PASS
    ROW-LEVEL CLASSIFICATION: PASS
    CROSS-ROW STATUS LEAK: NO
    APPROVED_NIGHT_CANDIDATE: NONE
    ENGINE BUG: NO
    ZERO-WRITE: PASS
    SAFE TO RUN FINAL CANDIDATE SQL: YES
    SAFE TO RUN PRODUCTION SHADOW CANARY: NO
