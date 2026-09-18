'use strict'

/**
 * Phase 36.2 production runner for exactly one approved V3 persist canary.
 * It has no scheduler, batch input, retry, legacy RPC, incident writer, or
 * alternate identity path. Merely importing this module performs no I/O.
 */

const fs = require('fs/promises')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { AttendanceEngineOrchestrator, SupabaseAttendanceReadRepository } = require('../services/attendance/AttendanceEngineOrchestrator.js')
const { WorkdayPersistenceService } = require('../services/attendance/WorkdayPersistenceService.js')
const { unwrapEvidence, assertApprovedContractEvidence: assertManifestContract } = require('./persist-canary-manifest-contract.js')
const {
  APPROVED,
  CONFIRMATION,
  CANONICAL_ORACLE_V3,
  readPersistCanaryDesignConfig,
  assertApprovedIdentity,
} = require('./persist-canary-design.js')

const APPROVED_HOST = 'tuhrqoihccfumlaxnbor.supabase.co'
const V3_SIGNATURE = 'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)'
// Current production contract: source_event_id is not a direct column. It may
// exist only as opaque raw_payload metadata, which must not be inferred here.
const REGISTRO_ASISTENCIA_READ_COLUMNS = 'id, cliente_id, empleado_id, dispositivo_id, verificado_at, tipo_verificacion, metodo, raw_payload, es_manual'

class PersistCanaryRunnerError extends Error {
  constructor(message, code, cause) {
    super(message)
    this.name = 'PersistCanaryRunnerError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function sanitizeSupabaseError(table, error) {
  const candidate = error && typeof error === 'object' ? error : {}
  return {
    table,
    code: typeof candidate.code === 'string' ? candidate.code : null,
    message: typeof candidate.message === 'string' ? candidate.message : String(candidate.message || 'unknown Supabase read error'),
    details: typeof candidate.details === 'string' ? candidate.details : null,
    hint: typeof candidate.hint === 'string' ? candidate.hint : null,
  }
}

function failReadDiagnostic(table, error) {
  const diagnostic = sanitizeSupabaseError(table, error)
  const wrapped = new PersistCanaryRunnerError(
    `No se pudo leer ${table}: ${diagnostic.message}`,
    'PERSIST_CANARY_READ_DIAGNOSTIC_FAILED',
    error
  )
  wrapped.diagnostic = diagnostic
  throw wrapped
}

function normalizeRegistroAsistencia(row) {
  // Keep the domain adapter contract without pretending a source linkage exists.
  return { ...row, source_event_id: null }
}

class PersistCanaryReadRepository extends SupabaseAttendanceReadRepository {
  async loadRegistro(registroId) {
    return this._single(
      this.client.from('registro_asistencia')
        .select(REGISTRO_ASISTENCIA_READ_COLUMNS)
        .eq('id', registroId),
      'registro_asistencia'
    ).then((row) => row ? normalizeRegistroAsistencia(row) : null)
  }

