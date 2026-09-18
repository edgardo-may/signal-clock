/**
 * Read-only comparison helpers for the temporary revision-resolver shadow.
 *
 * This adapter is intentionally not imported by ScheduleResolver or by the
 * engine. `horarios` is observable here only so a diagnostic can compare the
 * old representation with an already-resolved immutable revision. It must
 * never be used as a resolver fallback.
 */

import type { ShiftWindowConfig } from '../AttendanceTypes.ts'
import type { ScheduleDayKey } from './ScheduleRevisionAdapter.ts'
import type { ScheduleResolution } from './ScheduleResolver.ts'

export interface LegacyLiveScheduleShadowRecord {
  id: string
  nombre?: string | null
  activo: boolean
  dias_config: Record<string, {
    activo?: boolean
    entrada?: string | null
    salida?: string | null
    descanso_inicio?: string | null
    descanso_fin?: string | null
  }> | null
  tolerancia_minutos: number | null
}

function dayKeyFor(candidateDate: string): ScheduleDayKey {
  const day = new Date(`${candidateDate}T00:00:00.000Z`).getUTCDay()
  return ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][day] as ScheduleDayKey
}

function isClock(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function durationMinutes(start: string, end: string): number {
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  const result = endHour * 60 + endMinute - (startHour * 60 + startMinute)
  return result >= 0 ? result : result + 24 * 60
}

/** Maps the legacy parent schedule solely for a shadow observation. */
export function legacyLiveScheduleToShadowShift(
  schedule: LegacyLiveScheduleShadowRecord,
  candidateDate: string,
): ShiftWindowConfig | null {
  if (!schedule.activo) return null
  const day = schedule.dias_config?.[dayKeyFor(candidateDate)]
  if (!day?.activo) return null
  const toleranceMinutes = schedule.tolerancia_minutos
  if (!isClock(day.entrada) || !isClock(day.salida) || !Number.isInteger(toleranceMinutes) || toleranceMinutes === null || toleranceMinutes < 0) {
    throw new Error('LEGACY_SCHEDULE_SHADOW_INVALID')
  }
  const hasBreakStart = day.descanso_inicio !== null && day.descanso_inicio !== undefined && day.descanso_inicio !== ''
  const hasBreakEnd = day.descanso_fin !== null && day.descanso_fin !== undefined && day.descanso_fin !== ''
  if (hasBreakStart !== hasBreakEnd || (hasBreakStart && (!isClock(day.descanso_inicio) || !isClock(day.descanso_fin)))) {
    throw new Error('LEGACY_SCHEDULE_SHADOW_INVALID')
  }
  const hasBreak = hasBreakStart && hasBreakEnd
  return {
    id: schedule.id,
    name: schedule.nombre || 'legacy-live-schedule',
    operativeDate: candidateDate,
    startTime: day.entrada,
    endTime: day.salida,
    toleranceMinutes,
    hasBreak,
    breakConfig: hasBreak ? {
      startTime: day.descanso_inicio as string,
      endTime: day.descanso_fin as string,
      durationMinutes: durationMinutes(day.descanso_inicio as string, day.descanso_fin as string),
    } : undefined,
    scheduledBreakMinutes: hasBreak ? durationMinutes(day.descanso_inicio as string, day.descanso_fin as string) : 0,
  }
}

function shiftSemantics(shift: ShiftWindowConfig | null): Record<string, unknown> | null {
  if (!shift) return null
  return {
    operativeDate: shift.operativeDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    toleranceMinutes: shift.toleranceMinutes ?? 10,
    hasBreak: Boolean(shift.hasBreak),
    breakStart: shift.breakConfig?.startTime ?? null,
    breakEnd: shift.breakConfig?.endTime ?? null,
    scheduledBreakMinutes: shift.scheduledBreakMinutes ?? 0,
  }
}

/** Returns comparison evidence; it neither catches resolver errors nor falls back. */
export function compareRevisionResolutionToLegacyShadow(
  revisionResolution: ScheduleResolution,
  legacyShift: ShiftWindowConfig | null,
): {
  equal: boolean
  revision: Record<string, unknown> | null
  legacy: Record<string, unknown> | null
} {
  const revision = revisionResolution.kind === 'SCHEDULED' ? shiftSemantics(revisionResolution.shift) : null
  const legacy = shiftSemantics(legacyShift)
  return { equal: JSON.stringify(revision) === JSON.stringify(legacy), revision, legacy }
}
