'use strict'

/**
 * Future Production SHADOW Canary — manual-only, no persistence capability in
 * this module. The only candidate is fixed by the Phase 32.2 SQL review.
 */

const { createClient } = require('@supabase/supabase-js')
const path = require('path')
const {
  AttendanceEngineOrchestrator,
  SupabaseAttendanceReadRepository,
} = require('../services/attendance/AttendanceEngineOrchestrator.js')

const APPROVED_REGISTRO_ID = '7f99cef9-4100-48ff-9aaf-68548c80c948'
const APPROVED_TENANT_ID = '69095bd5-fee5-4237-a1a4-186dd88310ff'
const APPROVED_EMPLOYEE_ID = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'
const APPROVED_DEVICE_ID = 'f693aea8-9f80-4e81-a99c-91b39e6d66d9'
const APPROVED_SCHEDULE_ID = 'be4035c8-042c-473b-b25d-b5bf3fb99701'
const APPROVED_OPERATIVE_DATE = '2026-09-03'
const APPROVED_TIMEZONE = 'America/Cancun'
const WINDOW_START = '2026-09-03T09:00:00.000Z'
const WINDOW_END = '2026-09-03T22:00:00.000Z'

class ProductionShadowGuardError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ProductionShadowGuardError'
    this.code = code
  }
}

function requireEnv(name, environment) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProductionShadowGuardError(`Falta la configuración requerida ${name}.`, 'SHADOW_ENV_MISSING')
  }
  return value.trim()
}

function readProductionShadowConfig(registroId = APPROVED_REGISTRO_ID, environment = process.env) {
  const url = requireEnv('SUPABASE_URL', environment)
  const allowedHost = requireEnv('SHADOW_CANARY_ALLOWED_HOST', environment).toLowerCase()
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', environment)
  const targetEnvironment = requireEnv('SHADOW_CANARY_ENVIRONMENT', environment)
  const confirmation = requireEnv('SHADOW_CANARY_CONFIRMATION', environment)

  let target
  try {
    target = new URL(url)
  } catch {
    throw new ProductionShadowGuardError('SUPABASE_URL no es una URL válida.', 'SHADOW_DESTINATION_INVALID')
  }
  if (target.protocol !== 'https:' || target.hostname.toLowerCase() !== allowedHost) {
    throw new ProductionShadowGuardError('El destino no coincide exactamente con SHADOW_CANARY_ALLOWED_HOST.', 'SHADOW_DESTINATION_DENIED')
  }
  if (targetEnvironment !== 'PRODUCTION_SHADOW') {
    throw new ProductionShadowGuardError('SHADOW_CANARY_ENVIRONMENT debe confirmar PRODUCTION_SHADOW.', 'SHADOW_ENVIRONMENT_DENIED')
  }
  if (confirmation !== 'I_APPROVE_READ_ONLY_SHADOW') {
    throw new ProductionShadowGuardError('Falta la confirmación explícita de operación read-only SHADOW.', 'SHADOW_CONFIRMATION_DENIED')
  }
  if (registroId !== APPROVED_REGISTRO_ID) {
    throw new ProductionShadowGuardError('El registro no coincide con el único candidato aprobado.', 'SHADOW_CANDIDATE_DENIED')
  }

  return { url, serviceRoleKey, registroId, host: target.hostname }
}

function sanitizedEnvironmentCheck(environment = process.env) {
  const url = typeof environment.SUPABASE_URL === 'string' ? environment.SUPABASE_URL.trim() : ''
  let host = 'UNAVAILABLE'
  try {
    host = new URL(url).hostname || 'UNAVAILABLE'
  } catch {
    // The detailed validation below reports the non-secret failure code.
  }

  try {
    const config = readProductionShadowConfig(APPROVED_REGISTRO_ID, environment)
    return {
      mode: 'ENV_CHECK',
      envReady: true,
      supabaseHost: config.host,
      destinationGuard: 'PASS',
      serviceRolePresent: true,
      persistenceServiceReachable: false,
      upsertRpcReachable: false,
    }
  } catch (error) {
    return {
      mode: 'ENV_CHECK',
      envReady: false,
      supabaseHost: host,
      destinationGuard: 'FAIL',
      serviceRolePresent: typeof environment.SUPABASE_SERVICE_ROLE_KEY === 'string' && environment.SUPABASE_SERVICE_ROLE_KEY.trim() !== '',
      persistenceServiceReachable: false,
      upsertRpcReachable: false,
      code: error.code || 'SHADOW_ENV_CHECK_FAILED',
    }
  }
}

