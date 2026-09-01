/**
 * AttendanceTypes.ts
 * Definiciones de tipos y contratos para el Attendance Engine de Signum-Clock.
 *
 * Módulo: Cumplimiento Laboral México 2027
 * Arquitectura: Dominio puro, desacoplado de UI y bases de datos.
 *
 * HARDENING Phase 1:
 * - ATT-001: PunchDirection como tipo neutral de dominio (ENTRY | EXIT | UNKNOWN)
 * - ATT-002: WorkdayState separado de WorkdayStatus (estado estructural vs condición)
 * - ATT-004: PunchDispositionRecord para trazabilidad completa de todos los punches
 */

// ── Tipos de Marcajes Crudos y Normalizados ─────────────────────────────────

export type PunchSource = 'ADMS' | 'ISUP' | 'KIOSK' | 'MANUAL' | 'WEB' | 'SYSTEM'

/**
 * Tipo de entrada/salida extendido del dispositivo fuente.
 * Puede contener valores específicos del protocolo (ZKTeco, ISUP, etc.).
 */
export type InOutType = 'ENTRY' | 'EXIT' | 'BREAK_OUT' | 'BREAK_IN' | 'UNSPECIFIED'

/**
 * Dirección neutra de dominio.
 * ENTRY: El trabajador ingresó al centro de trabajo.
 * EXIT: El trabajador salió del centro de trabajo (o salió a descanso).
 * UNKNOWN: El dispositivo no reportó dirección o el valor no es confiable.
 *
 * Nota de diseño (ATT-001): El motor debe aprovechar esta dirección cuando esté
 * disponible. Si es UNKNOWN, se aplica inferencia posicional como fallback.
 */
export type PunchDirection = 'ENTRY' | 'EXIT' | 'UNKNOWN'

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
  inOutType: InOutType // Valor original del dispositivo, preservado
  direction: PunchDirection // Dirección neutral de dominio derivada de inOutType
  source: PunchSource
  deviceSerial?: string
  rawPayload?: string
}

// ── Trazabilidad de Punches (ATT-004) ───────────────────────────────────────

/**
 * Clasificación de cada punch recibido por el motor.
 * Ningún punch puede desaparecer silenciosamente del resultado.
 *
 * USED:           Punch aceptado y utilizado en el cálculo de la jornada.
 * DUPLICATE:      Punch descartado por deduplicación (dentro de la ventana de dedup).
 * OUT_OF_WINDOW:  Punch fuera de la ventana operativa del turno.
 * INVALID:        Punch rechazado por datos inválidos (timestamp nulo, tenant incorrecto, etc.).
 * IGNORED:        Punch válido pero descartado por otra razón (ej: sin turno asignado).
 */
export type PunchDispositionCode = 'USED' | 'DUPLICATE' | 'OUT_OF_WINDOW' | 'INVALID' | 'IGNORED'

export interface PunchDispositionRecord {
  logId: string
  utcTimestamp: string
  epochMs: number
  direction: PunchDirection
  disposition: PunchDispositionCode
  reason?: string // Explicación legible del motivo de la disposición
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
  /**
   * Minutos antes del inicio del turno en que se acepta un marcaje.
   * Default: 120 (2 horas antes).
   * Nota (ATT-008): Este default debe configurarse explícitamente para turnos dobles cercanos.
   */
  windowBeforeStartMinutes?: number
  /**
   * Minutos después del fin del turno en que se acepta un marcaje.
   * Default: 180 (3 horas después).
   * Nota (ATT-008): Este default puede solapar con turnos subsecuentes. Configurar explícitamente.
   */
  windowAfterEndMinutes?: number
}

// ── Estrategia de Deduplicación ─────────────────────────────────────────────

export interface DeduplicationConfig {
  /**
   * Umbral mínimo en segundos entre el punch RETENIDO y cada punch candidato.
   *
   * Semántica de ventana FIJA (ATT-003):
   * El umbral se compara contra el primer punch RETENIDO de cada ráfaga,
   * no contra el último punch descartado. Esto evita el colapso de ráfagas
   * largas causadas por malfuncionamiento de terminales.
   *
   * Ejemplo con window=5s:
   *   t=0  → RETENIDO
   *   t=4  → DUPLICADO (4s desde retenido)
   *   t=8  → NUEVO RETENIDO (8s > 5s desde el primer retenido t=0)
   *   t=12 → DUPLICADO (4s desde nuevo retenido t=8)
   *
   * Default: 60 segundos.
   */
  minSecondsBetweenPunches?: number

