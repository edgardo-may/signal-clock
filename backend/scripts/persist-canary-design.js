'use strict'

/**
 * Phase 36 design-only safety contract.
 *
 * This module intentionally has no Supabase client, WorkdayPersistenceService,
 * or RPC invocation. It validates the future one-workday canary authorization
 * and evaluates a read-only precheck snapshot. A separate approved phase must
 * implement and audit the writer only after all current schema blockers close.
 */

const APPROVED = Object.freeze({
  registroId: '7f99cef9-4100-48ff-9aaf-68548c80c948',
  clienteId: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  empleadoId: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  scheduleId: 'be4035c8-042c-473b-b25d-b5bf3fb99701',
  operativeDate: '2026-09-03',
  timezone: 'America/Cancun',
  calculationVersion: 3,
})

const CONFIRMATION = 'I_APPROVE_ONE_CANONICAL_WORKDAY_PERSIST_CANARY'

const CANONICAL_ORACLE_V3 = Object.freeze({
  firstIn: '2026-09-03T16:26:04.000Z',
  lastOut: '2026-09-03T17:55:13.000Z',
  workedMinutes: 89,
  breakMinutes: 0,
  lateMinutes: 326,
  earlyLeaveMinutes: 65,
  overtimeMinutes: 0,
  workdayState: 'COMPLETE',
})

class PersistCanaryDesignError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'PersistCanaryDesignError'
    this.code = code
  }
}

function requireEnv(environment, name) {
  const value = environment?.[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PersistCanaryDesignError(`Falta ${name}.`, 'PERSIST_CANARY_ENV_MISSING')
  }
  return value.trim()
}

function assertExact(value, expected, field) {
  if (value !== expected) {
    throw new PersistCanaryDesignError(`${field} no coincide con la identidad aprobada.`, 'PERSIST_CANARY_IDENTITY_DENIED')
  }
}

function readPersistCanaryDesignConfig(environment = process.env) {
  const url = requireEnv(environment, 'SUPABASE_URL')
  const allowedHost = requireEnv(environment, 'PERSIST_CANARY_ALLOWED_HOST').toLowerCase()
  const serviceRoleKey = requireEnv(environment, 'SUPABASE_SERVICE_ROLE_KEY')
  const targetEnvironment = requireEnv(environment, 'PERSIST_CANARY_ENVIRONMENT')
  const confirmation = requireEnv(environment, 'PERSIST_CANARY_CONFIRMATION')
  let target
  try {
    target = new URL(url)
  } catch {
    throw new PersistCanaryDesignError('SUPABASE_URL inválida.', 'PERSIST_CANARY_DESTINATION_INVALID')
  }
  if (target.protocol !== 'https:' || target.hostname.toLowerCase() !== allowedHost) {
    throw new PersistCanaryDesignError('El host no coincide con PERSIST_CANARY_ALLOWED_HOST.', 'PERSIST_CANARY_DESTINATION_DENIED')
  }
  if (targetEnvironment !== 'PRODUCTION_PERSIST_CANARY') {
    throw new PersistCanaryDesignError('El environment de persist canary no es explícito.', 'PERSIST_CANARY_ENVIRONMENT_DENIED')
  }
  if (confirmation !== CONFIRMATION) {
    throw new PersistCanaryDesignError('La confirmación de persist canary no coincide.', 'PERSIST_CANARY_CONFIRMATION_DENIED')
  }

  assertExact(requireEnv(environment, 'PERSIST_CANARY_REGISTRO_ID'), APPROVED.registroId, 'PERSIST_CANARY_REGISTRO_ID')
  assertExact(requireEnv(environment, 'PERSIST_CANARY_CLIENTE_ID'), APPROVED.clienteId, 'PERSIST_CANARY_CLIENTE_ID')
  assertExact(requireEnv(environment, 'PERSIST_CANARY_EMPLEADO_ID'), APPROVED.empleadoId, 'PERSIST_CANARY_EMPLEADO_ID')
  assertExact(requireEnv(environment, 'PERSIST_CANARY_SCHEDULE_ID'), APPROVED.scheduleId, 'PERSIST_CANARY_SCHEDULE_ID')
  assertExact(requireEnv(environment, 'PERSIST_CANARY_OPERATIVE_DATE'), APPROVED.operativeDate, 'PERSIST_CANARY_OPERATIVE_DATE')
  assertExact(requireEnv(environment, 'PERSIST_CANARY_CALCULATION_VERSION'), String(APPROVED.calculationVersion), 'PERSIST_CANARY_CALCULATION_VERSION')

  return {
    host: target.hostname,
    serviceRolePresent: Boolean(serviceRoleKey),
    approvedIdentity: { ...APPROVED },
  }
}

function assertApprovedIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    throw new PersistCanaryDesignError('La identidad de canary es obligatoria.', 'PERSIST_CANARY_IDENTITY_DENIED')
  }
  for (const [field, expected] of Object.entries(APPROVED)) {
    if (identity[field] !== expected) {
      throw new PersistCanaryDesignError(`${field} no coincide con la identidad aprobada.`, 'PERSIST_CANARY_IDENTITY_DENIED')
    }
  }
}

function planPersistCanary(precheck) {
  if (!precheck || typeof precheck !== 'object') {
    throw new PersistCanaryDesignError('Se requiere un precheck read-only.', 'PERSIST_CANARY_PRECHECK_REQUIRED')
  }
  assertApprovedIdentity(precheck.identity)
  if (!Number.isInteger(precheck.logicalWorkdayCount) || precheck.logicalWorkdayCount < 0 || precheck.logicalWorkdayCount > 1) {
    throw new PersistCanaryDesignError('La identidad no tiene exactamente cero o una jornada lógica.', 'PERSIST_CANARY_IDENTITY_CONFLICT')
  }
  if (precheck.calculationVersionPersisted !== true) {
    throw new PersistCanaryDesignError('El esquema/RPC no persiste calculation_version = 3.', 'PERSIST_CANARY_CALCULATION_VERSION_BLOCKED')
  }
  if (precheck.historyContractReady !== true) {
    throw new PersistCanaryDesignError('El esquema/RPC no soporta history auditable del canary.', 'PERSIST_CANARY_HISTORY_BLOCKED')
  }
  if (precheck.tenantFeatureContractReady !== true) {
    throw new PersistCanaryDesignError('No hay un contrato tenant feature aprobado para el canary.', 'PERSIST_CANARY_TENANT_FEATURE_BLOCKED')
  }
  if (precheck.contractRegressionPassed !== true) {
    throw new PersistCanaryDesignError('La regresion contractual V3 no fue aprobada para esta ejecucion.', 'PERSIST_CANARY_REGRESSION_BLOCKED')
  }
  if (typeof precheck.rpcFingerprint !== 'string' || precheck.rpcFingerprint === '' || precheck.rpcFingerprint !== precheck.approvedRpcFingerprint) {
    throw new PersistCanaryDesignError('El fingerprint de la RPC no coincide con el aprobado.', 'PERSIST_CANARY_RPC_FINGERPRINT_BLOCKED')
  }
  if (precheck.incidentWritePath !== false) {
    throw new PersistCanaryDesignError('El canary no permite un writer de incidencias.', 'PERSIST_CANARY_INCIDENT_PATH_BLOCKED')
  }
  if (precheck.logicalWorkdayCount === 1 && typeof precheck.persistedSnapshotMatches !== 'boolean') {
    throw new PersistCanaryDesignError(
      'Una jornada existente requiere comparación exacta del snapshot antes de persistir.',
      'PERSIST_CANARY_SNAPSHOT_REQUIRED'
    )
  }

  if (precheck.logicalWorkdayCount === 1 && !precheck.persistedSnapshotMatches) {
    throw new PersistCanaryDesignError(
      'Una jornada existente distinta es un conflicto; el primer canary no autoriza UPDATE.',
      'PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT'
    )
  }

  return {
    identity: { ...APPROVED },
    expectedPersistenceResult: precheck.logicalWorkdayCount === 0
      ? 'INSERTED'
      : 'UNCHANGED',
    maxLogicalWorkdaysAffected: 1,
    incidentWriteCalls: 0,
  }
}

function assertCanonicalManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !manifest.canonical || typeof manifest.canonical !== 'object') {
    throw new PersistCanaryDesignError('El manifest canonico V3 es obligatorio.', 'PERSIST_CANARY_MANIFEST_REQUIRED')
  }
  for (const [field, expected] of Object.entries(CANONICAL_ORACLE_V3)) {
    if (manifest.canonical[field] !== expected) {
      throw new PersistCanaryDesignError(`El manifest no coincide con el oracle V3 en ${field}.`, 'PERSIST_CANARY_MANIFEST_CANONICAL_FAILED')
    }
  }
  if (typeof manifest.canonical.integrityHash !== 'string' || manifest.canonical.integrityHash.trim() === '') {
    throw new PersistCanaryDesignError('El manifest requiere un integrity hash V3 fresco.', 'PERSIST_CANARY_MANIFEST_HASH_REQUIRED')
  }
  if (!Number.isInteger(manifest.expectedHistoryRows) || manifest.expectedHistoryRows < 0) {
    throw new PersistCanaryDesignError('El manifest requiere el conteo esperado de history.', 'PERSIST_CANARY_MANIFEST_HISTORY_REQUIRED')
  }
}

function verifyPersistCanaryPostcheck(manifest, observed) {
  if (!manifest || !observed) {
    throw new PersistCanaryDesignError('Postcheck requiere manifest y observación.', 'PERSIST_CANARY_POSTCHECK_REQUIRED')
  }
  assertApprovedIdentity(manifest.identity)
  assertApprovedIdentity(observed.identity)
  assertCanonicalManifest(manifest)
  if (observed.logicalWorkdayCount !== 1) {
    throw new PersistCanaryDesignError('El postcheck no encontró exactamente una jornada lógica.', 'PERSIST_CANARY_POSTCHECK_IDENTITY_FAILED')
  }
  if (observed.additionalIdentityWrites !== 0) {
    throw new PersistCanaryDesignError('El postcheck detectó identidades adicionales afectadas.', 'PERSIST_CANARY_POSTCHECK_SCOPE_FAILED')
  }
  if (observed.incidentWriteCalls !== 0) {
    throw new PersistCanaryDesignError('El postcheck detectó escrituras de incidencias.', 'PERSIST_CANARY_POSTCHECK_INCIDENT_FAILED')
  }
  if (observed.calculationVersion !== APPROVED.calculationVersion) {
    throw new PersistCanaryDesignError('El postcheck no preservó calculation_version = 3.', 'PERSIST_CANARY_POSTCHECK_VERSION_FAILED')
  }
  if (observed.historyRows !== manifest.expectedHistoryRows) {
    throw new PersistCanaryDesignError('El history observado no coincide con el manifest aprobado.', 'PERSIST_CANARY_POSTCHECK_HISTORY_FAILED')
  }
  for (const field of ['firstIn', 'lastOut', 'workedMinutes', 'breakMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'overtimeMinutes', 'workdayState', 'integrityHash']) {
    if (observed[field] !== manifest.canonical[field]) {
      throw new PersistCanaryDesignError(`El postcheck no coincide en ${field}.`, 'PERSIST_CANARY_POSTCHECK_CANONICAL_FAILED')
    }
  }
  return { pass: true }
}

function designReport(environment = process.env) {
  const config = readPersistCanaryDesignConfig(environment)
  return {
    mode: 'PERSIST_CANARY_DESIGN_ONLY',
    destinationGuard: 'PASS',
    host: config.host,
    serviceRolePresent: config.serviceRolePresent,
    writerReachable: false,
    upsertRpcReachable: false,
    databaseWrites: 0,
  }
}

if (require.main === module) {
  const allowed = process.argv.length === 3 && process.argv[2] === '--design-check'
  if (!allowed) {
    process.stderr.write('Uso: node backend/scripts/persist-canary-design.js --design-check\n')
    process.exitCode = 2
  } else {
    try {
      process.stdout.write(`${JSON.stringify(designReport())}\n`)
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ code: error.code || 'PERSIST_CANARY_DESIGN_FAILED', error: error.message })}\n`)
      process.exitCode = 1
    }
  }
}

module.exports = {
  APPROVED,
  CONFIRMATION,
  CANONICAL_ORACLE_V3,
  PersistCanaryDesignError,
  readPersistCanaryDesignConfig,
  assertApprovedIdentity,
  planPersistCanary,
  assertCanonicalManifest,
  verifyPersistCanaryPostcheck,
  designReport,
}
