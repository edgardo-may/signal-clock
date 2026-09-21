'use strict'

/**
 * Phase 30 runtime composition for the attendance domain.
 *
 * It is deliberately not imported by a listener, webhook, trigger, queue, or
 * cron. A backend caller must invoke run() explicitly.  Its default is
 * SHADOW: reads are allowed, writes are not.
 */

const { isApprovedWorkdayPersistenceService } = require('./WorkdayPersistenceContract.js')

const DEFAULT_EXECUTION_MODE = 'SHADOW'
const ACTIVE_EXECUTION_MODE = 'ACTIVE'
const READ_ONLY_PERSISTENCE_MODE = 'READ_ONLY'
const PERSISTENCE_MODE = 'PERSIST'
// Legacy aliases preserve explicit existing canary tooling. New runtime code
// must use executionMode and persistenceMode, never the ambiguous mode field.
const DEFAULT_MODE = DEFAULT_EXECUTION_MODE
const PERSIST_MODE = PERSISTENCE_MODE

class AttendanceOrchestratorError extends Error {
  constructor(message, code = 'ATTENDANCE_ORCHESTRATOR_ERROR', cause) {
    super(message)
    this.name = 'AttendanceOrchestratorError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function assertNonBlank(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AttendanceOrchestratorError(`${field} es obligatorio.`, 'ORCHESTRATOR_INPUT_INVALID')
  }
}

function previousLocalDate(date) {
  const parts = date.split('-').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new AttendanceOrchestratorError('La fecha local del evento es inválida.', 'ORCHESTRATOR_DATE_INVALID')
  }
  const prior = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1))
  return prior.toISOString().slice(0, 10)
}

function isoInRange(timestamp, startUtc, endUtc) {
  const epoch = new Date(timestamp).getTime()
  return Number.isFinite(epoch) && epoch >= new Date(startUtc).getTime() && epoch <= new Date(endUtc).getTime()
}

function safeErrorCode(error, fallback) {
  return typeof error?.code === 'string' ? error.code : fallback
}

function revisionObservabilityErrorCode(code) {
  const mapping = {
    SCHEDULE_REVISION_REQUIRED: 'REVISION_MISSING',
    SCHEDULE_REVISION_NOT_FOUND: 'REVISION_MISSING',
    SCHEDULE_REVISION_HASH_MISMATCH: 'REVISION_HASH_MISMATCH',
    SCHEDULE_REVISION_TENANT_MISMATCH: 'REVISION_TENANT_MISMATCH',
    SCHEDULE_REVISION_SCHEDULE_MISMATCH: 'REVISION_SCHEDULE_MISMATCH',
    SCHEDULE_REVISION_CONTRACT_VERSION_UNSUPPORTED: 'REVISION_VERSION_UNSUPPORTED',
    SCHEDULE_REVISION_SNAPSHOT_INVALID: 'REVISION_CONFIG_INVALID',
    SHIFT_CONFIG_ERROR: 'REVISION_CONFIG_INVALID',
    AMBIGUOUS_SCHEDULE: 'MULTIPLE_APPLICABLE_ASSIGNMENTS',
  }
  return mapping[code] || code
}

function calculateState(metrics, isUnscheduled) {
  if (isUnscheduled) return 'UNSCHEDULED'
  if (metrics.sourceLogIds.length === 0) return 'ABSENT'
  if (metrics.missingEntry || metrics.missingExit) return 'INCOMPLETE'
  return 'COMPLETE'
}

function addNightMinutes(domain, metrics, timezone) {
  let total = 0
  for (const segment of metrics.segments) {
    if (segment.segmentType === 'WORK' && segment.endPunch) {
      const minutes = domain.WorkdayCalculator.calculateNocturnalMinutes(
        segment.startPunch.epochMs,
        segment.endPunch.epochMs,
        timezone
      )
      segment.isNocturnalMinutes = minutes
      total += minutes
    }
  }
  metrics.nightShiftMinutes = total
}

