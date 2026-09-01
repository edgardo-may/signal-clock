/**
 * IncidentDetector.ts
 * Motor de detección automática e idempotente de incidencias y estado operativo de jornada.
 *
 * Módulo: Cumplimiento Laboral México 2027
 *
 * HARDENING Phase 1 — ATT-002:
 * Separación conceptual de estado estructural (WorkdayState) vs condiciones laborales (incidents[]).
 *
 * - workdayState: Estado ESTRUCTURAL. ¿La jornada está completa, incompleta o ausente?
 *   COMPLETE   = Tiene entrada y salida. Puede tener incidencias (LATE, EARLY_LEAVE, etc.)
 *   INCOMPLETE = Falta entrada o salida.
 *   ABSENT     = Sin marcajes en día programado.
 *   UNSCHEDULED = Marcajes sin turno asignado (no aplica en este flujo).
 *   INVALID    = Estado no determinable.
 *
 * - status (DEPRECATED): Alias mono-valor de compatibilidad. No captura co-ocurrencia de
 *   condiciones (ej: LATE + EARLY_LEAVE simultáneos). Usar workdayState + incidents[].
 *
 * - incidents[]: Lista exhaustiva de TODAS las condiciones laborales detectadas.
 *   Es la fuente de verdad para prenómina, auditoría y expediente STPS.
 */

import type {
  WorkdayIncident,
  WorkdayStatus,
  WorkdayState,
} from './AttendanceTypes.ts'
import type { ShiftMatchResult } from './ShiftMatcher.ts'
import type { CalculationMetrics } from './WorkdayCalculator.ts'

export interface IncidentEvaluationResult {
  /**
   * Estado ESTRUCTURAL de la jornada (ATT-002).
   * Úsalo para determinar si la jornada está completa o no.
   */
  workdayState: WorkdayState

  /**
   * DEPRECATED — Alias mono-valor de compatibilidad.
   * No puede representar co-ocurrencia de múltiples condiciones.
   * Usar workdayState + incidents[] en su lugar.
   * Será eliminado en Fase 3.
   */
  status: WorkdayStatus

  /** Lista exhaustiva de todas las condiciones laborales detectadas */
  incidents: WorkdayIncident[]

  warnings: string[]
}

