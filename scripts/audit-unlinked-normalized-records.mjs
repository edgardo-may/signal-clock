/**
 * Read-only classifier for automatic registro_asistencia rows without a
 * raw_payload.source_log_id. It never prints IDs, PIN values, or raw payloads.
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

async function fetchAll(table, select, filter = '', pageSize = 1000) {
  const rows = []
  let from = 0
  while (true) {
    const endpoint = new URL(`${url}/rest/v1/${table}`)
    endpoint.searchParams.set('select', select)
    for (const [name, value] of new URLSearchParams(filter)) endpoint.searchParams.set(name, value)
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

const normalize = value => String(value ?? '').trim()
const hasValue = value => normalize(value) !== ''

function frequency(rows, selector) {
  const counts = new Map()
  for (const row of rows) {
    const key = selector(row)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

const [rawLogs, normalizedRows] = await Promise.all([
  fetchAll('attendance_logs', 'timestamp'),
  fetchAll(
    'registro_asistencia',
    'id,creado_at,verificado_at,dispositivo_id,es_manual,metodo,tipo_verificacion,raw_payload,source_log_id:raw_payload->>source_log_id',
  ),
])

const rawTimes = rawLogs
  .map(log => new Date(log.timestamp).getTime())
  .filter(Number.isFinite)
const rawEarliest = rawTimes.length ? Math.min(...rawTimes) : null
const rawLatest = rawTimes.length ? Math.max(...rawTimes) : null

const automaticUnlinked = normalizedRows.filter(row => (
  row.es_manual !== true && !hasValue(row.source_log_id)
))

function timingBucket(row) {
  const createdAt = new Date(row.creado_at || row.verificado_at).getTime()
  if (!Number.isFinite(createdAt) || rawEarliest === null || rawLatest === null) return 'TIMING_NOT_COMPARABLE'
  if (createdAt < rawEarliest) return 'BEFORE_RAW_ATTLOG_WINDOW'
  if (createdAt > rawLatest) return 'AFTER_RAW_ATTLOG_WINDOW'
  return 'WITHIN_RAW_ATTLOG_WINDOW'
}

function rawPayloadShape(row) {
  if (!row.raw_payload || typeof row.raw_payload !== 'object' || Array.isArray(row.raw_payload)) return 'RAW_PAYLOAD_ABSENT_OR_NON_OBJECT'
  return 'RAW_PAYLOAD_OBJECT'
}

function hasKey(row, keyName) {
  return Boolean(row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload) && hasValue(row.raw_payload[keyName]))
}

function directOrigin(row) {
  const payload = row.raw_payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  return normalize(payload.origin || payload.source || payload.source_type || payload.channel).toUpperCase()
}

function classify(row) {
  const origin = directOrigin(row)
  const method = normalize(row.metodo).toLowerCase()

  if (origin.includes('IMPORT')) return 'IMPORT_EVENT'
  if (origin.includes('WEB') || origin.includes('API')) return 'WEB_EVENT'
  if (method === 'web') return 'WEB_EVENT'
  if (method.includes('import')) return 'IMPORT_EVENT'

  // Hardware context without an ATTLOG reference proves only that the row carries
  // device-related legacy context; it does not establish a specific RAW event.
  if (hasKey(row, 'device_serial') || hasKey(row, 'hardware_user_id') || hasKey(row, 'user_id')) {
    return 'LEGACY_NORMALIZED'
  }

  return 'UNKNOWN'
}

const payloadKeySets = frequency(automaticUnlinked, row => {
  if (!row.raw_payload || typeof row.raw_payload !== 'object' || Array.isArray(row.raw_payload)) return 'NO_JSON_OBJECT'
  const keys = Object.keys(row.raw_payload).sort()
  return keys.length ? keys.join('|') : 'EMPTY_JSON_OBJECT'
})

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'aggregate-only; no IDs, PIN values, raw payload values, or biometric material are emitted',
  rawAttlogTimeWindow: rawEarliest === null || rawLatest === null
    ? 'NOT_AVAILABLE'
    : { earliest: new Date(rawEarliest).toISOString(), latest: new Date(rawLatest).toISOString() },
  automaticUnlinked: {
    total: automaticUnlinked.length,
    byClassification: frequency(automaticUnlinked, classify),
    byMethod: frequency(automaticUnlinked, row => normalize(row.metodo) || 'VACIO_O_NULL'),
    byVerificationType: frequency(automaticUnlinked, row => normalize(row.tipo_verificacion) || 'VACIO_O_NULL'),
    byCreatedDate: frequency(automaticUnlinked, row => normalize(row.creado_at).slice(0, 10) || 'DATE_NOT_AVAILABLE'),
    byVerifiedDate: frequency(automaticUnlinked, row => normalize(row.verificado_at).slice(0, 10) || 'DATE_NOT_AVAILABLE'),
    byTiming: frequency(automaticUnlinked, timingBucket),
    withDeviceId: automaticUnlinked.filter(row => hasValue(row.dispositivo_id)).length,
    withoutDeviceId: automaticUnlinked.filter(row => !hasValue(row.dispositivo_id)).length,
    byRawPayloadShape: frequency(automaticUnlinked, rawPayloadShape),
    withDeviceSerialInPayload: automaticUnlinked.filter(row => hasKey(row, 'device_serial')).length,
    withHardwareUserIdInPayload: automaticUnlinked.filter(row => hasKey(row, 'hardware_user_id')).length,
    withUserIdInPayload: automaticUnlinked.filter(row => hasKey(row, 'user_id')).length,
    payloadKeySets,
  },
}

console.log(JSON.stringify(report, null, 2))