function toDispositions(normalization, match) {
  const outOfWindow = new Set(match.outOfWindowPunches.map((punch) => punch.id))
  return normalization.dispositions.map((disposition) => (
    disposition.disposition === 'USED' && outOfWindow.has(disposition.logId)
      ? { ...disposition, disposition: 'OUT_OF_WINDOW', reason: 'Fuera de la ventana operativa del turno.' }
      : disposition
  ))
}

function structuredLog(result, executionMode, persistenceMode, persistenceResult) {
  const resolution = result.scheduleResolution || null
  return {
    registroId: result.registroId,
    clienteId: result.workdayRecord.cliente_id,
    empleadoId: result.workdayRecord.empleado_id,
    deviceId: result.deviceId,
    scheduleId: result.workdayRecord.schedule_id,
    operativeDate: result.workdayRecord.workday_date,
    timezone: result.workdayRecord.timezone,
    workdayState: result.workdayRecord.status,
    workedMinutes: result.workdayRecord.worked_minutes,
    breakMinutes: result.workdayRecord.break_minutes,
    overtimeMinutes: result.workdayRecord.overtime_minutes,
    lateMinutes: result.workdayRecord.late_minutes,
    earlyLeaveMinutes: result.workdayRecord.early_leave_minutes,
    integrityHash: result.workdayRecord.integrity_hash,
    execution_mode: executionMode,
    persistence_mode: persistenceMode,
    // Stable, secret-free revision-resolution audit fields. These contain no
    // snapshot configuration and are suitable for structured log indexing.
    tenant_id: result.workdayRecord.cliente_id,
    employee_id: result.workdayRecord.empleado_id,
    operative_date: result.workdayRecord.workday_date,
    assignment_id: resolution?.scheduleAssignmentId ?? null,
    schedule_revision_id: resolution?.scheduleRevisionId ?? null,
    revision_version: resolution?.scheduleRevisionVersion ?? null,
    revision_integrity_hash: resolution?.scheduleRevisionHash ?? null,
    resolution_mode: resolution?.kind === 'SCHEDULED' ? 'REVISION' : 'UNSCHEDULED',
    resolution_result: resolution?.kind ?? 'UNSCHEDULED',
    error_code: null,
    ...(persistenceResult ? { persistenceResult } : {}),
  }
}

/**
 * A read-only repository implemented against an injected backend Supabase
 * client.  Every relationship lookup includes cliente_id; repository responses
 * are also revalidated by the orchestrator and pure domain adapters.
 */
class SupabaseAttendanceReadRepository {
  constructor(client) {
    if (!client || typeof client.from !== 'function') {
      throw new AttendanceOrchestratorError('Se requiere un cliente backend de lectura.', 'BACKEND_CLIENT_REQUIRED')
    }
    this.client = client
  }

  async _single(query, label) {
    const { data, error } = await query.maybeSingle()
    if (error) throw new AttendanceOrchestratorError(`${label} no pudo cargarse.`, 'BACKEND_READ_FAILED', error)
    return data || null
  }

  async loadRegistro(registroId) {
    return this._single(
      this.client.from('registro_asistencia')
        .select('id, cliente_id, empleado_id, dispositivo_id, verificado_at, tipo_verificacion, metodo, source_event_id, es_manual')
        .eq('id', registroId),
      'registro_asistencia'
    )
  }

  async getAttendanceById(registroId) {
    return this._single(
      this.client.from('registro_asistencia')
        .select('id, cliente_id, empleado_id, dispositivo_id, verificado_at, tipo_verificacion, metodo, source_event_id, es_manual')
        .eq('id', registroId),
      'registro_asistencia'
    )
  }

  async loadDevice({ clienteId, deviceId }) {
    return this._single(
      this.client.from('devices').select('id, cliente_id, timezone')
        .eq('id', deviceId).eq('cliente_id', clienteId),
      'device'
    )
  }

  async getDeviceForTenant(deviceId, clienteId) {
    return this.loadDevice({ deviceId, clienteId })
  }

  async loadEmployee({ clienteId, empleadoId }) {
    return this._single(
      this.client.from('empleados').select('id, cliente_id')
        .eq('id', empleadoId).eq('cliente_id', clienteId),
      'employee'
    )
  }

