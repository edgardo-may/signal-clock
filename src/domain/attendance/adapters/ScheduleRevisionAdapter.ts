import type { ShiftWindowConfig } from '../AttendanceTypes.ts'
import { AttendanceError, ShiftConfigurationError } from '../AttendanceErrors.ts'
import { sha256Utf8 } from '../WorkdayIntegrityHasher.ts'

export type ScheduleDayKey = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom'

export interface RevisionDayConfig {
  activo?: boolean
  entrada?: string | null
  salida?: string | null
  descanso_inicio?: string | null
  descanso_fin?: string | null
}

export interface ScheduleRevisionSnapshotV1 {
  calculation_contract_version: 1
  dias_config: Record<ScheduleDayKey, RevisionDayConfig>
  tolerancia_minutos: number
  horario_activo: boolean
}

export interface ScheduleRevisionRecord {
  id: string
  cliente_id: string
  horario_id: string
  version: number
  config_snapshot: unknown
  integrity_hash: string
}

export class ScheduleRevisionContractError extends AttendanceError {
  constructor(message: string, code: string) {
    super(message, code)
    this.name = 'ScheduleRevisionContractError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/** PostgreSQL jsonb object order: key byte length, then UTF-8 bytes. */
function compareJsonbKeys(left: string, right: string): number {
  const leftBytes = utf8Bytes(left)
  const rightBytes = utf8Bytes(right)
  if (leftBytes.length !== rightBytes.length) return leftBytes.length - rightBytes.length
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index]
  }
  return 0
}

/**
 * Exact textual form emitted by PostgreSQL jsonb::text for the subset accepted
 * by schedule revision v1. This deliberately includes PostgreSQL's spaces.
 */