function readOnlyQueryGuard(query, counters) {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === 'then') return target.then?.bind(target)
      if (['insert', 'update', 'delete', 'upsert'].includes(property)) {
        return () => {
          counters.writeCalls++
          throw new ProductionShadowGuardError('El smoke READ_ONLY bloqueó una escritura.', 'SHADOW_WRITE_DENIED')
        }
      }
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args) => {
        const result = value.apply(target, args)
        // Supabase query builders are thenable. Keep the guard around those as
        // well: a select() builder must never regain its write/RPC methods.
        return result && typeof result === 'object' ? readOnlyQueryGuard(result, counters) : result
      }
    },
  })
}

function createReadOnlyClient(client, counters) {
  return {
    from(table) {
      return readOnlyQueryGuard(client.from(table), counters)
    },
    rpc() {
      counters.rpcWriteCalls++
      throw new ProductionShadowGuardError('El smoke READ_ONLY bloqueó una RPC.', 'SHADOW_RPC_DENIED')
    },
  }
}

function safeEventType(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['entrada', 'salida', '0', '1', '2', '3'].includes(normalized)) return normalized || 'UNSPECIFIED'
  return 'OTHER'
}

async function runProductionReadSmoke(
  registroId,
  environment = process.env,
  dependencies = { createClient }
) {
  const config = readProductionShadowConfig(registroId, environment)
  const counters = { writeCalls: 0, persistenceCalls: 0, rpcWriteCalls: 0 }
  const baseClient = dependencies.createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const repository = new SupabaseAttendanceReadRepository(createReadOnlyClient(baseClient, counters))
  const attendance = await repository.getAttendanceById(APPROVED_REGISTRO_ID)
  if (!attendance || attendance.id !== APPROVED_REGISTRO_ID || attendance.cliente_id !== APPROVED_TENANT_ID ||
      attendance.empleado_id !== APPROVED_EMPLOYEE_ID || attendance.dispositivo_id !== APPROVED_DEVICE_ID) {
    throw new ProductionShadowGuardError('El registro no coincide con el candidato aprobado.', 'SHADOW_ATTENDANCE_DENIED')
  }
  const employee = await repository.getEmployeeForTenant(attendance.empleado_id, attendance.cliente_id)
  if (!employee || employee.id !== APPROVED_EMPLOYEE_ID || employee.cliente_id !== APPROVED_TENANT_ID) {
    throw new ProductionShadowGuardError('Employee no resolvió dentro de Empresa.', 'SHADOW_EMPLOYEE_DENIED')
  }
  const device = await repository.getDeviceForTenant(attendance.dispositivo_id, attendance.cliente_id)
  if (!device || device.id !== APPROVED_DEVICE_ID || device.cliente_id !== APPROVED_TENANT_ID || device.timezone !== APPROVED_TIMEZONE) {
    throw new ProductionShadowGuardError('Device o timezone no coincide con el candidato aprobado.', 'SHADOW_DEVICE_DENIED')
  }
  const domain = await import('../../src/domain/attendance/index.ts')
  const scheduleContext = await repository.loadScheduleContext({ clienteId: attendance.cliente_id, empleadoId: attendance.empleado_id })
  const schedule = domain.ScheduleResolver.resolve({
    clienteId: attendance.cliente_id,
    empleadoId: attendance.empleado_id,
    candidateDate: APPROVED_OPERATIVE_DATE,
    assignments: scheduleContext.assignments,
    revisions: scheduleContext.revisions,
  })
  if (schedule.kind !== 'SCHEDULED' || schedule.scheduleId !== APPROVED_SCHEDULE_ID) {
    throw new ProductionShadowGuardError('El ScheduleResolver no devolvió el horario aprobado.', 'SHADOW_SCHEDULE_DENIED')
  }
  const events = await repository.getAttendanceWindow(
    attendance.empleado_id, attendance.cliente_id, WINDOW_START, WINDOW_END
  )
  if (counters.writeCalls !== 0 || counters.persistenceCalls !== 0 || counters.rpcWriteCalls !== 0) {
    throw new ProductionShadowGuardError('El smoke READ_ONLY detectó un intento de escritura.', 'SHADOW_ZERO_WRITE_FAILED')
  }
  const eventTypes = {}
  for (const event of events) {
    const type = safeEventType(event.tipo_verificacion)
    eventTypes[type] = (eventTypes[type] || 0) + 1
  }
  return {
    mode: 'READ_SMOKE',
    registroId: attendance.id,
    clienteId: attendance.cliente_id,
    empleadoId: attendance.empleado_id,
    deviceId: attendance.dispositivo_id,
    timezone: device.timezone,
    scheduleId: schedule.scheduleId,
    operativeDate: APPROVED_OPERATIVE_DATE,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    eventCount: events.length,
    eventTypes,
    destinationGuard: 'PASS',
    writeCalls: counters.writeCalls,
    persistenceCalls: counters.persistenceCalls,
    rpcWriteCalls: counters.rpcWriteCalls,
    persistenceServiceReachable: false,
    upsertRpcReachable: false,
  }
}

