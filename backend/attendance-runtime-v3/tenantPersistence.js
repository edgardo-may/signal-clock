'use strict'

const PERSIST_FEATURE_KEY = 'WORKDAY_PERSIST_CANARY'
class PersistAuthorizationError extends Error { constructor(message, code) { super(message); this.name = 'PersistAuthorizationError'; this.code = code } }

async function loadPersistAuthorization(client, { tenantId, registroId, employeeId }) {
  const response = await client.from('tenant_features').select('cliente_id,feature_key,mode,enabled,canary_registro_id,canary_empleado_id,canary_schedule_id,canary_workday_date').eq('cliente_id', tenantId).eq('feature_key', PERSIST_FEATURE_KEY).maybeSingle()
  if (response.error) throw new PersistAuthorizationError('No se pudo leer la autorizacion de persistencia.', 'PERSIST_AUTHORIZATION_READ_FAILED')
  const auth = response.data
  if (!auth || auth.enabled !== true || auth.mode !== 'PERSIST_CANARY' || auth.cliente_id !== tenantId || auth.canary_registro_id !== registroId || auth.canary_empleado_id !== employeeId || !auth.canary_schedule_id || !auth.canary_workday_date) throw new PersistAuthorizationError('La persistencia no esta autorizada para este tenant/registro.', 'PERSIST_AUTHORIZATION_DENIED')
  return Object.freeze({ tenantId, registroId, employeeId, scheduleId: auth.canary_schedule_id, operativeDate: auth.canary_workday_date })
}

function assertPersistRecordAuthorized(record, authorization) {
  if (!record || record.cliente_id !== authorization.tenantId || record.empleado_id !== authorization.employeeId || record.registro_id !== authorization.registroId || record.schedule_id !== authorization.scheduleId || record.workday_date !== authorization.operativeDate || record.calculation_version !== 3) throw new PersistAuthorizationError('El resultado calculado no coincide con la autorizacion de persistencia.', 'PERSIST_AUTHORIZATION_SCOPE_MISMATCH')
}

module.exports = { PERSIST_FEATURE_KEY, PersistAuthorizationError, loadPersistAuthorization, assertPersistRecordAuthorized }
