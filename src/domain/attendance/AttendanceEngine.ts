/**
 * AttendanceEngine.ts
 * Orquestador principal del motor de procesamiento de asistencia.
 *
 * Flujo:
 * RAW attendance_logs
 *   ↓
 * Normalization (AttendanceNormalizer) → NormalizationResult (accepted + dispositions)
 *   ↓
 * Shift Matching (ShiftMatcher) → matched + outOfWindow
 *   ↓
 * Workday Calculation (WorkdayCalculator) → CalculationMetrics (pairing híbrido ATT-001)
 *   ↓
 * Incident Detection (IncidentDetector) → workdayState + status + incidents
 *   ↓
 * Integrity Hash (WorkdayIntegrityHasher)
 *   ↓
 * Workday Calculation Result (con punchDispositions completas, ATT-004)
 *
 * Módulo: Cumplimiento Laboral México 2027
 *
 * HARDENING Phase 1:
 * - ATT-001: Pairing híbrido activo vía WorkdayCalculator.
 * - ATT-002: workdayState propagado desde IncidentDetector.
 * - ATT-004: punchDispositions agrupadas (USED, DUPLICATE, OUT_OF_WINDOW).
 * - ATT-006: calculateNocturnalMinutes se invoca con timezone correcta por segmento.
 */

import type {
  RawAttendancePunch,
  ShiftWindowConfig,
  WorkdayCalculationResult,
  AttendanceEngineOptions,
  PunchDispositionRecord,
} from './AttendanceTypes.ts'
import { assertValidTimezone } from './timezoneUtils.ts'
import { AttendanceNormalizer } from './AttendanceNormalizer.ts'
import { ShiftMatcher } from './ShiftMatcher.ts'
import { WorkdayCalculator, DefaultLaborRuleProvider } from './WorkdayCalculator.ts'
import { IncidentDetector } from './IncidentDetector.ts'
import { WorkdayIntegrityHasher } from './WorkdayIntegrityHasher.ts'

export class AttendanceEngine {
  private readonly defaultOptions: Required<AttendanceEngineOptions>

  constructor(options?: AttendanceEngineOptions) {
    this.defaultOptions = {
      timezone: options?.timezone || 'America/Mexico_City',
      deduplication: options?.deduplication || { minSecondsBetweenPunches: 60, mode: 'KEEP_FIRST' },
      laborRuleProvider: options?.laborRuleProvider || new DefaultLaborRuleProvider(),
      calculationVersion: options?.calculationVersion || 1,
      defaultToleranceMinutes: options?.defaultToleranceMinutes || 10,
      autoDeductScheduledBreakIfNoPunches: options?.autoDeductScheduledBreakIfNoPunches ?? false,
    }
    assertValidTimezone(this.defaultOptions.timezone)
  }

