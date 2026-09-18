'use strict'

const { createHash } = require('node:crypto')
const { readFile, readdir } = require('node:fs/promises')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')
const { createReadOnlyClient } = require('./readOnlySupabase.js')

const TARGET = Object.freeze({
  tenantId: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  employeeId: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  assignmentId: '2984316c-1c93-4f66-853e-349f90b9f82c',
  scheduleId: '5a753368-f019-4230-89e2-79beaa39ff0f',
  revisionId: '09df6a75-e231-4654-ae70-8448bdf2c312',
  integrityHash: '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866',
  operativeDate: '2026-09-14',
  featureKey: 'REVISION_SCHEDULE_RESOLVER',
})

class AttendanceRuntimePostcheckError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AttendanceRuntimePostcheckError'
    this.code = code
  }
}

function requireEnv(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AttendanceRuntimePostcheckError(`Falta ${name}.`, 'RUNTIME_POSTCHECK_ENV_MISSING')
  }
  return value.trim()
}

async function runtimeSourceSha256() {
  const root = path.resolve(__dirname, '..', '..')
  const files = [
    'backend/package.json',
    'backend/package-lock.json',
    'backend/attendance-runtime/server.js',
    'backend/attendance-runtime/app.js',
    'backend/attendance-runtime/AttendanceRuntimeService.js',
    'backend/attendance-runtime/readOnlySupabase.js',
    'backend/attendance-runtime/config.js',
    'backend/attendance-runtime/tenantFeature.js',
    'backend/services/attendance/AttendanceEngineOrchestrator.js',
    'backend/services/attendance/WorkdayPersistenceContract.js',
  ]
  async function collect(relativeDirectory) {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true })
    const nested = await Promise.all(entries.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1)).map(async (entry) => {
      const relative = `${relativeDirectory}/${entry.name}`
      return entry.isDirectory() ? collect(relative) : [relative]
    }))
    return nested.flat()
  }
  files.push(...await collect('src/domain/attendance'))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(await readFile(path.join(root, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function getJson(url, fetchImplementation) {
  const response = await fetchImplementation(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new AttendanceRuntimePostcheckError(`HTTP ${response.status} desde runtime.`, 'RUNTIME_HTTP_UNAVAILABLE')
  return response.json()
}

async function runPostDeployReadOnlyCheck(environment = process.env, options = {}) {
  const runtimeUrl = requireEnv(environment, 'ATTENDANCE_RUNTIME_URL').replace(/\/$/, '')
  const expectedVersion = requireEnv(environment, 'ATTENDANCE_RUNTIME_EXPECTED_VERSION')
  const expectedSha = requireEnv(environment, 'ATTENDANCE_RUNTIME_EXPECTED_SHA256')
  const expectedBuildSha = requireEnv(environment, 'ATTENDANCE_RUNTIME_EXPECTED_BUILD_SHA')
  const counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }
  const rawClient = options.createClient
    ? options.createClient()
    : createClient(requireEnv(environment, 'SUPABASE_URL'), requireEnv(environment, 'SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  const client = createReadOnlyClient(rawClient, counters)
  const fetchImplementation = options.fetch || fetch
  const target = options.target || TARGET
  const report = {
    phase: 'attendance_runtime_postdeploy_readonly',
    databaseWrites: 0,
    persistenceCalls: 0,
    rpcWriteCalls: 0,
    storageWriteCalls: 0,
    indirectSupabaseCalls: 0,
    incidentWriteCalls: 0,
    engineActivated: false,
    persistCanarySelected: false,
  }
  try {
    const [health, ready, domain] = await Promise.all([
      getJson(`${runtimeUrl}/health`, fetchImplementation),
      getJson(`${runtimeUrl}/ready`, fetchImplementation),
      import('../../src/domain/attendance/index.ts'),
    ])
    report.runtime_version = health.runtime_version || null
    report.runtime_build_sha = health.build_sha || null
    report.runtime_health = health.status === 'ok' && health.execution_mode === 'SHADOW_ONLY'
    report.runtime_ready = ready.status === 'ok' && ready.database === 'reachable'
    report.runtime_version_match = report.runtime_version === expectedVersion
    report.runtime_build_sha_match = report.runtime_build_sha === expectedBuildSha
    report.runtime_source_sha256 = await runtimeSourceSha256()
    report.runtime_source_sha_match = report.runtime_source_sha256 === expectedSha

    const [featureResponse, assignmentsResponse, revisionsResponse] = await Promise.all([
      client.from('tenant_features').select('cliente_id,feature_key,mode,enabled')
        .eq('cliente_id', target.tenantId).eq('feature_key', target.featureKey).maybeSingle(),
      client.from('empleados_horarios').select('id,cliente_id,empleado_id,horario_id,schedule_revision_id,fecha_inicio,fecha_fin,activo')
        .eq('cliente_id', target.tenantId).eq('empleado_id', target.employeeId).eq('id', target.assignmentId),
      client.from('schedule_revisions').select('id,cliente_id,horario_id,version,config_snapshot,integrity_hash')
        .eq('cliente_id', target.tenantId).eq('id', target.revisionId),
    ])
    if (featureResponse.error || assignmentsResponse.error || revisionsResponse.error) {
      throw new AttendanceRuntimePostcheckError('No se pudo leer el contrato de revision.', 'RUNTIME_POSTCHECK_DB_READ_FAILED')
    }
    const feature = featureResponse.data
    report.tenant_feature_mode = feature?.enabled === true ? feature.mode : 'OFF'
    report.tenant_feature_supported = ['OFF', 'SHADOW', 'ACTIVE'].includes(report.tenant_feature_mode)
    const assignments = assignmentsResponse.data || []
    const revisions = revisionsResponse.data || []
    const resolution = domain.ScheduleResolver.resolve({
      clienteId: target.tenantId,
      empleadoId: target.employeeId,
      candidateDate: target.operativeDate,
      assignments,
      revisions,
    })
    report.revision_resolver_available = true
    report.c_resolves_from_revision = resolution.kind === 'SCHEDULED'
      && resolution.scheduleAssignmentId === target.assignmentId
      && resolution.scheduleRevisionId === target.revisionId
      && resolution.scheduleRevisionVersion === 1
    report.hash_correct = resolution.scheduleRevisionHash === target.integrityHash
    report.databaseWrites = counters.databaseWrites
    report.rpcWriteCalls = counters.rpcWriteCalls
    report.storageWriteCalls = counters.storageWriteCalls
    report.indirectSupabaseCalls = counters.indirectSupabaseCalls
    report.postcheck_pass = report.runtime_health && report.runtime_ready && report.runtime_version_match
      && report.runtime_build_sha_match && report.runtime_source_sha_match && report.tenant_feature_supported && report.revision_resolver_available
      && report.c_resolves_from_revision && report.hash_correct
      && report.databaseWrites === 0 && report.persistenceCalls === 0 && report.rpcWriteCalls === 0
      && report.storageWriteCalls === 0 && report.indirectSupabaseCalls === 0 && report.incidentWriteCalls === 0
  } catch (error) {
    report.error_code = error.code || 'RUNTIME_POSTCHECK_FAILED'
    report.databaseWrites = counters.databaseWrites
    report.rpcWriteCalls = counters.rpcWriteCalls
    report.storageWriteCalls = counters.storageWriteCalls
    report.indirectSupabaseCalls = counters.indirectSupabaseCalls
    report.postcheck_pass = false
  }
  return report
}

if (require.main === module) {
  runPostDeployReadOnlyCheck().then((report) => {
    console.log(JSON.stringify(report))
    if (!report.postcheck_pass) process.exitCode = 3
  }).catch((error) => {
    console.error(JSON.stringify({ error_code: error.code || 'RUNTIME_POSTCHECK_FAILED' }))
    process.exitCode = 3
  })
}

module.exports = { TARGET, runPostDeployReadOnlyCheck, runtimeSourceSha256, AttendanceRuntimePostcheckError }
