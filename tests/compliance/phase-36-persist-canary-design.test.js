import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const {
  APPROVED,
  CONFIRMATION,
  CANONICAL_ORACLE_V3,
  PersistCanaryDesignError,
  readPersistCanaryDesignConfig,
  assertApprovedIdentity,
  planPersistCanary,
  verifyPersistCanaryPostcheck,
} = require('../../backend/scripts/persist-canary-design.js')

function environment(overrides = {}) {
  return {
    SUPABASE_URL: 'https://project.example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-presence-marker',
    PERSIST_CANARY_ALLOWED_HOST: 'project.example.supabase.co',
    PERSIST_CANARY_ENVIRONMENT: 'PRODUCTION_PERSIST_CANARY',
    PERSIST_CANARY_CONFIRMATION: CONFIRMATION,
    PERSIST_CANARY_REGISTRO_ID: APPROVED.registroId,
    PERSIST_CANARY_CLIENTE_ID: APPROVED.clienteId,
    PERSIST_CANARY_EMPLEADO_ID: APPROVED.empleadoId,
    PERSIST_CANARY_SCHEDULE_ID: APPROVED.scheduleId,
    PERSIST_CANARY_OPERATIVE_DATE: APPROVED.operativeDate,
    PERSIST_CANARY_CALCULATION_VERSION: '3',
    ...overrides,
  }
}

function readyPrecheck(overrides = {}) {
  return {
    identity: { ...APPROVED },
    logicalWorkdayCount: 0,
    calculationVersionPersisted: true,
    historyContractReady: true,
    tenantFeatureContractReady: true,
    contractRegressionPassed: true,
    rpcFingerprint: 'approved-rpc-fingerprint',
    approvedRpcFingerprint: 'approved-rpc-fingerprint',
    incidentWritePath: false,
    ...overrides,
  }
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => error instanceof PersistCanaryDesignError && error.code === code)
}

test('1. complete independent persist guards pass only for the approved identity', () => {
  const config = readPersistCanaryDesignConfig(environment())
  assert.equal(config.host, 'project.example.supabase.co')
  assert.equal(config.serviceRolePresent, true)
  assert.deepEqual(config.approvedIdentity, APPROVED)
})

test('2. missing guards make a write authorization impossible', () => {
  expectCode(() => readPersistCanaryDesignConfig({}), 'PERSIST_CANARY_ENV_MISSING')
})

test('3. incorrect host fails closed', () => {
  expectCode(
    () => readPersistCanaryDesignConfig(environment({ PERSIST_CANARY_ALLOWED_HOST: 'other.example.supabase.co' })),
    'PERSIST_CANARY_DESTINATION_DENIED'
  )
})

test('4. incorrect environment fails closed', () => {
  expectCode(
    () => readPersistCanaryDesignConfig(environment({ PERSIST_CANARY_ENVIRONMENT: 'PRODUCTION_SHADOW' })),
    'PERSIST_CANARY_ENVIRONMENT_DENIED'
  )
})

test('5. incorrect confirmation fails closed', () => {
  expectCode(
    () => readPersistCanaryDesignConfig(environment({ PERSIST_CANARY_CONFIRMATION: 'I_APPROVE_READ_ONLY_SHADOW' })),
    'PERSIST_CANARY_CONFIRMATION_DENIED'
  )
})

test('6. incorrect candidate fails closed', () => {
  expectCode(
    () => readPersistCanaryDesignConfig(environment({ PERSIST_CANARY_REGISTRO_ID: '00000000-0000-4000-8000-000000000000' })),
    'PERSIST_CANARY_IDENTITY_DENIED'
  )
})

test('7. any identity component outside the one approved workday fails closed', () => {
  expectCode(
    () => assertApprovedIdentity({ ...APPROVED, operativeDate: '2026-09-04' }),
    'PERSIST_CANARY_IDENTITY_DENIED'
  )
})