  async loadAttendanceEvents({ clienteId, empleadoId, startUtc, endUtc }) {
    const response = await this.client.from('registro_asistencia')
      .select(REGISTRO_ASISTENCIA_READ_COLUMNS)
      .eq('cliente_id', clienteId).eq('empleado_id', empleadoId)
      .gte('verificado_at', startUtc).lte('verificado_at', endUtc)
      .order('verificado_at', { ascending: true }).order('id', { ascending: true })
    if (response.error) {
      failReadDiagnostic('registro_asistencia', response.error)
    }
    return (response.data || []).map(normalizeRegistroAsistencia)
  }
}

function requireEnv(environment, name) {
  const value = environment?.[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PersistCanaryRunnerError(`Falta ${name}.`, 'PERSIST_CANARY_ENV_MISSING')
  }
  return value.trim()
}

function fail(message, code) {
  throw new PersistCanaryRunnerError(message, code)
}

function readPersistCanaryRunnerConfig(environment = process.env) {
  let designConfig
  try {
    designConfig = readPersistCanaryDesignConfig(environment)
  } catch (error) {
    throw new PersistCanaryRunnerError(error.message, error.code || 'PERSIST_CANARY_CONFIG_DENIED', error)
  }
  if (requireEnv(environment, 'PERSIST_CANARY_ALLOWED_HOST').toLowerCase() !== APPROVED_HOST || designConfig.host.toLowerCase() !== APPROVED_HOST) {
    fail('El runner sólo permite el host de producción aprobado.', 'PERSIST_CANARY_DESTINATION_DENIED')
  }
  const approvedRpcFingerprint = requireEnv(environment, 'PERSIST_CANARY_APPROVED_RPC_FINGERPRINT').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(approvedRpcFingerprint)) {
    fail('PERSIST_CANARY_APPROVED_RPC_FINGERPRINT debe ser un MD5 válido.', 'PERSIST_CANARY_RPC_FINGERPRINT_BLOCKED')
  }
  return {
    url: requireEnv(environment, 'SUPABASE_URL'),
    serviceRoleKey: requireEnv(environment, 'SUPABASE_SERVICE_ROLE_KEY'),
    host: APPROVED_HOST,
    approvedRpcFingerprint,
    precheckManifestPath: requireEnv(environment, 'PERSIST_CANARY_PRECHECK_MANIFEST'),
    identity: { ...APPROVED },
  }
}

function parseCommand(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !['--persist-canary', '--validate-manifest', '--validate-production-reads'].includes(argv[0])) {
    fail('Uso: node backend/scripts/run-production-persist-canary.js --validate-manifest | --validate-production-reads | --persist-canary', 'PERSIST_CANARY_USAGE_DENIED')
  }
  if (argv[0] === '--persist-canary') return 'PERSIST_CANARY'
  return argv[0] === '--validate-manifest' ? 'PERSIST_CANARY_MANIFEST_VALIDATION' : 'PERSIST_CANARY_PRODUCTION_READ_VALIDATION'
}

function assertApprovedContractEvidence(input, approvedFingerprint) {
  try {
    return assertManifestContract(input, approvedFingerprint)
  } catch (error) {
    throw new PersistCanaryRunnerError(error.message, error.code || 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED', error)
  }
}

function assertLegacyApprovedContractEvidence(input, approvedFingerprint) {
  const evidence = unwrapEvidence(input)
  if (!evidence || typeof evidence !== 'object' || evidence.phase !== '36_2_persist_canary_runner_precheck' || evidence.read_only !== 'on') {
    fail('Falta evidencia read-only válida del contrato V3.', 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED')
  }
  try {
    assertApprovedIdentity(evidence.identity)
  } catch (error) {
    throw new PersistCanaryRunnerError(error.message, 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED', error)
  }
  if (evidence.precheck_pass !== true || evidence.candidate_exact !== true || evidence.rpc_v3_available !== true || evidence.incident_write_path !== false ||
      evidence.target_workday_rows !== 0 || evidence.target_history_rows !== 0 ||
      evidence.exact_authorization_rows !== 1 || evidence.all_authorization_rows !== 1 ||
      typeof evidence.rpc_fingerprint !== 'string' || evidence.rpc_fingerprint.toLowerCase() !== approvedFingerprint) {
    fail('La evidencia del contrato V3 no coincide con el fingerprint aprobado.', 'PERSIST_CANARY_RPC_FINGERPRINT_BLOCKED')
  }
  return evidence
}

async function loadApprovedContractEvidence(filePath, approvedFingerprint, dependencies = { readFile: fs.readFile }) {
  let text
  try {
    text = await dependencies.readFile(path.resolve(filePath), 'utf8')
  } catch (error) {
    throw new PersistCanaryRunnerError('No se pudo leer el manifiesto local de precheck.', 'PERSIST_CANARY_MANIFEST_READ_FAILED', error)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new PersistCanaryRunnerError('El manifiesto local no es JSON UTF-8 válido sin BOM.', 'PERSIST_CANARY_MANIFEST_JSON_INVALID', error)
  }
  return assertApprovedContractEvidence(parsed, approvedFingerprint)
}

async function validateLocalManifest(environment = process.env, dependencies = { readFile: fs.readFile }) {
  const config = readPersistCanaryRunnerConfig(environment)
  const evidence = await loadApprovedContractEvidence(config.precheckManifestPath, config.approvedRpcFingerprint, dependencies)
  return {
    mode: 'PERSIST_CANARY_MANIFEST_VALIDATION',
    host: config.host,
    identity: evidence.identity,
    rpcFingerprint: evidence.rpc_fingerprint,
    writerReachable: false,
    supabaseClientCreated: false,
    rpcCalls: 0,
    databaseWrites: 0,
  }
}

function readOnlyQueryGuard(query, counters) {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === 'then') return target.then?.bind(target)
      if (['insert', 'update', 'delete', 'upsert'].includes(property)) {
        return () => {
          counters.databaseWrites++
          fail('La validación read-only bloqueó una escritura.', 'PERSIST_CANARY_READ_ONLY_WRITE_DENIED')
        }
      }
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args) => {
        const result = value.apply(target, args)
        return result && typeof result === 'object' ? readOnlyQueryGuard(result, counters) : result
      }
    },
  })
}

