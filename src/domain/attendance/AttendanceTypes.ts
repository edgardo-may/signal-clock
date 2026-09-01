/**
 * AttendanceTypes.ts
 * Definiciones de tipos y contratos para el Attendance Engine de Signum-Clock.
 *
 * Módulo: Cumplimiento Laboral México 2027
 * Arquitectura: Dominio puro, desacoplado de UI y bases de datos.
 */

// ── Tipos de Marcajes Crudos y Normalizados ─────────────────────────────────

export type PunchSource = 'ADMS' | 'ISUP' | 'KIOSK' | 'MANUAL' | 'WEB' | 'SYSTEM'

export type InOutType = 'ENTRY' | 'EXIT' | 'BREAK_OUT' | 'BREAK_IN' | 'UNSPECIFIED'

export interface RawAttendancePunch {
  id?: string
  clienteId: string
  empleadoId: string
  timestamp: string | Date // ISO UTC o Date
  source?: PunchSource
  deviceSerial?: string
  verifyType?: number // 0=pw, 1=fp, 2=card, 15=face, etc.
  inOutState?: number // 0=in, 1=out, 2=break_out, 3=break_in
  rawPayload?: string
  status?: string
}

export interface NormalizedPunch {
  id: string
  clienteId: string
  empleadoId: string
  utcTimestamp: string // ISO 8601 UTC (ej: "2027-01-15T14:02:00.000Z")
  epochMs: number
  localDate: string // YYYY-MM-DD en la timezone efectiva (ej: "2027-01-15")
  localTime: string // HH:mm:ss en la timezone efectiva (ej: "08:02:00")
  localMinutesOfDay: number // Minutos desde 00:00 del día local (ej: 482)
  inOutType: InOutType
  source: PunchSource
  deviceSerial?: string
  rawPayload?: string
}

// ── Tipos de Turnos y Programación ──────────────────────────────────────────

export type ShiftType = 'DIURNA' | 'NOCTURNA' | 'MIXTA' | 'ESPECIAL'

export interface BreakConfig {
  startTime: string // HH:mm (ej: "13:00")
  endTime: string // HH:mm (ej: "14:00")
  durationMinutes?: number // ej: 60
  isPaid?: boolean
}

export interface ShiftWindowConfig {
  id?: string
  name?: string
  operativeDate: string // YYYY-MM-DD (Día laboral al que pertenece la jornada)
  startTime: string // HH:mm (ej: "08:00" o "22:00")
  endTime: string // HH:mm (ej: "17:00" o "06:00")
  toleranceMinutes?: number // Minutos de tolerancia en entrada (default: 10)
  hasBreak?: boolean
  breakConfig?: BreakConfig
  scheduledBreakMinutes?: number // Minutos teóricos de comida/descanso
  shiftType?: ShiftType
  isRestDay?: boolean
  isHoliday?: boolean
  holidayName?: string
  windowBeforeStartMinutes?: number // Tolerancia de anticipación para aceptar marcajes (default: 120m)
  windowAfterEndMinutes?: number // Tolerancia posterior para aceptar marcajes (default: 180m)
}

// ── Estrategia de Deduplicación ─────────────────────────────────────────────

export interface DeduplicationConfig {
  /**
   * Umbral mínimo en segundos entre marcajes sucesivos para descartar dobles checadas accidentales.
   * Default: 60 segundos.
   */
  minSecondsBetweenPunches?: number

  /**
   * Modo de deduplicación:
   * - 'KEEP_FIRST': Conserva el primer marcaje de una ráfaga.
   * - 'KEEP_LAST': Conserva el último marcaje.
   * - 'DEBOUNCE': Agrupa ráfagas y emite el primero.
   */
  mode?: 'KEEP_FIRST' | 'KEEP_LAST' | 'DEBOUNCE'
}

// ── Segmentos de Jornada y Tiempos ──────────────────────────────────────────

export type SegmentType = 'WORK' | 'BREAK' | 'OUT_OF_WINDOW'

export interface WorkdaySegment {
  segmentType: SegmentType
  startPunch: NormalizedPunch
  endPunch?: NormalizedPunch
  durationMinutes: number
  isNocturnalMinutes: number
}

// ── Incidencias y Excepciones ───────────────────────────────────────────────

export type IncidentCode =
  | 'LATE'
  | 'EARLY_LEAVE'
  | 'MISSING_ENTRY'
  | 'MISSING_EXIT'
  | 'INCOMPLETE'
  | 'ABSENT'
  | 'OVERTIME_DETECTED'
  | 'REST_DAY_WORK'
  | 'HOLIDAY_WORK'
  | 'OUT_OF_WINDOW_PUNCH'
  | 'SCHEDULE_EXCEPTION'

export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface WorkdayIncident {
  code: IncidentCode
  severity: IncidentSeverity
  minutes?: number
  message: string
  metadata?: Record<string, unknown>
}

// ── Estados de Jornada ──────────────────────────────────────────────────────

export type WorkdayStatus =
  | 'PRESENT'
  | 'LATE'
  | 'EARLY_LEAVE'
  | 'INCOMPLETE'
  | 'ABSENT'
  | 'REST_DAY'
  | 'HOLIDAY'
  | 'REST_DAY_WORK'
  | 'HOLIDAY_WORK'
  | 'DISPUTED'

// ── Proveedor de Reglas Laborales Desacoplado ───────────────────────────────

export interface LaborRuleThresholds {
  maxDailyOrdinaryMinutes: number
  maxWeeklyOrdinaryMinutes: number
  overtimeDoubleMaxWeeklyMinutes: number // Primeras 9 horas extraordinarias semanales (LFT Art. 67)
}

export interface LaborRuleProvider {
  getRulesForDate(date: string, countryCode?: string, shiftType?: ShiftType): LaborRuleThresholds
}

// ── Resultado Final del Cálculo de Jornada ──────────────────────────────────

export interface WorkdayCalculationResult {
  clienteId: string
  empleadoId: string
  operativeDate: string // YYYY-MM-DD (fecha operativa del turno)
  timezone: string

  scheduleId?: string
  shiftType: ShiftType
  isRestDay: boolean
  isHoliday: boolean
  holidayName?: string

  scheduledStart?: string // ISO UTC o string formateado
  scheduledEnd?: string // ISO UTC o string formateado
  scheduledMinutes: number

  actualStart?: string // ISO UTC del primer marcaje válido
  actualEnd?: string // ISO UTC del último marcaje válido

  workedMinutes: number // Minutos totales transcurridos en el centro
  breakMinutes: number // Minutos computados de comida/descanso
  effectiveMinutes: number // Minutos efectivos (workedMinutes - breakMinutes)

  lateMinutes: number
  earlyLeaveMinutes: number
  ordinaryMinutes: number
  overtimeMinutes: number
  nightShiftMinutes: number

  status: WorkdayStatus
  missingEntry: boolean
  missingExit: boolean

  segments: WorkdaySegment[]
  sourceLogIds: string[]
  devicesInvolved: string[]

  warnings: string[]
  incidents: WorkdayIncident[]

  calculationVersion: number
  integrityHash: string // SHA-256 determinista para detección de modificaciones
}

// ── Opciones de Ejecución del Motor ─────────────────────────────────────────

export interface AttendanceEngineOptions {
  timezone?: string // Default: 'America/Mexico_City'
  deduplication?: DeduplicationConfig
  laborRuleProvider?: LaborRuleProvider
  calculationVersion?: number
  defaultToleranceMinutes?: number
  autoDeductScheduledBreakIfNoPunches?: boolean
}
