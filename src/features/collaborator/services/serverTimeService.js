// src/features/collaborator/services/serverTimeService.js
// Servicio de Sincronización de Hora del Servidor Anti-Manipulación y Resolución de Zona Horaria por Ubicación

let serverOffsetMs = 0
let isSynchronized = false
let syncPromise = null
let lastSyncTimestamp = 0

/**
 * Resuelve la zona horaria en base a la ubicación real del usuario / dispositivo (GPS, navegador o empresa).
 * Si el usuario o dispositivo se encuentra en Cancún / Quintana Roo (o por coordenadas GPS),
 * asigna 'America/Cancun' (UTC-5 sin horario de verano).
 */
export function resolveLocationTimezone(options = {}) {
  const { coords, tenantState, tenantCity, fallback } = options

  // 1. Detección por coordenadas GPS exactas (latitud / longitud)
  if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
    const lat = coords.latitude
    const lon = coords.longitude

    // Región Quintana Roo / Cancún / Riviera Maya (Aprox Lat 17.8 - 21.8, Lon -89.4 - -86.5)
    if (lat >= 17.8 && lat <= 21.8 && lon >= -89.4 && lon <= -86.5) {
      return 'America/Cancun'
    }

    // Baja California (Tijuana, Mexicali, Ensenada)
    if (lat >= 28.0 && lat <= 32.8 && lon >= -117.5 && lon <= -112.5) {
      return 'America/Tijuana'
    }

    // Sonora (Hermosillo, Cd. Obregón, Nogales)
    if (lat >= 26.0 && lat <= 32.5 && lon >= -115.0 && lon <= -108.5) {
      return 'America/Hermosillo'
    }

    // Baja California Sur, Sinaloa, Nayarit
    if (lat >= 21.5 && lat <= 28.5 && lon >= -114.5 && lon <= -105.0) {
      return 'America/Mazatlan'
    }

    // Centro / Noreste / Sur de México
    if (lat >= 14.5 && lat <= 32.8 && lon >= -118.0 && lon <= -86.0) {
      return 'America/Mexico_City'
    }
  }

  // 2. Detección por Estado o Ciudad de la Empresa si está registrado
  const locStr = `${tenantState || ''} ${tenantCity || ''}`.toLowerCase()
  if (
    locStr.includes('quintana roo') ||
    locStr.includes('cancun') ||
    locStr.includes('cancún') ||
    locStr.includes('playa del carmen') ||
    locStr.includes('tulum') ||
    locStr.includes('cozumel') ||
    locStr.includes('chetumal') ||
    locStr.includes('coba') ||
    locStr.includes('cobá') ||
    locStr.includes('isla mujeres')
  ) {
    return 'America/Cancun'
  }

  // 3. Detección por zona horaria nativa del sistema / navegador del usuario
  try {
    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (systemTz && typeof systemTz === 'string' && systemTz.length > 2) {
      return systemTz
    }
  } catch (_) {}

  // 4. Fallback: Si no hay detección previa, usar fallback o 'America/Cancun'
  return fallback || 'America/Cancun'
}

/**
 * Obtiene la hora autoritativa del servidor Supabase / Postgres.
 * Mide el tiempo de ida y vuelta (RTT) para máxima precisión.
 */
export async function syncServerTime() {
  const t0 = performance.now()

  try {
    const sUrl = import.meta.env.VITE_SUPABASE_URL
    const sKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

    if (sUrl && sKey) {
      const res = await fetch(`${sUrl}/rest/v1/clientes?select=id&limit=1`, {
        method: 'HEAD',
        headers: {
          apikey: sKey,
          Authorization: `Bearer ${sKey}`,
        },
        cache: 'no-store',
      })

      const t1 = performance.now()
      const rtt = (t1 - t0) / 2
      const serverDateHeader = res.headers.get('date')

      if (serverDateHeader) {
        const serverDateMs = new Date(serverDateHeader).getTime()
        serverOffsetMs = (serverDateMs + rtt) - t1
        isSynchronized = true
        lastSyncTimestamp = Date.now()
        return getServerNow()
      }
    }
  } catch (_) {}

  serverOffsetMs = 0
  isSynchronized = false
  return new Date()
}

/**
 * Asegura que la hora del servidor esté sincronizada al menos una vez cada 10 minutos.
 */
export async function ensureServerTimeSync() {
  if (isSynchronized && Date.now() - lastSyncTimestamp < 10 * 60 * 1000) {
    return
  }
  if (!syncPromise) {
    syncPromise = syncServerTime().finally(() => {
      syncPromise = null
    })
  }
  return syncPromise
}

/**
 * Retorna la hora actual del servidor calculada mediante el reloj monotónico performance.now().
 * Si el usuario cambia la hora de su celular o PC, este valor NO se altera.
 */
export function getServerNow() {
  if (!isSynchronized) {
    return new Date()
  }
  const nowMs = performance.now() + serverOffsetMs
  return new Date(nowMs)
}

/**
 * Detecta si el reloj del dispositivo del usuario está desfasado o manipulado.
 * Retorna la diferencia en segundos (positivo = reloj del dispositivo adelantado).
 */
export function getDeviceClockDriftSeconds() {
  if (!isSynchronized) return 0
  const serverNow = getServerNow()
  const localNow = new Date()
  return Math.round((localNow.getTime() - serverNow.getTime()) / 1000)
}

/**
 * Formatea una fecha en la zona horaria resuelta por ubicación (ej: 'America/Cancun').
 */
export function formatInTenantTimezone(dateInput, timezone, options = {}) {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number'
    ? new Date(dateInput)
    : (dateInput || getServerNow())

  const safeTz = timezone || resolveLocationTimezone()

  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: safeTz,
      ...options,
    }).format(date)
  } catch (_) {
    try {
      return new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Cancun',
        ...options,
      }).format(date)
    } catch {
      return new Intl.DateTimeFormat('es-MX', options).format(date)
    }
  }
}
