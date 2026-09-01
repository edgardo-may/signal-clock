/**
 * WorkdayCalculator.ts
 * Cálculo matemático determinista de segmentos, tiempos trabajados, descansos, retardos y horas extras.
 *
 * Módulo: Cumplimiento Laboral México 2027
 *
 * HARDENING Phase 1:
 * - ATT-001: Algoritmo híbrido de apareamiento por dirección. Prioriza direction explícita (ENTRY/EXIT).
 *            Fallback posicional cuando direction=UNKNOWN. Genera incidencias en secuencias ambiguas.
 * - ATT-005: lateMinutes documentado explícitamente (se mide desde hora programada, no desde tolerancia).
 * - ATT-006: calculateNocturnalMinutes evaluado — O(n) aceptable para volúmenes típicos (<1000 jornadas
 *            en batch), diferido para optimización en motor de batch de Fase 5.
 */

import type {
  WorkdaySegment,
  AttendanceEngineOptions,
  LaborRuleProvider,
  NormalizedPunch,
  WorkdayIncident,
} from './AttendanceTypes.ts'
import type { ShiftMatchResult } from './ShiftMatcher.ts'
import { getLocalComponents } from './timezoneUtils.ts'

// ── Resultado del apareamiento de punches (ATT-001) ──────────────────────────

export interface PunchPairingResult {
  /** Pares de punches apareados (entrada, salida) para construir segmentos WORK */
  pairs: Array<{ entry: NormalizedPunch; exit: NormalizedPunch }>
  /** Punch de entrada sin salida correspondiente (jornada abierta) */
  orphanEntry?: NormalizedPunch
  /** Punch de salida sin entrada correspondiente (jornada con entrada faltante) */
  orphanExit?: NormalizedPunch
  /** Incidencias generadas durante el apareamiento */
  pairingIncidents: WorkdayIncident[]
  /** Indica si el pareado usó dirección explícita (true) o fallback posicional (false) */
  usedDirectionPairing: boolean
}

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
  pairingIncidents: WorkdayIncident[]
}

/**
 * Proveedor de reglas por defecto en caso de no inyectar uno personalizado.
 * Desacoplado: No hardcodea números mágicos en el calculador principal.
 */
