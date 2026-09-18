/**
 * Boundary adapter for the live public.registro_asistencia contract.
 *
 * This module is deliberately pure: it does not query Supabase or choose a
 * schedule. The caller must provide the device row already retrieved with
 * (devices.id, devices.cliente_id) constrained to the attendance tenant.
 */

import type { PunchSource, RawAttendancePunch } from '../AttendanceTypes.ts'
import { AttendanceError, InvalidPunchError, TenantMismatchError } from '../AttendanceErrors.ts'
import { getLocalComponents } from '../timezoneUtils.ts'

export interface RegistroAsistenciaRecord {
  id: string
  cliente_id: string
  empleado_id: string
  dispositivo_id: string | null
  verificado_at: string | Date
  tipo_verificacion: string | number | null
  metodo: string | null
  source_event_id: string | null
  raw_payload: unknown
  es_manual: boolean
}

export interface AttendanceDeviceRecord {
  id: string
  cliente_id: string
  timezone: string | null
}

export interface RegistroAttendanceDomainEvent {
  /** registro_asistencia.id: identity of the event used by the domain. */
  eventId: string
  /** attendance_source_events reference, when the event was sourced from one. */
  sourceEventId: string | null
  clienteId: string
  empleadoId: string
  deviceId: string
  timezone: string
  /** Local calendar date of this individual event. It is NOT its workday date. */
  localEventDate: string
  verificationMethod: string | null
  isManual: boolean
  /** Opaque trace data only; never use it for tenant, employee, device, or schedule lookups. */
  rawPayload: unknown
  rawPunch: RawAttendancePunch
}

export class UnsupportedSourceTimezoneError extends AttendanceError {
  constructor() {
    super(
      'No se puede resolver una zona horaria autoritativa sin dispositivo para este registro.',
      'UNSUPPORTED_SOURCE_TIMEZONE'
    )
    this.name = 'UnsupportedSourceTimezoneError'
  }
}

export class DeviceResolutionError extends AttendanceError {
  constructor(message: string, code: string = 'DEVICE_RESOLUTION_ERROR') {
    super(message, code)
    this.name = 'DeviceResolutionError'
  }
}

function requireNonBlank(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new InvalidPunchError(`registro_asistencia.${field} es obligatorio para adaptar el evento.`)
  }
}

function sourceFor(record: RegistroAsistenciaRecord): PunchSource {
  // `metodo` is a verification method, not a trusted origin classification.
  // A physical device maps to ADMS until a source-specific adapter says otherwise.
  return record.es_manual ? 'MANUAL' : 'ADMS'
}

/**
 * Converts one live registro_asistencia row to the database-neutral domain input.
 *
 * An event with dispositivo_id = NULL is intentionally rejected. A Web/App source
 * must obtain its own explicit timezone contract before it can enter this adapter.
 */
export class RegistroAttendanceAdapter {
  public static fromRegistro(
    record: RegistroAsistenciaRecord,
    device: AttendanceDeviceRecord | null | undefined
  ): RegistroAttendanceDomainEvent {
    requireNonBlank(record.id, 'id')
    requireNonBlank(record.cliente_id, 'cliente_id')
    requireNonBlank(record.empleado_id, 'empleado_id')

    if (!record.dispositivo_id) {
      throw new UnsupportedSourceTimezoneError()
    }

    if (!device || device.id !== record.dispositivo_id) {
      throw new DeviceResolutionError(
        'No existe un device coincidente para registro_asistencia.dispositivo_id.',
        'DEVICE_NOT_FOUND'
      )
    }

    if (device.cliente_id !== record.cliente_id) {
      throw new TenantMismatchError(record.cliente_id, device.cliente_id)
    }

    const timezone = device.timezone?.trim()
    if (!timezone) {
      throw new DeviceResolutionError(
        'El device físico no tiene una zona horaria configurada.',
        'DEVICE_TIMEZONE_MISSING'
      )
    }

    const localEventDate = getLocalComponents(record.verificado_at, timezone).localDate

    return {
      eventId: record.id,
      sourceEventId: record.source_event_id,
      clienteId: record.cliente_id,
      empleadoId: record.empleado_id,
      deviceId: record.dispositivo_id,
      timezone,
      localEventDate,
      verificationMethod: record.metodo,
      isManual: record.es_manual,
      rawPayload: record.raw_payload,
      rawPunch: {
        id: record.id,
        clienteId: record.cliente_id,
        empleadoId: record.empleado_id,
        timestamp: record.verificado_at,
        source: sourceFor(record),
        inOutState: record.tipo_verificacion ?? undefined,
      },
    }
  }
}
