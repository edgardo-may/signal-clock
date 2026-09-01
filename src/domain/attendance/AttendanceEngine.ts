/**
 * AttendanceEngine.ts
 * Orquestador principal del motor de procesamiento de asistencia.
 *
 * Flujo:
 * RAW attendance_logs
 *   ↓
 * Normalization (AttendanceNormalizer)
 *   ↓
 * Shift Matching (ShiftMatcher)
 *   ↓
 * Workday Calculation (WorkdayCalculator)
 *   ↓
 * Incident Detection (IncidentDetector)
 *   ↓
 * Integrity Hash (WorkdayIntegrityHasher)
 *   ↓
 * Workday Calculation Result
 *
 * Módulo: Cumplimiento Laboral México 2027
 */

import type {
  RawAttendancePunch,
  ShiftWindowConfig,
  WorkdayCalculationResult,
  AttendanceEngineOptions,
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

    // 1. Normalización y deduplicación en la zona horaria efectiva
    const normalizedPunches = AttendanceNormalizer.normalize(
      rawPunches,
      timezone,
      clienteId,
      empleadoId,
      mergedOptions.deduplication
    )

    // 2. Emparejamiento con la ventana operativa del turno
    const matchResult = ShiftMatcher.match(shiftConfig, normalizedPunches, timezone)

    // 3. Cálculo matemático de segmentos, tiempos trabajados y descansos
    const metrics = WorkdayCalculator.calculate(matchResult, timezone, mergedOptions)

    // 4. Detección automática e idempotente de incidencias y estado
    const evalResult = IncidentDetector.evaluate(matchResult, metrics)

    // 5. Cálculo del hash de integridad SHA-256
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

    // 6. Construcción del resultado consolidado
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
      status: evalResult.status,
      missingEntry: metrics.missingEntry,
      missingExit: metrics.missingExit,
      segments: metrics.segments,
      sourceLogIds: metrics.sourceLogIds,
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
