/**
 * IncidentDetector.ts
 * Motor de detección automática e idempotente de incidencias y estado operativo de jornada.
 *
 * Módulo: Cumplimiento Laboral México 2027
 */

import type {
  WorkdayIncident,
  WorkdayStatus,
} from './AttendanceTypes.ts'
import type { ShiftMatchResult } from './ShiftMatcher.ts'
import type { CalculationMetrics } from './WorkdayCalculator.ts'

export interface IncidentEvaluationResult {
  status: WorkdayStatus
  incidents: WorkdayIncident[]
  warnings: string[]
}

export class IncidentDetector {
  /**
   * Evalúa las métricas y el contexto del turno para generar incidencias estructuradas y el estado final.
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
    // 1. Días Festivos y Días de Descanso
    // ─────────────────────────────────────────────────────────────
    if (isHoliday) {
      if (metrics.effectiveMinutes > 0) {
        incidents.push({
          code: 'HOLIDAY_WORK',
          severity: 'INFO',
          minutes: metrics.effectiveMinutes,
          message: `Día festivo laborado: ${metrics.effectiveMinutes} minutos efectivos registrados.`,
        })
        return { status: 'HOLIDAY_WORK', incidents, warnings }
      }
      return { status: 'HOLIDAY', incidents, warnings }
    }

    if (isRestDay) {
      if (metrics.effectiveMinutes > 0) {
        incidents.push({
          code: 'REST_DAY_WORK',
          severity: 'INFO',
          minutes: metrics.effectiveMinutes,
          message: `Descanso semanal laborado: ${metrics.effectiveMinutes} minutos efectivos registrados.`,
        })
        return { status: 'REST_DAY_WORK', incidents, warnings }
      }
      return { status: 'REST_DAY', incidents, warnings }
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
      return { status: 'ABSENT', incidents, warnings }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Jornadas Incompletas
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
    // 7. Determinación del Estado Primario de la Jornada
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

    return { status, incidents, warnings }
  }
}
