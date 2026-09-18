'use strict'

const { PERSISTENCE_SERVICE_BRAND } = require('./WorkdayPersistenceContract.js')

/**
 * Server-only boundary for public.upsert_workday_record.
 *
 * This module does not construct a Supabase client and never contains a
 * service-role secret. The backend composition root must inject its already
 * configured service-role RPC client. Keeping it under backend/ prevents it
 * from being imported by the browser bundle.
 */

const ALLOWED_PERSISTENCE_RESULTS = new Set(['INSERTED', 'UNCHANGED'])
const ALLOWED_WORKDAY_STATES = new Set([
  'COMPLETE',
  'INCOMPLETE',
  'ABSENT',
  'UNSCHEDULED',
  'INVALID',
])

class WorkdayPersistenceError extends Error {
  constructor(message, code = 'WORKDAY_PERSISTENCE_ERROR', cause) {
    super(message)
    this.name = 'WorkdayPersistenceError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function assertNonBlank(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkdayPersistenceError(
      field + ' es obligatorio.',
      'WORKDAY_PERSISTENCE_INPUT_INVALID'
    )
  }
}

function assertNullableTimestamp(value, field) {
  if (value === null || value === undefined) return
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new WorkdayPersistenceError(
      field + ' debe ser un timestamp ISO válido o null.',
      'WORKDAY_PERSISTENCE_INPUT_INVALID'
    )
  }
}

function assertNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new WorkdayPersistenceError(
      field + ' debe ser un entero no negativo.',
      'WORKDAY_PERSISTENCE_INPUT_INVALID'
    )
  }
}

/**
 * Creates the only identity the RPC is allowed to use. schedule_id is
 * deliberately excluded so a valid reprocess cannot create a second workday.
 */
function workdayPersistenceIdentity(record) {
  assertNonBlank(record?.registro_id, 'registro_id')
  assertNonBlank(record?.cliente_id, 'cliente_id')
  assertNonBlank(record?.empleado_id, 'empleado_id')
  assertNonBlank(record?.workday_date, 'workday_date')

  return {
    registro_id: record.registro_id,
    cliente_id: record.cliente_id,
    empleado_id: record.empleado_id,
    workday_date: record.workday_date,
  }
}

/**
 * Converts the output of WorkdayRecordAdapter to the explicit V3 RPC signature.
 * It intentionally ignores deprecated WorkdayStatus and every non-canonical field.
 */
function toUpsertWorkdayRpcParams(record) {
  const identity = workdayPersistenceIdentity(record)
  assertNonBlank(record.timezone, 'timezone')
  assertNonBlank(record.schedule_id, 'schedule_id')
  assertNonBlank(record.integrity_hash, 'integrity_hash')
  if (record.calculation_version !== 3) {
    throw new WorkdayPersistenceError(
      'calculation_version debe ser exactamente 3.',
      'WORKDAY_PERSISTENCE_VERSION_INVALID'
    )
  }

  if (!ALLOWED_WORKDAY_STATES.has(record.status)) {
    throw new WorkdayPersistenceError(
      'status debe contener un WorkdayState permitido.',
      'WORKDAY_PERSISTENCE_INPUT_INVALID'
    )
  }

  assertNullableTimestamp(record.first_in, 'first_in')
  assertNullableTimestamp(record.last_out, 'last_out')
  if (record.first_in && record.last_out && new Date(record.last_out) < new Date(record.first_in)) {
    throw new WorkdayPersistenceError(
      'last_out no puede ser anterior a first_in.',
      'WORKDAY_PERSISTENCE_INPUT_INVALID'
    )
  }

  assertNonNegativeInteger(record.worked_minutes, 'worked_minutes')
  assertNonNegativeInteger(record.break_minutes, 'break_minutes')
  assertNonNegativeInteger(record.overtime_minutes, 'overtime_minutes')
  assertNonNegativeInteger(record.late_minutes, 'late_minutes')
  assertNonNegativeInteger(record.early_leave_minutes, 'early_leave_minutes')

  return {
    p_registro_id: identity.registro_id,
    p_cliente_id: identity.cliente_id,
    p_empleado_id: identity.empleado_id,
    p_workday_date: identity.workday_date,
    p_schedule_id: record.schedule_id,
    p_timezone: record.timezone,
    p_first_in: record.first_in ?? null,
    p_last_out: record.last_out ?? null,
    p_worked_minutes: record.worked_minutes,
    p_break_minutes: record.break_minutes,
    p_overtime_minutes: record.overtime_minutes,
    p_late_minutes: record.late_minutes,
    p_early_leave_minutes: record.early_leave_minutes,
    p_status: record.status,
    p_integrity_hash: record.integrity_hash,
    p_calculation_version: record.calculation_version,
  }
}

