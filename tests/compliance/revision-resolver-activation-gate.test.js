import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const runtime = require('../../backend/scripts/revision-resolver-runtime-postcheck.js')
const { TARGET, runRevisionResolverRuntimePostcheck, runtimeSourceSha256 } = runtime

function snapshot() {
  return {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: true, entrada: '09:00', salida: '18:00' }, mar: { activo: true, entrada: '09:00', salida: '18:00' },
      mie: { activo: true, entrada: '09:00', salida: '18:00' }, jue: { activo: true, entrada: '09:00', salida: '18:00' },
      vie: { activo: true, entrada: '09:00', salida: '18:00' }, sab: { activo: false }, dom: { activo: false },
    }, tolerancia_minutos: 10, horario_activo: true,
  }
}

function rows(overrides = {}) {
  const config_snapshot = snapshot()
  return {
    tenant_features: [{ cliente_id: TARGET.tenantId, feature_key: TARGET.featureKey, mode: 'ACTIVE', enabled: true }],
    empleados_horarios: [{ id: TARGET.assignmentId, cliente_id: TARGET.tenantId, empleado_id: TARGET.employeeId, horario_id: TARGET.scheduleId, schedule_revision_id: TARGET.revisionId, fecha_inicio: '2026-09-09', fecha_fin: null, activo: true }],
    schedule_revisions: [{ id: TARGET.revisionId, cliente_id: TARGET.tenantId, horario_id: TARGET.scheduleId, version: 1, config_snapshot, integrity_hash: domain.computeScheduleRevisionIntegrityHash(config_snapshot) }],
    ...overrides,
  }
}

function client(data) {
  return {
    from(table) {
      const builder = {
        select() { return this }, eq() { return this },
        maybeSingle: async () => ({ data: data[table]?.[0] ?? null, error: null }),
      }
      return builder
    },
    rpc() { throw new Error('unexpected rpc') },
  }
}

async function environment() {
  return {
    SUPABASE_URL: 'https://project.example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    REVISION_RESOLVER_POSTCHECK_EXPECTED_SHA256: await runtimeSourceSha256(),
  }
}

test('runtime postcheck proves active C revision resolution without engine or writes', async () => {
  const data = rows()
  const testTarget = { ...TARGET, integrityHash: data.schedule_revisions[0].integrity_hash }
  const report = await runRevisionResolverRuntimePostcheck(await environment(), { createClient: () => client(data), target: testTarget })
  assert.equal(report.postcheck_pass, true, JSON.stringify(report))
  assert.equal(report.c_resolves_from_revision, true)
  assert.equal(report.databaseWrites, 0)
  assert.equal(report.rpcWrites, 0)
  assert.equal(report.engineActivated, false)
})

test('runtime postcheck rejects a flag active for another tenant', async () => {
  const data = rows({ tenant_features: [{ cliente_id: 'other-tenant', feature_key: TARGET.featureKey, mode: 'ACTIVE', enabled: true }] })
  const report = await runRevisionResolverRuntimePostcheck(await environment(), { createClient: () => client(data) })
  assert.equal(report.postcheck_pass, false)
  assert.equal(report.revision_resolver_active_only_for_pilot, false)
})

test('activation SQL checks are read-only and no activation DML has been run', () => {
  const precheck = readFileSync(new URL('../../database/live-schema/59_revision_resolver_activation_precheck.sql', import.meta.url), 'utf8')
  const postcheck = readFileSync(new URL('../../database/live-schema/63_revision_resolver_activation_postcheck.sql', import.meta.url), 'utf8')
  assert.match(precheck + postcheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(precheck + postcheck, /ROLLBACK;/)
  assert.doesNotMatch(precheck + postcheck, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i)
  assert.match(precheck + postcheck, new RegExp(TARGET.revisionId))
})

test('activation SQL uses the established tenant_features shape', () => {
  const names = [
    '59_revision_resolver_activation_precheck.sql',
    '60_revision_resolver_shadow_change.sql',
    '61_revision_resolver_active_change.sql',
    '62_revision_resolver_rollback.sql',
    '63_revision_resolver_activation_postcheck.sql',
  ]
  const sql = names.map((name) => readFileSync(new URL(`../../database/live-schema/${name}`, import.meta.url), 'utf8')).join('\n')
  assert.doesNotMatch(sql, /\bf\.config\b|\bconfig\s*=|\bconfig\s*\)/i)
  assert.doesNotMatch(sql, /jsonb_agg\(cliente_id\)/i)
  assert.match(sql, /jsonb_agg\(f\.cliente_id\)/i)
  assert.match(sql, /feature_key,mode,enabled/i)
})

test('Phase 64 is a SHADOW-only read-only postcheck with no ACTIVE authorization', () => {
  const shadowPostcheck = readFileSync(new URL('../../database/live-schema/64_revision_resolver_shadow_postcheck.sql', import.meta.url), 'utf8')
  assert.match(shadowPostcheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(shadowPostcheck, /ROLLBACK;/)
  assert.doesNotMatch(shadowPostcheck, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i)
  assert.match(shadowPostcheck, /mode='SHADOW'/)
  assert.match(shadowPostcheck, /NOT EXISTS\(SELECT 1 FROM features f WHERE f\.mode='ACTIVE' AND f\.enabled\)/)
  assert.match(shadowPostcheck, new RegExp(TARGET.revisionId))
})
