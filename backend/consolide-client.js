// backend/consolide-client.js
// ─────────────────────────────────────────────────────────────────────────────
//  Cliente HTTP dedicado para la API externa Consolide
//
//  Responsabilidades:
//   - Autenticación (obtener accessToken dinámico)
//   - Caché del token con expiración
//   - Requests a la API externa con headers correctos
//   - Timeout, errores HTTP, errores de red
//
//  SEGURIDAD:
//   - El accessToken NUNCA se expone fuera de este módulo
//   - Las credenciales vienen exclusivamente de variables de entorno
//   - Los errores retornan mensajes genéricos al frontend (sin token)
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

// ── Configuración desde variables de entorno ─────────────────────────────────
const BASE_URL    = (process.env.CONSOLIDE_API_URL || 'https://qa.consolide.com.mx').trim().replace(/\/$/, '')
const AUTH_URL    = `${BASE_URL}/Consolide_ApiIdentity/v2/identity/authentication`
const EMP_URL     = `${BASE_URL}/API_RelojesIncidenciasv2/api/Empleados/PostListEmpleados`
const TIMEOUT_MS  = parseInt(process.env.CONSOLIDE_TIMEOUT_MS || '30000', 10)

// ── Caché del token ───────────────────────────────────────────────────────────
// Se renueva automáticamente 5 minutos antes de expirar (JWT suele ser 60min)
let _cachedToken   = null
let _tokenExpiresAt = 0   // timestamp ms

// ── Error personalizado ───────────────────────────────────────────────────────
class ConsolideApiError extends Error {
  constructor(statusCode, message, retryable = false) {
    super(message)
    this.name        = 'ConsolideApiError'
    this.statusCode  = statusCode
    this.retryable   = retryable
  }
}

// ── Fetch con timeout ─────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ConsolideApiError(408, 'La solicitud al servidor externo agotó el tiempo de espera (timeout)', false)
    }
    throw new ConsolideApiError(503, 'No se pudo conectar con el servidor externo', false)
  } finally {
    clearTimeout(timer)
  }
}

// ── Obtener/renovar token de acceso ──────────────────────────────────────────
async function getAccessToken() {
  // Retornar token en caché si aún es válido (con margen de 5 min)
  const now = Date.now()
  if (_cachedToken && now < _tokenExpiresAt - 5 * 60 * 1000) {
    return _cachedToken
  }

  const username = process.env.CONSOLIDE_USERNAME
  const password = process.env.CONSOLIDE_PASSWORD

  if (!username || !password) {
    throw new ConsolideApiError(500, 'Configuración de API externa incompleta en el servidor')
  }

  console.log(`[SYNC-AUTH] Intentando login en: ${AUTH_URL}`)

  const reqBody = JSON.stringify({ userName: username, password })

  console.log(`[SYNC-AUTH] === DEBUG REQUEST ===`)
  console.log(`[SYNC-AUTH] URL: ${AUTH_URL}`)
  console.log(`[SYNC-AUTH] Method: POST`)
  console.log(`[SYNC-AUTH] Content-Type: application/json`)
  console.log(`[SYNC-AUTH] Body keys: ${Object.keys({ userName: username, password }).join(', ')}`)
  console.log(`[SYNC-AUTH] Username: ${JSON.stringify(username)}`)
  console.log(`[SYNC-AUTH] Password length: ${password ? password.length : 'NULL'}, has#: ${password ? password.includes('#') : false}, first3: ${password ? password.slice(0,3) : 'NULL'}`)

  const response = await fetchWithTimeout(AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    reqBody,
  })

  const rawText = await response.text()
  console.log(`[SYNC-AUTH] Response status: ${response.status}`)
  console.log(`[SYNC-AUTH] Response body (first 300): ${rawText.slice(0, 300)}`)

  if (response.status === 401 || response.status === 403) {
    throw new ConsolideApiError(response.status, 'Credenciales de API externa inválidas')
  }
  if (!response.ok) {
    throw new ConsolideApiError(response.status, `Error de autenticación con API externa: ${response.status}`)
  }

  let body
  try {
    body = JSON.parse(rawText)
  } catch {
    throw new ConsolideApiError(502, 'Respuesta inválida del servidor de autenticación externo')
  }

  if (!body?.esExitosa || !body?.datos?.accessToken) {
    throw new ConsolideApiError(401, body?.mensaje || 'Autenticación externa fallida')
  }

  // Guardar en caché (asumimos 60 min de vida del token JWT)
  _cachedToken    = body.datos.accessToken
  _tokenExpiresAt = now + 60 * 60 * 1000

  return _cachedToken
}

