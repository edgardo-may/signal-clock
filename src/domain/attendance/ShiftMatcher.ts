/**
 * ShiftMatcher.ts
 * Algoritmo de emparejamiento de marcajes con la ventana operativa del turno programado.
 *
 * Soporta:
 * - Jornada diurna estándar (ej: 08:00 - 17:00)
 * - Turno partido (con descansos intermedios)
 * - Turno nocturno que cruza la medianoche (ej: 22:00 - 06:00 del día siguiente)
 * - Días festivos y días de descanso
 * - Detección de marcajes fuera de ventana (Out-of-Window)
 */

import type {
  ShiftWindowConfig,
  NormalizedPunch,
  ShiftType,
} from './AttendanceTypes.ts'
import { ShiftConfigurationError } from './AttendanceErrors.ts'
import { localToUtcIso } from './timezoneUtils.ts'

export interface ShiftMatchResult {
  operativeDate: string
  scheduledStartUtc?: string
  scheduledEndUtc?: string
  scheduledMinutes: number
  crossesMidnight: boolean
  shiftType: ShiftType
  isRestDay: boolean
  isHoliday: boolean
  toleranceMinutes: number
  scheduledBreakMinutes: number
  matchedPunches: NormalizedPunch[]
  outOfWindowPunches: NormalizedPunch[]
}

export class ShiftMatcher {
  /**
   * Determina el tipo de jornada según la LFT Mexicana:
   * - DIURNA: Entre 06:00 y 20:00
   * - NOCTURNA: Entre 20:00 y 06:00
   * - MIXTA: Comprende periodos de ambas, siempre que el periodo nocturno sea menor a 3.5h
   */
  public static inferShiftType(startTimeStr: string, endTimeStr: string, crossesMidnight: boolean): ShiftType {
    if (!startTimeStr || !endTimeStr) return 'DIURNA'

    const [startH, startM] = startTimeStr.split(':').map((n) => parseInt(n, 10))
    const [endH, endM] = endTimeStr.split(':').map((n) => parseInt(n, 10))

    const startMins = startH * 60 + (startM || 0)
    let endMins = endH * 60 + (endM || 0)
    if (crossesMidnight || endMins <= startMins) {
      endMins += 24 * 60
    }

    // Ventana nocturna: 20:00 (1200 mins) a 06:00 (360 mins)
    let nocturnalMins = 0
    for (let m = startMins; m < endMins; m++) {
      const modM = m % (24 * 60)
      if (modM >= 20 * 60 || modM < 6 * 60) {
        nocturnalMins++
      }
    }

    const totalMins = endMins - startMins
    if (nocturnalMins >= totalMins * 0.7 || (startMins >= 20 * 60 && endMins <= 30 * 60)) {
      return 'NOCTURNA'
    }
    if (nocturnalMins > 0 && nocturnalMins <= 3.5 * 60) {
      return 'MIXTA'
    }
    if (nocturnalMins > 3.5 * 60) {
      return 'NOCTURNA'
    }

    return 'DIURNA'
  }

  /**
   * Obtiene el siguiente día calendario en formato YYYY-MM-DD.
   */
  public static getNextCalendarDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map((n) => parseInt(n, 10))
    const d = new Date(Date.UTC(year, month - 1, day + 1))
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }

  /**
   * Empareja los marcajes normalizados con la configuración del turno programado.
   */
  public static match(
    shiftConfig: ShiftWindowConfig,
    normalizedPunches: NormalizedPunch[],
    timezone: string
  ): ShiftMatchResult {
    const operativeDate = shiftConfig.operativeDate
    if (!operativeDate || !/^\d{4}-\d{2}-\d{2}$/.test(operativeDate)) {
      throw new ShiftConfigurationError(`operativeDate inválido: "${operativeDate}"`)
    }

    const isRestDay = Boolean(shiftConfig.isRestDay)
    const isHoliday = Boolean(shiftConfig.isHoliday)
    const toleranceMinutes = shiftConfig.toleranceMinutes ?? 10
    const scheduledBreakMinutes = shiftConfig.scheduledBreakMinutes ?? (shiftConfig.hasBreak ? 60 : 0)

    // Caso 1: Día de descanso o festivo sin horas programadas fijas
    if ((isRestDay || isHoliday) && (!shiftConfig.startTime || !shiftConfig.endTime)) {
      const dayStartIso = localToUtcIso(operativeDate, '00:00:00', timezone)
      const dayEndIso = localToUtcIso(operativeDate, '23:59:59', timezone)
      const startMs = new Date(dayStartIso).getTime()
      const endMs = new Date(dayEndIso).getTime() + 1000

      const matchedPunches = normalizedPunches.filter((p) => p.epochMs >= startMs && p.epochMs <= endMs)
      const outOfWindowPunches = normalizedPunches.filter((p) => p.epochMs < startMs || p.epochMs > endMs)

      return {
        operativeDate,
        scheduledMinutes: 0,
        crossesMidnight: false,
        shiftType: 'DIURNA',
        isRestDay,
        isHoliday,
        toleranceMinutes,
        scheduledBreakMinutes: 0,
        matchedPunches,
        outOfWindowPunches,
      }
    }

    // Caso 2: Turno con horario programado
    if (!shiftConfig.startTime || !shiftConfig.endTime) {
      throw new ShiftConfigurationError(
        `El turno requiere startTime y endTime (o estar marcado como isRestDay/isHoliday).`
      )
    }

    const [startH, startM] = shiftConfig.startTime.split(':').map((n) => parseInt(n, 10))
    const [endH, endM] = shiftConfig.endTime.split(':').map((n) => parseInt(n, 10))

    const startMinutes = startH * 60 + (startM || 0)
    const endMinutes = endH * 60 + (endM || 0)

    const crossesMidnight = endMinutes <= startMinutes
    const endDate = crossesMidnight ? this.getNextCalendarDate(operativeDate) : operativeDate

    const scheduledStartUtc = localToUtcIso(operativeDate, shiftConfig.startTime, timezone)
    const scheduledEndUtc = localToUtcIso(endDate, shiftConfig.endTime, timezone)

    const startEpochMs = new Date(scheduledStartUtc).getTime()
    const endEpochMs = new Date(scheduledEndUtc).getTime()

    const scheduledMinutes = Math.round((endEpochMs - startEpochMs) / 60000)

    // Ventana de tolerancia para capturar marcajes tempranos/tardíos
    const windowBeforeMins = shiftConfig.windowBeforeStartMinutes ?? 120 // 2 horas antes
    const windowAfterMins = shiftConfig.windowAfterEndMinutes ?? 180 // 3 horas después

    const windowStartMs = startEpochMs - windowBeforeMins * 60000
    const windowEndMs = endEpochMs + windowAfterMins * 60000

    const shiftType =
      shiftConfig.shiftType || this.inferShiftType(shiftConfig.startTime, shiftConfig.endTime, crossesMidnight)

    const matchedPunches: NormalizedPunch[] = []
    const outOfWindowPunches: NormalizedPunch[] = []

    for (const punch of normalizedPunches) {
      if (punch.epochMs >= windowStartMs && punch.epochMs <= windowEndMs) {
        matchedPunches.push(punch)
      } else {
        outOfWindowPunches.push(punch)
      }
    }

    return {
      operativeDate,
      scheduledStartUtc,
      scheduledEndUtc,
      scheduledMinutes,
      crossesMidnight,
      shiftType,
      isRestDay,
      isHoliday,
      toleranceMinutes,
      scheduledBreakMinutes,
      matchedPunches,
      outOfWindowPunches,
    }
  }
}
