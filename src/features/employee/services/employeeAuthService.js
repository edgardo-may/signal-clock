// Server-verified identity; the memory cache contains display data only.
let session = null
const LAST_COMPANY = 'sc_last_tenant_id'
const CLOCK = 'sc_web_clock_preference'
try { localStorage.removeItem('sc_colaborador_session'); localStorage.removeItem('sc_empleado_session') } catch {}
const messages = {
  LOGIN_DENIED: 'Credenciales incorrectas o acceso temporalmente limitado.',
  SESSION_DENIED: 'Tu sesión terminó. Inicia sesión nuevamente.',
  CLOCK_DENIED: 'El reloj seleccionado no está autorizado.',
  DIRECTION_DENIED: 'Actualiza tus checadas antes de continuar.',
}
async function request(action, body, clock) {
  const query = new URLSearchParams({ action })
  if (clock) query.set('clock', clock)
  try {
    const response = await fetch('/api/employee?' + query, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const data = await response.json()
    if (response.status === 401) session = null
    if (!response.ok || data.success !== true) return { success: false, error: messages[data.error] || 'No se pudo completar la solicitud. Intenta nuevamente.' }
    if (data.session) session = data.session
    return data
  } catch { return { success: false, error: 'No se pudo conectar con el portal. Intenta nuevamente.' } }
}
export function getClockPreference() {
  try { return new URLSearchParams(window.location.search).get('clock') || localStorage.getItem(CLOCK) || '' } catch { return '' }
}
export function setClockPreference(slug) { try { localStorage.setItem(CLOCK, slug) } catch {} }
export async function getEmpresasDisponibles() {
  const result = await request('directory')
  return result.success ? result.companies || [] : []
}
export async function loginEmployee({ clienteId, clave, pin }) {
  if (!clienteId || !clave?.trim() || !/^[0-9]{5}$/.test(pin || '')) return { success: false, error: 'Selecciona tu Empresa e ingresa tu clave y PIN de 5 dígitos.' }
  const result = await request('login', { clienteId, clave: clave.trim(), pin, clockSlug: getClockPreference() })
  if (result.success) { try { localStorage.setItem(LAST_COMPANY, clienteId) } catch {} }
  return result
}
export function getEmployeeSession() { return session }
export function getLastTenantId() { try { return localStorage.getItem(LAST_COMPANY) || null } catch { return null } }
export function getEmployeeState(clock = getClockPreference()) { return request('session', undefined, clock) }
export async function hasActiveEmployeeSession() { return (await getEmployeeState('')).success === true }
export function registrarChecada({ direction, clockSlug, requestId, evidence }) { return request('punch', { direction, clockSlug, requestId, evidence }) }
export async function logoutEmployee() {
  const result = await request('logout', {})
  if (result.success) session = null
  return result
}