// ── Invalidar caché del token ─────────────────────────────────────────────────
function invalidateToken() {
  _cachedToken    = null
  _tokenExpiresAt = 0
}

// ── Consultar lista de empleados ──────────────────────────────────────────────
/**
 * @param {object} params
 * @param {string|number} params.idEmpresa - IDEmpresa del tenant en Consolide
 * @param {string} params.fechaInicio  - "YYYY-MM-DD"
 * @param {string} params.fechaFin     - "YYYY-MM-DD"
 * @param {string} [params.trabId]     - trab_ID específico, vacío = todos
 * @returns {Promise<ExternalEmployee[]>}
 */
async function fetchEmpleados({ idEmpresa, fechaInicio, fechaFin, trabId = '' }) {
  if (!idEmpresa) {
    throw new ConsolideApiError(400, 'El parámetro idEmpresa es requerido para consultar la API')
  }

  const empresaId = parseInt(idEmpresa, 10)
  let token

  try {
    token = await getAccessToken()
  } catch (err) {
    throw err
  }

  // Primer intento
  let response = await _doFetchEmpleados(token, empresaId, fechaInicio, fechaFin, trabId)

  // Si 401 → renovar token y reintentar una vez
  if (response.status === 401) {
    invalidateToken()
    token    = await getAccessToken()
    response = await _doFetchEmpleados(token, empresaId, fechaInicio, fechaFin, trabId)
  }

  if (response.status === 429) {
    throw new ConsolideApiError(429, 'La API externa está temporalmente saturada. Intenta en unos minutos.', true)
  }
  if (response.status === 403) {
    throw new ConsolideApiError(403, 'Acceso denegado por la API externa. Verifica IDEmpresa y permisos.')
  }
  if (!response.ok) {
    throw new ConsolideApiError(response.status, `Error del servidor externo: ${response.status} ${response.statusText}`)
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new ConsolideApiError(502, 'La API externa retornó una respuesta no válida (JSON inválido)')
  }

  if (!Array.isArray(body?.resultado)) {
    throw new ConsolideApiError(502, 'La API externa retornó un formato inesperado (sin "resultado")')
  }

  return body.resultado
}

async function _doFetchEmpleados(token, empresaId, fechaInicio, fechaFin, trabId) {
  return fetchWithTimeout(EMP_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,   // ← token NUNCA sale del backend
      'IDEmpresa':     String(empresaId),
    },
    body: JSON.stringify({
      empresa_ID:              empresaId,
      trab_ID:                 trabId,
      fecha_Movimiento_Inicio: fechaInicio,
      fecha_Movimiento_Fin:    fechaFin,
    }),
  })
}

// ── Verificar conexión (test ping) ────────────────────────────────────────────
/**
 * Realiza autenticación de prueba. No expone el token.
 * @returns {Promise<{ ok: boolean, mensaje: string }>}
 */
async function testConnection() {
  try {
    await getAccessToken()
    return { ok: true, mensaje: 'Conexión exitosa con API Consolide' }
  } catch (err) {
    return { ok: false, mensaje: err.message }
  }
}

module.exports = {
  fetchEmpleados,
  testConnection,
  ConsolideApiError,
}