test('8. V3 canonical identity locks calculation version 3 and the approved schedule', () => {
  assert.equal(APPROVED.calculationVersion, 3)
  assert.equal(APPROVED.scheduleId, 'be4035c8-042c-473b-b25d-b5bf3fb99701')
  assert.equal(APPROVED.operativeDate, '2026-09-03')
})

test('9. zero existing logical workdays plans exactly one INSERTED result', () => {
  const plan = planPersistCanary(readyPrecheck())
  assert.equal(plan.expectedPersistenceResult, 'INSERTED')
  assert.equal(plan.maxLogicalWorkdaysAffected, 1)
  assert.equal(plan.incidentWriteCalls, 0)
})

test('10. an exact second canary replay plans UNCHANGED, proving the desired idempotency', () => {
  const plan = planPersistCanary(readyPrecheck({
    logicalWorkdayCount: 1,
    persistedSnapshotMatches: true,
  }))
  assert.equal(plan.expectedPersistenceResult, 'UNCHANGED')
})

test('11. a changed existing snapshot blocks rather than authorizing an automatic UPDATE', () => {
  expectCode(() => planPersistCanary(readyPrecheck({
    logicalWorkdayCount: 1,
    persistedSnapshotMatches: false,
  })), 'PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT')
})

test('12. more than one logical workday blocks before any persistence boundary exists', () => {
  expectCode(
    () => planPersistCanary(readyPrecheck({ logicalWorkdayCount: 2 })),
    'PERSIST_CANARY_IDENTITY_CONFLICT'
  )
})

test('13. missing calculation-version persistence blocks the canary', () => {
  expectCode(
    () => planPersistCanary(readyPrecheck({ calculationVersionPersisted: false })),
    'PERSIST_CANARY_CALCULATION_VERSION_BLOCKED'
  )
})

test('14. missing append-only history semantics block the canary', () => {
  expectCode(
    () => planPersistCanary(readyPrecheck({ historyContractReady: false })),
    'PERSIST_CANARY_HISTORY_BLOCKED'
  )
})

test('15. an incident-capable path blocks before persistence', () => {
  expectCode(
    () => planPersistCanary(readyPrecheck({ incidentWritePath: true })),
    'PERSIST_CANARY_INCIDENT_PATH_BLOCKED'
  )
})

test('16. unapproved tenant feature, regression, or RPC fingerprint blocks before persistence', () => {
  expectCode(
    () => planPersistCanary(readyPrecheck({ tenantFeatureContractReady: false })),
    'PERSIST_CANARY_TENANT_FEATURE_BLOCKED'
  )
  expectCode(
    () => planPersistCanary(readyPrecheck({ contractRegressionPassed: false })),
    'PERSIST_CANARY_REGRESSION_BLOCKED'
  )
  expectCode(
    () => planPersistCanary(readyPrecheck({ rpcFingerprint: 'unexpected' })),
    'PERSIST_CANARY_RPC_FINGERPRINT_BLOCKED'
  )
})

test('17. postcheck accepts only the approved canonical V3 observation with zero extra identities and incidents', () => {
  const manifest = {
    identity: { ...APPROVED },
    expectedHistoryRows: 1,
    canonical: {
      firstIn: '2026-09-03T16:26:04.000Z',
      lastOut: '2026-09-03T17:55:13.000Z',
      workedMinutes: 89,
      breakMinutes: 0,
      lateMinutes: 326,
      earlyLeaveMinutes: 65,
      overtimeMinutes: 0,
      workdayState: 'COMPLETE',
      integrityHash: 'fixture-v3-hash',
    },
  }
  assert.deepEqual(verifyPersistCanaryPostcheck(manifest, {
    identity: { ...APPROVED },
    logicalWorkdayCount: 1,
    additionalIdentityWrites: 0,
    incidentWriteCalls: 0,
    calculationVersion: 3,
    historyRows: 1,
    ...manifest.canonical,
  }), { pass: true })
})