function safeOutput(result) {
  const record = result.workdayRecord
  return {
    CANARY_MODE: 'SHADOW',
    mode: 'SHADOW',
    registroId: result.registroId,
    clienteId: record.cliente_id,
    empleadoId: record.empleado_id,
    deviceId: result.deviceId,
    scheduleId: record.schedule_id,
    timezone: record.timezone,
    operativeDate: record.workday_date,
    actualStart: record.first_in,
    actualEnd: record.last_out,
    workedMinutes: record.worked_minutes,
    breakMinutes: record.break_minutes,
    overtimeMinutes: record.overtime_minutes,
    lateMinutes: record.late_minutes,
    earlyLeaveMinutes: record.early_leave_minutes,
    workdayState: record.status,
    integrityHash: record.integrity_hash,
    eventCount: result.eventCount,
    persistenceCalled: false,
  }
}

function eventTypeSummary(events) {
  const summary = {}
  for (const event of events) {
    const type = safeEventType(event.tipo_verificacion)
    summary[type] = (summary[type] || 0) + 1
  }
  return summary
}

function comparableEngineResult(result) {
  const record = result.workdayRecord
  return {
    workdayState: record.status,
    firstIn: record.first_in,
    lastOut: record.last_out,
    workedMinutes: record.worked_minutes,
    breakMinutes: record.break_minutes,
    overtimeMinutes: record.overtime_minutes,
    lateMinutes: record.late_minutes,
    earlyLeaveMinutes: record.early_leave_minutes,
    supplementalEvents: result.calculation.supplementalEvents,
    integrityHash: record.integrity_hash,
  }
}

function assertApprovedEngineContext(result, inputEvents) {
  const record = result.workdayRecord
  if (result.mode !== 'SHADOW' || result.registroId !== APPROVED_REGISTRO_ID ||
      record.cliente_id !== APPROVED_TENANT_ID || record.empleado_id !== APPROVED_EMPLOYEE_ID ||
      record.schedule_id !== APPROVED_SCHEDULE_ID || record.workday_date !== APPROVED_OPERATIVE_DATE ||
      record.timezone !== APPROVED_TIMEZONE || result.eventWindow.startUtc !== WINDOW_START ||
      result.eventWindow.endUtc !== WINDOW_END || result.eventCount !== inputEvents.length) {
    throw new ProductionShadowGuardError('El engine no resolviÃ³ el contexto aprobado del canary.', 'SHADOW_ENGINE_CONTEXT_DENIED')
  }
}