  async getEmployeeForTenant(employeeId, clienteId) {
    return this.loadEmployee({ empleadoId: employeeId, clienteId })
  }

  async getScheduleAssignments(employeeId, clienteId, candidateDate) {
    if (typeof candidateDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)) {
      throw new AttendanceOrchestratorError('candidateDate debe ser YYYY-MM-DD.', 'BACKEND_READ_INPUT_INVALID')
    }
    const response = await this.client.from('empleados_horarios')
      .select('id, cliente_id, empleado_id, horario_id, schedule_revision_id, fecha_inicio, fecha_fin, activo')
      .eq('cliente_id', clienteId).eq('empleado_id', employeeId).eq('activo', true)
      .lte('fecha_inicio', candidateDate)
      .or(`fecha_fin.is.null,fecha_fin.gte.${candidateDate}`)
    if (response.error) {
      throw new AttendanceOrchestratorError('No se pudieron cargar asignaciones vigentes.', 'BACKEND_READ_FAILED', response.error)
    }
    return response.data || []
  }

  async loadScheduleContext({ clienteId, empleadoId }) {
    const assignmentsResponse = await this.client.from('empleados_horarios')
      .select('id, cliente_id, empleado_id, horario_id, schedule_revision_id, fecha_inicio, fecha_fin, activo')
      .eq('cliente_id', clienteId).eq('empleado_id', empleadoId).eq('activo', true)
    if (assignmentsResponse.error) {
      throw new AttendanceOrchestratorError('No se pudieron cargar empleados_horarios.', 'BACKEND_READ_FAILED', assignmentsResponse.error)
    }

    const assignments = assignmentsResponse.data || []
    // This is a bounded set read, not an N+1 relation lookup. Do not read
    // public.horarios here: the immutable revision is the sole calculation
    // input. A missing row remains observable to ScheduleResolver as a
    // SCHEDULE_REVISION_NOT_FOUND failure, never as a live-schedule fallback.
    const revisionIds = [...new Set(assignments.map((assignment) => assignment.schedule_revision_id).filter(Boolean))]
    if (revisionIds.length === 0) return { assignments, revisions: [] }

    const revisionsResponse = await this.client.from('schedule_revisions')
      .select('id, cliente_id, horario_id, version, config_snapshot, integrity_hash')
      .eq('cliente_id', clienteId)
      .in('id', revisionIds)
    if (revisionsResponse.error) {
      throw new AttendanceOrchestratorError('No se pudieron cargar schedule_revisions.', 'BACKEND_READ_FAILED', revisionsResponse.error)
    }

    return { assignments, revisions: revisionsResponse.data || [] }
  }

  async loadAttendanceEvents({ clienteId, empleadoId, startUtc, endUtc }) {
    const response = await this.client.from('registro_asistencia')
      .select('id, cliente_id, empleado_id, dispositivo_id, verificado_at, tipo_verificacion, metodo, source_event_id, es_manual')
      .eq('cliente_id', clienteId).eq('empleado_id', empleadoId)
      .gte('verificado_at', startUtc).lte('verificado_at', endUtc)
      .order('verificado_at', { ascending: true }).order('id', { ascending: true })
    if (response.error) throw new AttendanceOrchestratorError('No se pudo cargar la ventana de eventos.', 'BACKEND_READ_FAILED', response.error)
    return response.data || []
  }

  async getAttendanceWindow(employeeId, clienteId, fromTimestamp, toTimestamp) {
    const response = await this.client.from('registro_asistencia')
      .select('id, cliente_id, empleado_id, dispositivo_id, verificado_at, tipo_verificacion, metodo, source_event_id, es_manual')
      .eq('cliente_id', clienteId).eq('empleado_id', employeeId)
      .gte('verificado_at', fromTimestamp).lte('verificado_at', toTimestamp)
      .order('verificado_at', { ascending: true }).order('id', { ascending: true })
    if (response.error) throw new AttendanceOrchestratorError('No se pudo cargar la ventana de eventos.', 'BACKEND_READ_FAILED', response.error)
    return response.data || []
  }

  async loadDevices({ clienteId, deviceIds }) {
    if (deviceIds.length === 0) return []
    const response = await this.client.from('devices').select('id, cliente_id, timezone')
      .eq('cliente_id', clienteId).in('id', deviceIds)
    if (response.error) throw new AttendanceOrchestratorError('No se pudieron cargar devices de la ventana.', 'BACKEND_READ_FAILED', response.error)
    return response.data || []
  }
}