function createReadOnlyOperationalClient(client, counters) {
  return {
    from(table) {
      return readOnlyQueryGuard(client.from(table), counters)
    },
    rpc() {
      counters.rpcWrites++
      fail('La validación read-only bloqueó una RPC.', 'PERSIST_CANARY_READ_ONLY_RPC_DENIED')
    },
  }
}

async function loadCandidateRegistroForDiagnostic(client) {
  const response = await client.from('registro_asistencia')
    .select(REGISTRO_ASISTENCIA_READ_COLUMNS)
    .eq('id', APPROVED.registroId)
    .maybeSingle()
  if (!response || response.error) {
    failReadDiagnostic('registro_asistencia', response?.error)
  }
  if (!response.data) {
    fail('El registro candidato no existe.', 'PERSIST_CANARY_REGISTRO_NOT_FOUND')
  }
  const registro = normalizeRegistroAsistencia(response.data)
  if (registro.id !== APPROVED.registroId || registro.cliente_id !== APPROVED.clienteId || registro.empleado_id !== APPROVED.empleadoId) {
    fail('El registro candidato no coincide exactamente con el tenant y empleado aprobados.', 'PERSIST_CANARY_CANDIDATE_DENIED')
  }
  return registro
}

function diagnosticFromReadError(error) {
  if (error?.diagnostic) return error.diagnostic
  const source = error?.cause && typeof error.cause === 'object' ? error.cause : error
  return sanitizeSupabaseError('unknown', source)
}

async function validateProductionReads(environment = process.env, dependencies = {
  createClient,
  readFile: fs.readFile,
  createEngine: (options) => new AttendanceEngineOrchestrator(options),
}) {
  const config = readPersistCanaryRunnerConfig(environment)
  await loadApprovedContractEvidence(config.precheckManifestPath, config.approvedRpcFingerprint, dependencies)
  const counters = { databaseWrites: 0, rpcWrites: 0 }
  const baseClient = dependencies.createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const client = createReadOnlyOperationalClient(baseClient, counters)
  const registro = await loadCandidateRegistroForDiagnostic(client)
  const repository = new PersistCanaryReadRepository(client)
  let calculation
  try {
    calculation = await dependencies.createEngine({
      repository, mode: 'SHADOW', calculationVersion: 3, logger: { info: () => {}, error: () => {} },
    }).run({ registroId: APPROVED.registroId })
  } catch (error) {
    const wrapped = new PersistCanaryRunnerError('La validación read-only del engine falló.', 'PERSIST_CANARY_PRODUCTION_READS_FAILED', error)
    wrapped.diagnostic = diagnosticFromReadError(error)
    throw wrapped
  }
  const snapshot = await readLiveCanarySnapshot(client)
  return {
    mode: 'PERSIST_CANARY_PRODUCTION_READ_VALIDATION',
    registro: { id: registro.id, clienteId: registro.cliente_id, empleadoId: registro.empleado_id },
    recordIdentity: {
      clienteId: calculation.workdayRecord.cliente_id,
      empleadoId: calculation.workdayRecord.empleado_id,
      scheduleId: calculation.workdayRecord.schedule_id,
      operativeDate: calculation.workdayRecord.workday_date,
      calculationVersion: calculation.workdayRecord.calculation_version,
    },
    prewriteSnapshot: { workdayRows: snapshot.workdayRows.length, historyRows: snapshot.historyRows.length },
    writerReachable: false,
    rpcWrites: counters.rpcWrites,
    databaseWrites: counters.databaseWrites,
  }
}

