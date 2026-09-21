'use strict'

/**
 * Generates evidence for one pre-approved revision-based V3 persistence canary.
 * It is deliberately a server-only, read-only CLI: no HTTP route, no RPC and
 * no persistence service are reachable from this module.
 */

const { createClient } = require('@supabase/supabase-js')
const { AttendanceEngineOrchestrator, SupabaseAttendanceReadRepository } = require('../services/attendance/AttendanceEngineOrchestrator.js')
const { createReadOnlyClient } = require('../attendance-runtime/readOnlySupabase.js')
const {
  APPROVED_REVISION_CANARY,
  EXPECTED_RUNTIME,
  REVISION_FEATURE_KEY,
  MANIFEST_CONFIRMATION,
  PersistCanaryRevisionError,
  sha256Canonical,
  manifestPayload,
} = require('./persist-canary-revision-contract.js')

const MANIFEST_GENERATOR_VERSION = 'persist-canary-revision-shadow-manifest-v1'

function requireEnv(environment, name) {
  const value = environment?.[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PersistCanaryRevisionError(`Falta ${name}.`, 'PERSIST_CANARY_MANIFEST_ENV_MISSING')
  }
  return value.trim()
}

function assertManifestEnvironment(environment) {
  if (requireEnv(environment, 'PERSIST_CANARY_MANIFEST_CONFIRMATION') !== MANIFEST_CONFIRMATION) {
    throw new PersistCanaryRevisionError('Falta confirmacion humana read-only para generar el manifest.', 'PERSIST_CANARY_MANIFEST_CONFIRMATION_DENIED')
  }
  if (requireEnv(environment, 'RUNTIME_VERSION') !== EXPECTED_RUNTIME.runtime_version ||
      requireEnv(environment, 'BUILD_SHA') !== EXPECTED_RUNTIME.build_sha) {
    throw new PersistCanaryRevisionError('RUNTIME_VERSION/BUILD_SHA no corresponden al runtime Cloud Run aprobado.', 'PERSIST_CANARY_RUNTIME_IDENTITY_DENIED')
  }
  const url = requireEnv(environment, 'SUPABASE_URL')
  try {
    if (new URL(url).protocol !== 'https:') throw new Error('protocol')
  } catch {
    throw new PersistCanaryRevisionError('SUPABASE_URL debe ser https valida.', 'PERSIST_CANARY_DESTINATION_DENIED')
  }
  return { url, secretKey: requireEnv(environment, 'SUPABASE_SECRET_KEY') }
}

function assertZeroWrites(counters) {
  const names = ['databaseWrites', 'rpcWriteCalls', 'storageWriteCalls', 'indirectSupabaseCalls']
  if (names.some((name) => counters[name] !== 0)) {
    throw new PersistCanaryRevisionError('El generador read-only detecto una capacidad de escritura.', 'PERSIST_CANARY_MANIFEST_NOT_READ_ONLY')
  }
}

async function loadRevisionFeatureState(client) {
  const [targetResponse, activeResponse] = await Promise.all([
    client.from('tenant_features').select('cliente_id,feature_key,mode,enabled')
      .eq('cliente_id', APPROVED_REVISION_CANARY.cliente_id).eq('feature_key', REVISION_FEATURE_KEY).maybeSingle(),
    client.from('tenant_features').select('cliente_id,feature_key,mode,enabled')
      .eq('feature_key', REVISION_FEATURE_KEY).eq('mode', 'ACTIVE').eq('enabled', true),
  ])
  if (targetResponse.error || activeResponse.error) {
    throw new PersistCanaryRevisionError('No se pudo leer REVISION_SCHEDULE_RESOLVER.', 'PERSIST_CANARY_FEATURE_READ_FAILED')
  }
  const target = targetResponse.data
  const activeTenants = activeResponse.data || []
  if (!target || target.enabled !== true || target.mode !== 'SHADOW') {
    throw new PersistCanaryRevisionError('REVISION_SCHEDULE_RESOLVER debe estar exactamente en SHADOW.', 'PERSIST_CANARY_REVISION_FEATURE_DENIED')
  }
  if (activeTenants.length !== 0) {
    throw new PersistCanaryRevisionError('Existe un tenant con REVISION_SCHEDULE_RESOLVER ACTIVE.', 'PERSIST_CANARY_OTHER_ACTIVE_TENANT')
  }
  return { mode: target.mode, enabled: target.enabled, active_tenants: [] }
}

