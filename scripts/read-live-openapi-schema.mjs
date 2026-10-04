/**
 * Read-only discovery helper for the Supabase project explicitly configured
 * in backend/.env. It requests only PostgREST's OpenAPI document and never
 * queries, changes, or prints application records or credentials.
 */
import { readFileSync } from 'node:fs'

const envText = readFileSync('backend/.env', 'utf8')

function readEnvValue(name) {
  const line = envText
    .split(/\r?\n/)
    .find(candidate => candidate.trim().startsWith(`${name}=`))

  if (!line) return ''
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

const url = readEnvValue('SUPABASE_URL').replace(/\/$/, '')
const key = readEnvValue('SUPABASE_SERVICE_ROLE_KEY')

if (!url || !key) {
  throw new Error('Configured Supabase read-only connection is missing.')
}

const response = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/openapi+json',
  },
})

console.log(`HTTP=${response.status}`)

if (!response.ok) {
  throw new Error('The configured endpoint did not provide its OpenAPI schema.')
}

const document = await response.json()
const schemas = document.components?.schemas || document.definitions || {}
const relevant = new Set([
  'clientes',
  'empleados',
  'devices',
  'device_employee_assignments',
  'attendance_logs',
  'registro_asistencia',
  'horarios',
  'empleados_horarios',
  'incidencias',
  'usuarios_perfiles',
  'cliente_modulos',
  'module_catalog',
  'user_module_permissions',
  'rate_limits_logs',
  'login_attempts',
  'workday_records',
  'workday_record_history',
  'tenant_features',
])

const names = Object.keys(schemas).sort()
console.log(`SCHEMA_COUNT=${names.length}`)
console.log(`ALL_SCHEMAS=${names.join(',')}`)
console.log(`RELEVANT_SCHEMAS=${names.filter(name => relevant.has(name)).join(',')}`)

for (const name of names.filter(candidate => relevant.has(candidate))) {
  const properties = schemas[name]?.properties || {}
  const columns = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([column, definition]) => {
      const type = definition.type || definition.format || 'unknown'
      const format = definition.format ? `:${definition.format}` : ''
      return `${column}(${type}${format})`
    })
  console.log(`${name}: ${columns.join(',')}`)
}

const rpcPaths = Object.keys(document.paths || {})
  .filter(path => path.startsWith('/rpc/'))
  .map(path => path.slice('/rpc/'.length))
  .sort()

console.log(`EXPOSED_RPCS=${rpcPaths.join(',')}`)

for (const rpcName of rpcPaths) {
  const post = document.paths?.[`/rpc/${rpcName}`]?.post
  const properties = post?.requestBody?.content?.['application/json']?.schema?.properties || {}
  console.log(`RPC ${rpcName}: args=${Object.keys(properties).sort().join(',')}`)
}
