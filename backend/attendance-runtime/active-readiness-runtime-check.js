'use strict'

// HTTP-only evidence checker. It does not invoke the engine, write the DB, or
// require a service-role secret.
const { ACTIVE_READINESS } = require('../scripts/revision-resolver-active-readiness-contract.js')

async function checkActiveRuntimeReadiness(environment = process.env, { fetchImplementation = fetch } = {}) {
  const baseUrl = environment.ATTENDANCE_RUNTIME_URL?.replace(/\/$/, '')
  if (!baseUrl) throw new Error('ATTENDANCE_RUNTIME_URL_REQUIRED')
  const [healthResponse, readyResponse] = await Promise.all([
    fetchImplementation(`${baseUrl}/health`, { headers: { accept: 'application/json' } }),
    fetchImplementation(`${baseUrl}/ready`, { headers: { accept: 'application/json' } }),
  ])
  if (!healthResponse.ok || !readyResponse.ok) throw new Error('ATTENDANCE_RUNTIME_HTTP_UNAVAILABLE')
  const [health, ready] = await Promise.all([healthResponse.json(), readyResponse.json()])
  return {
    phase: 'revision_resolver_active_runtime_readiness', databaseWrites: 0, rpcWriteCalls: 0, persistenceCalls: 0,
    runtime_version: health.runtime_version || null, runtime_build_sha: health.build_sha || null,
    runtime_ready: ready.status === 'ok' && ready.database === 'reachable',
    runtime_readiness_pass: health.status === 'ok' && health.execution_mode === 'SHADOW_ONLY' &&
      health.runtime_version === ACTIVE_READINESS.runtime_version && health.build_sha === ACTIVE_READINESS.runtime_build_sha &&
      ready.status === 'ok' && ready.database === 'reachable',
  }
}

if (require.main === module) {
  checkActiveRuntimeReadiness().then((report) => {
    process.stdout.write(`${JSON.stringify(report)}\n`)
    if (!report.runtime_readiness_pass) process.exitCode = 3
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ error_code: error.message || 'RUNTIME_READINESS_FAILED' })}\n`)
    process.exitCode = 3
  })
}

module.exports = { checkActiveRuntimeReadiness }
