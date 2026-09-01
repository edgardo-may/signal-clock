/**
 * AttendanceNormalizer.ts
 * Normaliza y deduplica marcajes crudos procedentes de cualquier origen (ADMS, ISUP, Kiosko, Manual)
 * a una estructura estandarizada en la zona horaria efectiva del centro de trabajo.
 */

import type {
  RawAttendancePunch,
  NormalizedPunch,
  InOutType,
  DeduplicationConfig,
} from './AttendanceTypes.ts'
import { InvalidPunchError, TenantMismatchError } from './AttendanceErrors.ts'
import { getLocalComponents } from './timezoneUtils.ts'

export class AttendanceNormalizer {
  /**
   * Mapea el estado numérico o textual de entrada/salida a InOutType estándar.
   */
  public static mapInOutType(inOutState?: number | string, verifyType?: number): InOutType {
    if (inOutState === undefined || inOutState === null) {
      return 'UNSPECIFIED'
    }

    const stateStr = String(inOutState).trim().toLowerCase()

    if (stateStr === '0' || stateStr === 'in' || stateStr === 'entrada') {
      return 'ENTRY'
    }
    if (stateStr === '1' || stateStr === 'out' || stateStr === 'salida') {
      return 'EXIT'
    }
    if (stateStr === '2' || stateStr === 'break_out' || stateStr === 'descanso_inicio' || stateStr === 'comida_salida') {
      return 'BREAK_OUT'
    }
    if (stateStr === '3' || stateStr === 'break_in' || stateStr === 'descanso_fin' || stateStr === 'comida_entrada') {
      return 'BREAK_IN'
    }

    return 'UNSPECIFIED'
  }

  /**
   * Normaliza una lista de marcajes crudos.
   */
  public static normalize(
    rawPunches: RawAttendancePunch[],
    targetTimezone: string,
    expectedTenantId?: string,
    expectedEmployeeId?: string,
    dedupConfig?: DeduplicationConfig
  ): NormalizedPunch[] {
    if (!rawPunches || !Array.isArray(rawPunches) || rawPunches.length === 0) {
      return []
    }

    const minSeconds = dedupConfig?.minSecondsBetweenPunches ?? 60
    const minMs = minSeconds * 1000
    const dedupMode = dedupConfig?.mode ?? 'KEEP_FIRST'

    const normalizedList: NormalizedPunch[] = []

    for (let i = 0; i < rawPunches.length; i++) {
      const raw = rawPunches[i]

      // 1. Validaciones de presencia
      if (!raw.clienteId) {
        throw new InvalidPunchError(`El marcaje #${i} carece de clienteId.`)
      }
      if (!raw.empleadoId) {
        throw new InvalidPunchError(`El marcaje #${i} carece de empleadoId.`)
      }
      if (!raw.timestamp) {
        throw new InvalidPunchError(`El marcaje #${i} carece de timestamp.`)
      }

      // 2. Validación de aislamiento multi-tenant
      if (expectedTenantId && raw.clienteId !== expectedTenantId) {
        throw new TenantMismatchError(expectedTenantId, raw.clienteId)
      }
      if (expectedEmployeeId && raw.empleadoId !== expectedEmployeeId) {
        throw new InvalidPunchError(
          `Violación de identidad: se esperaba empleadoId "${expectedEmployeeId}" pero se recibió "${raw.empleadoId}"`
        )
      }

      // 3. Conversión a Date
      const date = typeof raw.timestamp === 'object' && raw.timestamp instanceof Date
        ? raw.timestamp
        : new Date(raw.timestamp)

      if (isNaN(date.getTime())) {
        throw new InvalidPunchError(`Timestamp inválido en marcaje #${i}: "${String(raw.timestamp)}"`)
      }

      // 4. Extracción de componentes locales según la timezone efectiva
      const local = getLocalComponents(date, targetTimezone)
      const epochMs = date.getTime()
      const utcTimestamp = date.toISOString()

      const inOutType = this.mapInOutType(raw.inOutState, raw.verifyType)
      const id = raw.id || `punch_${raw.clienteId}_${raw.empleadoId}_${epochMs}_${i}`

      normalizedList.push({
        id,
        clienteId: raw.clienteId,
        empleadoId: raw.empleadoId,
        utcTimestamp,
        epochMs,
        localDate: local.localDate,
        localTime: local.localTime,
        localMinutesOfDay: local.localMinutesOfDay,
        inOutType,
        source: raw.source || 'ADMS',
        deviceSerial: raw.deviceSerial,
        rawPayload: raw.rawPayload,
      })
    }

    // 5. Ordenar cronológicamente
    normalizedList.sort((a, b) => a.epochMs - b.epochMs)

    // 6. Deduplicación inteligente
    if (minMs <= 0 || normalizedList.length <= 1) {
      return normalizedList
    }

    const deduplicated: NormalizedPunch[] = []
    let currentBurst: NormalizedPunch[] = [normalizedList[0]]

    for (let j = 1; j < normalizedList.length; j++) {
      const punch = normalizedList[j]
      const prevPunch = currentBurst[currentBurst.length - 1]

      if (punch.epochMs - prevPunch.epochMs <= minMs) {
        currentBurst.push(punch)
      } else {
        deduplicated.push(this.selectFromBurst(currentBurst, dedupMode))
        currentBurst = [punch]
      }
    }

    if (currentBurst.length > 0) {
      deduplicated.push(this.selectFromBurst(currentBurst, dedupMode))
    }

    return deduplicated
  }

  private static selectFromBurst(burst: NormalizedPunch[], mode: 'KEEP_FIRST' | 'KEEP_LAST' | 'DEBOUNCE'): NormalizedPunch {
    if (burst.length === 1) return burst[0]

    // Si dentro de la ráfaga uno tiene tipo explícito y otro UNSPECIFIED, priorizar el explícito
    const explicit = burst.find((p) => p.inOutType !== 'UNSPECIFIED')
    if (explicit) return explicit

    if (mode === 'KEEP_LAST') {
      return burst[burst.length - 1]
    }

    // Default 'KEEP_FIRST' / 'DEBOUNCE'
    return burst[0]
  }
}