async function readRows(client, table, columns, predicates) {
  let query = client.from(table).select(columns)
  for (const [column, value] of predicates) query = query.eq(column, value)
  const response = await query
  if (!response || response.error) {
    failReadDiagnostic(table, response?.error)
  }
  return Array.isArray(response.data) ? response.data : []
}

function exactAuthorization(row) {
  return row && row.cliente_id === APPROVED.clienteId && row.feature_key === 'WORKDAY_PERSIST_CANARY' &&
    row.mode === 'PERSIST_CANARY' && row.enabled === true && row.canary_registro_id === APPROVED.registroId &&
    row.canary_empleado_id === APPROVED.empleadoId && row.canary_schedule_id === APPROVED.scheduleId &&
    row.canary_workday_date === APPROVED.operativeDate
}

async function readLiveCanarySnapshot(client) {
  const [authorizationRows, allAuthorizationRows, workdayRows, historyRows] = await Promise.all([
    readRows(client, 'tenant_features', 'cliente_id, feature_key, mode, enabled, canary_registro_id, canary_empleado_id, canary_schedule_id, canary_workday_date', [
      ['cliente_id', APPROVED.clienteId], ['feature_key', 'WORKDAY_PERSIST_CANARY'],
    ]),
    readRows(client, 'tenant_features', 'cliente_id, feature_key, mode, enabled, canary_registro_id, canary_empleado_id, canary_schedule_id, canary_workday_date', [
      ['feature_key', 'WORKDAY_PERSIST_CANARY'],
    ]),
    readRows(client, 'workday_records', 'id, cliente_id, empleado_id, workday_date, schedule_id, timezone, first_in, last_out, worked_minutes, break_minutes, overtime_minutes, late_minutes, early_leave_minutes, status, integrity_hash, calculation_version', [
      ['cliente_id', APPROVED.clienteId], ['empleado_id', APPROVED.empleadoId], ['workday_date', APPROVED.operativeDate],
    ]),
    readRows(client, 'workday_record_history', 'id, workday_record_id, cliente_id, empleado_id, workday_date, schedule_id, timezone, first_in, last_out, worked_minutes, break_minutes, overtime_minutes, late_minutes, early_leave_minutes, status, integrity_hash, calculation_version, action', [
      ['cliente_id', APPROVED.clienteId], ['empleado_id', APPROVED.empleadoId], ['workday_date', APPROVED.operativeDate],
    ]),
  ])
  return { identity: { ...APPROVED }, authorizationRows, allAuthorizationRows, workdayRows, historyRows }
}

function valueMatches(row, field, value) {
  return row?.[field] === value
}

function timestampMatches(actual, expected) {
  if (actual === null || actual === undefined || expected === null || expected === undefined) return actual === expected
  const actualEpoch = Date.parse(actual)
  const expectedEpoch = Date.parse(expected)
  return Number.isFinite(actualEpoch) && Number.isFinite(expectedEpoch) && actualEpoch === expectedEpoch
}

function workdaySnapshotMatches(row, record) {
  if (!row || !record) return false
  const fields = [
    'cliente_id', 'empleado_id', 'workday_date', 'schedule_id', 'timezone',
    'worked_minutes', 'break_minutes', 'overtime_minutes', 'late_minutes', 'early_leave_minutes',
    'status', 'integrity_hash', 'calculation_version',
  ]
  return fields.every((field) => valueMatches(row, field, record[field])) &&
    timestampMatches(row.first_in, record.first_in) && timestampMatches(row.last_out, record.last_out)
}