test('18. postcheck fails closed on an additional write or incident write', () => {
  const manifest = {
    identity: { ...APPROVED },
    expectedHistoryRows: 1,
    canonical: {
      firstIn: '2026-09-03T16:26:04.000Z', lastOut: '2026-09-03T17:55:13.000Z',
      workedMinutes: 89, breakMinutes: 0, lateMinutes: 326, earlyLeaveMinutes: 65,
      overtimeMinutes: 0, workdayState: 'COMPLETE', integrityHash: 'fixture-v3-hash',
    },
  }
  expectCode(() => verifyPersistCanaryPostcheck(manifest, {
    identity: { ...APPROVED }, logicalWorkdayCount: 1, additionalIdentityWrites: 1,
    incidentWriteCalls: 0, calculationVersion: 3, historyRows: 1, ...manifest.canonical,
  }), 'PERSIST_CANARY_POSTCHECK_SCOPE_FAILED')
  expectCode(() => verifyPersistCanaryPostcheck(manifest, {
    identity: { ...APPROVED }, logicalWorkdayCount: 1, additionalIdentityWrites: 0,
    incidentWriteCalls: 1, calculationVersion: 3, historyRows: 1, ...manifest.canonical,
  }), 'PERSIST_CANARY_POSTCHECK_INCIDENT_FAILED')
})

