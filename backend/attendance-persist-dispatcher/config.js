'use strict'

class DispatcherConfigError extends Error { constructor(message, code = 'DISPATCHER_CONFIG_INVALID') { super(message); this.code = code } }
function required(environment, name, minimumLength = 1) { const value = environment[name]; if (typeof value !== 'string' || value.trim().length < minimumLength) throw new DispatcherConfigError(`Falta configuracion valida para ${name}.`, 'DISPATCHER_CONFIG_MISSING'); return value.trim() }
function loadDispatcherConfig(environment = process.env) {
  const runtimeUrl = required(environment, 'ATTENDANCE_RUNTIME_URL')
  try { if (new URL(runtimeUrl).protocol !== 'https:') throw new Error('protocol') } catch { throw new DispatcherConfigError('ATTENDANCE_RUNTIME_URL debe usar https.', 'DISPATCHER_RUNTIME_URL_INVALID') }
  const batchSize = Number(environment.WORKDAY_PERSIST_BATCH_SIZE || 10)
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new DispatcherConfigError('WORKDAY_PERSIST_BATCH_SIZE es invalido.', 'DISPATCHER_BATCH_SIZE_INVALID')
  return Object.freeze({ supabaseUrl: required(environment, 'SUPABASE_URL'), secretKey: required(environment, 'SUPABASE_SECRET_KEY', 20), runtimeUrl: runtimeUrl.replace(/\/$/, ''), internalToken: required(environment, 'ATTENDANCE_RUNTIME_INTERNAL_TOKEN', 32), workerId: required(environment, 'WORKDAY_PERSIST_WORKER_ID', 8), batchSize })
}
module.exports = { DispatcherConfigError, loadDispatcherConfig }