function assertCanonicalRecord(record) {
  const identity = {
    registroId: record?.registro_id,
    clienteId: record?.cliente_id,
    empleadoId: record?.empleado_id,
    scheduleId: record?.schedule_id,
    operativeDate: record?.workday_date,
    timezone: record?.timezone,
    calculationVersion: record?.calculation_version,
  }
  try {
    assertApprovedIdentity(identity)
  } catch (error) {
    throw new PersistCanaryRunnerError(error.message, 'PERSIST_CANARY_CANDIDATE_DENIED', error)
  }
  for (const [field, expected] of Object.entries(CANONICAL_ORACLE_V3)) {
    const recordField = ({ firstIn: 'first_in', lastOut: 'last_out', workedMinutes: 'worked_minutes', breakMinutes: 'break_minutes', lateMinutes: 'late_minutes', earlyLeaveMinutes: 'early_leave_minutes', overtimeMinutes: 'overtime_minutes', workdayState: 'status' })[field]
    if (record[recordField] !== expected) fail(`El AttendanceEngine no coincide con Oracle V3 en ${field}.`, 'PERSIST_CANARY_CANONICAL_DENIED')
  }
  if (!/^[0-9a-f]{64}$/.test(record.integrity_hash || '')) {
    fail('El AttendanceEngine no generó integrity hash SHA-256 válido.', 'PERSIST_CANARY_INTEGRITY_HASH_DENIED')
  }
}

function assertCanonicalCalculation(calculation) {
  if (!Array.isArray(calculation?.calculation?.supplementalEvents) || calculation.calculation.supplementalEvents.length !== 14) {
    fail('El AttendanceEngine no conserva los 14 supplemental events aprobados.', 'PERSIST_CANARY_CANONICAL_DENIED')
  }
  assertCanonicalRecord(calculation.workdayRecord)
}

