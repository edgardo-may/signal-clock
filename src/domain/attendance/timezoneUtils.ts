/**
 * timezoneUtils.ts
 * Utilidades deterministas de zona horaria independientes de la plataforma/sistema anfitrión.
 */

import { InvalidTimezoneError } from './AttendanceErrors.ts'

/**
 * Valida si una cadena de zona horaria IANA es válida en el entorno JS actual.
 */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Asegura que la zona horaria sea válida o arroja InvalidTimezoneError.
 */
export function assertValidTimezone(timeZone: string): void {
  if (!isValidTimezone(timeZone)) {
    throw new InvalidTimezoneError(timeZone)
  }
}

export interface LocalTimeComponents {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number // 0-59
  second: number // 0-59
  localDate: string // YYYY-MM-DD
  localTime: string // HH:mm:ss
  localMinutesOfDay: number
}

/**
 * Formatea una fecha/timestamp UTC en sus componentes locales para la zona horaria objetivo.
 */
export function getLocalComponents(dateInput: Date | string | number, timeZone: string): LocalTimeComponents {
  assertValidTimezone(timeZone)
  const date = typeof dateInput === 'object' && dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (isNaN(date.getTime())) {
    throw new Error(`Fecha inválida: ${String(dateInput)}`)
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    map[p.type] = p.value
  }

  const year = parseInt(map.year, 10)
  const month = parseInt(map.month, 10)
  const day = parseInt(map.day, 10)
  // Intl hour12:false can return "24" for midnight in some implementations, normalize it
  let hour = parseInt(map.hour, 10)
  if (hour === 24) hour = 0
  const minute = parseInt(map.minute, 10)
  const second = parseInt(map.second, 10)

  const pad = (n: number) => String(n).padStart(2, '0')
  const localDate = `${year}-${pad(month)}-${pad(day)}`
  const localTime = `${pad(hour)}:${pad(minute)}:${pad(second)}`
  const localMinutesOfDay = hour * 60 + minute

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    localDate,
    localTime,
    localMinutesOfDay,
  }
}

/**
 * Convierte una fecha y hora local (YYYY-MM-DD y HH:mm[:ss]) en una zona horaria específica a su equivalente ISO 8601 UTC.
 */
export function localToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  assertValidTimezone(timeZone)

  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const timeParts = timeStr.split(':')
  const targetYear = parseInt(yearStr, 10)
  const targetMonth = parseInt(monthStr, 10)
  const targetDay = parseInt(dayStr, 10)
  const targetHour = parseInt(timeParts[0], 10)
  const targetMinute = parseInt(timeParts[1] || '0', 10)
  const targetSecond = parseInt(timeParts[2] || '0', 10)

  // Estimación inicial asumiendo UTC
  let estimatedUtcEpoch = Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMinute, targetSecond)

  // Iterar para encontrar el offset exacto en la zona horaria destino
  for (let i = 0; i < 3; i++) {
    const comps = getLocalComponents(estimatedUtcEpoch, timeZone)
    const localEpoch = Date.UTC(comps.year, comps.month - 1, comps.day, comps.hour, comps.minute, comps.second)
    const targetLocalEpoch = Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMinute, targetSecond)
    const diff = targetLocalEpoch - localEpoch
    if (diff === 0) break
    estimatedUtcEpoch += diff
  }

  return new Date(estimatedUtcEpoch).toISOString()
}

/**
 * Calcula la diferencia en minutos entre dos fechas/timestamps.
 */
export function diffMinutes(dateA: Date | string | number, dateB: Date | string | number): number {
  const msA = typeof dateA === 'object' && dateA instanceof Date ? dateA.getTime() : new Date(dateA).getTime()
  const msB = typeof dateB === 'object' && dateB instanceof Date ? dateB.getTime() : new Date(dateB).getTime()
  return Math.round((msA - msB) / (1000 * 60))
}