test('19. the design helper and read-only SQL have no writer, RPC, or incident path', async () => {
  const [helper, precheck] = await Promise.all([
    readFile(new URL('../../backend/scripts/persist-canary-design.js', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/36_persist_canary_precheck.sql', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(helper, /require\(['"]@supabase|createClient\(|require\([^)]*WorkdayPersistenceService|\.rpc\(/)
  assert.match(precheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(precheck, /ROLLBACK;/)
  assert.doesNotMatch(precheck, /\bINSERT\s+INTO\b|\bUPDATE\s+public[.]\b|\bDELETE\s+FROM\b|SELECT\s+public[.]upsert_workday_record/i)
})

test('20. postcheck rejects a manifest without a fresh integrity hash or canonical V3 values', () => {
  const manifest = {
    identity: { ...APPROVED },
    expectedHistoryRows: 1,
    canonical: { ...CANONICAL_ORACLE_V3, integrityHash: '' },
  }
  expectCode(() => verifyPersistCanaryPostcheck(manifest, {
    identity: { ...APPROVED },
    logicalWorkdayCount: 1,
    additionalIdentityWrites: 0,
    incidentWriteCalls: 0,
    calculationVersion: 3,
    historyRows: 1,
    ...manifest.canonical,
}), 'PERSIST_CANARY_MANIFEST_HASH_REQUIRED')
})

test('21. prepared schema sequence is precheck/change/postcheck and encodes atomic V3 history semantics', async () => {
  const [precheck, change, postcheck] = await Promise.all([
    readFile(new URL('../../database/live-schema/37_persist_contract_precheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/38_persist_contract_change.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/39_persist_contract_postcheck.sql', import.meta.url), 'utf8'),
  ])
  assert.match(precheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(precheck, /ROLLBACK;/)
  assert.match(change, /calculation_version integer/)
  assert.match(change, /CREATE TABLE IF NOT EXISTS public\.workday_record_history/)
  assert.match(change, /INSERT INTO public\.workday_record_history/)
  assert.match(change, /FAIL CLOSED: existing snapshot differs/)
  assert.match(change, /SET search_path = pg_catalog, public/)
  assert.match(postcheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(postcheck, /atomic_history_version_path/)
  assert.match(postcheck, /postcheck_pass/)
})

test('22. optional history and tenant objects are guarded with safe OIDs, never unsafe regclass casts', async () => {
  const change = await readFile(new URL('../../database/live-schema/38_persist_contract_change.sql', import.meta.url), 'utf8')
  assert.match(change, /v_history_regclass\s+regclass/)
  assert.match(change, /v_tenant_features_regclass\s+regclass/)
  assert.match(change, /v_history_regclass\s*:=\s*to_regclass\('public\.workday_record_history'\)/)
  assert.match(change, /v_tenant_features_regclass\s*:=\s*to_regclass\('public\.tenant_features'\)/)
  assert.doesNotMatch(change, /'public\.workday_record_history'::regclass/)
  assert.doesNotMatch(change, /'public\.tenant_features'::regclass/)
  assert.match(change, /existing workday_record_history shape is incompatible/)
  assert.match(change, /existing tenant_features shape is incompatible/)
})

test('23. Phase 38 creates absent optional tables before every dependent DDL, DCL, index, or V3 runtime reference', async () => {
  // This is the Phase 37 ready state: workday_records and the legacy RPC exist,
  // while history, tenant_features, and the V3 RPC do not.
  const change = await readFile(new URL('../../database/live-schema/38_persist_contract_change.sql', import.meta.url), 'utf8')
  const position = (fragment) => {
    const index = change.indexOf(fragment)
    assert.notEqual(index, -1, `missing SQL fragment: ${fragment}`)
    return index
  }

  const preflight = position('DO $preflight$')
  const workdayAlter = position('ALTER TABLE public.workday_records\n  ADD COLUMN IF NOT EXISTS calculation_version integer;')
  const createHistory = position('CREATE TABLE IF NOT EXISTS public.workday_record_history')
  const createTenantFeatures = position('CREATE TABLE IF NOT EXISTS public.tenant_features')
  const workdayConstraint = position('DO $constraints$')
  const historyIndex = position('CREATE INDEX IF NOT EXISTS workday_record_history_logical_identity_idx')
  const historyRls = position('ALTER TABLE public.workday_record_history ENABLE ROW LEVEL SECURITY;')
  const tenantFeaturesRls = position('ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;')
  const tableRevoke = position('REVOKE ALL ON TABLE public.workday_record_history, public.tenant_features')
  const historyGrant = position('GRANT SELECT, INSERT ON TABLE public.workday_record_history TO service_role;')
  const tenantFeaturesGrant = position('GRANT SELECT ON TABLE public.tenant_features TO service_role;')
  const createV3 = position('CREATE OR REPLACE FUNCTION public.upsert_workday_record(')
  const legacyRevoke = position('REVOKE EXECUTE ON FUNCTION public.upsert_workday_record(')
  const commit = position('COMMIT;')

  assert.ok(preflight < workdayAlter)
  assert.ok(workdayAlter < createHistory)
  assert.ok(createHistory < createTenantFeatures)
  assert.ok(createTenantFeatures < workdayConstraint)
  assert.ok(workdayConstraint < historyIndex)
  assert.ok(historyIndex < historyRls)
  assert.ok(createHistory < historyRls)
  assert.ok(createTenantFeatures < tenantFeaturesRls)
  assert.ok(tenantFeaturesRls < tableRevoke)
  assert.ok(tableRevoke < historyGrant)
  assert.ok(tableRevoke < tenantFeaturesGrant)
  assert.ok(historyGrant < createV3)
  assert.ok(tenantFeaturesGrant < createV3)
  assert.ok(createV3 < legacyRevoke)
  assert.ok(legacyRevoke < commit)

  const beforeHistoryCreate = change.slice(0, createHistory)
  const beforeTenantFeaturesCreate = change.slice(0, createTenantFeatures)
  assert.doesNotMatch(beforeHistoryCreate, /ALTER TABLE public\.workday_record_history|REVOKE ALL ON TABLE[^;]*workday_record_history|GRANT [^;]*ON TABLE public\.workday_record_history|CREATE INDEX[^;]*ON public\.workday_record_history|(?:INSERT INTO|SELECT [\s\S]*?FROM) public\.workday_record_history/i)
  assert.doesNotMatch(beforeTenantFeaturesCreate, /ALTER TABLE public\.tenant_features|REVOKE ALL ON TABLE[^;]*tenant_features|GRANT [^;]*ON TABLE public\.tenant_features|CREATE INDEX[^;]*ON public\.tenant_features|(?:INSERT INTO|SELECT [\s\S]*?FROM) public\.tenant_features/i)
})