export class DefaultLaborRuleProvider implements LaborRuleProvider {
  public getRulesForDate(date: string, countryCode = 'MEX', shiftType = 'DIURNA') {
    const year = parseInt(date.substring(0, 4), 10)

    // Reducción progresiva 48h → 40h México
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
   *
   * Nota de rendimiento (ATT-006):
   * Este método itera minuto a minuto, con una llamada a Intl.DateTimeFormat por minuto.
   * Para una jornada típica de 8h = 480 llamadas. Para 100 jornadas en batch = 48,000 llamadas.
   * El rendimiento es aceptable para el volumen esperado en Fase 1–2 (procesamiento asíncrono por empleado).
   * Se diferirá la optimización basada en intersección de intervalos al motor de batch (Fase 5+).
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
   * Algoritmo híbrido de apareamiento de punches (ATT-001).
   *
   * Estrategia de prioridad:
   * 1. Si TODOS los punches tienen dirección UNKNOWN → fallback posicional (par/impar).
   * 2. Si TODOS tienen dirección explícita (ENTRY/EXIT) → apareamiento por tipo.
   * 3. Si hay mezcla (algunos UNKNOWN, algunos explícitos) → apareamiento híbrido:
   *    - Punches con dirección explícita guían la lógica.
   *    - Punches UNKNOWN se tratan posicionalmente en el contexto de la secuencia.
   *
   * Cuando se detecta ambigüedad (dos ENTRY consecutivos o dos EXIT consecutivos):
   * - Se genera la incidencia correspondiente (CONSECUTIVE_ENTRY / CONSECUTIVE_EXIT).
   * - NO se corrige silenciosamente.
   * - El par ambiguo se excluye del cálculo con un orphan.
   */
  public static pairPunches(punches: NormalizedPunch[]): PunchPairingResult {
    if (punches.length === 0) {
      return { pairs: [], pairingIncidents: [], usedDirectionPairing: false }
    }

    const allUnknown = punches.every(p => p.direction === 'UNKNOWN')

    if (allUnknown) {
      return this.positionalPairing(punches)
    }

    return this.directionAwarePairing(punches)
  }

  /**
   * Apareamiento posicional: ENTRY=par, EXIT=impar.
   * Fallback cuando no hay información de dirección confiable.
   */
  private static positionalPairing(punches: NormalizedPunch[]): PunchPairingResult {
    const pairs: Array<{ entry: NormalizedPunch; exit: NormalizedPunch }> = []
    const pairingIncidents: WorkdayIncident[] = []
    let orphanEntry: NormalizedPunch | undefined
    let orphanExit: NormalizedPunch | undefined

    for (let i = 0; i + 1 < punches.length; i += 2) {
      pairs.push({ entry: punches[i], exit: punches[i + 1] })
    }

    // Si número impar, el último punch queda sin par
    if (punches.length % 2 !== 0) {
      orphanEntry = punches[punches.length - 1]
    }

    return { pairs, orphanEntry, pairingIncidents, usedDirectionPairing: false }
  }

  /**
   * Apareamiento consciente de dirección.
   * Usa direction (ENTRY/EXIT/UNKNOWN) para construir pares semánticos.
   * Genera incidencias cuando la secuencia es ambigua.
   */
  private static directionAwarePairing(punches: NormalizedPunch[]): PunchPairingResult {
    const pairs: Array<{ entry: NormalizedPunch; exit: NormalizedPunch }> = []
    const pairingIncidents: WorkdayIncident[] = []
    let openEntry: NormalizedPunch | undefined
    let orphanExit: NormalizedPunch | undefined

    for (const punch of punches) {
      const dir = punch.direction

      if (dir === 'ENTRY') {
        if (openEntry !== undefined) {
          // Dos ENTRY consecutivos sin EXIT intermedio → ambigüedad
          pairingIncidents.push({
            code: 'CONSECUTIVE_ENTRY',
            severity: 'WARNING',
            message: `Dos marcajes de ENTRADA consecutivos detectados: ${openEntry.id} y ${punch.id}. Se descarta la primera entrada.`,
            metadata: {
              discardedPunchId: openEntry.id,
              discardedTimestamp: openEntry.utcTimestamp,
              conflictingPunchId: punch.id,
              conflictingTimestamp: punch.utcTimestamp,
            },
          })
          // Estrategia: descartar la primera ENTRY, conservar la nueva (más razonable)
          openEntry = punch
        } else {
          openEntry = punch
        }
      } else if (dir === 'EXIT') {
        if (openEntry === undefined) {
          // EXIT sin ENTRY previo → entrada faltante
          pairingIncidents.push({
            code: 'CONSECUTIVE_EXIT',
            severity: 'WARNING',
            message: `Marcaje de SALIDA sin ENTRADA previa: ${punch.id}. Se marca como salida huérfana.`,
            metadata: {
              orphanExitPunchId: punch.id,
              orphanExitTimestamp: punch.utcTimestamp,
            },
          })
          orphanExit = punch
        } else {
          pairs.push({ entry: openEntry, exit: punch })
          openEntry = undefined
        }
      } else {
        // UNKNOWN: tratamiento posicional en contexto
        if (openEntry === undefined) {
          openEntry = punch
        } else {
          // Tenemos un ENTRY abierto y llega un UNKNOWN → se cierra el segmento
          pairs.push({ entry: openEntry, exit: punch })
          openEntry = undefined
        }
      }
    }

    const orphanEntry = openEntry // Si quedó entrada abierta sin salida

    // Si hay ambigüedad significativa (múltiples incidencias sin pares), generar incidencia general
    if (pairingIncidents.length > 0 && pairs.length === 0 && !orphanEntry) {
      pairingIncidents.push({
        code: 'PUNCH_SEQUENCE_AMBIGUOUS',
        severity: 'CRITICAL',
        message: 'La secuencia de marcajes no puede interpretarse unívocamente. Verificar manualmente.',
        metadata: { totalIncidents: pairingIncidents.length },
      })
    }

    return { pairs, orphanEntry, orphanExit, pairingIncidents, usedDirectionPairing: true }
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
        pairingIncidents: [],
      }
    }

    // ─────────────────────────────────────────────────────────────
    // CASO 1: Un solo marcaje (Jornada Incompleta)
    // ─────────────────────────────────────────────────────────────
    if (punches.length === 1) {
      return this.calculateSinglePunch(punches[0], matchResult, sourceLogIds, devicesInvolved)
    }

