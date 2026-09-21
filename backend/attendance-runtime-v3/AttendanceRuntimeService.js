'use strict'

const { AttendanceEngineOrchestrator, SupabaseAttendanceReadRepository, READ_ONLY_PERSISTENCE_MODE, PERSISTENCE_MODE } = require('../services/attendance/AttendanceEngineOrchestrator.js')
const { WorkdayPersistenceService } = require('../services/attendance/WorkdayPersistenceService.js')
const { PERSISTENCE_SERVICE_BRAND } = require('../services/attendance/WorkdayPersistenceContract.js')
const { createReadOnlyClient } = require('./readOnlySupabase.js')
const { loadRevisionResolverFeature } = require('./tenantFeature.js')
const { loadPersistAuthorization, assertPersistRecordAuthorized } = require('./tenantPersistence.js')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENGINE_VERSION = 'ATTENDANCE_ENGINE_V3'; const CALCULATION_VERSION = 3
const RUNTIME_CAPABILITY = 'ACTIVE_PERSIST_CAPABLE'; const RUNTIME_EXECUTION_MODE = 'REVISION_RESOLVER_ACTIVE_PERSIST_CAPABLE'

class AttendanceRuntimeError extends Error { constructor(message, code = 'ATTENDANCE_RUNTIME_ERROR', cause) { super(message); this.name = 'AttendanceRuntimeError'; this.code = code; if (cause !== undefined) this.cause = cause } }
function assertRegistroId(registroId) { if (typeof registroId !== 'string' || !UUID_PATTERN.test(registroId)) throw new AttendanceRuntimeError('registro_id debe ser UUID.', 'RUNTIME_INPUT_INVALID') }
function safeErrorCode(error) { return typeof error?.code === 'string' ? error.code : 'ATTENDANCE_RUNTIME_ERROR' }

function summarize(engineResult, featureMode, durationMs, operation, deduplicated) {
  const resolution = engineResult.scheduleResolution || { kind: 'UNSCHEDULED' }
  return { registro_id: engineResult.registroId, tenant_id: engineResult.calculation.clienteId, employee_id: engineResult.calculation.empleadoId, operative_date: engineResult.operativeDate, assignment_id: resolution.scheduleAssignmentId || null, schedule_revision_id: resolution.scheduleRevisionId || null, revision_version: resolution.scheduleRevisionVersion || null, integrity_hash: resolution.scheduleRevisionHash || null, revision_integrity_hash: resolution.scheduleRevisionHash || null, resolution_mode: featureMode, execution_mode: engineResult.executionMode, persistence_mode: engineResult.persistenceMode, persistence_result: engineResult.persistenceResult || null, workday_id: engineResult.workdayId || null, runtime_capability: RUNTIME_CAPABILITY, engine_version: ENGINE_VERSION, calculation_version: engineResult.calculation.calculationVersion, result: resolution.kind || 'SCHEDULED', error_code: null, duration_ms: durationMs, deduplicated: Boolean(deduplicated), databaseWrites: operation.databaseWrites, persistenceCalls: operation.persistenceCalls, rpcWriteCalls: operation.rpcWriteCalls, storageWriteCalls: 0, indirectSupabaseCalls: 0, incidentWriteCalls: 0 }
}

class AttendanceRuntimeService {
  constructor({ client, logger = console, orchestratorFactory, featureLoader = loadRevisionResolverFeature, persistAuthorizationLoader = loadPersistAuthorization, persistenceServiceFactory } = {}) {
    if (!client) throw new AttendanceRuntimeError('Se requiere cliente backend.', 'RUNTIME_CLIENT_REQUIRED')
    this.rawClient = client; this.readCounters = { databaseWrites: 0, rpcWriteCalls: 0, indirectSupabaseCalls: 0 }; this.client = createReadOnlyClient(client, this.readCounters)
    this.logger = logger; this.featureLoader = featureLoader; this.persistAuthorizationLoader = persistAuthorizationLoader
    this.persistenceServiceFactory = persistenceServiceFactory || ((rawClient) => new WorkdayPersistenceService(rawClient))
    this.orchestratorFactory = orchestratorFactory || ((options) => new AttendanceEngineOrchestrator({ repository: new SupabaseAttendanceReadRepository(this.client), logger: this.logger, calculationVersion: CALCULATION_VERSION, ...options }))
    this.inFlight = new Map()
  }