function planCanaryWrite(snapshot, record, evidence) {
  try {
    assertApprovedIdentity(snapshot?.identity)
  } catch (error) {
    throw new PersistCanaryRunnerError(error.message, 'PERSIST_CANARY_PRECHECK_IDENTITY_DENIED', error)
  }
  assertCanonicalRecord(record)
  if (!evidence || evidence.precheck_pass !== true || evidence.rpc_v3_available !== true || evidence.rpc_fingerprint === undefined) {
    fail('La evidencia local del contrato no está lista.', 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED')
  }
  if (snapshot.authorizationRows.length !== 1 || snapshot.allAuthorizationRows.length !== 1 || !exactAuthorization(snapshot.authorizationRows[0])) {
    fail('La autorización tenant feature no es exactamente el único canary aprobado.', 'PERSIST_CANARY_TENANT_FEATURE_BLOCKED')
  }
  if (snapshot.workdayRows.length > 1 || snapshot.historyRows.length > 1) {
    fail('La identidad lógica tiene más de una fila objetivo.', 'PERSIST_CANARY_IDENTITY_CONFLICT')
  }
  if (snapshot.workdayRows.length === 0 && snapshot.historyRows.length === 0) {
    return { expectedPersistenceResult: 'INSERTED', maxLogicalWorkdaysAffected: 1, incidentWriteCalls: 0 }
  }
  if (snapshot.workdayRows.length !== 1 || snapshot.historyRows.length !== 1 || !workdaySnapshotMatches(snapshot.workdayRows[0], record) ||
      !exactHistorySnapshot(snapshot.historyRows[0], record, snapshot.workdayRows[0].id)) {
    fail('La jornada existente no es un replay V3 exacto; UPDATE no está autorizado.', 'PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT')
  }
  return { expectedPersistenceResult: 'UNCHANGED', maxLogicalWorkdaysAffected: 1, incidentWriteCalls: 0 }
}

function exactHistorySnapshot(row, record, workdayId) {
  return row && row.workday_record_id === workdayId && row.action === 'INSERTED' &&
    workdaySnapshotMatches({ ...row, id: undefined }, record)
}

function assertPostWriteObservation(plan, record, persistence, after) {
  if (!persistence || persistence.persistenceResult !== plan.expectedPersistenceResult || persistence.integrityHash !== record.integrity_hash) {
    fail('La respuesta RPC no coincide con el resultado único esperado.', 'PERSIST_CANARY_RPC_RESULT_DENIED')
  }
  if (after.workdayRows.length !== 1 || after.historyRows.length !== 1 || !workdaySnapshotMatches(after.workdayRows[0], record) ||
      !exactHistorySnapshot(after.historyRows[0], record, persistence.workdayId)) {
    fail('El post-RPC no conserva exactamente un workday y un history snapshot.', 'PERSIST_CANARY_POSTWRITE_DENIED')
  }
  return true
}

async function runProductionPersistCanary(environment = process.env, dependencies = { createClient, readFile: fs.readFile }) {
  const config = readPersistCanaryRunnerConfig(environment)
  const evidence = await loadApprovedContractEvidence(config.precheckManifestPath, config.approvedRpcFingerprint, dependencies)
  const client = dependencies.createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await loadCandidateRegistroForDiagnostic(client)
  const repository = new PersistCanaryReadRepository(client)
  const engine = new AttendanceEngineOrchestrator({ repository, mode: 'SHADOW', calculationVersion: 3, logger: { info: () => {}, error: () => {} } })
  const calculation = await engine.run({ registroId: APPROVED.registroId })
  const record = calculation.workdayRecord
  assertCanonicalCalculation(calculation)
  const before = await readLiveCanarySnapshot(client)
  const plan = planCanaryWrite(before, record, evidence)

  let persistence
  try {
    persistence = await new WorkdayPersistenceService(client).persist(record)
  } catch (error) {
    throw new PersistCanaryRunnerError('La única RPC V3 falló; no habrá retry, fallback ni compensación.', 'PERSIST_CANARY_RPC_FAILED', error)
  }

  const after = await readLiveCanarySnapshot(client)
  assertPostWriteObservation(plan, record, persistence, after)
  return {
    mode: 'PERSIST_CANARY',
    identity: { ...APPROVED },
    v3Signature: V3_SIGNATURE,
    persistenceResult: persistence.persistenceResult,
    workdayId: persistence.workdayId,
    integrityHash: persistence.integrityHash,
    expectedBefore: { workdayRows: before.workdayRows.length, historyRows: before.historyRows.length },
    observedAfter: { workdayRows: after.workdayRows.length, historyRows: after.historyRows.length },
    incidentWriteCalls: 0,
    rpcCalls: 1,
    legacyFallbackCalls: 0,
    retries: 0,
  }
}

if (require.main === module) {
  let command
  try {
    command = parseCommand(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'PERSIST_CANARY_USAGE_DENIED', error: error.message })}\n`)
    process.exitCode = 2
    return
  }
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })
  const run = command === 'PERSIST_CANARY_MANIFEST_VALIDATION'
    ? () => validateLocalManifest()
    : command === 'PERSIST_CANARY_PRODUCTION_READ_VALIDATION'
      ? () => validateProductionReads()
      : () => runProductionPersistCanary()
  run().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      const diagnostic = error?.diagnostic
      const report = { mode: command, code: error.code || 'PERSIST_CANARY_FAILED', error: error.message }
      if (diagnostic) report.diagnostic = diagnostic
      process.stderr.write(`${JSON.stringify(report)}\n`)
      process.exitCode = 1
    }
  )
}

module.exports = {
  APPROVED_HOST,
  V3_SIGNATURE,
  REGISTRO_ASISTENCIA_READ_COLUMNS,
  CONFIRMATION,
  PersistCanaryRunnerError,
  readPersistCanaryRunnerConfig,
  parseCommand,
  unwrapEvidence,
  assertApprovedContractEvidence,
  loadApprovedContractEvidence,
  validateLocalManifest,
  createReadOnlyOperationalClient,
  loadCandidateRegistroForDiagnostic,
  validateProductionReads,
  sanitizeSupabaseError,
  readLiveCanarySnapshot,
  workdaySnapshotMatches,
  timestampMatches,
  assertCanonicalRecord,
  assertCanonicalCalculation,
  planCanaryWrite,
  assertPostWriteObservation,
  runProductionPersistCanary,
}
