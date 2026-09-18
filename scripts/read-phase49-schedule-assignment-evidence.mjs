import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const TENANT_ID = '69095bd5-fee5-4237-a1a4-186dd88310ff'
const EMPLOYEE_ID = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'
const ASSIGNMENT_IDS = [
  'a290fc73-7ee6-4ea8-9e0e-8e92a683245f',
  '56f8c98d-5fe1-49d2-abe2-42182a4a830a',
  '2984316c-1c93-4f66-853e-349f90b9f82c',
]

function readDotEnv(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

function cancunDate(timestamp) {
  if (!timestamp) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Cancun', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function select(query, table) {
  const { data, error } = await query
  if (error) {
    throw new Error(`${table}: ${error.code ?? 'UNKNOWN'} ${error.message}`)
  }
  return data ?? []
}

const env = readDotEnv(new URL('../backend/.env', import.meta.url))
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('READ_ONLY_EVIDENCE_ENV_MISSING')
}
if (new URL(env.SUPABASE_URL).host !== 'tuhrqoihccfumlaxnbor.supabase.co') {
  throw new Error('READ_ONLY_EVIDENCE_HOST_DENIED')
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const assignments = await select(
  supabase.from('empleados_horarios').select('*').eq('cliente_id', TENANT_ID).eq('empleado_id', EMPLOYEE_ID),
  'empleados_horarios',
)
const scheduleIds = assignments.map(({ horario_id }) => horario_id)
const schedules = scheduleIds.length === 0 ? [] : await select(
  supabase.from('horarios').select('*').eq('cliente_id', TENANT_ID).in('id', scheduleIds),
  'horarios',
)
const attendance = await select(
  supabase.from('registro_asistencia').select('*').eq('cliente_id', TENANT_ID).eq('empleado_id', EMPLOYEE_ID),
  'registro_asistencia',
)
const deviceIds = [...new Set(attendance.map(({ dispositivo_id }) => dispositivo_id).filter(Boolean))]
const devices = deviceIds.length === 0 ? [] : await select(
  supabase.from('devices').select('*').eq('cliente_id', TENANT_ID).in('id', deviceIds),
  'devices',
)
const auditEvents = await select(
  supabase.from('audit_logs').select('*').eq('cliente_id', TENANT_ID).in('resource_id', ASSIGNMENT_IDS).order('created_at'),
  'audit_logs',
)
const workdays = await select(
  supabase.from('workday_records').select('*').eq('cliente_id', TENANT_ID).eq('empleado_id', EMPLOYEE_ID),
  'workday_records',
)

const devicesById = new Map(devices.map((device) => [device.id, device]))
const attendanceByDate = attendance
  .map((row) => {
    const device = devicesById.get(row.dispositivo_id)
    const deviceTimezone = device?.timezone ?? null
    return {
      registro_id: row.id,
      device_id: row.dispositivo_id ?? null,
      timestamp: row.verificado_at ?? null,
      cancun_date_for_analysis_only: cancunDate(row.verificado_at),
      device_timezone: deviceTimezone,
      operative_date_confidence: deviceTimezone ? 'DEVICE_TIMEZONE' : 'UNVERIFIED_NO_DEVICE_TIMEZONE',
      source_timezone_fields: Object.fromEntries(
        Object.entries(row).filter(([key]) => /timezone|zona|tz/i.test(key)),
      ),
      raw_source: row.origen ?? row.fuente ?? null,
    }
  })
  .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)))

const result = {
  mode: 'READ_ONLY_PHASE49_EVIDENCE',
  databaseWrites: 0,
  rpcWrites: 0,
  tenantId: TENANT_ID,
  employeeId: EMPLOYEE_ID,
  assignments,
  schedules,
  auditEvents,
  workdays,
  attendanceByDate,
  attendanceWithoutDeviceTimezone: attendanceByDate.filter((row) => !row.device_timezone),
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
