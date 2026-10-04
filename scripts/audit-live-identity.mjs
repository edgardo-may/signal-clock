/**
 * Read-only aggregate audit against the Supabase project configured in backend/.env.
 * It fetches only identifier fields needed for aggregate checks and never writes,
 * logs values, templates, names, credentials, or biometric payloads.
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
if (!url || !key) throw new Error('Configured Supabase read-only connection is missing.')

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
}

const normalize = value => String(value ?? '').trim()
const nonEmpty = value => normalize(value) !== ''

async function fetchAll(table, select, pageSize = 1000) {
  const rows = []
  let from = 0

  while (true) {
    const endpoint = new URL(`${url}/rest/v1/${table}`)
    endpoint.searchParams.set('select', select)
    const response = await fetch(endpoint, {
      headers: {
        ...headers,
        Range: `${from}-${from + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    })
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`)

    const page = await response.json()
    rows.push(...page)
    if (page.length < pageSize) return rows
    from += pageSize
  }
}

async function countRows(table) {
  const endpoint = new URL(`${url}/rest/v1/${table}`)
  endpoint.searchParams.set('select', 'id')
  const response = await fetch(endpoint, {
    method: 'HEAD',
    headers: {
      ...headers,
      Range: '0-0',
      'Range-Unit': 'items',
      Prefer: 'count=exact',
    },
  })
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`)
  const match = (response.headers.get('content-range') || '').match(/\/(\d+|\*)$/)
  return match?.[1] === '*' ? null : Number(match?.[1] || 0)
}

function duplicateSummary(rows, keyOf) {
  const counts = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const groups = [...counts.values()].filter(count => count > 1)
  return {
    groups: groups.length,
    rows: groups.reduce((sum, count) => sum + count, 0),
  }
}

const [companies, employees, devices, assignments, rawCount, normalizedCount] = await Promise.all([
  fetchAll('clientes', 'id,id_empresa'),
  fetchAll('empleados', 'id,cliente_id,clave_empleado,pin,device_userid,activo'),
  fetchAll('devices', 'id,cliente_id,serial_number,timezone'),
  fetchAll('device_employee_assignments', 'id,cliente_id,device_id,employee_id,biometric_user_id,activo'),
  countRows('attendance_logs'),
  countRows('registro_asistencia'),
])

const companyById = new Map(companies.map(company => [company.id, company]))
const employeeByCompanyAndId = new Map(employees.map(employee => [`${employee.cliente_id}:${employee.id}`, employee]))
const deviceByCompanyAndId = new Map(devices.map(device => [`${device.cliente_id}:${device.id}`, device]))

const companyKeyDuplicates = duplicateSummary(
  companies.filter(company => nonEmpty(company.id_empresa)),
  company => normalize(company.id_empresa),
)
const pinDuplicates = duplicateSummary(
  employees.filter(employee => nonEmpty(employee.pin)),
  employee => `${employee.cliente_id}:${normalize(employee.pin)}`,
)
const activeAssignmentDuplicates = duplicateSummary(
  assignments.filter(assignment => assignment.activo === true && nonEmpty(assignment.biometric_user_id)),
  assignment => `${assignment.device_id}:${normalize(assignment.biometric_user_id)}`,
)
const serialDuplicates = duplicateSummary(
  devices.filter(device => nonEmpty(device.serial_number)),
  device => normalize(device.serial_number).toUpperCase(),
)

let assignmentWithoutEmployee = 0
let assignmentWithoutDevice = 0
let biometricPinMismatch = 0
let assignmentPinWithoutFunctionalPin = 0

for (const assignment of assignments) {
  const employee = employeeByCompanyAndId.get(`${assignment.cliente_id}:${assignment.employee_id}`)
  const device = deviceByCompanyAndId.get(`${assignment.cliente_id}:${assignment.device_id}`)
  if (!employee) assignmentWithoutEmployee += 1
  if (!device) assignmentWithoutDevice += 1
  if (!employee || !nonEmpty(assignment.biometric_user_id)) continue

  if (!nonEmpty(employee.pin)) {
    assignmentPinWithoutFunctionalPin += 1
  } else if (normalize(assignment.biometric_user_id) !== normalize(employee.pin)) {
    biometricPinMismatch += 1
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'aggregate-only; no identifier values are emitted',
  empresa: {
    total: companies.length,
    idEmpresaEmptyOrNull: companies.filter(company => !nonEmpty(company.id_empresa)).length,
    idEmpresaDuplicates: companyKeyDuplicates,
  },
  colaboradores: {
    total: employees.length,
    pinPresent: employees.filter(employee => nonEmpty(employee.pin)).length,
    pinEmptyOrNull: employees.filter(employee => !nonEmpty(employee.pin)).length,
    claveEmpleadoPresent: employees.filter(employee => nonEmpty(employee.clave_empleado)).length,
    claveEmpleadoEmptyOrNull: employees.filter(employee => !nonEmpty(employee.clave_empleado)).length,
    deviceUseridPresent: employees.filter(employee => nonEmpty(employee.device_userid)).length,
    deviceUseridEmptyOrNull: employees.filter(employee => !nonEmpty(employee.device_userid)).length,
    pinEqualsClaveEmpleado: employees.filter(employee => nonEmpty(employee.pin) && nonEmpty(employee.clave_empleado) && normalize(employee.pin) === normalize(employee.clave_empleado)).length,
    pinDiffersFromClaveEmpleado: employees.filter(employee => nonEmpty(employee.pin) && nonEmpty(employee.clave_empleado) && normalize(employee.pin) !== normalize(employee.clave_empleado)).length,
    pinDiffersFromDeviceUserid: employees.filter(employee => nonEmpty(employee.pin) && nonEmpty(employee.device_userid) && normalize(employee.pin) !== normalize(employee.device_userid)).length,
    duplicatePinPerEmpresa: pinDuplicates,
  },
  dispositivos: {
    total: devices.length,
    timezoneEmptyOrNull: devices.filter(device => !nonEmpty(device.timezone)).length,
    duplicateNormalizedSerial: serialDuplicates,
  },
  assignments: {
    total: assignments.length,
    activeDuplicateDeviceAndBiometricPin: activeAssignmentDuplicates,
    withoutEmployeeInSameEmpresa: assignmentWithoutEmployee,
    withoutDeviceInSameEmpresa: assignmentWithoutDevice,
    biometricPinMismatch,
    physicalPinWithEmptyFunctionalPin: assignmentPinWithoutFunctionalPin,
  },
  attendance: {
    rawAttendanceLogs: rawCount,
    normalizedRegistroAsistencia: normalizedCount,
  },
}

console.log(JSON.stringify(report, null, 2))
