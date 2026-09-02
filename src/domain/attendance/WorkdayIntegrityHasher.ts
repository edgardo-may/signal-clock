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
 *
 * HARDENING Phase 1 — ATT-007:
 * El fallback SHA-256 puro en JS ahora codifica el input a bytes UTF-8 antes de procesar,
 * lo que permite manejar correctamente caracteres Unicode (José, Muñoz, Mérida, México, etc.).
 */

// Implementación portable SHA-256 que funciona tanto en Node.js como en navegadores y Workers
function sha256Sync(str: string): string {
  // Intentar usar node:crypto si está disponible en entorno Node
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // @ts-ignore
    const nodeCrypto = typeof require !== 'undefined' ? require('crypto') : null
    if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
      return nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex')
    }
  } catch {
    // Fallback a implementación pura en JS con soporte UTF-8
  }

  return pureJsSha256Utf8(str)
}

/**
 * Implementación pura en JavaScript de SHA-256 (FIPS 180-4) con soporte UTF-8 completo.
 *
 * ATT-007: El string de entrada se codifica a bytes UTF-8 antes de procesar.
 * Esto garantiza que caracteres como é, ñ, ü, emojis, etc., produzcan el mismo hash
 * que cualquier implementación estándar de SHA-256.
 *
 * Compatible con cualquier string Unicode, sin dependencias externas.
 */
function pureJsSha256Utf8(str: string): string {
  const bytes = encodeUtf8ToBytes(str)
  return pureJsSha256Bytes(bytes)
}

/** Convierte un string Unicode a un array de bytes UTF-8 */
function encodeUtf8ToBytes(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    // Manejar pares sustitutos (emojis y otros caracteres > U+FFFF)
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      const hi = code
      const lo = str.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        code = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
        i++
      }
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6))
      bytes.push(0x80 | (code & 0x3F))
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12))
      bytes.push(0x80 | ((code >> 6) & 0x3F))
      bytes.push(0x80 | (code & 0x3F))
    } else {
      bytes.push(0xF0 | (code >> 18))
      bytes.push(0x80 | ((code >> 12) & 0x3F))
      bytes.push(0x80 | ((code >> 6) & 0x3F))
      bytes.push(0x80 | (code & 0x3F))
    }
  }
  return bytes
}

/** SHA-256 sobre un array de bytes (FIPS 180-4) */
function pureJsSha256Bytes(bytes: number[]): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount))
  }

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

  // Longitud del mensaje en bits
  const bitLen = bytes.length * 8

  // Pre-procesamiento: padding
  bytes.push(0x80)
  while ((bytes.length % 64) !== 56) bytes.push(0x00)
  // Añadir longitud en big-endian (64 bits)
  bytes.push(0, 0, 0, 0) // bits [63:32] de la longitud (0 para inputs < 512MB)
  bytes.push((bitLen >>> 24) & 0xFF)
  bytes.push((bitLen >>> 16) & 0xFF)
  bytes.push((bitLen >>> 8) & 0xFF)
  bytes.push(bitLen & 0xFF)

  // Procesar bloques de 512 bits (64 bytes)
  for (let blockStart = 0; blockStart < bytes.length; blockStart += 64) {
    const w: number[] = new Array(64)

    // Preparar el bloque de mensajes W[0..15]
    for (let i = 0; i < 16; i++) {
      w[i] = (
        (bytes[blockStart + i * 4] << 24) |
        (bytes[blockStart + i * 4 + 1] << 16) |
        (bytes[blockStart + i * 4 + 2] << 8) |
        bytes[blockStart + i * 4 + 3]
      ) >>> 0
    }

    // Extender W[16..63]
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    // Inicializar variables de trabajo
    let [a, b, c, d, e, f, g, h] = hash

    // Compresión principal
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + k[i] + w[i]) >>> 0
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0

      h = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  // Producir el digest hexadecimal
  return hash.map(v => v.toString(16).padStart(8, '0')).join('')
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
   *
   * Propiedades del hash:
   * - Determinista: Mismo input → mismo hash, siempre.
   * - Canónico: sourceLogIds e incidentCodes se ordenan antes de hashear.
   * - Unicode-safe (ATT-007): Soporta caracteres de nombres de festivos en cualquier idioma.
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
