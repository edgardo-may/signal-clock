/**
 * Fail-closed resolver for immutable empleados_horarios + schedule_revisions.
 * It deliberately has no input for mutable public.horarios calculation fields.
 */

import { AttendanceError, ShiftConfigurationError, TenantMismatchError } from '../AttendanceErrors.ts'
import {
  type ScheduleRevisionRecord,
  type ScheduleDayKey,
  revisionDayToShift,
  validateScheduleRevision,
} from './ScheduleRevisionAdapter.ts'

export interface EmpleadoHorarioRecord {
  id: string
  cliente_id: string
  empleado_id: string
  horario_id: string
  schedule_revision_id: string | null
  fecha_inicio: string
  fecha_fin: string | null
  activo: boolean
}

export interface ScheduleResolutionInput {
  clienteId: string
  empleadoId: string
  /** YYYY-MM-DD already selected by the workday grouping flow. */
  candidateDate: string
  assignments: readonly EmpleadoHorarioRecord[]
  revisions: readonly ScheduleRevisionRecord[]
}

export interface UnscheduledResolution {
  kind: 'UNSCHEDULED'
  candidateDate: string
}

export interface ScheduledResolution {
  kind: 'SCHEDULED'
  candidateDate: string
  /** empleados_horarios.id: trace only, never the persisted workday schedule_id. */
  scheduleAssignmentId: string
  /** horarios.id: stable schedule identity persisted by workday_records. */
  scheduleId: string
  scheduleRevisionId: string
  scheduleRevisionVersion: number
  scheduleRevisionHash: string
  shift: NonNullable<ReturnType<typeof revisionDayToShift>>
}

export type ScheduleResolution = UnscheduledResolution | ScheduledResolution

export class AmbiguousScheduleError extends AttendanceError {
  constructor(clienteId: string, empleadoId: string, candidateDate: string) {
    super(`Más de una asignación vigente es válida para cliente ${clienteId}, empleado ${empleadoId}, fecha ${candidateDate}.`, 'AMBIGUOUS_SCHEDULE')
    this.name = 'AmbiguousScheduleError'
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function dayKeyFor(candidateDate: string): ScheduleDayKey {
  const day = new Date(`${candidateDate}T00:00:00.000Z`).getUTCDay()
  return ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][day] as ScheduleDayKey
}

function isInRange(assignment: EmpleadoHorarioRecord, candidateDate: string): boolean {
  return assignment.fecha_inicio <= candidateDate && (assignment.fecha_fin === null || assignment.fecha_fin >= candidateDate)
}

function assertAssignmentRange(assignment: EmpleadoHorarioRecord): void {
  if (!isIsoDate(assignment.fecha_inicio) || (assignment.fecha_fin !== null && (!isIsoDate(assignment.fecha_fin) || assignment.fecha_fin < assignment.fecha_inicio))) {
    throw new ShiftConfigurationError(`empleados_horarios.id ${assignment.id} tiene un rango temporal inválido.`)
  }
}

/** Resolves a versioned assignment; lack of an applicable assignment is the only UNSCHEDULED case. */
export class ScheduleResolver {
  public static resolve(input: ScheduleResolutionInput): ScheduleResolution {
    if (!isIsoDate(input.candidateDate)) throw new ShiftConfigurationError(`candidateDate inválido: "${input.candidateDate}"`)

    const employeeAssignments = input.assignments.filter((assignment) => assignment.empleado_id === input.empleadoId && assignment.activo)
    for (const assignment of employeeAssignments) {
      if (assignment.cliente_id !== input.clienteId) throw new TenantMismatchError(input.clienteId, assignment.cliente_id)
      assertAssignmentRange(assignment)
    }

    const applicable = employeeAssignments.filter((assignment) => isInRange(assignment, input.candidateDate))
    if (applicable.length === 0) return { kind: 'UNSCHEDULED', candidateDate: input.candidateDate }
    if (applicable.length !== 1) throw new AmbiguousScheduleError(input.clienteId, input.empleadoId, input.candidateDate)

    const assignment = applicable[0]
    if (!assignment.schedule_revision_id) {
      throw new AttendanceError(`La asignación vigente ${assignment.id} no tiene schedule_revision_id.`, 'SCHEDULE_REVISION_REQUIRED')
    }
    const matchingRevisions = input.revisions.filter((candidate) => candidate.id === assignment.schedule_revision_id)
    if (matchingRevisions.length === 0) {
      throw new AttendanceError(`No existe schedule_revisions.id ${assignment.schedule_revision_id}.`, 'SCHEDULE_REVISION_NOT_FOUND')
    }
    // A primary-key violation cannot be repaired by choosing an arbitrary row
    // from a malformed repository response. This is deliberately separate
    // from UNSCHEDULED: the assignment did exist and is corrupt.
    if (matchingRevisions.length !== 1) {
      throw new AttendanceError(`schedule_revisions.id ${assignment.schedule_revision_id} fue devuelto más de una vez.`, 'SCHEDULE_REVISION_AMBIGUOUS')
    }
    const revision = matchingRevisions[0]

    const snapshot = validateScheduleRevision(revision, assignment.cliente_id, assignment.horario_id)
    const shift = revisionDayToShift(revision, snapshot, input.candidateDate, dayKeyFor(input.candidateDate))
    if (!shift) return { kind: 'UNSCHEDULED', candidateDate: input.candidateDate }

    return {
      kind: 'SCHEDULED',
      candidateDate: input.candidateDate,
      scheduleAssignmentId: assignment.id,
      scheduleId: assignment.horario_id,
      scheduleRevisionId: revision.id,
      scheduleRevisionVersion: revision.version,
      scheduleRevisionHash: revision.integrity_hash,
      shift,
    }
  }
}
