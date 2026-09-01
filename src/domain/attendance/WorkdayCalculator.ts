/**
 * WorkdayCalculator.ts
 * Cálculo matemático determinista de segmentos, tiempos trabajados, descansos, retardos y horas extras.
 *
 * Módulo: Cumplimiento Laboral México 2027
 */

import type {
  WorkdaySegment,
  AttendanceEngineOptions,
  LaborRuleProvider,
} from './AttendanceTypes.ts'
import type { ShiftMatchResult } from './ShiftMatcher.ts'
import { getLocalComponents } from './timezoneUtils.ts'

export interface CalculationMetrics {
  actualStart?: string
  actualEnd?: string
  workedMinutes: number
  breakMinutes: number
  effectiveMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  ordinaryMinutes: number
  overtimeMinutes: number
  nightShiftMinutes: number
  missingEntry: boolean
  missingExit: boolean
  segments: WorkdaySegment[]
  sourceLogIds: string[]
  devicesInvolved: string[]
}

/**
 * Proveedor de reglas por defecto en caso de no inyectar uno personalizado.
 * Desacoplado: No hardcodea números mágicos en el calculador principal.
 */
export class DefaultLaborRuleProvider implements LaborRuleProvider {
  public getRulesForDate(date: string, countryCode = 'MEX', shiftType = 'DIURNA') {
    const year = parseInt(date.substring(0, 4), 10)

    // Reducción progresiva 48h -> 40h México
    let weeklyMaxHours = 48
    if (year === 2027) weeklyMaxHours = 46
    else if (year === 2028) weeklyMaxHours = 44
    else if (year === 2029) weeklyMaxHours = 42
    else if (year >= 2030) weeklyMaxHours = 40

    // Jornada diaria máxima LFT (Diurna 8h, Mixta 7.5h, Nocturna 7h)
    let dailyMaxHours = 8
    if (shiftType === 'NOCTURNA') dailyMaxHours = 7
    else if (shiftType === 'MIXTA') dailyMaxHours = 7.5

    return {
      maxDailyOrdinaryMinutes: Math.round(dailyMaxHours * 60),
      maxWeeklyOrdinaryMinutes: Math.round(weeklyMaxHours * 60),
      overtimeDoubleMaxWeeklyMinutes: 9 * 60, // Primeras 9 horas semanales dobles (LFT Art. 67)
    }
  }
}

export class WorkdayCalculator {
  /**
   * Calcula cuántos minutos de un segmento transcurren dentro de la ventana nocturna (20:00 a 06:00).
   */
  public static calculateNocturnalMinutes(startMs: number, endMs: number, timezone: string): number {
    if (endMs <= startMs) return 0

    let nocturnalMinutes = 0
    const stepMs = 60000
    for (let t = startMs; t < endMs; t += stepMs) {
      const comps = getLocalComponents(t, timezone)
      if (comps.localMinutesOfDay >= 20 * 60 || comps.localMinutesOfDay < 6 * 60) {
        nocturnalMinutes++
      }
    }
    return nocturnalMinutes
  }

