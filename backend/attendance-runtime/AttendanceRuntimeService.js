'use strict'

const {
  AttendanceEngineOrchestrator,
  SupabaseAttendanceReadRepository,
  READ_ONLY_PERSISTENCE_MODE,
} = require('../services/attendance/AttendanceEngineOrchestrator.js')
const { createReadOnlyClient } = require('./readOnlySupabase.js')
const { loadRevisionResolverFeature } = require('./tenantFeature.js')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENGINE_VERSION = 'ATTENDANCE_ENGINE_V3'
const CALCULATION_VERSION = 3
const RUNTIME_EXECUTION_MODE = 'REVISION_RESOLVER_ACTIVE_CAPABLE_READ_ONLY'
const RUNTIME_CAPABILITY = 'ACTIVE_CAPABLE'
const RESOLUTION_MODE_SHADOW = 'SHADOW'
const RESOLUTION_MODE_ACTIVE = 'ACTIVE'

class AttendanceRuntimeError extends Error {
  constructor(message, code = 'ATTENDANCE_RUNTIME_ERROR', cause) {
    super(message)
    this.name = 'AttendanceRuntimeError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function assertRegistroId(registroId) {
  if (typeof registroId !== 'string' || !UUID_PATTERN.test(registroId)) {
    throw new AttendanceRuntimeError('registro_id debe ser UUID.', 'RUNTIME_INPUT_INVALID')
  }
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'ATTENDANCE_RUNTIME_ERROR'
}

function summarizeEngineResult(engineResult, featureMode, durationMs, counters, deduplicated = false) {
  const resolution = engineResult.scheduleResolution || { kind: 'UNSCHEDULED' }
  return {
    registro_id: engineResult.registroId,
    tenant_id: engineResult.calculation.clienteId,
    employee_id: engineResult.calculation.empleadoId,
    operative_date: engineResult.operativeDate,
    assignment_id: resolution.scheduleAssignmentId || null,
    schedule_revision_id: resolution.scheduleRevisionId || null,
    revision_version: resolution.scheduleRevisionVersion || null,
    integrity_hash: resolution.scheduleRevisionHash || null,
    revision_integrity_hash: resolution.scheduleRevisionHash || null,
    resolution_mode: featureMode,
    execution_mode: engineResult.executionMode,
    persistence_mode: engineResult.persistenceMode,
    runtime_capability: RUNTIME_CAPABILITY,
    engine_version: ENGINE_VERSION,
    calculation_version: engineResult.calculation.calculationVersion,
    result: resolution.kind || 'SCHEDULED',
    error_code: null,
    duration_ms: durationMs,
    deduplicated,
    databaseWrites: counters.databaseWrites,
    persistenceCalls: 0,
    rpcWriteCalls: counters.rpcWriteCalls,
    storageWriteCalls: counters.storageWriteCalls,
    indirectSupabaseCalls: counters.indirectSupabaseCalls,
    incidentWriteCalls: 0,
  }
}

class AttendanceRuntimeService {
  constructor({ client, logger = console, orchestratorFactory, featureLoader = loadRevisionResolverFeature, runtimeCapability = 'SHADOW_ONLY' } = {}) {
    if (!client) throw new AttendanceRuntimeError('Se requiere cliente backend.', 'RUNTIME_CLIENT_REQUIRED')
    this.counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }
    this.client = createReadOnlyClient(client, this.counters)
    this.logger = logger
    this.featureLoader = featureLoader
    this.runtimeCapability = runtimeCapability
    this.orchestratorFactory = orchestratorFactory || (({ executionMode }) => new AttendanceEngineOrchestrator({
      repository: new SupabaseAttendanceReadRepository(this.client),
      executionMode,
      persistenceMode: READ_ONLY_PERSISTENCE_MODE,
      logger: this.logger,
      calculationVersion: CALCULATION_VERSION,
    }))
    this.inFlight = new Map()
  }

  async _loadTrustedRegistro(registroId) {
    const response = await this.client.from('registro_asistencia')
      .select('id,cliente_id,empleado_id,dispositivo_id,verificado_at')
      .eq('id', registroId)
      .maybeSingle()
    if (response.error) throw new AttendanceRuntimeError('No se pudo leer registro_asistencia.', 'RUNTIME_REGISTRO_READ_FAILED', response.error)
    if (!response.data) throw new AttendanceRuntimeError('registro_asistencia no existe.', 'REGISTRO_NOT_FOUND')
    if (!response.data.cliente_id || !response.data.empleado_id || !response.data.dispositivo_id) {
      throw new AttendanceRuntimeError('registro_asistencia no tiene identidad completa.', 'RUNTIME_REGISTRO_INVALID')
    }
    return response.data
  }

