'use strict'

// This is the permanent tenant-scoped gate.  It intentionally has no canary
// identity fields: each canonical source event is authorized by its own
// registro_id, while the tenant feature authorizes only that tenant.
const PERSIST_FEATURE_KEY = 'WORKDAY_PERSIST_ACTIVE'
const PERSIST_FEATURE_MODE = 'PERSIST_ACTIVE'
class PersistAuthorizationError extends Error { constructor(message, code) { super(message); this.name = 'PersistAuthorizationError'; this.code = code } }

async function loadPersistAuthorization(client, { tenantId, registroId, employeeId, sourceEventId }) {
  const response = await client.from('tenant_features').select('cliente_id,feature_key,mode,enabled,canary_registro_id,canary_empleado_id,canary_schedule_id,canary_workday_date').eq('cliente_id', tenantId).eq('feature_key', PERSIST_FEATURE_KEY).maybeSingle()
  if (response.error) throw new PersistAuthorizationError('No se pudo leer la autorizacion de persistencia.', 'PERSIST_AUTHORIZATION_READ_FAILED')
  const auth = response.data
  if (!auth || auth.enabled !== true || auth.mode !== PERSIST_FEATURE_MODE || auth.cliente_id !== tenantId || auth.canary_registro_id !== null || auth.canary_empleado_id !== null || auth.canary_schedule_id !== null || auth.canary_workday_date !== null) throw new PersistAuthorizationError('La persistencia no esta autorizada para este tenant.', 'PERSIST_AUTHORIZATION_DENIED')
  if (typeof sourceEventId !== 'string' || sourceEventId.length === 0) throw new PersistAuthorizationError('El registro no tiene source event canonico.', 'PERSIST_SOURCE_EVENT_REQUIRED')
  const source = await client.from('attendance_source_events').select('id,cliente_id,employee_id,source_type,processing_status').eq('id', sourceEventId).eq('cliente_id', tenantId).eq('employee_id', employeeId).maybeSingle()
  if (source.error) throw new PersistAuthorizationError('No se pudo validar el source event.', 'PERSIST_SOURCE_EVENT_READ_FAILED')
  if (!source.data || source.data.id !== sourceEventId || source.data.cliente_id !== tenantId || source.data.employee_id !== employeeId || source.data.source_type !== 'ZKTECO' || source.data.processing_status !== 'PROCESSED') throw new PersistAuthorizationError('El source event no es una checada fisica canonica procesada.', 'PERSIST_SOURCE_EVENT_DENIED')
  return Object.freeze({ tenantId, registroId, employeeId, sourceEventId })
}

function assertPersistRecordAuthorized(record, authorization) {
  if (!record || record.cliente_id !== authorization.tenantId || record.empleado_id !== authorization.employeeId || record.registro_id !== authorization.registroId || typeof record.schedule_id !== 'string' || record.schedule_id.length === 0 || record.calculation_version !== 3) throw new PersistAuthorizationError('El resultado calculado no coincide con la autorizacion de persistencia.', 'PERSIST_AUTHORIZATION_SCOPE_MISMATCH')
}

module.exports = { PERSIST_FEATURE_KEY, PERSIST_FEATURE_MODE, PersistAuthorizationError, loadPersistAuthorization, assertPersistRecordAuthorized }
