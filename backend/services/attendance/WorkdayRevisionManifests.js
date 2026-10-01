'use strict'
const { createHash } = require('node:crypto')

// Reuses the repository's existing PostgreSQL jsonb::text serialization contract:
// object keys ordered by UTF-8 byte length then bytes; explicit JSON spaces.
function canonicalText(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Number.isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalText).join(', ') + ']'
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)))
    return '{' + keys.map(key => JSON.stringify(key) + ': ' + canonicalText(value[key])).join(', ') + '}'
  }
  throw new Error('WORKDAY_MANIFEST_VALUE_INVALID')
}
function fingerprint(manifest) { return createHash('sha256').update(canonicalText(manifest), 'utf8').digest('hex') }
function orderingTimestamp(value) {
  const text = value instanceof Date ? value.toISOString() : String(value)
  const iso = new Date(value).toISOString()
  const fraction = text.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] || ''
  return iso.slice(0, 19) + '.' + fraction.padEnd(6, '0').slice(0, 6) + 'Z'
}
function evidenceManifest(domain, events, clienteId, empleadoId, workdayDate) {
  const rows = events.map(row => ({
    registro_id: row.id,
    source_event_id: row.source_event_id ?? null,
    effective_timestamp_utc: new Date(row.verificado_at).toISOString(),
    ordering_timestamp_utc: orderingTimestamp(row.verificado_at),
    effective_type: domain.AttendanceNormalizer.mapInOutType(row.tipo_verificacion),
    effective_origin: row.es_manual ? 'MANUAL' : 'ADMS',
  })).sort((a, b) => a.ordering_timestamp_utc.localeCompare(b.ordering_timestamp_utc) || a.registro_id.localeCompare(b.registro_id))
  return { evidence_manifest_version: 1, cliente_id: clienteId, empleado_id: empleadoId, workday_date: workdayDate, events: rows }
}
function contextManifest(selection, match, timezone, version, window) {
  const shift = selection.resolution?.shift || {}
  return {
    context_manifest_version: 1, calculation_version: version,
    schedule_id: selection.resolution?.scheduleId ?? null,
    schedule_revision_id: selection.resolution?.scheduleRevisionId ?? null,
    timezone, scheduled_start: match.scheduledStartUtc ?? null, scheduled_end: match.scheduledEndUtc ?? null,
    tolerance_minutes: match.toleranceMinutes,
    window_before_minutes: shift.windowBeforeStartMinutes ?? 120,
    window_after_minutes: shift.windowAfterEndMinutes ?? 180,
    window_start_utc: window.startUtc, window_end_utc: window.endUtc,
    deduplication: { min_seconds: 60, mode: 'KEEP_FIRST', fixed_window: true },
    scheduled_break_minutes: match.scheduledBreakMinutes ?? 0,
    auto_deduct_scheduled_break: false,
  }
}
module.exports = { canonicalText, fingerprint, evidenceManifest, contextManifest }