function safeEngineShadowOutput(result, inputEvents, counters) {
  const record = result.workdayRecord
  return {
    CANARY_MODE: 'SHADOW',
    mode: 'SHADOW',
    registroId: result.registroId,
    clienteId: record.cliente_id,
    empleadoId: record.empleado_id,
    timezone: record.timezone,
    scheduleId: record.schedule_id,
    operativeDate: record.workday_date,
    calculationVersion: result.calculation.calculationVersion,
    windowStart: result.eventWindow.startUtc,
    windowEnd: result.eventWindow.endUtc,
    inputEventCount: result.eventCount,
    inputEventTypes: eventTypeSummary(inputEvents),
    normalizedEventCount: result.normalizedEventCount,
    supplementalEventCount: result.calculation.supplementalEvents.length,
    supplementalEvents: result.calculation.supplementalEvents.map((event) => ({
      registroId: event.logId,
      timestamp: event.utcTimestamp,
      type: event.type,
      reason: event.reason,
    })),
    workdayState: record.status,
    firstIn: record.first_in,
    lastOut: record.last_out,
    workedMinutes: record.worked_minutes,
    breakMinutes: record.break_minutes,
    overtimeMinutes: record.overtime_minutes,
    lateMinutes: record.late_minutes,
    earlyLeaveMinutes: record.early_leave_minutes,
    integrityHash: record.integrity_hash || null,
    calculationWarnings: result.calculationWarnings,
    destinationGuard: 'PASS',
    deterministicReplay: true,
    writeCalls: counters.writeCalls,
    persistenceCalls: counters.persistenceCalls,
    rpcWriteCalls: counters.rpcWriteCalls,
    incidentWriteCalls: counters.incidentWriteCalls,
    persistenceServiceReachable: false,
    upsertRpcReachable: false,
    incidentWriterReachable: false,
  }
}

