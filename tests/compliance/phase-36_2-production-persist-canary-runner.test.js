import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const runner = require('../../backend/scripts/run-production-persist-canary.js')
const design = require('../../backend/scripts/persist-canary-design.js')

const {
  APPROVED_HOST,
  PersistCanaryRunnerError,
  readPersistCanaryRunnerConfig,
  parseCommand,
  assertApprovedContractEvidence,
  assertCanonicalRecord,
  assertCanonicalCalculation,
  planCanaryWrite,
  assertPostWriteObservation,
  unwrapEvidence,
  loadApprovedContractEvidence,
  validateLocalManifest,
  REGISTRO_ASISTENCIA_READ_COLUMNS,
  loadCandidateRegistroForDiagnostic,
  validateProductionReads,
  sanitizeSupabaseError,
} = runner
const { APPROVED, CANONICAL_ORACLE_V3 } = design

function environment(overrides = {}) {
  return {
    SUPABASE_URL: `https://${APPROVED_HOST}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-presence',
    PERSIST_CANARY_ALLOWED_HOST: APPROVED_HOST,
    PERSIST_CANARY_ENVIRONMENT: 'PRODUCTION_PERSIST_CANARY',
    PERSIST_CANARY_CONFIRMATION: 'I_APPROVE_ONE_CANONICAL_WORKDAY_PERSIST_CANARY',
    PERSIST_CANARY_REGISTRO_ID: APPROVED.registroId,
    PERSIST_CANARY_CLIENTE_ID: APPROVED.clienteId,
    PERSIST_CANARY_EMPLEADO_ID: APPROVED.empleadoId,
    PERSIST_CANARY_SCHEDULE_ID: APPROVED.scheduleId,
    PERSIST_CANARY_OPERATIVE_DATE: APPROVED.operativeDate,
    PERSIST_CANARY_CALCULATION_VERSION: '3',
    PERSIST_CANARY_APPROVED_RPC_FINGERPRINT: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    PERSIST_CANARY_PRECHECK_MANIFEST: 'local/phase-36_2-precheck.json',
    ...overrides,
  }
}

function record(overrides = {}) {
  return {
    registro_id: APPROVED.registroId,
    cliente_id: APPROVED.clienteId,
    empleado_id: APPROVED.empleadoId,
    workday_date: APPROVED.operativeDate,
    schedule_id: APPROVED.scheduleId,
    timezone: APPROVED.timezone,
    first_in: CANONICAL_ORACLE_V3.firstIn,
    last_out: CANONICAL_ORACLE_V3.lastOut,
    worked_minutes: CANONICAL_ORACLE_V3.workedMinutes,
    break_minutes: CANONICAL_ORACLE_V3.breakMinutes,
    overtime_minutes: CANONICAL_ORACLE_V3.overtimeMinutes,
    late_minutes: CANONICAL_ORACLE_V3.lateMinutes,
    early_leave_minutes: CANONICAL_ORACLE_V3.earlyLeaveMinutes,
    status: CANONICAL_ORACLE_V3.workdayState,
    integrity_hash: 'b'.repeat(64),
    calculation_version: 3,
    ...overrides,
  }
}

function authorization(overrides = {}) {
  return {
    cliente_id: APPROVED.clienteId,
    feature_key: 'WORKDAY_PERSIST_CANARY',
    mode: 'PERSIST_CANARY',
    enabled: true,
    canary_registro_id: APPROVED.registroId,
    canary_empleado_id: APPROVED.empleadoId,
    canary_schedule_id: APPROVED.scheduleId,
    canary_workday_date: APPROVED.operativeDate,
    ...overrides,
  }
}

function evidence(overrides = {}) {
  return {
    phase: '36_2_persist_canary_runner_precheck',
    read_only: 'on',
    identity: { ...APPROVED },
    precheck_pass: true,
    candidate_exact: true,
    rpc_v3_available: true,
    rpc_fingerprint: 'a'.repeat(32),
    incident_write_path: false,
    target_workday_rows: 0,
    target_history_rows: 0,
    exact_authorization_rows: 1,
    all_authorization_rows: 1,
    ...overrides,
  }
}

function snapshot(overrides = {}) {
  const exact = authorization()
  return {
    identity: { ...APPROVED },
    authorizationRows: [exact],
    allAuthorizationRows: [exact],
    workdayRows: [],
    historyRows: [],
    ...overrides,
  }
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof PersistCanaryRunnerError && error.code === code)
}

test('1. missing runner guard fails closed', () => expectCode(
  () => readPersistCanaryRunnerConfig(environment({ SUPABASE_SERVICE_ROLE_KEY: '' })), 'PERSIST_CANARY_ENV_MISSING'
))
test('2. bad production host fails closed', () => expectCode(
  () => readPersistCanaryRunnerConfig(environment({ PERSIST_CANARY_ALLOWED_HOST: 'wrong.example' })), 'PERSIST_CANARY_DESTINATION_DENIED'
))
test('3. bad environment fails closed', () => expectCode(
  () => readPersistCanaryRunnerConfig(environment({ PERSIST_CANARY_ENVIRONMENT: 'PRODUCTION_SHADOW' })), 'PERSIST_CANARY_ENVIRONMENT_DENIED'
))
test('4. bad confirmation fails closed', () => expectCode(
  () => readPersistCanaryRunnerConfig(environment({ PERSIST_CANARY_CONFIRMATION: 'NO' })), 'PERSIST_CANARY_CONFIRMATION_DENIED'
))

for (const [number, key] of [
  [5, 'PERSIST_CANARY_REGISTRO_ID'], [6, 'PERSIST_CANARY_CLIENTE_ID'], [7, 'PERSIST_CANARY_EMPLEADO_ID'],
  [8, 'PERSIST_CANARY_SCHEDULE_ID'], [9, 'PERSIST_CANARY_OPERATIVE_DATE'], [10, 'PERSIST_CANARY_CALCULATION_VERSION'],
]) {
  test(`${number}. ${key} mismatch fails closed`, () => expectCode(
    () => readPersistCanaryRunnerConfig(environment({ [key]: key === 'PERSIST_CANARY_CALCULATION_VERSION' ? '2' : 'mismatch' })),
    'PERSIST_CANARY_IDENTITY_DENIED'
  ))
}

test('11. missing tenant authorization fails closed', () => expectCode(
  () => planCanaryWrite(snapshot({ authorizationRows: [], allAuthorizationRows: [] }), record(), evidence()), 'PERSIST_CANARY_TENANT_FEATURE_BLOCKED'
))
test('12. wrong tenant authorization fails closed', () => expectCode(
  () => planCanaryWrite(snapshot({ authorizationRows: [authorization({ canary_schedule_id: 'wrong' })] }), record(), evidence()), 'PERSIST_CANARY_TENANT_FEATURE_BLOCKED'
))
test('13. pre-existing different workday fails closed', () => expectCode(
  () => planCanaryWrite(snapshot({ workdayRows: [record({ worked_minutes: 1 })], historyRows: [{ ...record(), workday_record_id: 'w-1', action: 'INSERTED' }] }), record(), evidence()), 'PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT'
))
test('14. first authorized execution plans exactly one INSERTED', () => {
  assert.deepEqual(planCanaryWrite(snapshot(), record(), evidence()), {
    expectedPersistenceResult: 'INSERTED', maxLogicalWorkdaysAffected: 1, incidentWriteCalls: 0,
  })
})
test('15. exact replay plans UNCHANGED', () => {
  const workday = record({ id: 'w-1' })
  const history = { ...record(), workday_record_id: 'w-1', action: 'INSERTED' }
  assert.equal(planCanaryWrite(snapshot({ workdayRows: [workday], historyRows: [history] }), record(), evidence()).expectedPersistenceResult, 'UNCHANGED')
})
test('16. post-write requires no duplicate history', () => {
  const after = snapshot({
    workdayRows: [record({ id: 'w-1' })],
    historyRows: [{ ...record(), workday_record_id: 'w-1', action: 'INSERTED' }],
  })
  assert.equal(assertPostWriteObservation({ expectedPersistenceResult: 'INSERTED' }, record(), {
    workdayId: 'w-1', persistenceResult: 'INSERTED', integrityHash: record().integrity_hash,
  }, after), true)
  expectCode(() => assertPostWriteObservation({ expectedPersistenceResult: 'INSERTED' }, record(), {
    workdayId: 'w-1', persistenceResult: 'INSERTED', integrityHash: record().integrity_hash,
  }, { ...after, historyRows: [...after.historyRows, after.historyRows[0]] }), 'PERSIST_CANARY_POSTWRITE_DENIED')
})
test('17. UPDATED and changed snapshots are rejected', () => {
  expectCode(() => assertPostWriteObservation({ expectedPersistenceResult: 'INSERTED' }, record(), {
    workdayId: 'w-1', persistenceResult: 'UPDATED', integrityHash: record().integrity_hash,
  }, snapshot()), 'PERSIST_CANARY_RPC_RESULT_DENIED')
})
test('18. plan exposes zero incident writes and canonical 14 supplemental events are mandatory', () => {
  assert.equal(planCanaryWrite(snapshot(), record(), evidence()).incidentWriteCalls, 0)
  expectCode(() => assertCanonicalCalculation({ workdayRecord: record(), calculation: { supplementalEvents: [] } }), 'PERSIST_CANARY_CANONICAL_DENIED')
})
test('19. runner has no legacy RPC fallback', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-persist-canary.js', import.meta.url), 'utf8')
  assert.match(source, /V3_SIGNATURE/)
  assert.doesNotMatch(source, /upsert_workday_record\(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text\)'/)
  assert.doesNotMatch(source, /upsert_workday_record_legacy|p_calculation_version:\s*[12]|\.rpc\(['"]upsert_workday_record_legacy/i)
})
test('20. SHADOW runners cannot reach --persist-canary or the persistence service', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /--persist-canary|WorkdayPersistenceService\.js|upsert_workday_record|\.rpc\(/)
})
test('21. post-write validation detects wrong canonical metrics', () => expectCode(
  () => assertCanonicalRecord(record({ late_minutes: 325 })), 'PERSIST_CANARY_CANONICAL_DENIED'
))
test('22. more than one history snapshot fails closed', () => expectCode(
  () => planCanaryWrite(snapshot({ historyRows: [{}, {}] }), record(), evidence()), 'PERSIST_CANARY_IDENTITY_CONFLICT'
))
test('23. extra logical identity writes fail closed', () => expectCode(
  () => planCanaryWrite(snapshot({ workdayRows: [record(), record({ id: 'w-2' })] }), record(), evidence()), 'PERSIST_CANARY_IDENTITY_CONFLICT'
))
test('24. runner accepts only one explicit --persist-canary command', () => {
  assert.equal(parseCommand(['--persist-canary']), 'PERSIST_CANARY')
  assert.equal(parseCommand(['--validate-manifest']), 'PERSIST_CANARY_MANIFEST_VALIDATION')
  expectCode(() => parseCommand(['--engine-shadow']), 'PERSIST_CANARY_USAGE_DENIED')
  expectCode(() => parseCommand(['--persist-canary', '--registro-id', APPROVED.registroId]), 'PERSIST_CANARY_USAGE_DENIED')
})
test('25. contract evidence requires the exact V3 fingerprint and zero incident path', () => {
  assert.equal(assertApprovedContractEvidence(evidence(), 'a'.repeat(32)).rpc_v3_available, true)
  expectCode(() => assertApprovedContractEvidence(evidence({ rpc_fingerprint: 'b'.repeat(32) }), 'a'.repeat(32)), 'PERSIST_CANARY_RPC_FINGERPRINT_BLOCKED')
})
test('26. authorization SQL is a separate precheck/change/postcheck transaction sequence', async () => {
  const [precheck, change, postcheck] = await Promise.all([
    readFile(new URL('../../database/live-schema/40_persist_canary_authorization_precheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/41_persist_canary_authorization_change.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/42_persist_canary_authorization_postcheck.sql', import.meta.url), 'utf8'),
  ])
  assert.match(precheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(precheck, /authorization_conflict_exists/)
  assert.match(change, /BEGIN;/)
  assert.match(change, /LOCK TABLE public\.tenant_features/)
  assert.match(change, /INSERT INTO public\.tenant_features/)
  assert.match(change, /COMMIT;/)
  assert.match(postcheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(postcheck, /exact_authorization_rows = 1/)
  assert.match(postcheck, /no_extra_scope/)
})
test('27. runner precheck, fresh baseline, and postcheck remain read-only templates until manual execution', async () => {
  const [precheck, baseline, postcheck] = await Promise.all([
    readFile(new URL('../../database/live-schema/43_persist_canary_runner_precheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/44_persist_canary_global_baseline.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/45_persist_canary_postcheck.sql', import.meta.url), 'utf8'),
  ])
  for (const sql of [precheck, baseline, postcheck]) {
    assert.match(sql, /BEGIN TRANSACTION READ ONLY;/)
    assert.match(sql, /ROLLBACK;/)
    assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|SELECT\s+public\.upsert_workday_record/i)
  }
  assert.match(precheck, /rpc_v3_available/)
  assert.match(precheck, /target_history_rows/)
  assert.match(baseline, /workday_record_history/)
  assert.match(postcheck, /PERSIST_CANARY_RUNNER_RESULT_JSON/)
  assert.match(postcheck, /incidencias_delta = 0/)
})
test('28. local Phase 45 renderer embeds only validated baseline and runner evidence', async () => {
  const renderer = require('../../backend/scripts/render-persist-canary-postcheck.js')
  const template = await readFile(new URL('../../database/live-schema/45_persist_canary_postcheck.sql', import.meta.url), 'utf8')
  const baseline = {
    phase: '36_2_persist_canary_global_baseline', read_only: 'on',
    candidate_registro_id: APPROVED.registroId, baseline_id: 'c'.repeat(32),
    counts: Object.fromEntries(renderer.COUNT_KEYS.map((key) => [key, 0])),
  }
  const result = {
    mode: 'PERSIST_CANARY', persistenceResult: 'INSERTED', identity: { ...APPROVED }, integrityHash: 'd'.repeat(64),
  }
  const rendered = renderer.renderPostcheckSql(template, baseline, result)
  assert.equal(rendered.includes(renderer.BASELINE_MARKER), false)
  assert.equal(rendered.includes(renderer.RUNNER_MARKER), false)
  assert.match(rendered, /"integrityHash":"d{64}"/)
  assert.throws(() => renderer.validateRunnerResult({ ...result, persistenceResult: 'UPDATED' }),
    (error) => error.code === 'PERSIST_CANARY_RUNNER_RESULT_INVALID')
})
test('29. Phase 44 baseline has parseable SQL tokens, exact counts, and no DML', async () => {
  const baseline = await readFile(new URL('../../database/live-schema/44_persist_canary_global_baseline.sql', import.meta.url), 'utf8')
  const expectedTables = [
    'workday_records', 'workday_record_history', 'tenant_features', 'incidencias', 'registro_asistencia',
    'empleados', 'horarios', 'empleados_horarios', 'devices', 'attendance_source_events',
  ]

  assert.match(baseline, /\bBEGIN TRANSACTION READ ONLY;/)
  assert.match(baseline, /ROLLBACK;\s*$/)
  assert.match(baseline, /SELECT jsonb_build_object\(/)
  assert.match(baseline, /current_setting\('transaction_read_only'\)/)
  assert.match(baseline, /'candidate_registro_id', '7f99cef9-4100-48ff-9aaf-68548c80c948'/)
  for (const table of expectedTables) {
    assert.match(baseline, new RegExp(`'${table}',\\s*\\(SELECT count\\(\\*\\) FROM public\\.${table}\\)`))
  }
  assert.doesNotMatch(baseline, /\b(?:cou\s+nt|co\s+unt|sel\s+ect|se\s+lect|fr\s+om|f\s+rom|pub\s+lic|jsonb\s+build_object|to_reg\s+class|current\s+setting|transaction_read\s+only)\b/i)
  assert.doesNotMatch(baseline, /\b(?:INSERT|UPDATE|DELETE|UPSERT|MERGE|CALL)\b|SELECT\s+public\.upsert_workday_record/i)
})

async function expectAsyncCode(operation, code) {
  await assert.rejects(operation, (error) => error.code === code)
}

test('30. runner unwrapEvidence accepts only wrapper and direct evidence, not Supabase arrays', () => {
  const direct = evidence()
  const wrapper = { persist_canary_runner_precheck: direct }
  const supabaseArray = [wrapper]
  assert.equal(unwrapEvidence(direct), direct)
  assert.equal(unwrapEvidence(wrapper), direct)
  assert.equal(unwrapEvidence(supabaseArray), supabaseArray)
  assert.equal(assertApprovedContractEvidence(wrapper, 'a'.repeat(32)).phase, direct.phase)
  assert.equal(assertApprovedContractEvidence(direct, 'a'.repeat(32)).phase, direct.phase)
  expectCode(() => assertApprovedContractEvidence(supabaseArray, 'a'.repeat(32)), 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED')
})

test('31. local normalizer accepts Supabase array, wrapper, and direct input and emits direct canonical evidence', () => {
  const normalizer = require('../../backend/scripts/render-persist-canary-precheck-manifest.js')
  const direct = evidence()
  for (const input of [[{ persist_canary_runner_precheck: direct }], { persist_canary_runner_precheck: direct }, direct]) {
    const normalized = normalizer.normalizePhase43Payload(input, 'a'.repeat(32))
    assert.deepEqual(normalized, direct)
    assert.equal(Object.hasOwn(normalized, 'persist_canary_runner_precheck'), false)
  }
})

test('32. JSON encoding behavior is explicit: LF, CRLF, and trailing newline parse; UTF-8 BOM fails closed', async () => {
  const normalizer = require('../../backend/scripts/render-persist-canary-precheck-manifest.js')
  const directory = await mkdtemp(path.join(tmpdir(), 'signum-phase43-'))
  const input = path.join(directory, 'phase43-crlf.json')
  const output = path.join(directory, 'canonical.json')
  try {
    const source = JSON.stringify([{ persist_canary_runner_precheck: evidence() }], null, 2).replace(/\n/g, '\r\n') + '\r\n'
    await writeFile(input, source, 'utf8')
    await normalizer.renderManifest(input, output, 'a'.repeat(32))
    const canonicalText = readFileSync(output, 'utf8')
    assert.doesNotThrow(() => JSON.parse(canonicalText))
    assert.equal(canonicalText.charCodeAt(0), 0x7B)
    assert.equal(canonicalText.endsWith('\n'), true)
    assert.doesNotMatch(canonicalText, /^\uFEFF/)
    assert.doesNotThrow(() => JSON.parse('{"valid":true}\n'))
    assert.doesNotThrow(() => JSON.parse('{"valid":true}\r\n'))
    assert.throws(() => JSON.parse('\uFEFF{"valid":true}'))
    const bom = path.join(directory, 'phase43-bom.json')
    await writeFile(bom, `\uFEFF${source}`, 'utf8')
    await expectAsyncCode(() => normalizer.renderManifest(bom, path.join(directory, 'bom-output.json'), 'a'.repeat(32)), 'PERSIST_CANARY_MANIFEST_JSON_INVALID')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('33. normalizer fails closed for malformed or unsafe Phase 43 evidence', async () => {
  const normalizer = require('../../backend/scripts/render-persist-canary-precheck-manifest.js')
  const invalidCases = [
    { phase: 'wrong' },
    evidence({ read_only: 'off' }), evidence({ precheck_pass: false }), evidence({ candidate_exact: false }),
    evidence({ rpc_fingerprint: 'b'.repeat(32) }), evidence({ rpc_v3_available: false }), evidence({ incident_write_path: true }),
    evidence({ target_workday_rows: 1 }), evidence({ target_history_rows: 1 }),
    evidence({ exact_authorization_rows: 0 }), evidence({ all_authorization_rows: 2 }),
  ]
  for (const invalid of invalidCases) {
    assert.throws(() => normalizer.normalizePhase43Payload(invalid, 'a'.repeat(32)))
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'signum-phase43-invalid-'))
  try {
    const malformed = path.join(directory, 'malformed.json')
    await writeFile(malformed, '{not json', 'utf8')
    await expectAsyncCode(() => normalizer.renderManifest(malformed, path.join(directory, 'output.json'), 'a'.repeat(32)), 'PERSIST_CANARY_MANIFEST_JSON_INVALID')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('34. local dry validation uses the runner validator and never creates a client, RPC, or database write', async () => {
  const result = await validateLocalManifest(environment(), {
    readFile: async () => JSON.stringify(evidence()),
    createClient: () => { throw new Error('must never be called') },
  })
  assert.equal(result.mode, 'PERSIST_CANARY_MANIFEST_VALIDATION')
  assert.equal(result.writerReachable, false)
  assert.equal(result.supabaseClientCreated, false)
  assert.equal(result.rpcCalls, 0)
  assert.equal(result.databaseWrites, 0)
})

test('35. normalized on-disk manifest passes JSON.parse and the exact runner loader', async () => {
  const normalizer = require('../../backend/scripts/render-persist-canary-precheck-manifest.js')
  const directory = await mkdtemp(path.join(tmpdir(), 'signum-phase43-loader-'))
  const input = path.join(directory, 'phase43.json')
  const output = path.join(directory, 'manifest.json')
  try {
    await writeFile(input, JSON.stringify([{ persist_canary_runner_precheck: evidence() }]), 'utf8')
    await normalizer.renderManifest(input, output, 'a'.repeat(32))
    const parsed = JSON.parse(readFileSync(output, 'utf8'))
    const loaded = await loadApprovedContractEvidence(output, 'a'.repeat(32))
    assert.deepEqual(loaded, parsed)
    assert.equal(loaded.rpc_fingerprint, 'a'.repeat(32))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('36. Phase 43 normalizer and shared contract have no Supabase, RPC, or persistence dependency', async () => {
  const [normalizer, contract] = await Promise.all([
    readFile(new URL('../../backend/scripts/render-persist-canary-precheck-manifest.js', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/scripts/persist-canary-manifest-contract.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(normalizer + contract, /@supabase|createClient|WorkdayPersistenceService|\.rpc\(|AttendanceEngineOrchestrator/i)
})

test('37. runner loader distinguishes missing files from strict UTF-8 JSON parse failures', async () => {
  await expectAsyncCode(
    () => loadApprovedContractEvidence('missing-local-phase43.json', 'a'.repeat(32), { readFile: async () => { throw new Error('ENOENT') } }),
    'PERSIST_CANARY_MANIFEST_READ_FAILED'
  )
  await expectAsyncCode(
    () => loadApprovedContractEvidence('bom-local-phase43.json', 'a'.repeat(32), { readFile: async () => '\uFEFF{}' }),
    'PERSIST_CANARY_MANIFEST_JSON_INVALID'
  )
})

function candidateRow(overrides = {}) {
  return {
    id: APPROVED.registroId,
    cliente_id: APPROVED.clienteId,
    empleado_id: APPROVED.empleadoId,
    dispositivo_id: 'f693aea8-9f80-4e81-a99c-91b39e6d66d9',
    verificado_at: '2026-09-03T16:26:04.000Z',
    tipo_verificacion: 'entrada', metodo: 'face', raw_payload: {}, es_manual: false,
    ...overrides,
  }
}

function candidateClient(candidateResponse, tableRows = {}) {
  const calls = []
  return {
    calls,
    rpc() { throw new Error('RPC must not be called') },
    from(table) {
      calls.push(['from', table])
      const builder = {
        select(columns) { calls.push(['select', table, columns]); return this },
        eq(column, value) { calls.push(['eq', table, column, value]); return this },
        gte(column, value) { calls.push(['gte', table, column, value]); return this },
        lte(column, value) { calls.push(['lte', table, column, value]); return this },
        order(column) { calls.push(['order', table, column]); return this },
        maybeSingle: async () => candidateResponse,
        then(resolve, reject) { return Promise.resolve({ data: tableRows[table] || [], error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

test('38. candidate read uses the production-compatible projection and exact id with maybeSingle', async () => {
  const client = candidateClient({ data: candidateRow(), error: null })
  const result = await loadCandidateRegistroForDiagnostic(client)
  assert.equal(result.id, APPROVED.registroId)
  assert.equal(result.cliente_id, APPROVED.clienteId)
  assert.equal(result.empleado_id, APPROVED.empleadoId)
  assert.equal(result.source_event_id, null)
  assert.match(REGISTRO_ASISTENCIA_READ_COLUMNS, /raw_payload/)
  assert.doesNotMatch(REGISTRO_ASISTENCIA_READ_COLUMNS, /source_event_id/)
  assert.equal(client.calls.some((call) => call[0] === 'select' && call[2] === REGISTRO_ASISTENCIA_READ_COLUMNS), true)
  assert.equal(client.calls.some((call) => call[0] === 'eq' && call[2] === 'id' && call[3] === APPROVED.registroId), true)
})

test('39. missing, malformed, column, and permission candidate responses fail closed with safe diagnostics', async () => {
  await expectAsyncCode(
    () => loadCandidateRegistroForDiagnostic(candidateClient({ data: null, error: null })),
    'PERSIST_CANARY_REGISTRO_NOT_FOUND'
  )
  await expectAsyncCode(
    () => loadCandidateRegistroForDiagnostic(candidateClient(null)),
    'PERSIST_CANARY_READ_DIAGNOSTIC_FAILED'
  )
  for (const postgrestError of [
    { code: '42703', message: 'column registro_asistencia.source_event_id does not exist', details: null, hint: 'Check schema cache' },
    { code: '42501', message: 'permission denied for table registro_asistencia', details: 'RLS policy denied', hint: null },
  ]) {
    await assert.rejects(
      () => loadCandidateRegistroForDiagnostic(candidateClient({ data: null, error: postgrestError })),
      (error) => {
        assert.equal(error.code, 'PERSIST_CANARY_READ_DIAGNOSTIC_FAILED')
        assert.deepEqual(error.diagnostic, { table: 'registro_asistencia', ...postgrestError })
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /service_role|authorization|bearer|jwt/i)
        return true
      }
    )
  }
})

test('40. read-only production validation reuses candidate and snapshot reads without RPC or writer access', async () => {
  const auth = authorization()
  const baseClient = candidateClient({ data: candidateRow(), error: null }, {
    tenant_features: [auth], workday_records: [], workday_record_history: [],
  })
  const result = await validateProductionReads(environment(), {
    readFile: async () => JSON.stringify(evidence()),
    createClient: () => baseClient,
    createEngine: () => ({ run: async () => ({ workdayRecord: record() }) }),
  })
  assert.equal(result.mode, 'PERSIST_CANARY_PRODUCTION_READ_VALIDATION')
  assert.deepEqual(result.registro, { id: APPROVED.registroId, clienteId: APPROVED.clienteId, empleadoId: APPROVED.empleadoId })
  assert.deepEqual(result.prewriteSnapshot, { workdayRows: 0, historyRows: 0 })
  assert.equal(result.writerReachable, false)
  assert.equal(result.rpcWrites, 0)
  assert.equal(result.databaseWrites, 0)
  assert.equal(baseClient.calls.some((call) => call[0] === 'from' && call[1] === 'workday_records'), true)
  assert.equal(baseClient.calls.some((call) => call[0] === 'from' && call[1] === 'workday_record_history'), true)
})

test('41. sanitizer allows only safe PostgREST fields', () => {
  assert.deepEqual(sanitizeSupabaseError('registro_asistencia', {
    code: '42703', message: 'missing column', details: 'detail', hint: 'hint',
    authorization: 'Bearer forbidden', service_role_key: 'forbidden',
  }), {
    table: 'registro_asistencia', code: '42703', message: 'missing column', details: 'detail', hint: 'hint',
  })
})
