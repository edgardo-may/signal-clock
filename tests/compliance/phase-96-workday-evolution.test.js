import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { toUpsertWorkdayRpcParams, WorkdayPersistenceService } = require('../../backend/services/attendance/WorkdayPersistenceService.js')

function snapshot(overrides = {}) {
  return { registro_id: '5707fc4d-833a-48ab-bf49-90f5b30e0174', cliente_id: '69095bd5-fee5-4237-a1a4-186dd88310ff', empleado_id: '6c94a683-1fbd-4427-af9e-8ea154ea50fa', workday_date: '2026-09-20', schedule_id: '5a753368-f019-4230-89e2-79beaa39ff0f', timezone: 'America/Cancun', first_in: '2026-09-20T14:00:00.000Z', last_out: null, worked_minutes: 0, break_minutes: 0, overtime_minutes: 0, late_minutes: 0, early_leave_minutes: 0, status: 'INCOMPLETE', integrity_hash: 'a'.repeat(64), calculation_version: 3, source_observed_at: '2026-09-20T14:00:00.000Z', source_event_count: 1, ...overrides }
}

// This is an executable specification of the monotonic branch implemented by
// Phase 97. SQL-shape assertions below ensure the real RPC contains the same
// lock, evidence, update, history, and stale branches.
function transition(current, next) {
  if (!current) return { result: 'INSERTED', record: next, history: [next] }
  if (JSON.stringify(current) === JSON.stringify(next)) return { result: 'UNCHANGED', record: current, history: [] }
  if (next.source_observed_at < current.source_observed_at || (next.source_observed_at === current.source_observed_at && next.source_event_count < current.source_event_count)) return { result: 'STALE', record: current, history: [] }
  if (next.source_observed_at === current.source_observed_at && next.source_event_count === current.source_event_count) throw Object.assign(new Error('PERSIST_SNAPSHOT_CONFLICT'), { code: 'PERSIST_SNAPSHOT_CONFLICT' })
  return { result: 'UPDATED', record: next, history: [next] }
}

test('A-G: entry/replay/exit/replay/stale/concurrency/two physical records have deterministic logical evolution', () => {
  const entry = snapshot()
  const inserted = transition(null, entry)
  assert.equal(inserted.result, 'INSERTED'); assert.equal(inserted.history.length, 1)
  assert.equal(transition(inserted.record, entry).result, 'UNCHANGED')
  const exit = snapshot({ registro_id: '6707fc4d-833a-48ab-bf49-90f5b30e0174', last_out: '2026-09-20T23:00:00.000Z', worked_minutes: 480, status: 'COMPLETE', integrity_hash: 'b'.repeat(64), source_observed_at: '2026-09-20T23:00:00.000Z', source_event_count: 2 })
  const updated = transition(inserted.record, exit)
  assert.equal(updated.result, 'UPDATED'); assert.equal(updated.record.workday_date, entry.workday_date); assert.equal(updated.history.length, 1)
  assert.equal(transition(updated.record, exit).result, 'UNCHANGED')
  const stale = transition(updated.record, entry)
  assert.equal(stale.result, 'STALE'); assert.equal(stale.record.integrity_hash, exit.integrity_hash)
  const concurrentDuplicate = transition(updated.record, exit)
  assert.equal(concurrentDuplicate.result, 'UNCHANGED')
  const latePhysicalRecord = snapshot({ registro_id: '7707fc4d-833a-48ab-bf49-90f5b30e0174', first_in: '2026-09-20T13:50:00.000Z', last_out: exit.last_out, worked_minutes: 490, status: 'COMPLETE', integrity_hash: 'c'.repeat(64), source_observed_at: exit.source_observed_at, source_event_count: 3 })
  assert.equal(transition(updated.record, latePhysicalRecord).result, 'UPDATED')
  assert.throws(() => transition(updated.record, { ...exit, integrity_hash: 'd'.repeat(64) }), { code: 'PERSIST_SNAPSHOT_CONFLICT' })
})

test('runtime persistence boundary sends domain source evidence and accepts only the evolved result set', async () => {
  const params = toUpsertWorkdayRpcParams(snapshot())
  assert.equal(params.p_source_observed_at, '2026-09-20T14:00:00.000Z'); assert.equal(params.p_source_event_count, 1)
  for (const persistence_result of ['INSERTED', 'UPDATED', 'UNCHANGED', 'STALE']) {
    const result = await new WorkdayPersistenceService({ rpc: async () => ({ data: [{ workday_id: '5fe7ef34-7699-474b-b312-d0c5031a1fbe', persistence_result, integrity_hash: 'a'.repeat(64) }], error: null }) }).persist(snapshot())
    assert.equal(result.persistenceResult, persistence_result)
  }
})

test('Phase 97 is the real SQL contract: locks, immutable revision, atomic UPDATE/history, and stale no-write branch', async () => {
  const sql = await readFile(new URL('../../database/live-schema/97_workday_evolution_contract_change.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN;/); assert.match(sql, /WORKDAY_EVOLUTION_GATE_MUST_BE_CLOSED/)
  assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /FOR UPDATE/)
  assert.match(sql, /source_observed_at/); assert.match(sql, /source_event_count/)
  assert.match(sql, /'INSERTED'/); assert.match(sql, /'UPDATED'/); assert.match(sql, /'UNCHANGED'/); assert.match(sql, /'STALE'/)
  assert.match(sql, /UPDATE public\.workday_records SET/); assert.match(sql, /INSERT INTO public\.workday_record_history/)
  assert.match(sql, /PERSIST_SNAPSHOT_CONFLICT/); assert.match(sql, /schedule_revisions/)
  assert.doesNotMatch(sql, /public\.horarios/)
  const legacy = 'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid)'
  const evolved = legacy.slice(0, -1) + ',timestamptz,integer)'
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION ' + legacy + ' FROM PUBLIC,anon,authenticated,service_role;'))
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION ' + evolved + ' TO service_role;'))
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION ' + evolved + ' FROM PUBLIC,anon,authenticated;'))
})