function chronological(left, right) {
  const leftTime = String(left.verificado_at || left.utcTimestamp)
  const rightTime = String(right.verificado_at || right.utcTimestamp)
  if (leftTime < rightTime) return -1
  if (leftTime > rightTime) return 1
  const leftId = String(left.id || left.logId)
  const rightId = String(right.id || right.logId)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function pairingActions(trace) {
  const pairedEntryIds = new Set(trace.pairing.pairs.map((pair) => pair.entry.id))
  const pairedExitIds = new Set(trace.pairing.pairs.map((pair) => pair.exit.id))
  const discardedEntryIds = new Set()
  const unmatchedExitIds = new Set()
  for (const incident of trace.pairing.pairingIncidents) {
    if (incident.code === 'CONSECUTIVE_ENTRY' && incident.metadata?.discardedPunchId) {
      discardedEntryIds.add(incident.metadata.discardedPunchId)
    }
    if (incident.code === 'CONSECUTIVE_EXIT' && incident.metadata?.orphanExitPunchId) {
      unmatchedExitIds.add(incident.metadata.orphanExitPunchId)
    }
  }
  return {
    forId(id, disposition, timestamp) {
      const actions = []
      if (disposition?.disposition === 'DUPLICATE') actions.push('DUPLICATE')
      if (disposition?.disposition === 'OUT_OF_WINDOW') actions.push('OUTSIDE_WINDOW')
      if (discardedEntryIds.has(id)) actions.push('DISCARDED_CONSECUTIVE_ENTRY')
      if (pairedEntryIds.has(id)) actions.push('OPEN_INTERVAL')
      if (pairedExitIds.has(id)) actions.push('CLOSE_INTERVAL')
      if (trace.pairing.orphanEntry?.id === id) actions.push('UNMATCHED_ENTRY')
      if (unmatchedExitIds.has(id) || trace.pairing.orphanExit?.id === id) actions.push('UNMATCHED_EXIT')
      if (timestamp === trace.metrics.actualStart) actions.push('USED_AS_FIRST_IN')
      if (timestamp === trace.metrics.actualEnd) actions.push('USED_AS_LAST_OUT')
      if (actions.length === 0 && disposition?.disposition === 'USED') actions.push('USED_NOT_PAIRED')
      if (actions.length === 0) actions.push('IGNORED')
      return actions
    },
    unmatchedEntryIds: trace.pairing.orphanEntry ? [trace.pairing.orphanEntry.id] : [],
    unmatchedExitIds: [...unmatchedExitIds],
  }
}

function buildSanitizedCalculationTrace(trace) {
  const normalizedById = new Map(trace.normalizedEvents.map((event) => [event.id, event]))
  const dispositionById = new Map(trace.dispositions.map((disposition) => [disposition.logId, disposition]))
  const actions = pairingActions(trace)
  const supplementalById = new Map(trace.metrics.supplementalEvents.map((event) => [event.logId, event]))
  const chronologicalEvents = trace.sourceEvents.slice().sort(chronological).map((event, index) => {
    const normalized = normalizedById.get(event.id)
    const disposition = dispositionById.get(event.id)
    return {
      sequence: index + 1,
      registro_id: event.id,
      timestamp_utc: event.verificado_at,
      timestamp_local: normalized ? `${normalized.localDate}T${normalized.localTime}` : null,
      tipo_verificacion: safeEventType(event.tipo_verificacion),
      normalized_type: normalized?.inOutType || null,
      normalized_timestamp: normalized?.utcTimestamp || null,
      normalization_disposition: disposition?.disposition || 'NOT_NORMALIZED',
      action: [...actions.forId(event.id, disposition, normalized?.utcTimestamp), ...(supplementalById.has(event.id)
        ? [`SUPPLEMENTAL_${supplementalById.get(event.id).reason}`] : [])],
    }
  })
  const shift = trace.scheduleResolution?.shift || null
  const scheduleTrace = {
    operativeDate: trace.match.operativeDate,
    timezone: trace.calculation.timezone,
    scheduledEntryLocal: shift?.startTime || null,
    scheduledExitLocal: shift?.endTime || null,
    scheduledEntryUtc: trace.match.scheduledStartUtc || null,
    scheduledExitUtc: trace.match.scheduledEndUtc || null,
    breakStartLocal: shift?.breakConfig?.startTime || null,
    breakEndLocal: shift?.breakConfig?.endTime || null,
    toleranceMinutes: trace.match.toleranceMinutes,
    shiftWindowStartUtc: trace.eventWindow.startUtc,
    shiftWindowEndUtc: trace.eventWindow.endUtc,
    isNightShift: trace.match.crossesMidnight,
  }
  const intervals = trace.metrics.segments.map((segment, index) => ({
    intervalNumber: index + 1,
    segmentType: segment.segmentType,
    in: segment.startPunch.utcTimestamp,
    out: segment.endPunch?.utcTimestamp || null,
    durationMinutes: segment.durationMinutes,
    includedInWorkedMinutes: segment.segmentType === 'WORK',
  }))
  const firstMatched = trace.match.matchedPunches[0]
  const lastMatched = trace.match.matchedPunches[trace.match.matchedPunches.length - 1]
  const spanMinutes = firstMatched && lastMatched
    ? Math.round((lastMatched.epochMs - firstMatched.epochMs) / 60000)
    : 0
  const workSegmentMinutes = intervals.filter((interval) => interval.segmentType === 'WORK')
    .reduce((total, interval) => total + interval.durationMinutes, 0)
  const breakSegmentMinutes = intervals.filter((interval) => interval.segmentType === 'BREAK')
    .reduce((total, interval) => total + interval.durationMinutes, 0)
  const unmatchedPresent = actions.unmatchedEntryIds.length > 0 || actions.unmatchedExitIds.length > 0
  const canonicalStateProvenance = trace.metrics.missingExit
    ? 'INCOMPLETE because no canonical EXIT follows the canonical first ENTRY.'
    : trace.metrics.missingEntry
      ? 'INCOMPLETE because no canonical ENTRY exists.'
      : 'COMPLETE because a canonical first ENTRY and subsequent first EXIT exist; supplemental events do not alter state.'
  return {
    eventTrace: chronologicalEvents,
    scheduleTrace,
    pairingTrace: chronologicalEvents.map((event) => ({
      sequence: event.sequence, registro_id: event.registro_id, type: event.normalized_type,
      timestamp: event.normalized_timestamp || event.timestamp_utc, action: event.action,
    })),
    intervals,
    pairingIncidents: trace.pairing.pairingIncidents.map((incident) => ({ code: incident.code, severity: incident.severity })),
    supplementalEvents: trace.metrics.supplementalEvents.map((event) => ({
      registro_id: event.logId,
      timestamp: event.utcTimestamp,
      type: event.type,
      reason: event.reason,
    })),
    unmatchedEntries: actions.unmatchedEntryIds,
    unmatchedExits: actions.unmatchedExitIds,
    firstInSourceEvent: trace.metrics.actualStart
      ? chronologicalEvents.find((event) => event.normalized_timestamp === trace.metrics.actualStart) || null
      : null,
    lastOutSourceEvent: trace.metrics.actualEnd
      ? chronologicalEvents.find((event) => event.normalized_timestamp === trace.metrics.actualEnd) || null
      : null,
    reconciliations: {
      workedMinutes: trace.metrics.workedMinutes,
      spanMinutes,
      workSegmentMinutes,
      breakSegmentMinutes,
      workedMinutesReconciles: trace.metrics.workedMinutes === workSegmentMinutes,
      breakMinutes: trace.metrics.breakMinutes,
      breakMinutesReconciles: trace.metrics.breakMinutes === breakSegmentMinutes,
      lateMinutes: trace.metrics.lateMinutes,
      lateMinutesReconciles: !trace.match.scheduledStartUtc || !trace.metrics.actualStart ||
        trace.metrics.lateMinutes === Math.round((new Date(trace.metrics.actualStart).getTime() - new Date(trace.match.scheduledStartUtc).getTime()) / 60000),
    },
    finalState: {
      workdayState: trace.calculation.workdayState,
      missingEntry: trace.metrics.missingEntry,
      missingExit: trace.metrics.missingExit,
      lastOut: trace.metrics.actualEnd || null,
      provenance: canonicalStateProvenance,
      canonicalProvenance: canonicalStateProvenance,
      legacyPairingProvenance: trace.metrics.missingExit
        ? 'INCOMPLETE porque pairPunches dejó orphanEntry; WorkdayCalculator fija actualEnd undefined.'
        : trace.metrics.missingEntry
          ? 'INCOMPLETE porque falta entrada según el pairing.'
          : 'El estado no se deriva de una entrada o salida faltante.',
    },
    warningCoverage: unmatchedPresent && trace.calculation.warnings.length === 0 ? 'GAP' : 'ADEQUATE',
  }
}

async function runProductionEngineShadow(
  registroId,
  environment = process.env,
  dependencies = { createClient }
) {
  const config = readProductionShadowConfig(registroId, environment)
  const counters = { writeCalls: 0, persistenceCalls: 0, rpcWriteCalls: 0, incidentWriteCalls: 0 }
  const baseClient = dependencies.createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const repository = new SupabaseAttendanceReadRepository(createReadOnlyClient(baseClient, counters))
  let inputEvents = []
  const loadAttendanceEvents = repository.loadAttendanceEvents.bind(repository)
  repository.loadAttendanceEvents = async (input) => {
    const events = await loadAttendanceEvents(input)
    inputEvents = events.slice()
    return events
  }
  const orchestrator = new AttendanceEngineOrchestrator({
    repository,
    mode: 'SHADOW',
    // Deliberately omit persistenceService. SHADOW has no writer capability.
    logger: { info: () => {}, error: () => {} },
    traceCollector: typeof dependencies.traceSink === 'function' ? dependencies.traceSink : undefined,
  })

  const first = await orchestrator.run({ registroId: config.registroId })
  assertApprovedEngineContext(first, inputEvents)
  const firstInputEvents = inputEvents.slice()
  const second = await orchestrator.run({ registroId: config.registroId })
  assertApprovedEngineContext(second, inputEvents)
  if (JSON.stringify(comparableEngineResult(first)) !== JSON.stringify(comparableEngineResult(second))) {
    throw new ProductionShadowGuardError('El replay SHADOW no fue determinista.', 'SHADOW_NON_DETERMINISTIC')
  }
  if (counters.writeCalls !== 0 || counters.persistenceCalls !== 0 || counters.rpcWriteCalls !== 0 || counters.incidentWriteCalls !== 0) {
    throw new ProductionShadowGuardError('ENGINE_SHADOW detectÃ³ un intento de escritura.', 'SHADOW_ZERO_WRITE_FAILED')
  }
  return safeEngineShadowOutput(first, firstInputEvents, counters)
}

async function runProductionEngineShadowTrace(
  registroId,
  environment = process.env,
  dependencies = { createClient }
) {
  const traces = []
  const report = await runProductionEngineShadow(registroId, environment, {
    ...dependencies,
    traceSink: (trace) => traces.push(buildSanitizedCalculationTrace(trace)),
  })
  if (traces.length !== 2 || JSON.stringify(traces[0]) !== JSON.stringify(traces[1])) {
    throw new ProductionShadowGuardError('La traza ENGINE_SHADOW no fue determinista.', 'SHADOW_TRACE_NON_DETERMINISTIC')
  }
  return { ...report, trace: traces[0] }
}

async function runProductionShadowCanary(registroId, environment = process.env) {
  // Compatibility alias. It intentionally shares the guarded ENGINE_SHADOW
  // execution rather than retaining a second production execution path.
  return runProductionEngineShadow(registroId, environment)
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })
  const run = process.argv.length === 3 && process.argv[2] === '--check-env'
    ? () => sanitizedEnvironmentCheck()
    : process.argv.length === 5 && process.argv[2] === '--read-smoke' && process.argv[3] === '--registro-id'
      ? () => runProductionReadSmoke(process.argv[4])
      : process.argv.length === 5 && process.argv[2] === '--engine-shadow' && process.argv[3] === '--registro-id'
        ? () => runProductionEngineShadow(process.argv[4])
      : process.argv.length === 5 && process.argv[2] === '--engine-shadow-trace' && process.argv[3] === '--registro-id'
        ? () => runProductionEngineShadowTrace(process.argv[4])
      : null
  if (!run) {
    console.error('Uso: node backend/scripts/run-production-workday-shadow-canary.js --check-env')
    console.error('  o: node backend/scripts/run-production-workday-shadow-canary.js --read-smoke --registro-id ' + APPROVED_REGISTRO_ID)
    console.error('  o: node backend/scripts/run-production-workday-shadow-canary.js --engine-shadow --registro-id ' + APPROVED_REGISTRO_ID)
    console.error('  o: node backend/scripts/run-production-workday-shadow-canary.js --engine-shadow-trace --registro-id ' + APPROVED_REGISTRO_ID)
    process.exitCode = 2
  } else {
    Promise.resolve().then(run)
      .then((report) => {
        console.log(JSON.stringify(report, null, 2))
        if (report.envReady === false) process.exitCode = 1
      })
      .catch((error) => {
        const mode = process.argv[2] === '--check-env' ? 'ENV_CHECK' : process.argv[2]?.startsWith('--engine-shadow') ? 'SHADOW' : 'READ_SMOKE'
        console.error(JSON.stringify({ mode, code: error.code || 'SHADOW_SMOKE_FAILED', error: error.message }))
        process.exitCode = 1
      })
  }
}

module.exports = {
  ProductionShadowGuardError,
  APPROVED_REGISTRO_ID,
  APPROVED_TENANT_ID,
  APPROVED_EMPLOYEE_ID,
  APPROVED_DEVICE_ID,
  APPROVED_SCHEDULE_ID,
  WINDOW_START,
  WINDOW_END,
  createReadOnlyClient,
  readProductionShadowConfig,
  runProductionReadSmoke,
  runProductionEngineShadow,
  runProductionEngineShadowTrace,
  sanitizedEnvironmentCheck,
  runProductionShadowCanary,
  safeOutput,
  safeEngineShadowOutput,
  comparableEngineResult,
  buildSanitizedCalculationTrace,
}
