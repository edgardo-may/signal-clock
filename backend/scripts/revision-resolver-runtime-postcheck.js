'use strict'

/**
 * Manual, read-only verification intended to execute inside the same deployed
 * Node runtime that will host AttendanceEngineOrchestrator. It never invokes
 * the engine, persistence boundary, or a mutation method.
 */

const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')

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

class RevisionResolverRuntimePostcheckError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'RevisionResolverRuntimePostcheckError'
    this.code = code
  }
}

function requireEnv(name, environment) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RevisionResolverRuntimePostcheckError(`Falta ${name}.`, 'RUNTIME_POSTCHECK_ENV_MISSING')
  }
  return value.trim()
}

function readOnlyQueryGuard(query, counters) {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === 'then') return target.then?.bind(target)
      if (['insert', 'update', 'delete', 'upsert'].includes(property)) return () => {
        counters.databaseWrites += 1
        throw new RevisionResolverRuntimePostcheckError('La comprobación runtime no permite DML.', 'RUNTIME_POSTCHECK_WRITE_DENIED')
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

function readOnlyClient(client, counters) {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'rpc') return () => {
        counters.rpcWrites += 1
        throw new RevisionResolverRuntimePostcheckError('La comprobación runtime no permite RPC.', 'RUNTIME_POSTCHECK_RPC_DENIED')
      }
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args) => {
        const result = value.apply(target, args)
        return property === 'from' && result && typeof result === 'object' ? readOnlyQueryGuard(result, counters) : result
      }
    },
  })
}

async function runtimeSourceSha256() {
  const root = path.resolve(__dirname, '..', '..')
  const paths = [
    'src/domain/attendance/adapters/ScheduleRevisionAdapter.ts',
    'src/domain/attendance/adapters/ScheduleResolver.ts',
    'src/domain/attendance/ShiftMatcher.ts',
    'src/domain/attendance/AttendanceEngine.ts',
    'backend/services/attendance/AttendanceEngineOrchestrator.js',
  ]
  const contents = await Promise.all(paths.map(async (relativePath) => [relativePath, await readFile(path.join(root, relativePath))]))
  const hash = createHash('sha256')
  for (const [relativePath, content] of contents) hash.update(relativePath).update('\0').update(content).update('\0')
  return hash.digest('hex')
}

async function single(query, label) {
  const { data, error } = await query.maybeSingle()
  if (error) throw new RevisionResolverRuntimePostcheckError(`${label}: ${error.message}`, 'RUNTIME_POSTCHECK_READ_FAILED')
  return data || null
}

async function runRevisionResolverRuntimePostcheck(environment = process.env, dependencies = { createClient }) {
  const target = dependencies.target || TARGET
  const url = requireEnv('SUPABASE_URL', environment)
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', environment)
  const expectedSourceSha = requireEnv('REVISION_RESOLVER_POSTCHECK_EXPECTED_SHA256', environment)
  if (!/^[0-9a-f]{64}$/i.test(expectedSourceSha)) {
    throw new RevisionResolverRuntimePostcheckError('REVISION_RESOLVER_POSTCHECK_EXPECTED_SHA256 debe ser SHA-256.', 'RUNTIME_POSTCHECK_EXPECTED_SHA_INVALID')
  }
  const counters = { databaseWrites: 0, rpcWrites: 0 }
  const client = readOnlyClient(dependencies.createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }), counters)
  const [feature, assignment, revision, runtimeSourceSha] = await Promise.all([
    single(client.from('tenant_features').select('cliente_id,feature_key,mode,enabled,config')
      .eq('cliente_id', target.tenantId).eq('feature_key', target.featureKey), 'tenant_features'),
    single(client.from('empleados_horarios').select('id,cliente_id,empleado_id,horario_id,schedule_revision_id,fecha_inicio,fecha_fin,activo')
      .eq('id', target.assignmentId).eq('cliente_id', target.tenantId), 'empleados_horarios'),
    single(client.from('schedule_revisions').select('id,cliente_id,horario_id,version,config_snapshot,integrity_hash')
      .eq('id', target.revisionId).eq('cliente_id', target.tenantId), 'schedule_revisions'),
    runtimeSourceSha256(),
  ])
  const domain = await import('../../src/domain/attendance/index.ts')
  let resolution = null
  let resolutionErrorCode = null
  try {
    resolution = domain.ScheduleResolver.resolve({
      clienteId: target.tenantId, empleadoId: target.employeeId, candidateDate: target.operativeDate,
      assignments: assignment ? [assignment] : [], revisions: revision ? [revision] : [],
    })
  } catch (error) {
    resolutionErrorCode = error?.code || 'RUNTIME_POSTCHECK_RESOLUTION_ERROR'
  }
  const activeOnlyForPilot = feature?.cliente_id === target.tenantId
    && feature?.feature_key === target.featureKey && feature?.mode === 'ACTIVE' && feature?.enabled === true
  const cResolvesFromRevision = resolution?.kind === 'SCHEDULED'
    && resolution.scheduleAssignmentId === target.assignmentId
    && resolution.scheduleRevisionId === target.revisionId
    && resolution.scheduleRevisionVersion === 1
    && resolution.scheduleRevisionHash === target.integrityHash
    && resolution.shift.startTime === '09:00' && resolution.shift.endTime === '18:00'
    && resolution.shift.toleranceMinutes === 10
  const report = {
    phase: 'revision_resolver_runtime_postcheck', mode: 'READ_ONLY',
    runtime_version: 'revision-schedule-resolver-v1', runtime_source_sha256: runtimeSourceSha,
    expected_runtime_source_sha256: expectedSourceSha.toLowerCase(),
    runtime_artifact_matches_expected: runtimeSourceSha === expectedSourceSha.toLowerCase(),
    tenant_id: target.tenantId, feature_key: target.featureKey,
    revision_resolver_active_only_for_pilot: activeOnlyForPilot,
    feature: feature ? { mode: feature.mode, enabled: feature.enabled, config: feature.config } : null,
    c_resolves_from_revision: cResolvesFromRevision,
    resolution_error_code: resolutionErrorCode,
    databaseWrites: counters.databaseWrites, rpcWrites: counters.rpcWrites,
    persistCanarySelected: false, engineActivated: false,
    postcheck_pass: runtimeSourceSha === expectedSourceSha.toLowerCase()
      && activeOnlyForPilot && cResolvesFromRevision && counters.databaseWrites === 0 && counters.rpcWrites === 0,
  }
  return report
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })
  runRevisionResolverRuntimePostcheck()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.postcheck_pass) process.exitCode = 3
    })
    .catch((error) => {
      console.error(JSON.stringify({ phase: 'revision_resolver_runtime_postcheck', error_code: error.code || 'RUNTIME_POSTCHECK_FAILED', message: error.message }))
      process.exitCode = 1
    })
}

module.exports = { TARGET, RevisionResolverRuntimePostcheckError, runRevisionResolverRuntimePostcheck, runtimeSourceSha256 }
