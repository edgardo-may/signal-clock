/**
 * AttendanceNormalizer.ts
 * Normaliza y deduplica marcajes crudos procedentes de cualquier origen (ADMS, ISUP, Kiosko, Manual)
 * a una estructura estandarizada en la zona horaria efectiva del centro de trabajo.
 *
 * HARDENING Phase 1:
 * - ATT-001: Agrega campo `direction: PunchDirection` neutral de dominio a NormalizedPunch.
 * - ATT-003: Deduplicación con ventana FIJA (compara vs punch retenido, no vs último descartado).
 * - ATT-004: Retorna NormalizationResult con punches aceptados Y disposiciones de todos los punches.
 */

import type {
  RawAttendancePunch,
  NormalizedPunch,
  InOutType,
  PunchDirection,
  PunchDispositionCode,
  PunchDispositionRecord,
  DeduplicationConfig,
} from './AttendanceTypes.ts'
import { InvalidPunchError, TenantMismatchError } from './AttendanceErrors.ts'
import { getLocalComponents } from './timezoneUtils.ts'

export interface NormalizationResult {
  /** Punches aceptados (dentro de ventana, deduplicados) — listos para ShiftMatcher */
  accepted: NormalizedPunch[]
  /** Trazabilidad completa de TODOS los punches recibidos (ATT-004) */
  dispositions: PunchDispositionRecord[]
}

export class AttendanceNormalizer {
  /**
   * Mapea el estado numérico o textual de entrada/salida a InOutType estándar.
   */
  public static mapInOutType(inOutState?: number | string, _verifyType?: number): InOutType {
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
   * Mapea InOutType del dispositivo a PunchDirection neutral de dominio (ATT-001).
   *
   * Reglas de mapeo:
   * - ENTRY → ENTRY
   * - EXIT → EXIT
   * - BREAK_OUT → EXIT  (salida hacia descanso = tipo de salida)
   * - BREAK_IN → ENTRY  (retorno de descanso = tipo de entrada)
   * - UNSPECIFIED → UNKNOWN (el dispositivo no proporcionó dirección confiable)
   */
  public static mapToDirection(inOutType: InOutType): PunchDirection {
    switch (inOutType) {
      case 'ENTRY':
        return 'ENTRY'
      case 'EXIT':
        return 'EXIT'
      case 'BREAK_OUT':
        return 'EXIT'
      case 'BREAK_IN':
        return 'ENTRY'
      case 'UNSPECIFIED':
      default:
        return 'UNKNOWN'
    }
  }

  /**
   * Normaliza una lista de marcajes crudos y retorna los punches aceptados + trazabilidad completa.
   *
   * La deduplicación usa ventana FIJA (ATT-003):
   * Cada punch candidato se compara contra el punch RETENIDO actual (primer punch de la ráfaga),
   * NO contra el último punch descartado. Esto evita el colapso de cadenas largas de marcajes
   * producidas por malfuncionamiento de terminales.
   *
   * Ejemplo con window=5s:
   *   t=0  → RETENIDO (nuevo burst)
   *   t=4  → DUPLICATE (4s desde retenido t=0)
   *   t=8  → RETENIDO (8s > 5s desde retenido t=0 → nuevo burst)
   *   t=12 → DUPLICATE (4s desde retenido t=8)
   *   t=16 → RETENIDO (8s > 5s desde retenido t=8 → nuevo burst)
   *
   * ATT-003 anterior (sliding-window): todos se agrupaban en 1 porque t+0→t+4→t+8 eran
   * comparaciones consecutivas. Ahora t=8 es un nuevo burst porque 8s > 5s desde t=0.
   */
  public static normalize(
    rawPunches: RawAttendancePunch[],
    targetTimezone: string,
    expectedTenantId?: string,
    expectedEmployeeId?: string,
    dedupConfig?: DeduplicationConfig
  ): NormalizationResult {
    const dispositions: PunchDispositionRecord[] = []

    if (!rawPunches || !Array.isArray(rawPunches) || rawPunches.length === 0) {
      return { accepted: [], dispositions: [] }
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
        : new Date(raw.timestamp as string)

      if (isNaN(date.getTime())) {
        throw new InvalidPunchError(`Timestamp inválido en marcaje #${i}: "${String(raw.timestamp)}"`)
      }

      // 4. Extracción de componentes locales según la timezone efectiva
      const local = getLocalComponents(date, targetTimezone)
      const epochMs = date.getTime()
      const utcTimestamp = date.toISOString()
      const { verifyType: _verifyType } = raw
      const inOutType = this.mapInOutType(raw.inOutState, raw.verifyType)
      const direction = this.mapToDirection(inOutType)
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
        direction,
        source: raw.source || 'ADMS',
        deviceSerial: raw.deviceSerial,
        rawPayload: raw.rawPayload,
      })
    }