  /**
   * Procesa una jornada laboral para un colaborador específico en una fecha operativa.
   */
  public processWorkday(
    clienteId: string,
    empleadoId: string,
    shiftConfig: ShiftWindowConfig,
    rawPunches: RawAttendancePunch[],
    overrideOptions?: AttendanceEngineOptions
  ): WorkdayCalculationResult {
    const timezone = overrideOptions?.timezone || this.defaultOptions.timezone
    assertValidTimezone(timezone)

    const calculationVersion = overrideOptions?.calculationVersion || this.defaultOptions.calculationVersion
    const mergedOptions: AttendanceEngineOptions = {
      ...this.defaultOptions,
      ...overrideOptions,
      timezone,
      calculationVersion,
    }

    // 1. Normalización, deduplicación (ventana fija ATT-003) y trazabilidad (ATT-004)
    const normalizationResult = AttendanceNormalizer.normalize(
      rawPunches,
      timezone,
      clienteId,
      empleadoId,
      mergedOptions.deduplication
    )

    // 2. Emparejamiento con la ventana operativa del turno
    const matchResult = ShiftMatcher.match(shiftConfig, normalizationResult.accepted, timezone)

    // 3. Cálculo matemático de segmentos, tiempos trabajados y descansos
    //    (con apareamiento híbrido ATT-001)
    const metrics = WorkdayCalculator.calculate(matchResult, timezone, mergedOptions)

    // 3b. Calcular minutos nocturnos correctamente con timezone (ATT-006)
    let totalNocturnalMinutes = 0
    for (const seg of metrics.segments) {
      if (seg.segmentType === 'WORK' && seg.endPunch) {
        const noctural = WorkdayCalculator.calculateNocturnalMinutes(
          seg.startPunch.epochMs,
          seg.endPunch.epochMs,
          timezone
        )
        seg.isNocturnalMinutes = noctural
        totalNocturnalMinutes += noctural
      }
    }
    metrics.nightShiftMinutes = totalNocturnalMinutes

    // 4. Detección automática e idempotente de incidencias y workdayState (ATT-002)
    const evalResult = IncidentDetector.evaluate(matchResult, metrics)

    // 5. Construcción de punchDispositions completas (ATT-004)
    //    USED/DUPLICATE vienen del normalizador.
    //    OUT_OF_WINDOW se marca aquí para los punches aceptados por normalizer
    //    pero rechazados por ShiftMatcher.
    const outOfWindowIds = new Set(matchResult.outOfWindowPunches.map(p => p.id))
    const punchDispositions: PunchDispositionRecord[] = normalizationResult.dispositions.map(d => {
      if (d.disposition === 'USED' && outOfWindowIds.has(d.logId)) {
        return {
          ...d,
          disposition: 'OUT_OF_WINDOW' as const,
          reason: 'Fuera de la ventana operativa del turno (pre/post-shift window)',
        }
      }
      return d
    })

    // 6. Cálculo del hash de integridad SHA-256
    const integrityHash = WorkdayIntegrityHasher.computeHash({
      clienteId,
      empleadoId,
      operativeDate: matchResult.operativeDate,
      timezone,
      scheduleId: shiftConfig.id,
      scheduledStart: matchResult.scheduledStartUtc,
      scheduledEnd: matchResult.scheduledEndUtc,
      actualStart: metrics.actualStart,
      actualEnd: metrics.actualEnd,
      workedMinutes: metrics.workedMinutes,
      breakMinutes: metrics.breakMinutes,
      effectiveMinutes: metrics.effectiveMinutes,
      lateMinutes: metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      ordinaryMinutes: metrics.ordinaryMinutes,
      overtimeMinutes: metrics.overtimeMinutes,
      status: evalResult.status,
      sourceLogIds: metrics.sourceLogIds,
      incidentCodes: evalResult.incidents.map((i) => i.code),
      calculationVersion,
    })

    // 7. Construcción del resultado consolidado
    return {
      clienteId,
      empleadoId,
      operativeDate: matchResult.operativeDate,
      timezone,
      scheduleId: shiftConfig.id,
      shiftType: matchResult.shiftType,
      isRestDay: matchResult.isRestDay,
      isHoliday: matchResult.isHoliday,
      holidayName: shiftConfig.holidayName,
      scheduledStart: matchResult.scheduledStartUtc,
      scheduledEnd: matchResult.scheduledEndUtc,
      scheduledMinutes: matchResult.scheduledMinutes,
      actualStart: metrics.actualStart,
      actualEnd: metrics.actualEnd,
      workedMinutes: metrics.workedMinutes,
      breakMinutes: metrics.breakMinutes,
      effectiveMinutes: metrics.effectiveMinutes,
      lateMinutes: metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      ordinaryMinutes: metrics.ordinaryMinutes,
      overtimeMinutes: metrics.overtimeMinutes,
      nightShiftMinutes: metrics.nightShiftMinutes,
      workdayState: evalResult.workdayState,   // ATT-002: Estado estructural
      status: evalResult.status,               // ATT-002: DEPRECATED — alias de compatibilidad
      missingEntry: metrics.missingEntry,
      missingExit: metrics.missingExit,
      segments: metrics.segments,
      sourceLogIds: metrics.sourceLogIds,
      punchDispositions,                       // ATT-004: Trazabilidad completa
      devicesInvolved: metrics.devicesInvolved,
      warnings: evalResult.warnings,
      incidents: evalResult.incidents,
      calculationVersion,
      integrityHash,
    }
  }

  /**
   * Método estático de conveniencia para ejecución directa sin instanciación manual.
   */
  public static process(
    clienteId: string,
    empleadoId: string,
    shiftConfig: ShiftWindowConfig,
    rawPunches: RawAttendancePunch[],
    options?: AttendanceEngineOptions
  ): WorkdayCalculationResult {
    const engine = new AttendanceEngine(options)
    return engine.processWorkday(clienteId, empleadoId, shiftConfig, rawPunches, options)
  }
}