  /**
   * Ejecuta el cálculo integral de la jornada a partir de los marcajes emparejados.
   */
  public static calculate(
    matchResult: ShiftMatchResult,
    timezone: string,
    options?: AttendanceEngineOptions
  ): CalculationMetrics {
    const punches = matchResult.matchedPunches
    const ruleProvider = options?.laborRuleProvider || new DefaultLaborRuleProvider()
    const rules = ruleProvider.getRulesForDate(
      matchResult.operativeDate,
      'MEX',
      matchResult.shiftType
    )

    const sourceLogIds = punches.map((p) => p.id)
    const devicesInvolved = Array.from(
      new Set(punches.map((p) => p.deviceSerial).filter(Boolean) as string[])
    )

    const isRestOrHoliday = matchResult.isRestDay || matchResult.isHoliday

    // ─────────────────────────────────────────────────────────────
    // CASO 0: Cero marcajes
    // ─────────────────────────────────────────────────────────────
    if (punches.length === 0) {
      return {
        workedMinutes: 0,
        breakMinutes: 0,
        effectiveMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        ordinaryMinutes: 0,
        overtimeMinutes: 0,
        nightShiftMinutes: 0,
        missingEntry: !isRestOrHoliday,
        missingExit: !isRestOrHoliday,
        segments: [],
        sourceLogIds: [],
        devicesInvolved: [],
      }
    }

    // ─────────────────────────────────────────────────────────────
    // CASO 1: Un solo marcaje (Jornada Incompleta)
    // ─────────────────────────────────────────────────────────────
    if (punches.length === 1) {
      const singlePunch = punches[0]
      const punchMs = singlePunch.epochMs

      let isEntry = true

      if (singlePunch.inOutType === 'EXIT') {
        isEntry = false
      } else if (singlePunch.inOutType === 'ENTRY') {
        isEntry = true
      } else if (matchResult.scheduledStartUtc && matchResult.scheduledEndUtc) {
        const startMs = new Date(matchResult.scheduledStartUtc).getTime()
        const endMs = new Date(matchResult.scheduledEndUtc).getTime()
        const distToStart = Math.abs(punchMs - startMs)
        const distToEnd = Math.abs(punchMs - endMs)
        isEntry = distToStart <= distToEnd
      }

      let lateMinutes = 0
      let earlyLeaveMinutes = 0

      if (isEntry) {
        if (matchResult.scheduledStartUtc) {
          const startMs = new Date(matchResult.scheduledStartUtc).getTime()
          const toleranceMs = matchResult.toleranceMinutes * 60000
          if (punchMs > startMs + toleranceMs) {
            lateMinutes = Math.round((punchMs - startMs) / 60000)
          }
        }
        return {
          actualStart: singlePunch.utcTimestamp,
          actualEnd: undefined,
          workedMinutes: 0,
          breakMinutes: 0,
          effectiveMinutes: 0,
          lateMinutes,
          earlyLeaveMinutes: 0,
          ordinaryMinutes: 0,
          overtimeMinutes: 0,
          nightShiftMinutes: 0,
          missingEntry: false,
          missingExit: true,
          segments: [],
          sourceLogIds,
          devicesInvolved,
        }
      } else {
        if (matchResult.scheduledEndUtc) {
          const endMs = new Date(matchResult.scheduledEndUtc).getTime()
          if (punchMs < endMs) {
            earlyLeaveMinutes = Math.round((endMs - punchMs) / 60000)
          }
        }
        return {
          actualStart: undefined,
          actualEnd: singlePunch.utcTimestamp,
          workedMinutes: 0,
          breakMinutes: 0,
          effectiveMinutes: 0,
          lateMinutes: 0,
          earlyLeaveMinutes,
          ordinaryMinutes: 0,
          overtimeMinutes: 0,
          nightShiftMinutes: 0,
          missingEntry: true,
          missingExit: false,
          segments: [],
          sourceLogIds,
          devicesInvolved,
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // CASO 2: Dos o más marcajes
    // ─────────────────────────────────────────────────────────────
    const segments: WorkdaySegment[] = []
    let totalBreakMinutes = 0
    let totalWorkMinutes = 0
    let totalNocturnalMinutes = 0

    const firstPunch = punches[0]
    const lastPunch = punches[punches.length - 1]
    const actualStart = firstPunch.utcTimestamp
    let actualEnd: string | undefined = lastPunch.utcTimestamp
    let missingExit = false

    if (punches.length % 2 !== 0) {
      missingExit = true
    }

    for (let i = 0; i < punches.length - 1; i += 2) {
      const pIn = punches[i]
      const pOut = punches[i + 1]

      const segDuration = Math.round((pOut.epochMs - pIn.epochMs) / 60000)
      const segNocturnal = this.calculateNocturnalMinutes(pIn.epochMs, pOut.epochMs, timezone)

      segments.push({
        segmentType: 'WORK',
        startPunch: pIn,
        endPunch: pOut,
        durationMinutes: segDuration,
        isNocturnalMinutes: segNocturnal,
      })

      totalWorkMinutes += segDuration
      totalNocturnalMinutes += segNocturnal

      if (i + 2 < punches.length) {
        const nextIn = punches[i + 2]
        const breakDur = Math.round((nextIn.epochMs - pOut.epochMs) / 60000)
        segments.push({
          segmentType: 'BREAK',
          startPunch: pOut,
          endPunch: nextIn,
          durationMinutes: breakDur,
          isNocturnalMinutes: 0,
        })
        totalBreakMinutes += breakDur
      }
    }

    if (
      punches.length === 2 &&
      options?.autoDeductScheduledBreakIfNoPunches &&
      matchResult.scheduledBreakMinutes > 0
    ) {
      if (totalWorkMinutes >= matchResult.scheduledMinutes) {
        totalBreakMinutes = matchResult.scheduledBreakMinutes
      }
    }

    const workedMinutes = Math.round((lastPunch.epochMs - firstPunch.epochMs) / 60000)
    const effectiveMinutes = Math.max(0, totalWorkMinutes - (punches.length === 2 ? totalBreakMinutes : 0))

    let lateMinutes = 0
    if (matchResult.scheduledStartUtc) {
      const startMs = new Date(matchResult.scheduledStartUtc).getTime()
      const toleranceMs = matchResult.toleranceMinutes * 60000
      if (firstPunch.epochMs > startMs + toleranceMs) {
        lateMinutes = Math.round((firstPunch.epochMs - startMs) / 60000)
      }
    }

    let earlyLeaveMinutes = 0
    if (matchResult.scheduledEndUtc && !missingExit) {
      const endMs = new Date(matchResult.scheduledEndUtc).getTime()
      if (lastPunch.epochMs < endMs) {
        earlyLeaveMinutes = Math.round((endMs - lastPunch.epochMs) / 60000)
      }
    }

    const dailyOrdinaryThreshold = Math.min(
      rules.maxDailyOrdinaryMinutes,
      matchResult.scheduledMinutes > 0 ? matchResult.scheduledMinutes : rules.maxDailyOrdinaryMinutes
    )

    let ordinaryMinutes = 0
    let overtimeMinutes = 0

    if (isRestOrHoliday) {
      ordinaryMinutes = 0
      overtimeMinutes = effectiveMinutes
    } else {
      if (effectiveMinutes > dailyOrdinaryThreshold) {
        ordinaryMinutes = dailyOrdinaryThreshold
        overtimeMinutes = effectiveMinutes - dailyOrdinaryThreshold
      } else {
        ordinaryMinutes = effectiveMinutes
        overtimeMinutes = 0
      }
    }

    return {
      actualStart,
      actualEnd: missingExit ? undefined : actualEnd,
      workedMinutes,
      breakMinutes: totalBreakMinutes,
      effectiveMinutes,
      lateMinutes,
      earlyLeaveMinutes,
      ordinaryMinutes,
      overtimeMinutes,
      nightShiftMinutes: totalNocturnalMinutes,
      missingEntry: false,
      missingExit,
      segments,
      sourceLogIds,
      devicesInvolved,
    }
  }
}
