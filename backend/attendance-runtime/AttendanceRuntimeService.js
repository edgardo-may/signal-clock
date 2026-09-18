'use strict'

const {
  AttendanceEngineOrchestrator,
  SupabaseAttendanceReadRepository,
} = require('../services/attendance/AttendanceEngineOrchestrator.js')
const { createReadOnlyClient } = require('./readOnlySupabase.js')
const { loadRevisionResolverFeature } = require('./tenantFeature.js')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENGINE_VERSION = 'ATTENDANCE_ENGINE_V3'
const CALCULATION_VERSION = 3

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
    resolution_mode: featureMode,
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
  constructor({ client, logger = console, orchestratorFactory, featureLoader = loadRevisionResolverFeature } = {}) {
    if (!client) throw new AttendanceRuntimeError('Se requiere cliente backend.', 'RUNTIME_CLIENT_REQUIRED')
    this.counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }
    this.client = createReadOnlyClient(client, this.counters)
    this.logger = logger
    this.featureLoader = featureLoader
    this.orchestratorFactory = orchestratorFactory || (() => new AttendanceEngineOrchestrator({
      repository: new SupabaseAttendanceReadRepository(this.client),
      mode: 'SHADOW',
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

  async _execute(registroId) {
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
      const engineResult = await this.orchestratorFactory().run({ registroId })
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

  async executeShadow({ registroId } = {}) {
    assertRegistroId(registroId)
    const existing = this.inFlight.get(registroId)
    if (existing) {
      const prior = await existing
      return { ...prior, deduplicated: true }
    }
    const execution = this._execute(registroId)
    this.inFlight.set(registroId, execution)
    try {
      return await execution
    } finally {
      this.inFlight.delete(registroId)
    }
  }
}

module.exports = {
  AttendanceRuntimeService,
  AttendanceRuntimeError,
  ENGINE_VERSION,
  CALCULATION_VERSION,
  assertRegistroId,
  summarizeEngineResult,
}
