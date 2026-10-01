import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createRequire } from 'node:module'
import * as domain from '../../src/domain/attendance/index.ts'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate } from '../helpers/workdayEvolutionDbreal.js'
import { createRevisionReadRepository, revisionRpcAdapter, revisionRpc } from '../helpers/workdayRevisionDbreal.js'

const require = createRequire(import.meta.url)
const { AttendanceRuntimeService } = require('../../backend/attendance-runtime-v3/AttendanceRuntimeService.js')
const { AttendanceEngineOrchestrator } = require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')
const { WorkdayPersistenceService } = require('../../backend/services/attendance/WorkdayPersistenceService.js')
const { fingerprint } = require('../../backend/services/attendance/WorkdayRevisionManifests.js')
const { validateRuntimeResult } = require('../../backend/attendance-persist-dispatcher/dispatcher.js')
const { engineV4 } = require('../fixtures/calculation-engine-v4.cjs')
const url = process.env.PHASE2_AUDIT_DATABASE_URL

test('rollback capability R1–R12 and normal/rollback/normal continuity in local DBREAL', { skip: !url && 'Explicit local DBREAL URL required' }, async t => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname))
  assert.equal(new URL(url).port, '54322')
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  const tables = ['clientes', 'empleados', 'devices', 'horarios', 'schedule_revisions', 'empleados_horarios', 'tenant_features', 'registro_asistencia', 'attendance_logs', 'attendance_source_events', 'workday_records', 'workday_record_history', 'workday_calculation_revisions', 'workday_revision_promotions', 'attendance_persist_outbox', 'incidencias', 'rate_limits_logs']
  const counts = async () => {
    const result = {}
    for (const table of tables) result[table] = (await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n
    return result
  }
  const baseline = await counts()
  const incidentsBefore = (await db.query('SELECT to_jsonb(i) value FROM public.incidencias i ORDER BY id')).rows
  const step = async (name, fn) => {
    let failure
    await t.test(name, async child => { try { await fn(child) } catch (error) { failure = error; throw error } })
    if (failure) throw failure
  }
  const reject = async (fn, code) => {
    const before = await counts()
    await db.query('SAVEPOINT rejected')
    try { await assert.rejects(fn, error => error.code === code || error.message === code) }
    finally { await db.query('ROLLBACK TO SAVEPOINT rejected') }
    assert.deepEqual(await counts(), before)
  }
  // Transport only: actual authorization loaders, orchestrator, registry and
  // persistence service remain production implementations. JSON mirrors REST.
  const rpc = revisionRpcAdapter(db)
  const calls = []
  const client = {
    rpc: async (name, params) => { assert.equal(name, 'upsert_workday_record'); calls.push(params); return rpc.rpc(name, params) },
    from(table) {
      assert.ok(['registro_asistencia', 'tenant_features', 'attendance_source_events'].includes(table))
      const filters = []
      return { select() { return this }, eq(key, value) { assert.match(key, /^[a-z_]+$/); filters.push([key, value]); return this },
        async maybeSingle() {
          const rows = (await db.query(`SELECT to_jsonb(r) value FROM public.${table} r WHERE ${filters.map(([key], i) => `${key}=$${i + 1}`).join(' AND ')}`, filters.map(([, value]) => value))).rows
          assert.ok(rows.length <= 1)
          return { data: rows[0]?.value || null, error: null }
        },
      }
    },
  }
  const records = []
  const service = capability => new AttendanceRuntimeService({ client, runtimeCapability: capability, logger: {},
    orchestratorFactory: options => new AttendanceEngineOrchestrator({ ...options, repository: createRevisionReadRepository(db), domain, logger: { info(result) {} } }),
    persistenceServiceFactory: raw => {
      const writer = new WorkdayPersistenceService(raw)
      return { persist: record => { records.push(record); return writer.persist(record) } }
    },
  })
  const rollback = service('REVISION_AWARE_V3_ONLY'), active = service('ACTIVE_PERSIST_CAPABLE')
  const writer = new WorkdayPersistenceService(client)
  const current = async f => (await db.query('SELECT to_jsonb(w) value FROM public.workday_records w WHERE cliente_id=$1 AND empleado_id=$2', [f.tenantA.id, f.employee.id])).rows[0]?.value
  const revisionRows = async f => (await db.query('SELECT to_jsonb(r) value FROM public.workday_calculation_revisions r WHERE cliente_id=$1 ORDER BY id', [f.tenantA.id])).rows.map(r => r.value)
  const auditRows = async f => (await db.query('SELECT to_jsonb(r) value FROM public.workday_revision_promotions r WHERE cliente_id=$1 ORDER BY id', [f.tenantA.id])).rows.map(r => r.value)
  const add = async (f, time, type = 'salida') => {
    const source = await createCanonicalRegistro(db, f, { occurredAt: time })
    await db.query('UPDATE public.registro_asistencia SET tipo_verificacion=$2 WHERE id=$1', [source.id, type])
    return source
  }
  const enable = async f => {
    await enableFixturePersistGate(db, f.tenantA.id)
    await db.query("INSERT INTO public.tenant_features(cliente_id,feature_key,mode,enabled) VALUES($1,'REVISION_SCHEDULE_RESOLVER','ACTIVE',true)", [f.tenantA.id])
  }
  try {
    await db.query('BEGIN')
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)")
    const f = await createWorkdayEvolutionFixture(db)
    await enable(f)
    const first = await add(f, '2030-06-10T14:00:00.000Z', 'entrada')
    const readonly = await new AttendanceEngineOrchestrator({ repository: createRevisionReadRepository(db), domain, logger: {} }).run({ registroId: first.id })
    const legacyRecord = { ...readonly.workdayRecord, evidence_manifest: undefined, context_manifest: undefined }
    assert.equal((await writer.persist(legacyRecord)).persistenceResult, 'INSERTED')
    assert.equal((await current(f)).current_revision_id, null)
    let last, priorRecord, preservedRevisions, preservedAudits
    await step('R1 legacy v3 new evidence UPDATED through rollback runtime', async () => {
      last = await add(f, '2030-06-10T23:00:00.000Z')
      const result = await rollback.executePersist({ registroId: last.id })
      assert.equal(result.persistence_result, 'UPDATED')
      assert.equal(result.runtime_deployment_capability, 'REVISION_AWARE_V3_ONLY')
      validateRuntimeResult({ registro_id: last.id, cliente_id: f.tenantA.id, empleado_id: f.employee.id }, result)
      assert.ok((await current(f)).current_revision_id)
      priorRecord = records.at(-1)
      preservedRevisions = await revisionRows(f); preservedAudits = await auditRows(f)
    })
    await step('R2 versioned CURRENT v3 new evidence UPDATED with manifests', async () => {
      last = await add(f, '2030-06-10T23:05:00.000Z')
      assert.equal((await rollback.executePersist({ registroId: last.id })).persistence_result, 'UPDATED')
      assert.equal((await current(f)).calculation_version, 3)
      assert.ok(calls.at(-1).p_evidence_manifest); assert.ok(calls.at(-1).p_context_manifest)
    })
    await step('R3 exact replay UNCHANGED, no history/revision/audit append', async () => {
      const before = await counts(), projection = await current(f)
      assert.equal((await rollback.executePersist({ registroId: last.id })).persistence_result, 'UNCHANGED')
      assert.deepEqual(await counts(), before); assert.deepEqual(await current(f), projection)
    })
    await step('R4 earlier in-flight v3 calculation STALE without mutation', async () => {
      const before = await current(f), n = await counts()
      assert.equal((await writer.persist(priorRecord)).persistenceResult, 'STALE')
      assert.deepEqual(await current(f), before); assert.deepEqual(await counts(), n)
    })
    await step('R5 same evidence different snapshot PERSIST_SNAPSHOT_CONFLICT', async () => {
      await reject(() => writer.persist({ ...records.at(-1), worked_minutes: records.at(-1).worked_minutes + 1 }), 'PERSIST_SNAPSHOT_CONFLICT')
    })
    await step('R6 test-only CURRENT v4 fails closed in rollback runtime', async () => {
      await db.query('SAVEPOINT v4_fixture')
      try {
        const record = records.at(-1), projection = await current(f)
        const rows = (await db.query('SELECT to_jsonb(r) value FROM public.registro_asistencia r WHERE cliente_id=$1 ORDER BY verificado_at,id', [f.tenantA.id])).rows.map(r => r.value)
        const normalized = domain.AttendanceNormalizer.normalize(rows.map(r => ({ id: r.id, clienteId: r.cliente_id, empleadoId: r.empleado_id, timestamp: r.verificado_at, inOutState: r.tipo_verificacion })), 'America/Cancun', f.tenantA.id, f.employee.id)
        const match = domain.ShiftMatcher.match({ id: f.schedule.id, operativeDate: record.workday_date, startTime: '09:00', endTime: '18:00', toleranceMinutes: 10, hasBreak: false }, normalized.accepted, 'America/Cancun')
        const calculation = engineV4.calculate(domain, match, 'America/Cancun', { operativeDate: record.workday_date })
        const integrityHash = domain.WorkdayIntegrityHasher.computeHash({ clienteId: f.tenantA.id, empleadoId: f.employee.id, operativeDate: record.workday_date, timezone: 'America/Cancun', scheduleId: f.schedule.id, scheduledStart: match.scheduledStartUtc, scheduledEnd: match.scheduledEndUtc, ...calculation, status: 'COMPLETE', incidentCodes: [], warningCodes: [], calculationVersion: 4 })
        const snapshot = (await db.query('SELECT snapshot FROM public.workday_calculation_revisions WHERE id=$1', [projection.current_revision_id])).rows[0].snapshot
        const candidate = (await revisionRpc(db, 'create_workday_revision_candidate', { p_cliente_id: f.tenantA.id, p_empleado_id: f.employee.id, p_workday_date: record.workday_date, p_snapshot: { ...snapshot, calculation_version: 4, worked_minutes: calculation.workedMinutes, integrity_hash: integrityHash }, p_evidence_manifest: record.evidence_manifest, p_context_manifest: { ...record.context_manifest, calculation_version: 4 }, p_source_observed_at: record.source_observed_at, p_source_event_count: record.source_event_count }))[0]
        await revisionRpc(db, 'promote_workday_revision', { p_cliente_id: f.tenantA.id, p_empleado_id: f.employee.id, p_workday_date: record.workday_date, p_candidate_revision_id: candidate.revision_id, p_expected_current_revision_id: projection.current_revision_id, p_expected_evidence_fingerprint: fingerprint(record.evidence_manifest) })
        const before = await current(f), n = await counts(), callCount = calls.length
        await assert.rejects(() => rollback.executePersist({ registroId: last.id }), { code: 'CALCULATION_VERSION_UNAVAILABLE' })
        assert.equal(calls.length, callCount); assert.deepEqual(await counts(), n); assert.deepEqual(await current(f), before)
      } finally { await db.query('ROLLBACK TO SAVEPOINT v4_fixture') }
    })
    await step('R7 no unpromoted revision spontaneously created', async () => {
      const revisions = await revisionRows(f), audits = await auditRows(f)
      assert.ok(revisions.every(r => audits.some(a => a.promoted_revision_id === r.id)))
      assert.ok(calls.every(p => p.p_calculation_version === 3))
    })
    await step('R8 no explicit PROMOTION operation from ordinary persistence', async () => {
      assert.ok((await auditRows(f)).every(a => ['INITIAL', 'EVIDENCE_UPDATE'].includes(a.operation)))
    })
    await step('R9 current pointer remains coherent, never cleared', async () => {
      const projection = await current(f)
      assert.ok(projection.current_revision_id)
      assert.equal((await db.query('SELECT public.workday_revision_snapshot($1::jsonb)=snapshot consistent FROM public.workday_calculation_revisions WHERE id=$2', [projection, projection.current_revision_id])).rows[0].consistent, true)
    })
    await step('R10 preexisting revisions retained verbatim and immutable', async () => {
      const rows = await revisionRows(f)
      for (const old of preservedRevisions) assert.deepEqual(rows.find(r => r.id === old.id), old)
      await reject(() => db.query('UPDATE public.workday_calculation_revisions SET integrity_hash=$1 WHERE id=$2', ['bad', rows[0].id]), '55000')
    })
    await step('R11 preexisting audit retained verbatim and append-only', async () => {
      const rows = await auditRows(f)
      for (const old of preservedAudits) assert.deepEqual(rows.find(r => r.id === old.id), old)
      await reject(() => db.query('UPDATE public.workday_revision_promotions SET actor=$1 WHERE id=$2', ['bad', rows[0].id]), '55000')
    })
    await step('R12 cross-tenant ordinary writer rejected without mutation', async () => {
      await reject(() => writer.persist({ ...records.at(-1), cliente_id: f.tenantB.id }), 'PERSIST_SOURCE_EVENT_DENIED')
    })
    await step('schema114 normal → rollback → replay → normal, same identity and retained history', async () => {
      const s = await createWorkdayEvolutionFixture(db)
      await enable(s)
      const a = await add(s, '2030-06-10T14:00:00.000Z', 'entrada')
      assert.equal((await active.executePersist({ registroId: a.id })).persistence_result, 'INSERTED')
      const initial = await current(s), originalRevisions = await revisionRows(s), originalAudits = await auditRows(s)
      const b = await add(s, '2030-06-10T23:00:00.000Z')
      assert.equal((await rollback.executePersist({ registroId: b.id })).persistence_result, 'UPDATED')
      const updated = await current(s)
      assert.equal(updated.id, initial.id); assert.ok(updated.current_revision_id)
      assert.notEqual(updated.current_revision_id, initial.current_revision_id)
      assert.equal((await rollback.executePersist({ registroId: b.id })).persistence_result, 'UNCHANGED')
      const c = await add(s, '2030-06-10T23:10:00.000Z')
      assert.equal((await active.executePersist({ registroId: c.id })).persistence_result, 'UPDATED')
      assert.equal((await current(s)).id, initial.id); assert.equal((await current(s)).calculation_version, 3)
      assert.equal((await db.query('SELECT count(*)::int n FROM public.workday_record_history WHERE workday_record_id=$1', [initial.id])).rows[0].n, 3)
      for (const old of originalRevisions) assert.deepEqual((await revisionRows(s)).find(r => r.id === old.id), old)
      for (const old of originalAudits) assert.deepEqual((await auditRows(s)).find(r => r.id === old.id), old)
    })
    await step('Phase A regression from real database evidence', async child => {
      const phaseAFixture = await createWorkdayEvolutionFixture(db)
      const cases = [
        ['O1', ['09:00', '10:00', '18:00'], ['entrada', 'entrada', 'salida'], '09:00', '18:00', 540],
        ['O2', ['09:00', '12:00', '18:00'], ['entrada', 'salida', 'salida'], '09:00', '18:00', 180],
        ['O2B', ['09:00', '10:00', '18:00'], ['salida', 'entrada', 'salida'], '09:00', '18:00', 480],
        ['O3 overnight', ['22:10', '01:00', '02:00', '05:30'], ['entrada', 'salida', 'entrada', 'salida'], '22:00', '06:00', 380],
        ['multi-pair', ['09:00', '12:00', '13:00', '18:00'], ['entrada', 'salida', 'entrada', 'salida'], '09:00', '18:00', 480],
        ['open final cycle', ['09:00', '12:00', '13:00'], ['entrada', 'salida', 'entrada'], '09:00', '18:00', 180],
        ['UNKNOWN excluded', ['09:00', '12:00', '13:00', '18:00'], ['entrada', 'inicio_extra', 'entrada', 'salida'], '09:00', '18:00', 540],
        ['UNKNOWN cannot close ENTRY', ['09:00', '12:00'], ['entrada', 'inicio_extra'], '09:00', '18:00', 0],
      ]
      for (const [name, times, kinds, startTime, endTime, expected] of cases) {
        let failure
        await child.test(name, async () => {
          await db.query('SAVEPOINT phase_a')
          try {
            const ids = []
            for (let i = 0; i < times.length; i++) {
              const date = startTime === '22:00' && times[i] < startTime ? '2030-06-11' : '2030-06-10'
              const source = await add(phaseAFixture, domain.localToUtcIso(date, times[i] + ':00', 'America/Cancun'), kinds[i])
              ids.push(source.id)
            }
            const rows = (await db.query('SELECT to_jsonb(r) value FROM public.registro_asistencia r WHERE id=ANY($1::uuid[]) ORDER BY verificado_at,id', [ids])).rows.map(r => r.value)
            const device = (await db.query('SELECT to_jsonb(d) value FROM public.devices d WHERE id=$1', [phaseAFixture.deviceA.id])).rows[0].value
            const raw = rows.map(r => domain.RegistroAttendanceAdapter.fromRegistro(r, device).rawPunch)
            const normalized = domain.AttendanceNormalizer.normalize(raw, 'America/Cancun', phaseAFixture.tenantA.id, phaseAFixture.employee.id)
            const match = domain.ShiftMatcher.match({ operativeDate: '2030-06-10', startTime, endTime, toleranceMinutes: 10 }, normalized.accepted, 'America/Cancun')
            const metrics = domain.WorkdayCalculator.calculate(match, 'America/Cancun')
            assert.equal(metrics.workedMinutes, expected)
            if (name === 'open final cycle' || name === 'UNKNOWN cannot close ENTRY') assert.equal(metrics.missingExit, true)
          } catch (error) { failure = error; throw error }
          finally { await db.query('ROLLBACK TO SAVEPOINT phase_a') }
        })
        if (failure) throw failure
      }
    })
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
  } finally {
    try {
      await db.query('ROLLBACK')
      assert.deepEqual(await counts(), baseline)
      assert.deepEqual((await db.query('SELECT to_jsonb(i) value FROM public.incidencias i ORDER BY id')).rows, incidentsBefore)
      console.log('DBREAL_CLEAN=YES INCIDENT_BASELINE_RESTORED=YES')
    } finally { await db.end() }
  }
})
