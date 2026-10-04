// src/shared/utils/dateUtils.js
// ─────────────────────────────────────────────────────────────────────────────
//  Utilidades de fecha con zona horaria America/Cancun (UTC-5, sin DST)
//  Usar SIEMPRE estas funciones para "hoy" y rangos de día en el frontend.
// ─────────────────────────────────────────────────────────────────────────────

export const TZ = 'America/Cancun'

/**
 * Devuelve la fecha de hoy en Cancún como string 'YYYY-MM-DD'.
 * Ejemplo: "2026-09-19"
 */
export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/**
 * Dado un string 'YYYY-MM-DD', devuelve el ISO de inicio de ese día en Cancún
 * (medianoche Cancún = 05:00 UTC).
 * Ejemplo: "2026-09-19" → "2026-09-19T05:00:00.000Z"
 */
export function startOfDayCancun(dateStr) {
  // Creamos la fecha como si fuera medianoche Cancún
  // Cancún = UTC-5, así que +05:00 shift
  return new Date(`${dateStr}T00:00:00-05:00`).toISOString()
}

/**
 * Dado un string 'YYYY-MM-DD', devuelve el ISO del fin de ese día en Cancún
 * (23:59:59.999 Cancún = 04:59:59.999 UTC del día siguiente).
 * Ejemplo: "2026-09-19" → "2026-09-20T04:59:59.999Z"
 */
export function endOfDayCancun(dateStr) {
  return new Date(`${dateStr}T23:59:59.999-05:00`).toISOString()
}

/**
 * Formatea un timestamp ISO a texto legible en hora Cancún.
 * Ejemplo: "2026-09-19T18:04:52Z" → "19/09/2026 13:04"
 */
export function formatDateTimeCancun(isoStr) {
  if (!isoStr) return '—'
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ,
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoStr))
}

/**
 * Devuelve 'YYYY-MM-DD' de un ISO en zona Cancún.
 * Ejemplo: "2026-09-19T23:00:00Z" → "2026-09-19"
 */
export function toDateStrCancun(isoStr) {
  if (!isoStr) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(isoStr))
}