function singleRpcRow(data) {
  const rows = Array.isArray(data) ? data : [data]
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw new WorkdayPersistenceError(
      'La RPC debe retornar exactamente una fila.',
      'WORKDAY_PERSISTENCE_RESPONSE_INVALID'
    )
  }
  return rows[0]
}

class WorkdayPersistenceService {
  /**
   * @param {{ rpc: (name: string, params: object) => Promise<{ data: unknown, error: unknown }> }} backendRpcClient
   */
  constructor(backendRpcClient) {
    if (!backendRpcClient || typeof backendRpcClient.rpc !== 'function') {
      throw new WorkdayPersistenceError(
        'Se requiere un cliente RPC backend inyectado.',
        'WORKDAY_PERSISTENCE_BACKEND_CLIENT_REQUIRED'
      )
    }
    this[PERSISTENCE_SERVICE_BRAND] = true
    this.backendRpcClient = backendRpcClient
  }

  /**
   * @param {object} workdayRecord Output of WorkdayRecordAdapter.
   * @returns {Promise<{workdayId: string, persistenceResult: 'INSERTED'|'UNCHANGED', integrityHash: string|null}>}
   */
  async persist(workdayRecord) {
    const params = toUpsertWorkdayRpcParams(workdayRecord)

    let response
    try {
      response = await this.backendRpcClient.rpc('upsert_workday_record', params)
    } catch (error) {
      throw new WorkdayPersistenceError(
        'La llamada RPC de persistencia falló.',
        'WORKDAY_PERSISTENCE_RPC_ERROR',
        error
      )
    }

    if (!response || response.error) {
      const message = response?.error?.message || String(response?.error || 'error RPC desconocido')
      throw new WorkdayPersistenceError(
        'La RPC de persistencia devolvió error: ' + message,
        'WORKDAY_PERSISTENCE_RPC_ERROR',
        response?.error
      )
    }

    const row = singleRpcRow(response.data)
    if (typeof row.workday_id !== 'string' || row.workday_id.trim() === '') {
      throw new WorkdayPersistenceError(
        'La RPC no devolvió workday_id válido.',
        'WORKDAY_PERSISTENCE_RESPONSE_INVALID'
      )
    }
    if (!ALLOWED_PERSISTENCE_RESULTS.has(row.persistence_result)) {
      throw new WorkdayPersistenceError(
        'persistence_result no permitido: ' + String(row.persistence_result),
        'WORKDAY_PERSISTENCE_RESPONSE_INVALID'
      )
    }
    if (row.integrity_hash !== null && row.integrity_hash !== undefined && typeof row.integrity_hash !== 'string') {
      throw new WorkdayPersistenceError(
        'La RPC devolvió integrity_hash inválido.',
        'WORKDAY_PERSISTENCE_RESPONSE_INVALID'
      )
    }

    return {
      workdayId: row.workday_id,
      persistenceResult: row.persistence_result,
      integrityHash: row.integrity_hash ?? null,
    }
  }
}

module.exports = {
  WorkdayPersistenceService,
  WorkdayPersistenceError,
  workdayPersistenceIdentity,
  toUpsertWorkdayRpcParams,
}
