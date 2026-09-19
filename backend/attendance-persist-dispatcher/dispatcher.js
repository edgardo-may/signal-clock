'use strict'

const ALLOWED_RESULTS = new Set(['INSERTED', 'UNCHANGED'])
const TERMINAL_DENIALS = new Set(['PERSIST_AUTHORIZATION_DENIED', 'PERSIST_SOURCE_EVENT_REQUIRED', 'PERSIST_SOURCE_EVENT_DENIED', 'RUNTIME_RESOLUTION_MODE_MISMATCH', 'REVISION_MISSING', 'REVISION_HASH_MISMATCH', 'MULTIPLE_APPLICABLE_ASSIGNMENTS', 'TENANT_MISMATCH', 'PERSISTENCE_RESULT_INVALID'])

class DispatcherError extends Error { constructor(message, code = 'PERSIST_DISPATCHER_ERROR') { super(message); this.code = code } }
function safeErrorCode(error) { return typeof error?.code === 'string' ? error.code.slice(0, 120) : 'PERSIST_RUNTIME_TRANSPORT_ERROR' }
function safeRuntimeFields(value) {
  if (!value || typeof value !== 'object') throw new DispatcherError('Runtime devolvio un cuerpo invalido.', 'PERSIST_RUNTIME_RESPONSE_INVALID')
  return value
}
function validateRuntimeResult(row, value) {
  const result = safeRuntimeFields(value)
  if (result.registro_id !== row.registro_id || result.tenant_id !== row.cliente_id || result.employee_id !== row.empleado_id || result.execution_mode !== 'ACTIVE' || result.persistence_mode !== 'PERSIST' || result.runtime_capability !== 'ACTIVE_PERSIST_CAPABLE' || result.engine_version !== 'ATTENDANCE_ENGINE_V3' || result.calculation_version !== 3 || !ALLOWED_RESULTS.has(result.persistence_result) || typeof result.workday_id !== 'string' || result.workday_id.length === 0) throw new DispatcherError('Runtime devolvio una identidad o contrato de persistencia invalido.', 'PERSIST_RUNTIME_RESPONSE_INVALID')
  return result
}
async function metadataIdentityToken(audience, fetchImpl) {
  const endpoint = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`
  const response = await fetchImpl(endpoint, { headers: { 'Metadata-Flavor': 'Google' } })
  if (!response.ok) throw new DispatcherError('No se pudo obtener identidad de servicio Cloud Run.', 'PERSIST_CALLER_IDENTITY_UNAVAILABLE')
  const token = await response.text()
  if (!token || token.length < 20) throw new DispatcherError('La identidad de servicio Cloud Run es invalida.', 'PERSIST_CALLER_IDENTITY_UNAVAILABLE')
  return token
}
function runtimeErrorCode(body) { return typeof body?.error_code === 'string' ? body.error_code.slice(0, 120) : 'PERSIST_RUNTIME_HTTP_ERROR' }
class AttendancePersistDispatcher {
  constructor({ client, config, fetchImpl = global.fetch, identityTokenProvider = metadataIdentityToken, logger = console } = {}) {
    if (!client || typeof client.rpc !== 'function') throw new DispatcherError('Se requiere cliente backend RPC.', 'DISPATCHER_CLIENT_REQUIRED')
    if (!config || !fetchImpl) throw new DispatcherError('Se requiere configuracion y fetch.', 'DISPATCHER_CONFIG_REQUIRED')
    this.client = client; this.config = config; this.fetch = fetchImpl; this.identityTokenProvider = identityTokenProvider; this.logger = logger
  }
  async claim() {
    const response = await this.client.rpc('claim_attendance_persist_outbox', { p_limit: this.config.batchSize, p_worker_id: this.config.workerId })
    if (response?.error || !Array.isArray(response?.data)) throw new DispatcherError('No se pudo reclamar la outbox.', 'PERSIST_OUTBOX_CLAIM_FAILED')
    return response.data
  }
  async acknowledge(row, terminalStatus, { errorCode = null, runtimeResult = null, workdayId = null } = {}) {
    const response = await this.client.rpc('complete_attendance_persist_outbox', { p_outbox_id: row.outbox_id, p_worker_id: this.config.workerId, p_terminal_status: terminalStatus, p_error_code: errorCode, p_runtime_result: runtimeResult, p_workday_id: workdayId })
    if (response?.error) throw new DispatcherError('No se pudo confirmar la outbox.', 'PERSIST_OUTBOX_ACK_FAILED')
  }
  async process(row) {
    const startedAt = Date.now()
    try {
      const identityToken = await this.identityTokenProvider(this.config.runtimeUrl, this.fetch)
      const response = await this.fetch(`${this.config.runtimeUrl}/internal/attendance/persist`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.internalToken}`, 'X-Serverless-Authorization': `Bearer ${identityToken}` }, body: JSON.stringify({ registro_id: row.registro_id }) })
      let body = null; try { body = await response.json() } catch {}
      if (!response.ok) {
        const errorCode = runtimeErrorCode(body); await this.acknowledge(row, TERMINAL_DENIALS.has(errorCode) ? 'DENIED' : 'RETRY', { errorCode });
        return { outbox_id: row.outbox_id, status: TERMINAL_DENIALS.has(errorCode) ? 'DENIED' : 'RETRY', error_code: errorCode }
      }
      const result = validateRuntimeResult(row, body)
      await this.acknowledge(row, 'SUCCEEDED', { runtimeResult: result.persistence_result, workdayId: result.workday_id })
      const event = { registro_id: result.registro_id, tenant_id: result.tenant_id, employee_id: result.employee_id, operative_date: result.operative_date, assignment_id: result.assignment_id, schedule_revision_id: result.schedule_revision_id, execution_mode: result.execution_mode, persistence_mode: result.persistence_mode, persistence_result: result.persistence_result, workday_id: result.workday_id, databaseWrites: result.databaseWrites, persistenceCalls: result.persistenceCalls, rpcWriteCalls: result.rpcWriteCalls, duration_ms: Date.now() - startedAt, error_code: null }
      this.logger?.info?.('attendance_persist_dispatch', event); return { outbox_id: row.outbox_id, status: 'SUCCEEDED', ...event }
    } catch (error) {
      const errorCode = safeErrorCode(error); await this.acknowledge(row, 'RETRY', { errorCode }); this.logger?.error?.('attendance_persist_dispatch_failed', { registro_id: row.registro_id, tenant_id: row.cliente_id, employee_id: row.empleado_id, duration_ms: Date.now() - startedAt, error_code: errorCode }); return { outbox_id: row.outbox_id, status: 'RETRY', error_code: errorCode }
    }
  }
  async runOnce() { const rows = await this.claim(); const outcomes = []; for (const row of rows) outcomes.push(await this.process(row)); return outcomes }
}
module.exports = { AttendancePersistDispatcher, DispatcherError, validateRuntimeResult, metadataIdentityToken, TERMINAL_DENIALS }