async function defaultDomainLoader() {
  // Node's native type-stripping loader (Node 22+) can consume these pure
  // domain modules without bundling them into the frontend. A deployment must
  // use that supported backend runtime or inject an equivalent compiled domain.
  return import('../../../src/domain/attendance/index.ts')
}

class AttendanceEngineOrchestrator {
  /**
   * @param {{repository: object, executionMode?: 'SHADOW'|'ACTIVE', persistenceMode?: 'READ_ONLY'|'PERSIST', mode?: 'SHADOW'|'PERSIST', persistenceService?: object, domain?: object, domainLoader?: () => Promise<object>, logger?: object, calculationVersion?: number, traceCollector?: (trace: object) => void}} options
   */
  constructor(options = {}) {
    if (!options.repository) {
      throw new AttendanceOrchestratorError('Se requiere un repositorio de asistencia backend.', 'REPOSITORY_REQUIRED')
    }
    this.repository = options.repository
    if (options.mode !== undefined && (options.executionMode !== undefined || options.persistenceMode !== undefined)) {
      throw new AttendanceOrchestratorError('mode legado no puede mezclarse con executionMode/persistenceMode.', 'MODE_CONFIGURATION_AMBIGUOUS')
    }
    const legacyMode = options.mode
    if (legacyMode !== undefined && legacyMode !== DEFAULT_MODE && legacyMode !== PERSIST_MODE) {
      throw new AttendanceOrchestratorError('El mode legado de engine backend es invalido.', 'MODE_INVALID')
    }
    this.executionMode = legacyMode === undefined ? (options.executionMode || DEFAULT_EXECUTION_MODE) : DEFAULT_EXECUTION_MODE
    this.persistenceMode = legacyMode === undefined ? (options.persistenceMode || READ_ONLY_PERSISTENCE_MODE) : (legacyMode === PERSIST_MODE ? PERSISTENCE_MODE : READ_ONLY_PERSISTENCE_MODE)
    if (![DEFAULT_EXECUTION_MODE, ACTIVE_EXECUTION_MODE].includes(this.executionMode)) {
      throw new AttendanceOrchestratorError('executionMode de engine backend es invalido.', 'EXECUTION_MODE_INVALID')
    }
    if (![READ_ONLY_PERSISTENCE_MODE, PERSISTENCE_MODE].includes(this.persistenceMode)) {
      throw new AttendanceOrchestratorError('persistenceMode de engine backend es invalido.', 'PERSISTENCE_MODE_INVALID')
    }
    if (this.persistenceMode === PERSISTENCE_MODE && !isApprovedWorkdayPersistenceService(options.persistenceService)) {
      throw new AttendanceOrchestratorError('PERSIST requiere WorkdayPersistenceService backend.', 'PERSISTENCE_SERVICE_REQUIRED')
    }
    this.persistenceService = options.persistenceService || null
    this.domain = options.domain || null
    this.domainLoader = options.domainLoader || defaultDomainLoader
    this.logger = options.logger || console
    this.calculationVersion = options.calculationVersion || 3
    // Optional diagnostic observer. It is called only with computation-local
    // data and has no authority to alter events, matching, metrics, or writes.
    this.traceCollector = typeof options.traceCollector === 'function' ? options.traceCollector : null
  }

  async _domain() {
    const domain = this.domain || await this.domainLoader()
    const required = [
      'RegistroAttendanceAdapter', 'ScheduleResolver', 'AttendanceNormalizer',
      'ShiftMatcher', 'WorkdayCalculator', 'WorkdayIntegrityHasher', 'toWorkdayRecordWriteModel',
      'pairingWarningCodes', 'getLocalComponents', 'localToUtcIso',
    ]
    for (const name of required) {
      if (!domain || typeof domain[name] === 'undefined') {
        throw new AttendanceOrchestratorError(`El dominio backend carece de ${name}.`, 'DOMAIN_COMPONENT_MISSING')
      }
    }
    return domain
  }