  /**
   * Modo de selección cuando se retiene un punch de una ráfaga:
   * - 'KEEP_FIRST': Conserva el primer punch (default).
   * - 'KEEP_LAST': Conserva el último punch de la ráfaga.
   * - 'DEBOUNCE': Equivalente a KEEP_FIRST.
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
  // ATT-001: Códigos de ambigüedad en secuencia de marcajes
  | 'CONSECUTIVE_ENTRY'        // Dos marcajes de ENTRADA consecutivos sin salida intermedia
  | 'CONSECUTIVE_EXIT'         // Dos marcajes de SALIDA consecutivos sin entrada intermedia
  | 'PUNCH_SEQUENCE_AMBIGUOUS' // Secuencia de marcajes no interpretable unívocamente

export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface WorkdayIncident {
  code: IncidentCode
  severity: IncidentSeverity
  minutes?: number
  message: string
  metadata?: Record<string, unknown>
}

// ── Estado Estructural de la Jornada (ATT-002) ─────────────────────────────

/**
 * WorkdayState: Estado ESTRUCTURAL de la jornada.
 * Describe si la jornada está completa, incompleta o ausente,
 * independientemente de las condiciones laborales (retardo, salida anticipada, etc.).
 *
 * COMPLETE:    La jornada tiene entrada Y salida registradas.
 *              Puede tener incidencias (LATE, EARLY_LEAVE, OVERTIME).
 * INCOMPLETE:  La jornada tiene marcajes pero le falta entrada o salida.
 * ABSENT:      Sin marcajes en un día de trabajo programado.
 * UNSCHEDULED: Marcajes existentes pero sin turno programado asignado.
 * INVALID:     Estado no determinable por datos contradictorios o corruptos.
 */
export type WorkdayState = 'COMPLETE' | 'INCOMPLETE' | 'ABSENT' | 'UNSCHEDULED' | 'INVALID'

/**
 * WorkdayStatus: DEPRECATED. Se mantiene por compatibilidad con código existente.
 * Usar workdayState (estructura) + incidents[] (condiciones laborales) en su lugar.
 * Será eliminado en Fase 3.
 *
 * Advertencia: status no puede representar la co-ocurrencia de LATE + EARLY_LEAVE.
 * En ese caso, status = 'LATE' y 'EARLY_LEAVE' sólo aparece en incidents[].
 */
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

  workedMinutes: number // Minutos reales transcurridos (epochMs), NO de reloj local
  breakMinutes: number // Minutos computados de comida/descanso
  effectiveMinutes: number // Minutos efectivos (workedMinutes - breakMinutes)

  lateMinutes: number
  // Nota (ATT-005): lateMinutes = (actualStart - scheduledStart) en minutos.
  // Se mide desde la hora programada, NO desde el fin del período de tolerancia.
  // Ejemplo: scheduled=08:00, tolerance=10min, arrival=08:15 → lateMinutes=15 (no 5).
  // Para lógica de descuento penalizable, consultar también toleranceMinutes en ShiftWindowConfig.

  earlyLeaveMinutes: number
  ordinaryMinutes: number
  overtimeMinutes: number
  nightShiftMinutes: number

  /**
   * workdayState: Estado ESTRUCTURAL de la jornada (ATT-002).
   * Indica si la jornada está estructuralmente completa, independiente de condiciones laborales.
   * Usar junto con incidents[] para evaluar todas las condiciones detectadas.
   */
  workdayState: WorkdayState

  /**
   * status: DEPRECATED — Alias de compatibilidad.
   * Usa workdayState + incidents[] en su lugar.
   * No captura co-ocurrencia de múltiples condiciones (ej: LATE + EARLY_LEAVE simultáneos).
   */
  status: WorkdayStatus

  missingEntry: boolean
  missingExit: boolean

  segments: WorkdaySegment[]
  sourceLogIds: string[] // IDs de los punches USADOS en el cálculo (disposition=USED)

  /**
   * punchDispositions: Trazabilidad completa de TODOS los punches recibidos (ATT-004).
   * Incluye punches usados, duplicados, fuera de ventana e inválidos.
   * Ningún punch desaparece silenciosamente.
   */
  punchDispositions: PunchDispositionRecord[]

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
