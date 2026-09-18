/**
 * Pure mapping to the installed public.workday_records baseline.
 *
 * This is a contract adapter, not a persistence service. It does not access a
 * database and is intentionally not connected to a runtime writer in Phase 26.
 */

import type { WorkdayCalculationResult, WorkdayState } from '../AttendanceTypes.ts'
import { AttendanceError } from '../AttendanceErrors.ts'

export interface WorkdayLogicalIdentity {
  cliente_id: string
  empleado_id: string
  workday_date: string
}

export interface WorkdayRecordWriteModel extends WorkdayLogicalIdentity {
  /** Source registro used by the V3 persistence boundary. */
  registro_id?: string
  calculation_version: number
  schedule_id: string | null
  timezone: string
  first_in: string | null
  last_out: string | null
  worked_minutes: number
  break_minutes: number
  overtime_minutes: number
  late_minutes: number
  early_leave_minutes: number
  status: WorkdayState
  integrity_hash: string | null
}

const WORKDAY_STATES = new Set<WorkdayState>([
  'COMPLETE',
  'INCOMPLETE',
  'ABSENT',
  'UNSCHEDULED',
  'INVALID',
])

function assertNonBlank(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new AttendanceError(`El campo ${field} es obligatorio para workday_records.`, 'WORKDAY_CONTRACT_ERROR')
  }
}

/**
 * The logical identity deliberately excludes schedule_id. A corrected schedule
 * during a valid reprocess updates the same employee workday rather than adding
 * a second row.
 */
export function workdayLogicalIdentity(result: Pick<WorkdayCalculationResult, 'clienteId' | 'empleadoId' | 'operativeDate'>): WorkdayLogicalIdentity {
  assertNonBlank(result.clienteId, 'cliente_id')
  assertNonBlank(result.empleadoId, 'empleado_id')
  assertNonBlank(result.operativeDate, 'workday_date')

  return {
    cliente_id: result.clienteId,
    empleado_id: result.empleadoId,
    workday_date: result.operativeDate,
  }
}

/** Maps workdayState—not deprecated WorkdayStatus—to the installed DB status. */
export function toWorkdayRecordWriteModel(
  result: WorkdayCalculationResult,
  scheduleId: string | null,
  registroId?: string
): WorkdayRecordWriteModel {
  const identity = workdayLogicalIdentity(result)
  assertNonBlank(result.timezone, 'timezone')
  if (!WORKDAY_STATES.has(result.workdayState)) {
    throw new AttendanceError(`WorkdayState no permitido: ${String(result.workdayState)}`, 'WORKDAY_STATE_INVALID')
  }

  return {
    ...identity,
    ...(registroId ? { registro_id: registroId } : {}),
    calculation_version: result.calculationVersion,
    schedule_id: scheduleId,
    timezone: result.timezone,
    first_in: result.actualStart ?? null,
    last_out: result.actualEnd ?? null,
    worked_minutes: result.workedMinutes,
    break_minutes: result.breakMinutes,
    overtime_minutes: result.overtimeMinutes,
    late_minutes: result.lateMinutes,
    early_leave_minutes: result.earlyLeaveMinutes,
    status: result.workdayState,
    integrity_hash: result.integrityHash || null,
  }
}
