// Temporary employee canary. Authentication continues using the existing session.
import { supabase } from '../../../lib/supabase'

export const isEmployeeApiEnabled = (isSuperAdmin = false) =>
  import.meta.env.VITE_USE_EMPLOYEE_API === 'true' && !isSuperAdmin

const baseUrl = (import.meta.env.VITE_SIGNUM_API_URL || '').replace(/\/$/, '')
const fields = ['nombre', 'apellido', 'clave_empleado', 'departamento', 'puesto', 'pin',
  'device_userid', 'tarjeta', 'sexo', 'fecha_ingreso', 'fecha_cumpleanos']

function input(employee, create) {
  const payload = Object.fromEntries(fields.filter(key => employee[key] !== undefined).map(key => [key, employee[key]]))
  if (create && employee.activo !== undefined) payload.activo = employee.activo
  return payload
}

async function request(path, method = 'GET', body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Tu sesión ha expirado. Inicia sesión nuevamente.')
  const response = await fetch(`${baseUrl}/api/v1/employees${path}`, {
    method, headers: { Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await response.json()
  if (!response.ok) {
    const messages = { EMPLOYEE_LIFECYCLE_CONFLICT: 'La operación está bloqueada por las reglas de baja o reactivación.',
      EMPLOYEE_RULE_CONFLICT: 'La operación incumple una regla de empleados o el límite de tu empresa.',
      FORBIDDEN: 'No tienes permiso para realizar esta operación.', RATE_LIMITED: 'Espera un momento antes de volver a intentar.',
      INVALID_INPUT: 'Revisa los datos del colaborador.', EMPLOYEE_CONFLICT: 'La clave o el ID biométrico ya existe.' }
    throw Object.assign(new Error(messages[data.error] || 'No fue posible completar la operación de empleados.'), { code: data.code || data.error })
  }
  return data
}

// Keep the existing local search/export behavior during the canary. Every HTTP
// request is bounded; large-directory server-side search is a separate migration.
export async function listEmployees() {
  const employees = []
  for (let offset = 0; offset <= 1000000; offset += 100) {
    const page = await request(`?limit=100&offset=${offset}`)
    employees.push(...page.data)
    if (!page.hasMore) return employees
  }
  throw new Error('El directorio supera el límite de esta consulta.')
}

export async function employeeApiResult(operation) {
  try { return { data: await operation(), error: null } }
  catch (error) { return { data: null, error } }
}
export const createEmployee = employee => request('', 'POST', input(employee, true))
export const getEmployeeCapacity = () => request('/capacity')
export const updateEmployee = (id, employee) => request(`/${encodeURIComponent(id)}`, 'PATCH', input(employee, false))
export const importEmployees = employees => request('/import', 'POST', { employees: employees.map(employee => input(employee, true)) })
export function employeeLifecycle(id, action) {
  const route = { CHECK: 'lifecycle-check', DEACTIVATE: 'deactivate', ACTIVATE: 'reactivate' }[action]
  return request(`/${encodeURIComponent(id)}${route ? `/${route}` : ''}`, action === 'DELETE' ? 'DELETE' : 'POST')
}