  async _execute(registroId, expectedResolutionMode) {
    const startedAt = Date.now()
    const telemetry = {
      registro_id: registroId,
      tenant_id: null,
      employee_id: null,
      operative_date: null,
      assignment_id: null,
      schedule_revision_id: null,
      revision_version: null,
      integrity_hash: null,
      resolution_mode: 'REVISION',
      engine_version: ENGINE_VERSION,
      calculation_version: CALCULATION_VERSION,
      result: 'ERROR',
    }
    try {
      const trustedRegistro = await this._loadTrustedRegistro(registroId)
      telemetry.tenant_id = trustedRegistro.cliente_id
      telemetry.employee_id = trustedRegistro.empleado_id
      const feature = await this.featureLoader(this.client, trustedRegistro.cliente_id)
      telemetry.resolution_mode = feature.mode
      if (expectedResolutionMode === RESOLUTION_MODE_ACTIVE && feature.mode !== RESOLUTION_MODE_ACTIVE) {
        throw new AttendanceRuntimeError('La ruta ACTIVE exige REVISION_SCHEDULE_RESOLVER ACTIVE.', 'RUNTIME_RESOLUTION_MODE_MISMATCH')
      }
      if (expectedResolutionMode === RESOLUTION_MODE_SHADOW && feature.mode === RESOLUTION_MODE_ACTIVE) {
        throw new AttendanceRuntimeError('La ruta SHADOW no puede ejecutar un tenant ACTIVE.', 'RUNTIME_RESOLUTION_MODE_MISMATCH')
      }
      if (feature.mode === 'OFF') {
        const result = {
        registro_id: registroId,
        tenant_id: trustedRegistro.cliente_id,
        employee_id: trustedRegistro.empleado_id,
        operative_date: null,
        assignment_id: null,
        schedule_revision_id: null,
        revision_version: null,
        integrity_hash: null,
        resolution_mode: 'OFF',
        execution_mode: 'OFF',
        persistence_mode: 'READ_ONLY',
        runtime_capability: RUNTIME_CAPABILITY,
        engine_version: ENGINE_VERSION,
        calculation_version: CALCULATION_VERSION,
        result: 'SKIPPED_FLAG_OFF',
        error_code: null,
        duration_ms: Date.now() - startedAt,
        deduplicated: false,
        databaseWrites: this.counters.databaseWrites,
        persistenceCalls: 0,
        rpcWriteCalls: this.counters.rpcWriteCalls,
        incidentWriteCalls: 0,
        storageWriteCalls: this.counters.storageWriteCalls,
        indirectSupabaseCalls: this.counters.indirectSupabaseCalls,
      }
        this.logger?.info?.('attendance_runtime_resolution', result)
        return result
      }
      const engineResult = await this.orchestratorFactory({
        executionMode: feature.mode,
        persistenceMode: READ_ONLY_PERSISTENCE_MODE,
      }).run({ registroId })
      if (engineResult.executionMode !== feature.mode || engineResult.persistenceMode !== READ_ONLY_PERSISTENCE_MODE) {
        throw new AttendanceRuntimeError('El engine no respetó la frontera de ejecución/persistencia solicitada.', 'RUNTIME_ENGINE_MODE_MISMATCH')
      }
      const result = summarizeEngineResult(engineResult, feature.mode, Date.now() - startedAt, this.counters)
      this.logger?.info?.('attendance_runtime_resolution', result)
      return result
    } catch (error) {
      this.logger?.error?.('attendance_runtime_resolution_failed', {
        ...telemetry,
        error_code: safeErrorCode(error),
        duration_ms: Date.now() - startedAt,
        databaseWrites: this.counters.databaseWrites,
        persistenceCalls: 0,
        rpcWriteCalls: this.counters.rpcWriteCalls,
        incidentWriteCalls: 0,
        storageWriteCalls: this.counters.storageWriteCalls,
        indirectSupabaseCalls: this.counters.indirectSupabaseCalls,
      })
      throw error
    }
  }

  async _executeDeduplicated({ registroId, expectedResolutionMode }) {
    assertRegistroId(registroId)
    const inFlightKey = `${expectedResolutionMode || 'OFF_OR_SHADOW'}:${registroId}`
    const existing = this.inFlight.get(inFlightKey)
    if (existing) {
      const prior = await existing
      return { ...prior, deduplicated: true }
    }
    const execution = this._execute(registroId, expectedResolutionMode)
    this.inFlight.set(inFlightKey, execution)
    try {
      return await execution
    } finally {
      this.inFlight.delete(inFlightKey)
    }
  }

  async executeShadow({ registroId } = {}) {
    return this._executeDeduplicated({ registroId, expectedResolutionMode: RESOLUTION_MODE_SHADOW })
  }

  async executeActive({ registroId } = {}) {
    if (this.runtimeCapability !== RUNTIME_CAPABILITY) {
      throw new AttendanceRuntimeError('Este runtime no tiene capacidad ACTIVE.', 'RUNTIME_ACTIVE_CAPABILITY_DISABLED')
    }
    return this._executeDeduplicated({ registroId, expectedResolutionMode: RESOLUTION_MODE_ACTIVE })
  }
}

module.exports = {
  AttendanceRuntimeService,
  AttendanceRuntimeError,
  ENGINE_VERSION,
  CALCULATION_VERSION,
  RUNTIME_EXECUTION_MODE,
  RUNTIME_CAPABILITY,
  RESOLUTION_MODE_SHADOW,
  RESOLUTION_MODE_ACTIVE,
  assertRegistroId,
  summarizeEngineResult,
}