function assertEngineResult(engineResult) {
  if (!engineResult || typeof engineResult !== 'object') {
    throw new PersistCanaryRevisionError('El engine no devolvio resultado.', 'PERSIST_CANARY_MANIFEST_ENGINE_INVALID')
  }
  const resolution = engineResult.scheduleResolution
  const record = engineResult.workdayRecord
  const calculation = engineResult.calculation
  const e = APPROVED_REVISION_CANARY
  if (engineResult.registroId !== e.registro_id || engineResult.operativeDate !== e.operative_date ||
      calculation?.clienteId !== e.cliente_id || calculation?.empleadoId !== e.empleado_id || calculation?.timezone !== e.timezone ||
      calculation?.calculationVersion !== 3 || resolution?.kind !== 'SCHEDULED' ||
      resolution.scheduleAssignmentId !== e.assignment_id || resolution.scheduleId !== e.schedule_id ||
      resolution.scheduleRevisionId !== e.schedule_revision_id || resolution.scheduleRevisionVersion !== e.revision_version ||
      resolution.scheduleRevisionHash !== e.revision_integrity_hash ||
      record?.registro_id !== e.registro_id || record?.cliente_id !== e.cliente_id || record?.empleado_id !== e.empleado_id ||
      record?.workday_date !== e.operative_date || record?.schedule_id !== e.schedule_id || record?.timezone !== e.timezone ||
      record?.calculation_version !== 3 || record?.integrity_hash !== calculation.integrityHash) {
    throw new PersistCanaryRevisionError('La identidad/resolucion/snapshot no coincide con C revisionada.', 'PERSIST_CANARY_MANIFEST_IDENTITY_DENIED')
  }
  return { resolution, record, calculation }
}

function snapshotFromRecord(record) {
  return {
    first_in: record.first_in,
    last_out: record.last_out,
    worked_minutes: record.worked_minutes,
    break_minutes: record.break_minutes,
    overtime_minutes: record.overtime_minutes,
    late_minutes: record.late_minutes,
    early_leave_minutes: record.early_leave_minutes,
    status: record.status,
    calculation_version: record.calculation_version,
    integrity_hash: record.integrity_hash,
    source_observed_at: record.source_observed_at,
    source_event_count: record.source_event_count,
  }
}

async function generatePersistCanaryRevisionShadowManifest({ environment = process.env, dependencies = {} } = {}) {
  const config = assertManifestEnvironment(environment)
  const counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }
  const rawClient = dependencies.createClient
    ? dependencies.createClient(config.url, config.secretKey)
    : createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const client = createReadOnlyClient(rawClient, counters)
  const feature = await loadRevisionFeatureState(client)
  const orchestrator = dependencies.createOrchestrator
    ? dependencies.createOrchestrator(client)
    : new AttendanceEngineOrchestrator({
      repository: new SupabaseAttendanceReadRepository(client), mode: 'SHADOW',
      calculationVersion: 3, logger: { info() {}, error() {} },
    })
  const engineResult = await orchestrator.run({ registroId: APPROVED_REVISION_CANARY.registro_id })
  const { resolution, record } = assertEngineResult(engineResult)
  assertZeroWrites(counters)
  const manifest = {
    manifest_version: 1,
    phase: '65_persist_canary_revision_shadow_manifest',
    mode: 'READ_ONLY_SHADOW_MANIFEST',
    generated_at_utc: new Date().toISOString(),
    source: {
      manifest_generator_version: MANIFEST_GENERATOR_VERSION,
      runtime: { ...EXPECTED_RUNTIME },
      engine_version: 'ATTENDANCE_ENGINE_V3',
      revision_feature: feature,
    },
    identity: { ...APPROVED_REVISION_CANARY },
    snapshot: snapshotFromRecord(record),
    schedule_resolution: {
      assignment_id: resolution.scheduleAssignmentId,
      schedule_revision_id: resolution.scheduleRevisionId,
      revision_version: resolution.scheduleRevisionVersion,
      revision_integrity_hash: resolution.scheduleRevisionHash,
    },
    counters: {
      databaseWrites: 0, persistenceCalls: 0, rpcWriteCalls: 0,
      storageWriteCalls: 0, indirectSupabaseCalls: 0, incidentWriteCalls: 0,
    },
  }
  manifest.manifest_sha256 = sha256Canonical(manifestPayload(manifest))
  return manifest
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--registro-id' || argv[1] !== APPROVED_REVISION_CANARY.registro_id) {
    throw new PersistCanaryRevisionError(
      `Uso: node backend/scripts/generate-persist-canary-revision-shadow-manifest.js --registro-id ${APPROVED_REVISION_CANARY.registro_id}`,
      'PERSIST_CANARY_MANIFEST_USAGE_DENIED'
    )
  }
}

if (require.main === module) {
  try {
    parseArguments(process.argv.slice(2))
    generatePersistCanaryRevisionShadowManifest().then((manifest) => {
      process.stdout.write(`${JSON.stringify(manifest)}\n`)
    }).catch((error) => {
      process.stderr.write(`${JSON.stringify({ error_code: error.code || 'PERSIST_CANARY_MANIFEST_FAILED', error: error.message })}\n`)
      process.exitCode = 2
    })
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error_code: error.code || 'PERSIST_CANARY_MANIFEST_FAILED', error: error.message })}\n`)
    process.exitCode = 2
  }
}

module.exports = {
  MANIFEST_GENERATOR_VERSION,
  assertManifestEnvironment,
  loadRevisionFeatureState,
  assertEngineResult,
  snapshotFromRecord,
  generatePersistCanaryRevisionShadowManifest,
  parseArguments,
}