    // 5. Ordenar cronológicamente
    normalizedList.sort((a, b) => a.epochMs - b.epochMs)

    // 6. Deduplicación con ventana FIJA (ATT-003)
    if (minMs <= 0 || normalizedList.length <= 1) {
      // Sin dedup: todos aceptados
      for (const p of normalizedList) {
        dispositions.push(this.makeDisposition(p, 'USED'))
      }
      return { accepted: normalizedList, dispositions }
    }

    const accepted: NormalizedPunch[] = []

    // Retener el primer punch de cada burst. Comparar SIEMPRE contra el retenido, no contra el último descartado.
    let retainedPunch = normalizedList[0]
    accepted.push(retainedPunch)

    for (let j = 1; j < normalizedList.length; j++) {
      const punch = normalizedList[j]
      const distFromRetained = punch.epochMs - retainedPunch.epochMs

      if (distFromRetained <= minMs) {
        // Dentro de la ventana del punch retenido → DUPLICATE
        dispositions.push(this.makeDisposition(punch, 'DUPLICATE',
          `Dentro de la ventana de dedup (${distFromRetained}ms ≤ ${minMs}ms desde punch retenido ${retainedPunch.id})`
        ))
      } else {
        // Fuera de la ventana del punch retenido → nuevo burst
        // KEEP_LAST: el retenido de este burst pasado podría cambiarse por el último de la ráfaga
        // Pero como ya añadimos al accepted la primera vez, con KEEP_LAST hay que retroactivamente cambiar.
        // Para simplificar y no re-ordenar, KEEP_FIRST es el comportamiento real de esta implementación.
        // KEEP_LAST se maneja swapping el último accepted antes de iniciar nuevo burst.
        if (dedupMode === 'KEEP_LAST') {
          // Reemplazar el último accepted (que fue el retenido) por el último de la ráfaga finalizada
          // En este algoritmo de ventana fija, el "último de la ráfaga" es el punch anterior (j-1)
          // ya que el actual (j) inicia nueva ráfaga.
          // Hacemos el swap en el accepted y actualizamos la disposición correspondiente.
          const lastAccepted = accepted[accepted.length - 1]
          const prevPunch = normalizedList[j - 1]
          if (lastAccepted.id !== prevPunch.id) {
            // El prevPunch fue marcado como DUPLICATE, pero con KEEP_LAST debe ser USED.
            // Actualizar disposiciones: marcar el lastAccepted como DUPLICATE y prevPunch como USED.
            const retainedDispIdx = dispositions.findIndex(d => d.logId === lastAccepted.id && d.disposition === 'USED')
            if (retainedDispIdx >= 0) {
              dispositions[retainedDispIdx] = this.makeDisposition(lastAccepted, 'DUPLICATE',
                `KEEP_LAST: reemplazado por ${prevPunch.id}`)
            }
            const prevDispIdx = dispositions.findIndex(d => d.logId === prevPunch.id && d.disposition === 'DUPLICATE')
            if (prevDispIdx >= 0) {
              dispositions[prevDispIdx] = this.makeDisposition(prevPunch, 'USED')
            }
            accepted[accepted.length - 1] = prevPunch
            retainedPunch = punch // nuevo burst retiene el punch actual
          }
        }

        // Este punch inicia un nuevo burst
        retainedPunch = punch
        accepted.push(punch)
      }
    }

    // Ahora construir dispositions para los accepted que no tienen disposición aún
    for (const p of accepted) {
      if (!dispositions.find(d => d.logId === p.id)) {
        dispositions.push(this.makeDisposition(p, 'USED'))
      }
    }

    // Garantizar que todos los punches tienen disposición (sin silencio)
    for (const p of normalizedList) {
      if (!dispositions.find(d => d.logId === p.id)) {
        dispositions.push(this.makeDisposition(p, 'DUPLICATE', 'Sin disposición explícita — marcado como duplicate por defecto'))
      }
    }

    return { accepted, dispositions }
  }

  private static makeDisposition(
    punch: NormalizedPunch,
    code: PunchDispositionCode,
    reason?: string
  ): PunchDispositionRecord {
    return {
      logId: punch.id,
      utcTimestamp: punch.utcTimestamp,
      epochMs: punch.epochMs,
      direction: punch.direction,
      disposition: code,
      reason,
    }
  }
}