export function postgresJsonbCanonicalText(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ScheduleRevisionContractError('El snapshot contiene un número no finito.', 'SCHEDULE_REVISION_SNAPSHOT_INVALID')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(postgresJsonbCanonicalText).join(', ')}]`
  if (!isPlainObject(value)) throw new ScheduleRevisionContractError('El snapshot contiene un tipo JSON no soportado.', 'SCHEDULE_REVISION_SNAPSHOT_INVALID')
  return `{${Object.keys(value).sort(compareJsonbKeys).map((key) => `${JSON.stringify(key)}: ${postgresJsonbCanonicalText(value[key])}`).join(', ')}}`
}

function calculationPayload(snapshot: ScheduleRevisionSnapshotV1): Record<string, unknown> {
  return {
    calculation_contract_version: snapshot.calculation_contract_version,
    dias_config: snapshot.dias_config,
    tolerancia_minutos: snapshot.tolerancia_minutos,
    horario_activo: snapshot.horario_activo,
  }
}

export function computeScheduleRevisionIntegrityHash(snapshot: ScheduleRevisionSnapshotV1): string {
  return sha256Utf8(postgresJsonbCanonicalText(calculationPayload(snapshot)))
}

function isClock(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function parseDayConfig(value: unknown, key: ScheduleDayKey): RevisionDayConfig {
  if (!isPlainObject(value) || typeof value.activo !== 'boolean') {
    throw new ScheduleRevisionContractError(`dias_config.${key} es incompleto.`, 'SCHEDULE_REVISION_SNAPSHOT_INVALID')
  }
  if (value.activo && (!isClock(value.entrada) || !isClock(value.salida))) {
    throw new ShiftConfigurationError(`schedule_revision.dias_config.${key} requiere entrada y salida HH:MM válidas.`)
  }
  const hasBreakStart = value.descanso_inicio !== null && value.descanso_inicio !== undefined && value.descanso_inicio !== ''
  const hasBreakEnd = value.descanso_fin !== null && value.descanso_fin !== undefined && value.descanso_fin !== ''
  if (hasBreakStart !== hasBreakEnd || (hasBreakStart && (!isClock(value.descanso_inicio) || !isClock(value.descanso_fin)))) {
    throw new ShiftConfigurationError(`schedule_revision.dias_config.${key} tiene un descanso incompleto o inválido.`)
  }
  return value as RevisionDayConfig
}

export function parseScheduleRevisionV1(snapshot: unknown): ScheduleRevisionSnapshotV1 {
  if (!isPlainObject(snapshot)) throw new ScheduleRevisionContractError('config_snapshot debe ser un objeto.', 'SCHEDULE_REVISION_SNAPSHOT_INVALID')
  if (snapshot.calculation_contract_version !== 1) {
    throw new ScheduleRevisionContractError('calculation_contract_version no está soportada.', 'SCHEDULE_REVISION_CONTRACT_VERSION_UNSUPPORTED')
  }
  const diasConfig = snapshot.dias_config
  const tolerance = snapshot.tolerancia_minutos
  const scheduleActive = snapshot.horario_activo
  if (!isPlainObject(diasConfig) || typeof tolerance !== 'number' || !Number.isInteger(tolerance) || tolerance < 0 || typeof scheduleActive !== 'boolean') {
    throw new ScheduleRevisionContractError('config_snapshot v1 es incompleto.', 'SCHEDULE_REVISION_SNAPSHOT_INVALID')
  }
  const dias = {} as Record<ScheduleDayKey, RevisionDayConfig>
  for (const key of ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as ScheduleDayKey[]) dias[key] = parseDayConfig(diasConfig[key], key)
  return {
    calculation_contract_version: 1,
    dias_config: dias,
    tolerancia_minutos: tolerance,
    horario_activo: scheduleActive,
  }
}

export function validateScheduleRevision(revision: ScheduleRevisionRecord, assignmentClienteId: string, assignmentHorarioId: string): ScheduleRevisionSnapshotV1 {
  if (!Number.isInteger(revision.version) || revision.version < 1) {
    throw new ScheduleRevisionContractError('schedule_revisions.version es inválida.', 'SCHEDULE_REVISION_VERSION_INVALID')
  }
  if (revision.cliente_id !== assignmentClienteId) throw new ScheduleRevisionContractError('La revisión pertenece a otro tenant.', 'SCHEDULE_REVISION_TENANT_MISMATCH')
  if (revision.horario_id !== assignmentHorarioId) throw new ScheduleRevisionContractError('La revisión pertenece a otro horario.', 'SCHEDULE_REVISION_SCHEDULE_MISMATCH')
  if (!/^[0-9a-f]{64}$/.test(revision.integrity_hash)) throw new ScheduleRevisionContractError('integrity_hash tiene formato inválido.', 'SCHEDULE_REVISION_HASH_MISMATCH')
  const snapshot = parseScheduleRevisionV1(revision.config_snapshot)
  if (computeScheduleRevisionIntegrityHash(snapshot) !== revision.integrity_hash) throw new ScheduleRevisionContractError('integrity_hash no coincide con config_snapshot.', 'SCHEDULE_REVISION_HASH_MISMATCH')
  if (!snapshot.horario_activo) throw new ScheduleRevisionContractError('La revisión seleccionada está inactiva.', 'SCHEDULE_REVISION_INACTIVE')
  return snapshot
}

export function revisionDayToShift(revision: ScheduleRevisionRecord, snapshot: ScheduleRevisionSnapshotV1, candidateDate: string, dayKey: ScheduleDayKey): ShiftWindowConfig | null {
  const day = snapshot.dias_config[dayKey]
  if (!day.activo) return null
  if (!isClock(day.entrada) || !isClock(day.salida)) throw new ShiftConfigurationError(`schedule_revision.dias_config.${dayKey} requiere entrada y salida HH:MM válidas.`)
  const hasBreakStart = day.descanso_inicio !== null && day.descanso_inicio !== undefined && day.descanso_inicio !== ''
  const hasBreakEnd = day.descanso_fin !== null && day.descanso_fin !== undefined && day.descanso_fin !== ''
  if (hasBreakStart !== hasBreakEnd || (hasBreakStart && (!isClock(day.descanso_inicio) || !isClock(day.descanso_fin)))) {
    throw new ShiftConfigurationError(`schedule_revision.dias_config.${dayKey} tiene un descanso incompleto o inválido.`)
  }
  const minutes = (start: string, end: string) => {
    const [startHour, startMinute] = start.split(':').map(Number)
    const [endHour, endMinute] = end.split(':').map(Number)
    const result = endHour * 60 + endMinute - (startHour * 60 + startMinute)
    return result >= 0 ? result : result + 24 * 60
  }
  const hasBreak = hasBreakStart && hasBreakEnd
  return {
    id: revision.horario_id,
    name: `schedule-revision-v${revision.version}`,
    operativeDate: candidateDate,
    startTime: day.entrada,
    endTime: day.salida,
    toleranceMinutes: snapshot.tolerancia_minutos,
    hasBreak,
    breakConfig: hasBreak ? { startTime: day.descanso_inicio as string, endTime: day.descanso_fin as string, durationMinutes: minutes(day.descanso_inicio as string, day.descanso_fin as string) } : undefined,
    scheduledBreakMinutes: hasBreak ? minutes(day.descanso_inicio as string, day.descanso_fin as string) : 0,
  }
}