  _eventWindow(domain, selection, timezone) {
    if (selection.kind === 'SCHEDULED') {
      const start = selection.match.scheduledStartUtc
      const end = selection.match.scheduledEndUtc
      if (!start || !end) throw new AttendanceOrchestratorError('ShiftMatcher no resolvió la ventana del turno.', 'EVENT_WINDOW_INVALID')
      const before = selection.resolution.shift.windowBeforeStartMinutes ?? 120
      const after = selection.resolution.shift.windowAfterEndMinutes ?? 180
      return {
        startUtc: new Date(new Date(start).getTime() - before * 60000).toISOString(),
        endUtc: new Date(new Date(end).getTime() + after * 60000).toISOString(),
      }
    }
    return {
      startUtc: domain.localToUtcIso(selection.operativeDate, '00:00:00', timezone),
      endUtc: domain.localToUtcIso(selection.operativeDate, '23:59:59', timezone),
    }
  }

  async _selectWorkday(domain, anchorEvent, scheduleContext) {
    const candidateDates = [anchorEvent.localEventDate, previousLocalDate(anchorEvent.localEventDate)]
    const scheduled = []
    let sawScheduledCandidate = false
    for (const candidateDate of candidateDates) {
      const resolution = domain.ScheduleResolver.resolve({
        clienteId: anchorEvent.clienteId,
        empleadoId: anchorEvent.empleadoId,
        candidateDate,
        assignments: scheduleContext.assignments,
        revisions: scheduleContext.revisions,
      })
      if (resolution.kind !== 'SCHEDULED') continue
      sawScheduledCandidate = true
      const normalized = domain.AttendanceNormalizer.normalize(
        [anchorEvent.rawPunch], anchorEvent.timezone, anchorEvent.clienteId, anchorEvent.empleadoId
      )
      const match = domain.ShiftMatcher.match(resolution.shift, normalized.accepted, anchorEvent.timezone)
      if (match.matchedPunches.some((punch) => punch.id === anchorEvent.eventId)) {
        scheduled.push({ kind: 'SCHEDULED', resolution, match, operativeDate: candidateDate })
      }
    }

    if (scheduled.length > 1) {
      throw new AttendanceOrchestratorError('El evento pertenece a más de una ventana operativa.', 'AMBIGUOUS_OPERATIVE_WINDOW')
    }
    if (scheduled.length === 1) return scheduled[0]
    if (sawScheduledCandidate) {
      throw new AttendanceOrchestratorError('El evento no pertenece a una ventana válida del horario resuelto.', 'EVENT_OUTSIDE_SCHEDULE_WINDOW')
    }

    // The domain UNSCHEDULED contract is a local calendar window with an
    // explicit operative date. It never invents a schedule_id.
    const operativeDate = anchorEvent.localEventDate
    const shift = {
      id: 'UNSCHEDULED', name: 'UNSCHEDULED', operativeDate,
      startTime: '', endTime: '', isRestDay: true, toleranceMinutes: 0, hasBreak: false,
    }
    const normalized = domain.AttendanceNormalizer.normalize(
      [anchorEvent.rawPunch], anchorEvent.timezone, anchorEvent.clienteId, anchorEvent.empleadoId
    )
    return {
      kind: 'UNSCHEDULED', operativeDate,
      match: domain.ShiftMatcher.match(shift, normalized.accepted, anchorEvent.timezone),
      resolution: null,
    }
  }

