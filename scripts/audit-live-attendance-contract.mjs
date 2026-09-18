/**
 * Read-only aggregate audit for schedules, incidents, and attendance states.
 * It does not retrieve names, raw payloads, biometric templates, or PIN values.
 */
import { readFileSync } from 'node:fs'

const envText = readFileSync('backend/.env', 'utf8')

function readEnvValue(name) {
  const line = envText
    .split(/\r?\n/)
    .find(candidate => candidate.trim().startsWith(`${name}=`))
  if (!line) return ''
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const url = readEnvValue('SUPABASE_URL').replace(/\/$/, '')
const key = readEnvValue('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !key) throw new Error('Configured Supabase read-only connection is missing.')

const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function fetchAll(table, select, pageSize = 1000) {
  const rows = []
  let from = 0
  while (true) {
    const endpoint = new URL(`${url}/rest/v1/${table}`)
    endpoint.searchParams.set('select', select)
    const response = await fetch(endpoint, {
      headers: { ...headers, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' },
    })
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`)
    const page = await response.json()
    rows.push(...page)
    if (page.length < pageSize) return rows
    from += pageSize
  }
}

function frequency(rows, field) {
  const result = new Map()
  for (const row of rows) {
    const value = String(row[field] ?? '').trim() || 'VACIO_O_NULL'
    result.set(value, (result.get(value) || 0) + 1)
  }
  return Object.fromEntries([...result.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const min = '0001-01-01'
  const max = '9999-12-31'
  return (leftStart || min) <= (rightEnd || max) && (rightStart || min) <= (leftEnd || max)
}

const [schedules, scheduleAssignments, incidents, rawLogs, normalizedLogs] = await Promise.all([
  fetchAll('horarios', 'id,cliente_id,activo,dias_config,tolerancia_minutos'),
  fetchAll('empleados_horarios', 'id,cliente_id,empleado_id,horario_id,activo,fecha_inicio,fecha_fin'),
  fetchAll('incidencias', 'id,cliente_id,empleado_id,estado,tipo_incidencia,fecha_inicio,fecha_fin'),
  fetchAll('attendance_logs', 'id,status,verify_type'),
  fetchAll('registro_asistencia', 'id,cliente_id,empleado_id,dispositivo_id,es_manual,tipo_verificacion,metodo,verificado_at,source_log_id:raw_payload->>source_log_id'),
])

const activeAssignments = scheduleAssignments.filter(assignment => assignment.activo === true)
const assignmentsByEmployee = new Map()
for (const assignment of activeAssignments) {
  const key = `${assignment.cliente_id}:${assignment.empleado_id}`
  if (!assignmentsByEmployee.has(key)) assignmentsByEmployee.set(key, [])
  assignmentsByEmployee.get(key).push(assignment)
}

let ambiguousSchedulePairs = 0
let employeesWithAmbiguousSchedule = 0
for (const assignments of assignmentsByEmployee.values()) {
  let ambiguous = false
  for (let index = 0; index < assignments.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < assignments.length; otherIndex += 1) {
      const left = assignments[index]
      const right = assignments[otherIndex]
      if (intervalsOverlap(left.fecha_inicio, left.fecha_fin, right.fecha_inicio, right.fecha_fin)) {
        ambiguousSchedulePairs += 1
        ambiguous = true
      }
    }
  }
  if (ambiguous) employeesWithAmbiguousSchedule += 1
}

const rawIds = new Set(rawLogs.map(log => String(log.id)))
const linkedNormalizations = normalizedLogs.filter(log => String(log.source_log_id ?? '').trim() !== '')
const linkedBySourceLog = new Map()
for (const log of linkedNormalizations) {
  const sourceLogId = String(log.source_log_id).trim()
  if (!linkedBySourceLog.has(sourceLogId)) linkedBySourceLog.set(sourceLogId, [])
  linkedBySourceLog.get(sourceLogId).push(log)
}

const repeatedSourceLinks = [...linkedBySourceLog.values()].filter(logs => logs.length > 1)
const rawWithMoreThanOneNormalization = repeatedSourceLinks
  .filter(logs => rawIds.has(String(logs[0].source_log_id).trim()))
const rawWithAtLeastOneNormalization = new Set(
  [...linkedBySourceLog.keys()].filter(sourceLogId => rawIds.has(sourceLogId)),
)

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'aggregate-only; no collaborator names, raw payloads, PIN values, or biometric material are emitted',
  horarios: {
    total: schedules.length,
    active: schedules.filter(schedule => schedule.activo === true).length,
    inactive: schedules.filter(schedule => schedule.activo !== true).length,
    missingDiasConfig: schedules.filter(schedule => !schedule.dias_config || Object.keys(schedule.dias_config).length === 0).length,
    missingTolerance: schedules.filter(schedule => schedule.tolerancia_minutos === null || schedule.tolerancia_minutos === undefined).length,
  },
  asignacionesHorario: {
    total: scheduleAssignments.length,
    active: activeAssignments.length,
    activeWithoutStartDate: activeAssignments.filter(assignment => !assignment.fecha_inicio).length,
    activeWithInvalidRange: activeAssignments.filter(assignment => assignment.fecha_inicio && assignment.fecha_fin && assignment.fecha_fin < assignment.fecha_inicio).length,
    employeesWithOverlappingActiveAssignments: employeesWithAmbiguousSchedule,
    overlappingActiveAssignmentPairs: ambiguousSchedulePairs,
  },
  incidencias: {
    total: incidents.length,
    byEstado: frequency(incidents, 'estado'),
    byTipo: frequency(incidents, 'tipo_incidencia'),
  },
  attendanceRaw: {
    total: rawLogs.length,
    byStatus: frequency(rawLogs, 'status'),
    byVerifyType: frequency(rawLogs, 'verify_type'),
  },
  registroAsistencia: {
    total: normalizedLogs.length,
    manual: normalizedLogs.filter(log => log.es_manual === true).length,
    automatic: normalizedLogs.filter(log => log.es_manual !== true).length,
    byVerificationType: frequency(normalizedLogs, 'tipo_verificacion'),
    byMethod: frequency(normalizedLogs, 'metodo'),
    withRawSourceLogId: linkedNormalizations.length,
    withoutRawSourceLogId: normalizedLogs.length - linkedNormalizations.length,
    manualWithRawSourceLogId: linkedNormalizations.filter(log => log.es_manual === true).length,
    automaticWithRawSourceLogId: linkedNormalizations.filter(log => log.es_manual !== true).length,
    sourceLogIdNotFoundInRaw: [...linkedBySourceLog.keys()].filter(sourceLogId => !rawIds.has(sourceLogId)).length,
    repeatedSourceLogIdGroups: repeatedSourceLinks.length,
    normalizedRowsInRepeatedSourceLogIdGroups: repeatedSourceLinks.reduce((sum, logs) => sum + logs.length, 0),
    rawEventsWithMoreThanOneNormalization: rawWithMoreThanOneNormalization.length,
    rawEventsWithNoNormalization: rawLogs.length - rawWithAtLeastOneNormalization.size,
  },
}

console.log(JSON.stringify(report, null, 2))
