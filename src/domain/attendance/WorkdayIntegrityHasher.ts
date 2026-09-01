/**
 * WorkdayIntegrityHasher.ts
 * Genera un hash SHA-256 determinista del estado calculado de la jornada para:
 * - Control de integridad y detección de manipulaciones.
 * - Identificación unívoca de snapshots de versión.
 * - Soporte para auditoría STPS.
 *
 * NOTA DE DISEÑO:
 * Este hash es un control técnico de integridad de datos. NO constituye una firma electrónica
 * avanzada ni sustituye la validez jurídica de políticas o contratos patronales.
 */

// Implementación portable SHA-256 que funciona tanto en Node.js como en navegadores y Workers
function sha256Sync(str: string): string {
  // Intentar usar node:crypto si está disponible en entorno Node
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = typeof require !== 'undefined' ? require('crypto') : null
    if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
      return nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex')
    }
  } catch {
    // Fallback a implementación pura en JS
  }

  return pureJsSha256(str)
}

/**
 * Implementación pura en JavaScript de SHA-256 (FIPS 180-4) para compatibilidad universal sin dependencias externas.
 */
function pureJsSha256(ascii: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount))
  }

  const mathPow = Math.pow
  const maxWord = mathPow(2, 32)
  let lengthProperty = 'length'
  let i = 0, j = 0
  let result = ''

  const words: number[] = []
  const asciiBitLength = ascii[lengthProperty as any] * 8

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  let isCandidate: number
  const isPrime: Record<number, boolean> = {}

  let primeCounter = 0
  for (let candidate = 2; primeCounter < 64; candidate++) {
    isCandidate = 1
    for (let factor = 2; factor * factor <= candidate; factor++) {
      if (candidate % factor === 0) {
        isCandidate = 0
        break
      }
    }
    if (isCandidate) {
      if (primeCounter < 8) {
        hash[primeCounter] = (mathPow(candidate, 1 / 2) * maxWord) | 0
      }
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0
      primeCounter++
    }
  }

  ascii += '\x80'
  while ((ascii[lengthProperty as any] % 64) - 56) ascii += '\x00'
  for (i = 0; i < ascii[lengthProperty as any]; i++) {
    j = ascii.charCodeAt(i)
    if (j >> 8) return '' // Carácter no válido
    words[i >> 2] |= j << (((3 - i) % 4) * 8)
  }
  words[words[lengthProperty as any]] = (asciiBitLength / maxWord) | 0
  words[words[lengthProperty as any]] = asciiBitLength

  const w = new Array(64)
  for (j = 0; j < words[lengthProperty as any]; ) {
    const wOld = words.slice(j, (j += 16))
    const hd = hash.slice(0)

    for (i = 0; i < 64; i++) {
      const i2 = i + j
      const w15 = w[i - 15],
        w2 = w[i - 2]

      const a = hash[0],
        e = hash[4]
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? wOld[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0)

      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))

      hash = [(temp1 + temp2) | 0, a, hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]]
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + hd[i]) | 0
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255
      result += (b < 16 ? '0' : '') + b.toString(16)
    }
  }

  return result
}

export interface CanonicalWorkdayPayload {
  clienteId: string
  empleadoId: string
  operativeDate: string
  timezone: string
  scheduleId?: string
  scheduledStart?: string
  scheduledEnd?: string
  actualStart?: string
  actualEnd?: string
  workedMinutes: number
  breakMinutes: number
  effectiveMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  ordinaryMinutes: number
  overtimeMinutes: number
  status: string
  sourceLogIds: string[]
  incidentCodes: string[]
  calculationVersion: number
}

export class WorkdayIntegrityHasher {
  /**
   * Genera el hash de integridad SHA-256 a partir de los datos canónicos de la jornada.
   */
  public static computeHash(payload: CanonicalWorkdayPayload): string {
    const canonicalObject = {
      clienteId: payload.clienteId,
      empleadoId: payload.empleadoId,
      operativeDate: payload.operativeDate,
      timezone: payload.timezone,
      scheduleId: payload.scheduleId || '',
      scheduledStart: payload.scheduledStart || '',
      scheduledEnd: payload.scheduledEnd || '',
      actualStart: payload.actualStart || '',
      actualEnd: payload.actualEnd || '',
      workedMinutes: payload.workedMinutes,
      breakMinutes: payload.breakMinutes,
      effectiveMinutes: payload.effectiveMinutes,
      lateMinutes: payload.lateMinutes,
      earlyLeaveMinutes: payload.earlyLeaveMinutes,
      ordinaryMinutes: payload.ordinaryMinutes,
      overtimeMinutes: payload.overtimeMinutes,
      status: payload.status,
      sourceLogIds: [...payload.sourceLogIds].sort(),
      incidentCodes: [...payload.incidentCodes].sort(),
      calculationVersion: payload.calculationVersion,
    }

    const canonicalJson = JSON.stringify(canonicalObject)
    return sha256Sync(canonicalJson)
  }
}