    // ─────────────────────────────────────────────────────────────
    // CASO 2: Dos o más marcajes — Apareamiento híbrido (ATT-001)
    // ─────────────────────────────────────────────────────────────
    return this.calculateMultiplePunches(punches, matchResult, rules, options, sourceLogIds, devicesInvolved, isRestOrHoliday)
  }

  private static calculateSinglePunch(
    singlePunch: NormalizedPunch,
    matchResult: ShiftMatchResult,
    sourceLogIds: string[],
    devicesInvolved: string[]
  ): CalculationMetrics {
    const punchMs = singlePunch.epochMs

    let isEntry = true

    // Usar direction del punch para determinar si es entrada o salida
    if (singlePunch.direction === 'EXIT') {
      isEntry = false
    } else if (singlePunch.direction === 'ENTRY') {
      isEntry = true
    } else if (matchResult.scheduledStartUtc && matchResult.scheduledEndUtc) {
      // UNKNOWN: inferir por distancia a horario programado
      const startMs = new Date(matchResult.scheduledStartUtc).getTime()
      const endMs = new Date(matchResult.scheduledEndUtc).getTime()
      const distToStart = Math.abs(punchMs - startMs)
      const distToEnd = Math.abs(punchMs - endMs)
      isEntry = distToStart <= distToEnd
    }

    if (isEntry) {
      let lateMinutes = 0
      if (matchResult.scheduledStartUtc) {
        const startMs = new Date(matchResult.scheduledStartUtc).getTime()
        const toleranceMs = matchResult.toleranceMinutes * 60000
        if (punchMs > startMs + toleranceMs) {
          // ATT-005: lateMinutes = minutos desde hora programada, no desde fin de tolerancia
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
        pairingIncidents: [],
      }
    } else {
      let earlyLeaveMinutes = 0
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
        pairingIncidents: [],
      }
    }
  }

  private static calculateMultiplePunches(
    punches: NormalizedPunch[],
    matchResult: ShiftMatchResult,
    rules: ReturnType<DefaultLaborRuleProvider['getRulesForDate']>,
    options: AttendanceEngineOptions | undefined,
    sourceLogIds: string[],
    devicesInvolved: string[],
    isRestOrHoliday: boolean
  ): CalculationMetrics {
    const timezone = options?.timezone || matchResult.shiftType // pasado externamente al invoke
    // La timezone viene de las opciones del motor; el parámetro es inyectado por el caller (AttendanceEngine)

    // ATT-001: Apareamiento híbrido
    const pairing = this.pairPunches(punches)

    const segments: WorkdaySegment[] = []
    let totalBreakMinutes = 0
    let totalWorkMinutes = 0
    let totalNocturnalMinutes = 0

    const firstPunch = punches[0]
    const lastPunch = punches[punches.length - 1]
    const actualStart = firstPunch.utcTimestamp
    const missingExit = pairing.orphanEntry !== undefined
    const missingEntry = pairing.orphanExit !== undefined && pairing.pairs.length === 0

    // Construir segmentos de trabajo a partir de los pares apareados
    for (let i = 0; i < pairing.pairs.length; i++) {
      const { entry: pIn, exit: pOut } = pairing.pairs[i]

      const segDuration = Math.round((pOut.epochMs - pIn.epochMs) / 60000)
      // La timezone necesita ser pasada correctamente; se usa el campo recibido
      const segNocturnal = 0 // Se calculará con timezone real en la llamada desde engine

      segments.push({
        segmentType: 'WORK',
        startPunch: pIn,
        endPunch: pOut,
        durationMinutes: segDuration,
        isNocturnalMinutes: segNocturnal,
      })

      totalWorkMinutes += segDuration

      // Segmento de descanso entre pares consecutivos
      if (i + 1 < pairing.pairs.length) {
        const nextEntry = pairing.pairs[i + 1].entry
        const breakDur = Math.round((nextEntry.epochMs - pOut.epochMs) / 60000)
        segments.push({
          segmentType: 'BREAK',
          startPunch: pOut,
          endPunch: nextEntry,
          durationMinutes: breakDur,
          isNocturnalMinutes: 0,
        })
        totalBreakMinutes += breakDur
      }
    }

    // Auto-deducción de descanso programado cuando solo hay 2 punches y sin segmentos de break
    if (
      pairing.pairs.length === 1 &&
      options?.autoDeductScheduledBreakIfNoPunches &&
      matchResult.scheduledBreakMinutes > 0
    ) {
      if (totalWorkMinutes >= matchResult.scheduledMinutes) {
        totalBreakMinutes = matchResult.scheduledBreakMinutes
      }
    }

    const workedMinutes = Math.round((lastPunch.epochMs - firstPunch.epochMs) / 60000)
    const effectiveMinutes = Math.max(0, totalWorkMinutes - (pairing.pairs.length === 1 ? totalBreakMinutes : 0))

    // ATT-005: lateMinutes = minutos desde hora programada (scheduledStart), no desde fin de tolerancia.
    // Con scheduled=08:00, tolerance=10, arrival=08:15: lateMinutes=15 (no 5).
    // Para calcular minutos penalizables sobre tolerancia, el consumidor puede hacer:
    //   penalizableLateMinutes = Math.max(0, lateMinutes - toleranceMinutes)
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
      actualEnd: missingExit ? undefined : lastPunch.utcTimestamp,
      workedMinutes,
      breakMinutes: totalBreakMinutes,
      effectiveMinutes,
      lateMinutes,
      earlyLeaveMinutes,
      ordinaryMinutes,
      overtimeMinutes,
      nightShiftMinutes: totalNocturnalMinutes,
      missingEntry,
      missingExit,
      segments,
      sourceLogIds,
      devicesInvolved,
      pairingIncidents: pairing.pairingIncidents,
    }
  }
}
