import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseRuntimeCapability, loadRuntimeConfig } = require('../../backend/attendance-runtime-v3/config.js')
const { publicRuntimeStatus, createRuntimeApp } = require('../../backend/attendance-runtime-v3/app.js')
const { getCalculationEngine } = require('../../backend/services/attendance/CalculationEngineRegistry.js')
const { AttendancePersistDispatcher } = require('../../backend/attendance-persist-dispatcher/dispatcher.js')

test('rollback deployment accepts exactly two explicit capabilities, never a missing capability', () => {
  for (const value of ['ACTIVE_PERSIST_CAPABLE', 'REVISION_AWARE_V3_ONLY']) {
    assert.equal(parseRuntimeCapability(value), value)
    assert.equal(publicRuntimeStatus({ runtimeCapability: value }).runtime_capability, value)
  }
  for (const value of [undefined, '', 'INVALID_VALUE', 'SHADOW_ONLY', 'ACTIVE_CAPABLE']) {
    assert.throws(() => parseRuntimeCapability(value), { code: 'ATTENDANCE_RUNTIME_CAPABILITY_INVALID' })
  }
  const env = { SUPABASE_URL: 'https://localhost.invalid', SUPABASE_SECRET_KEY: 's'.repeat(20), ATTENDANCE_RUNTIME_INTERNAL_TOKEN: 't'.repeat(32), RUNTIME_VERSION: 'local', BUILD_SHA: 'abcdef1' }
  assert.throws(() => loadRuntimeConfig(env), { code: 'ATTENDANCE_RUNTIME_CAPABILITY_INVALID' })
  assert.equal(getCalculationEngine(3).calculationVersion, 3)
  assert.throws(() => getCalculationEngine(4), { code: 'CALCULATION_VERSION_UNAVAILABLE' })
})

test('rollback HTTP surface does not expose candidate or promotion operations', async () => {
  const app = createRuntimeApp({ service: {}, config: { runtimeCapability: 'REVISION_AWARE_V3_ONLY', internalToken: 't'.repeat(32) } })
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise(resolve => server.once('listening', resolve))
    for (const route of ['candidate', 'promote', 'promotion', 'revision']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/attendance/${route}`, { method: 'POST', headers: { authorization: 'Bearer ' + 't'.repeat(32), 'content-type': 'application/json' }, body: '{}' })
      assert.equal(response.status, 404)
    }
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('existing dispatcher classifies version unavailable as DENIED without a retry', async () => {
  const acknowledgements = []
  const worker = new AttendancePersistDispatcher({
    client: { rpc: async (name, params) => { acknowledgements.push({ name, params }); return { error: null } } },
    config: { runtimeUrl: 'https://runtime.invalid', internalToken: 'local-only', workerId: 'rollback-test' },
    identityTokenProvider: async () => 'local-only', logger: {},
    fetchImpl: async () => ({ ok: false, json: async () => ({ error_code: 'CALCULATION_VERSION_UNAVAILABLE' }) }),
  })
  assert.equal((await worker.process({ outbox_id: 'local-fixture' })).status, 'DENIED')
  assert.equal(acknowledgements.length, 1)
  assert.equal(acknowledgements[0].params.p_terminal_status, 'DENIED')
})