  async _loadTrustedRegistro(registroId) {
    const response = await this.client.from('registro_asistencia').select('id,cliente_id,empleado_id,dispositivo_id,verificado_at,source_event_id,es_manual').eq('id', registroId).maybeSingle()
    if (response.error) throw new AttendanceRuntimeError('No se pudo leer registro_asistencia.', 'RUNTIME_REGISTRO_READ_FAILED', response.error)
    if (!response.data || !response.data.cliente_id || !response.data.empleado_id || !response.data.dispositivo_id) throw new AttendanceRuntimeError('registro_asistencia no tiene identidad completa.', 'RUNTIME_REGISTRO_INVALID')
    return response.data
  }

  async _execute(registroId, requestedPersistenceMode) {
    const startedAt = Date.now(); const operation = { databaseWrites: 0, persistenceCalls: 0, rpcWriteCalls: 0 }
    try {
      const trusted = await this._loadTrustedRegistro(registroId); const feature = await this.featureLoader(this.client, trusted.cliente_id)
      if (feature.mode !== 'ACTIVE') throw new AttendanceRuntimeError('La ejecucion requiere REVISION_SCHEDULE_RESOLVER ACTIVE.', 'RUNTIME_RESOLUTION_MODE_MISMATCH')
      let persistenceService = null
      if (requestedPersistenceMode === PERSISTENCE_MODE) {
        let authorization
        if (trusted.es_manual === true || !trusted.source_event_id) throw new AttendanceRuntimeError('La persistencia requiere una checada fisica canonica.', 'PERSIST_SOURCE_EVENT_REQUIRED')
        try { authorization = await this.persistAuthorizationLoader(this.client, { tenantId: trusted.cliente_id, registroId, employeeId: trusted.empleado_id, sourceEventId: trusted.source_event_id }) } catch (error) { throw new AttendanceRuntimeError('La persistencia no esta autorizada.', error.code || 'PERSIST_AUTHORIZATION_DENIED', error) }
        const service = this.persistenceServiceFactory(this.rawClient)
        persistenceService = { [PERSISTENCE_SERVICE_BRAND]: true, persist: async (record) => { assertPersistRecordAuthorized(record, authorization); operation.persistenceCalls += 1; operation.rpcWriteCalls += 1; const persisted = await service.persist(record); operation.databaseWrites = persisted.persistenceResult === 'INSERTED' ? 1 : 0; return persisted } }
      }
      const engineResult = await this.orchestratorFactory({ executionMode: 'ACTIVE', persistenceMode: requestedPersistenceMode, persistenceService }).run({ registroId })
      if (engineResult.executionMode !== 'ACTIVE' || engineResult.persistenceMode !== requestedPersistenceMode || engineResult.calculation.calculationVersion !== CALCULATION_VERSION) throw new AttendanceRuntimeError('El engine no respeto el contrato solicitado.', 'RUNTIME_ENGINE_MODE_MISMATCH')
      if (requestedPersistenceMode === PERSISTENCE_MODE && !['INSERTED', 'UPDATED', 'UNCHANGED', 'STALE'].includes(engineResult.persistenceResult)) throw new AttendanceRuntimeError('Resultado de persistencia invalido.', 'PERSISTENCE_RESULT_INVALID')
      const result = summarize(engineResult, feature.mode, Date.now() - startedAt, operation, false); this.logger?.info?.('attendance_runtime_v3', result); return result
    } catch (error) { this.logger?.error?.('attendance_runtime_v3_failed', { registro_id: registroId, execution_mode: 'ACTIVE', persistence_mode: requestedPersistenceMode, error_code: safeErrorCode(error), duration_ms: Date.now() - startedAt, ...operation }); throw error }
  }
  async _deduplicated(registroId, persistenceMode) { assertRegistroId(registroId); const key = `${persistenceMode}:${registroId}`; const prior = this.inFlight.get(key); if (prior) return { ...(await prior), deduplicated: true }; const execution = this._execute(registroId, persistenceMode); this.inFlight.set(key, execution); try { return await execution } finally { this.inFlight.delete(key) } }
  async executeActive({ registroId } = {}) { return this._deduplicated(registroId, READ_ONLY_PERSISTENCE_MODE) }
  async executePersist({ registroId } = {}) { return this._deduplicated(registroId, PERSISTENCE_MODE) }
  async executeShadow() { throw new AttendanceRuntimeError('Runtime v3 no ofrece PERSIST por SHADOW.', 'RUNTIME_SHADOW_WRITE_DENIED') }
}

module.exports = { AttendanceRuntimeService, AttendanceRuntimeError, ENGINE_VERSION, CALCULATION_VERSION, RUNTIME_CAPABILITY, RUNTIME_EXECUTION_MODE, assertRegistroId }