export class IncidentDetector {
  /**
   * Evalúa las métricas y el contexto del turno para generar incidencias estructuradas,
   * el estado estructural (workdayState) y el estado alias (status) deprecado.
   */
  public static evaluate(
    matchResult: ShiftMatchResult,
    metrics: CalculationMetrics
  ): IncidentEvaluationResult {
    const incidents: WorkdayIncident[] = []
    const warnings: string[] = []

    const isHoliday = matchResult.isHoliday
    const isRestDay = matchResult.isRestDay
    const hasPunches = metrics.sourceLogIds.length > 0

    // ─────────────────────────────────────────────────────────────
    // 0. Incidencias de secuencia de marcajes (ATT-001)
    //    Se añaden primero para que queden en el registro.
    // ─────────────────────────────────────────────────────────────
    if (metrics.pairingIncidents && metrics.pairingIncidents.length > 0) {
      incidents.push(...metrics.pairingIncidents)
      for (const inc of metrics.pairingIncidents) {
        warnings.push(`Secuencia de marcajes ambigua: ${inc.message}`)
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 1. Días Festivos y Días de Descanso
    //    Festivo toma precedencia sobre Descanso si ambos aplican.
    // ─────────────────────────────────────────────────────────────
    if (isHoliday) {
      if (metrics.effectiveMinutes > 0) {
        incidents.push({
          code: 'HOLIDAY_WORK',
          severity: 'INFO',
          minutes: metrics.effectiveMinutes,
          message: `Día festivo laborado: ${metrics.effectiveMinutes} minutos efectivos registrados.`,
        })
        return {
          workdayState: 'COMPLETE',
          status: 'HOLIDAY_WORK',
          incidents,
          warnings,
        }
      }
      return { workdayState: 'COMPLETE', status: 'HOLIDAY', incidents, warnings }
    }

    if (isRestDay) {
      if (metrics.effectiveMinutes > 0) {
        incidents.push({
          code: 'REST_DAY_WORK',
          severity: 'INFO',
          minutes: metrics.effectiveMinutes,
          message: `Descanso semanal laborado: ${metrics.effectiveMinutes} minutos efectivos registrados.`,
        })
        return {
          workdayState: 'COMPLETE',
          status: 'REST_DAY_WORK',
          incidents,
          warnings,
        }
      }
      return { workdayState: 'COMPLETE', status: 'REST_DAY', incidents, warnings }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Ausencia Total en Día Programado
    // ─────────────────────────────────────────────────────────────
    if (!hasPunches) {
      incidents.push({
        code: 'ABSENT',
        severity: 'WARNING',
        message: 'Ausencia: Sin marcajes registrados en jornada programada.',
      })
      warnings.push('No se detectaron checadas en el biométrico ni registros manuales.')
      return {
        workdayState: 'ABSENT',
        status: 'ABSENT',
        incidents,
        warnings,
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Jornadas Incompletas (ATT-002)
    //    workdayState = INCOMPLETE cuando falta entrada o salida.
    //    incidents[] contiene MISSING_ENTRY y/o MISSING_EXIT.
    // ─────────────────────────────────────────────────────────────
    if (metrics.missingEntry) {
      incidents.push({
        code: 'MISSING_ENTRY',
        severity: 'WARNING',
        message: 'Falta marcaje de entrada.',
      })
      incidents.push({
        code: 'INCOMPLETE',
        severity: 'WARNING',
        message: 'Jornada incompleta por falta de entrada.',
      })
      warnings.push('El colaborador no registró su entrada laboral.')
    }

    if (metrics.missingExit) {
      incidents.push({
        code: 'MISSING_EXIT',
        severity: 'WARNING',
        message: 'Falta marcaje de salida.',
      })
      incidents.push({
        code: 'INCOMPLETE',
        severity: 'WARNING',
        message: 'Jornada incompleta por falta de salida.',
      })
      warnings.push('El colaborador no registró su salida laboral.')
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Retardos y Salidas Anticipadas
    //    ATT-002: Ambas condiciones se registran en incidents[] independientemente.
    //    El status deprecado solo puede capturar una (LATE tiene precedencia).
    // ─────────────────────────────────────────────────────────────
    if (metrics.lateMinutes > 0) {
      incidents.push({
        code: 'LATE',
        severity: 'WARNING',
        minutes: metrics.lateMinutes,
        message: `Retardo en entrada de ${metrics.lateMinutes} minutos (tolerancia: ${matchResult.toleranceMinutes} min).`,
      })
    }

    if (metrics.earlyLeaveMinutes > 0) {
      incidents.push({
        code: 'EARLY_LEAVE',
        severity: 'WARNING',
        minutes: metrics.earlyLeaveMinutes,
        message: `Salida anticipada de ${metrics.earlyLeaveMinutes} minutos antes del fin de turno.`,
      })
    }

    // ─────────────────────────────────────────────────────────────
    // 5. Horas Extraordinarias Detectadas
    // ─────────────────────────────────────────────────────────────
    if (metrics.overtimeMinutes > 0) {
      incidents.push({
        code: 'OVERTIME_DETECTED',
        severity: 'INFO',
        minutes: metrics.overtimeMinutes,
        message: `Tiempo adicional detectado: ${metrics.overtimeMinutes} minutos sujetos a aprobación patronal.`,
      })
    }

    // ─────────────────────────────────────────────────────────────
    // 6. Marcajes Fuera de Ventana
    // ─────────────────────────────────────────────────────────────
    if (matchResult.outOfWindowPunches.length > 0) {
      incidents.push({
        code: 'OUT_OF_WINDOW_PUNCH',
        severity: 'INFO',
        message: `Se detectaron ${matchResult.outOfWindowPunches.length} marcajes fuera de la ventana operativa del turno.`,
        metadata: {
          punchIds: matchResult.outOfWindowPunches.map((p) => p.id),
        },
      })
      warnings.push('Existen marcajes registrados con desfase horario excesivo respecto al turno.')
    }

    // ─────────────────────────────────────────────────────────────
    // 7. workdayState (ATT-002) — Estado Estructural
    // ─────────────────────────────────────────────────────────────
    let workdayState: WorkdayState = 'COMPLETE'

    if (metrics.missingEntry || metrics.missingExit) {
      workdayState = 'INCOMPLETE'
    }

    // ─────────────────────────────────────────────────────────────
    // 8. status DEPRECATED — Alias mono-valor para compatibilidad
    //    ADVERTENCIA: No puede representar co-ocurrencia de LATE + EARLY_LEAVE.
    //    En esa situación, status='LATE' y EARLY_LEAVE solo aparece en incidents[].
    //    Usar workdayState + incidents[] para lógica de prenómina.
    // ─────────────────────────────────────────────────────────────
    let status: WorkdayStatus = 'PRESENT'

    if (metrics.missingEntry || metrics.missingExit) {
      status = 'INCOMPLETE'
    } else if (metrics.lateMinutes > 0) {
      status = 'LATE'
    } else if (metrics.earlyLeaveMinutes > 0) {
      status = 'EARLY_LEAVE'
    } else {
      status = 'PRESENT'
    }

    return { workdayState, status, incidents, warnings }
  }
}