  /**
   * Explicit-only execution. executionMode and persistenceMode belong to
   * backend construction/configuration, never a client request.
   */
  async run({ registroId, registro } = {}) {
    if ((registroId && registro) || (!registroId && !registro)) {
      throw new AttendanceOrchestratorError('Proporcione exactamente registroId o registro.', 'ORCHESTRATOR_INPUT_INVALID')
    }
    if (registroId) assertNonBlank(registroId, 'registroId')

    const resolutionTelemetry = {
      tenant_id: null,
      employee_id: null,
      operative_date: null,
      assignment_id: null,
      schedule_revision_id: null,
      revision_version: null,
      revision_integrity_hash: null,
      resolution_mode: 'REVISION',
      resolution_result: 'ERROR',
    }
    try {
      const domain = await this._domain()
      const sourceRegistro = registro || await this.repository.loadRegistro(registroId)
      if (!sourceRegistro) throw new AttendanceOrchestratorError('registro_asistencia no existe.', 'REGISTRO_NOT_FOUND')
      assertNonBlank(sourceRegistro.id, 'registro_asistencia.id')
      assertNonBlank(sourceRegistro.cliente_id, 'registro_asistencia.cliente_id')
      assertNonBlank(sourceRegistro.empleado_id, 'registro_asistencia.empleado_id')
      if (!sourceRegistro.dispositivo_id) {
        throw new AttendanceOrchestratorError('registro_asistencia.dispositivo_id es obligatorio para una fuente física.', 'UNSUPPORTED_SOURCE_TIMEZONE')
      }

      const tenant = sourceRegistro.cliente_id
      const employeeId = sourceRegistro.empleado_id
      resolutionTelemetry.tenant_id = tenant
      resolutionTelemetry.employee_id = employeeId
      const device = await this.repository.loadDevice({ clienteId: tenant, deviceId: sourceRegistro.dispositivo_id })
      if (!device || device.id !== sourceRegistro.dispositivo_id || device.cliente_id !== tenant) {
        throw new AttendanceOrchestratorError('Device inexistente o de otra Empresa.', 'TENANT_MISMATCH')
      }
      const employee = await this.repository.loadEmployee({ clienteId: tenant, empleadoId: employeeId })
      if (!employee || employee.id !== employeeId || employee.cliente_id !== tenant) {
        throw new AttendanceOrchestratorError('Employee inexistente o de otra Empresa.', 'TENANT_MISMATCH')
      }

      const anchorEvent = domain.RegistroAttendanceAdapter.fromRegistro(sourceRegistro, device)
      const scheduleContext = await this.repository.loadScheduleContext({ clienteId: tenant, empleadoId: employeeId })
      const selection = await this._selectWorkday(domain, anchorEvent, scheduleContext)
      resolutionTelemetry.operative_date = selection.operativeDate
      if (selection.kind === 'SCHEDULED') {
        resolutionTelemetry.assignment_id = selection.resolution.scheduleAssignmentId
        resolutionTelemetry.schedule_revision_id = selection.resolution.scheduleRevisionId
        resolutionTelemetry.revision_version = selection.resolution.scheduleRevisionVersion
        resolutionTelemetry.revision_integrity_hash = selection.resolution.scheduleRevisionHash
        resolutionTelemetry.resolution_result = 'SCHEDULED'
      } else {
        resolutionTelemetry.resolution_mode = 'UNSCHEDULED'
        resolutionTelemetry.resolution_result = 'UNSCHEDULED'
      }
      const eventWindow = this._eventWindow(domain, selection, anchorEvent.timezone)
      const events = await this.repository.loadAttendanceEvents({
        clienteId: tenant, empleadoId: employeeId, ...eventWindow,
      })
      if (!events.some((event) => event.id === sourceRegistro.id)) events.push(sourceRegistro)
      events.sort((a, b) => {
        const timestampOrder = String(a.verificado_at) < String(b.verificado_at) ? -1 :
          String(a.verificado_at) > String(b.verificado_at) ? 1 : 0
        if (timestampOrder !== 0) return timestampOrder
        return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
      })

      for (const event of events) {
        if (event.cliente_id !== tenant || event.empleado_id !== employeeId || !isoInRange(event.verificado_at, eventWindow.startUtc, eventWindow.endUtc)) {
          throw new AttendanceOrchestratorError('Evento fuera del tenant, empleado o rango solicitado.', 'TENANT_MISMATCH')
        }
      }
      const deviceIds = [...new Set(events.map((event) => event.dispositivo_id).filter(Boolean))]
      const windowDevices = await this.repository.loadDevices({ clienteId: tenant, deviceIds })
      const devicesById = new Map(windowDevices.map((row) => [row.id, row]))
      const domainEvents = events.map((event) => {
        const eventDevice = devicesById.get(event.dispositivo_id)
        if (!eventDevice || eventDevice.cliente_id !== tenant) {
          throw new AttendanceOrchestratorError('Device de evento inexistente o cross-tenant.', 'TENANT_MISMATCH')
        }
        const adapted = domain.RegistroAttendanceAdapter.fromRegistro(event, eventDevice)
        if (adapted.timezone !== anchorEvent.timezone) {
          throw new AttendanceOrchestratorError('La ventana contiene devices con zonas horarias incompatibles.', 'EVENT_TIMEZONE_MISMATCH')
        }
        return adapted
      })

      const normalization = domain.AttendanceNormalizer.normalize(
        domainEvents.map((event) => event.rawPunch), anchorEvent.timezone, tenant, employeeId
      )
      const match = domain.ShiftMatcher.match(
        selection.kind === 'SCHEDULED' ? selection.resolution.shift : {
          id: 'UNSCHEDULED', name: 'UNSCHEDULED', operativeDate: selection.operativeDate,
          startTime: '', endTime: '', isRestDay: true, toleranceMinutes: 0, hasBreak: false,
        },
        normalization.accepted,
        anchorEvent.timezone
      )
      const metrics = domain.WorkdayCalculator.calculate(match, anchorEvent.timezone, {
        timezone: anchorEvent.timezone, operativeDate: selection.operativeDate, calculationVersion: this.calculationVersion,
      })
      addNightMinutes(domain, metrics, anchorEvent.timezone)
      const workdayState = calculateState(metrics, selection.kind === 'UNSCHEDULED')
      const calculationWarnings = domain.pairingWarningCodes(metrics)
      const integrityHash = domain.WorkdayIntegrityHasher.computeHash({
        clienteId: tenant, empleadoId: employeeId, operativeDate: selection.operativeDate, timezone: anchorEvent.timezone,
        scheduleId: selection.kind === 'SCHEDULED' ? selection.resolution.scheduleId : undefined,
        scheduledStart: match.scheduledStartUtc, scheduledEnd: match.scheduledEndUtc,
        actualStart: metrics.actualStart, actualEnd: metrics.actualEnd,
        workedMinutes: metrics.workedMinutes, breakMinutes: metrics.breakMinutes, effectiveMinutes: metrics.effectiveMinutes,
        lateMinutes: metrics.lateMinutes, earlyLeaveMinutes: metrics.earlyLeaveMinutes,
        ordinaryMinutes: metrics.ordinaryMinutes, overtimeMinutes: metrics.overtimeMinutes,
        status: workdayState, sourceLogIds: metrics.sourceLogIds,
        // Warnings are integrity-protected evidence, not HR incident records.
        incidentCodes: [], warningCodes: calculationWarnings, calculationVersion: this.calculationVersion,
      })
      const calculation = {
        clienteId: tenant, empleadoId: employeeId, operativeDate: selection.operativeDate, timezone: anchorEvent.timezone,
        shiftType: match.shiftType, isRestDay: match.isRestDay, isHoliday: match.isHoliday,
        scheduledStart: match.scheduledStartUtc, scheduledEnd: match.scheduledEndUtc, scheduledMinutes: match.scheduledMinutes,
        actualStart: metrics.actualStart, actualEnd: metrics.actualEnd,
        workedMinutes: metrics.workedMinutes, breakMinutes: metrics.breakMinutes, effectiveMinutes: metrics.effectiveMinutes,
        lateMinutes: metrics.lateMinutes, earlyLeaveMinutes: metrics.earlyLeaveMinutes,
        ordinaryMinutes: metrics.ordinaryMinutes, overtimeMinutes: metrics.overtimeMinutes, nightShiftMinutes: metrics.nightShiftMinutes,
        workdayState, missingEntry: metrics.missingEntry, missingExit: metrics.missingExit,
        segments: metrics.segments, sourceLogIds: metrics.sourceLogIds, punchDispositions: toDispositions(normalization, match),
        devicesInvolved: metrics.devicesInvolved, supplementalEvents: metrics.supplementalEvents,
        warnings: calculationWarnings, incidents: [], calculationVersion: this.calculationVersion, integrityHash,
      }
      if (this.traceCollector) {
        // pairPunches is a public, pure method and this second invocation only
        // exposes the exact pairing policy already used by calculate().
        this.traceCollector({
          eventWindow,
          sourceEvents: events.map((event) => ({
            id: event.id, cliente_id: event.cliente_id, empleado_id: event.empleado_id,
            dispositivo_id: event.dispositivo_id, verificado_at: event.verificado_at,
            tipo_verificacion: event.tipo_verificacion,
          })),
          normalizedEvents: normalization.accepted,
          dispositions: toDispositions(normalization, match),
          scheduleResolution: selection.kind === 'SCHEDULED' ? selection.resolution : null,
          match,
          pairing: domain.WorkdayCalculator.pairPunches(match.matchedPunches),
          metrics,
          calculation,
        })
      }
      const workdayRecord = domain.toWorkdayRecordWriteModel(
        calculation, selection.kind === 'SCHEDULED' ? selection.resolution.scheduleId : null, sourceRegistro.id
      )
      // The worker transport clock is never a persistence authority.  These
      // values are derived from the canonical, tenant-scoped registros that
      // produced this calculation and let the database reject a stale subset.
      const sourceEventsById = new Map(events.map((event) => [event.id, event]))
      const sourceObservedAt = [...sourceEventsById.values()].map((event) => event.verificado_at).sort().at(-1)
      if (!sourceObservedAt) throw new AttendanceOrchestratorError('La evidencia de fuentes esta vacia.', 'SOURCE_EVIDENCE_REQUIRED')
      workdayRecord.source_observed_at = sourceObservedAt
      workdayRecord.source_event_count = sourceEventsById.size
      const result = {
        registroId: sourceRegistro.id, deviceId: sourceRegistro.dispositivo_id,
        executionMode: this.executionMode, persistenceMode: this.persistenceMode,
        eventWindow, eventCount: events.length, normalizedEventCount: normalization.accepted.length,
        calculationWarnings: calculation.warnings || [], operativeDate: selection.operativeDate,
        scheduleResolution: selection.kind === 'SCHEDULED' ? selection.resolution : { kind: 'UNSCHEDULED' },
        calculation, workdayRecord,
      }

      if (this.persistenceMode === PERSISTENCE_MODE) {
        let persistence
        try {
          persistence = await this.persistenceService.persist(workdayRecord)
        } catch (error) {
          throw new AttendanceOrchestratorError('La persistencia RPC falló; no existe fallback de escritura.', safeErrorCode(error, 'PERSISTENCE_FAILED'), error)
        }
        result.persistenceResult = persistence.persistenceResult
        result.workdayId = persistence.workdayId
      }
      this.logger?.info?.('attendance_engine_orchestrator', structuredLog(result, this.executionMode, this.persistenceMode, result.persistenceResult))
      return result
    } catch (error) {
      const domainCode = safeErrorCode(error, 'ATTENDANCE_ORCHESTRATOR_ERROR')
      this.logger?.error?.('attendance_engine_orchestrator_failed', {
        registroId: registroId || registro?.id || null,
        execution_mode: this.executionMode,
        persistence_mode: this.persistenceMode,
        ...resolutionTelemetry,
        error_code: revisionObservabilityErrorCode(domainCode),
        domain_error_code: domainCode,
      })
      throw error
    }
  }
}

module.exports = {
  AttendanceEngineOrchestrator,
  AttendanceOrchestratorError,
  SupabaseAttendanceReadRepository,
  DEFAULT_EXECUTION_MODE,
  ACTIVE_EXECUTION_MODE,
  READ_ONLY_PERSISTENCE_MODE,
  PERSISTENCE_MODE,
  DEFAULT_MODE,
  PERSIST_MODE,
  calculateState,
  revisionObservabilityErrorCode,
}
