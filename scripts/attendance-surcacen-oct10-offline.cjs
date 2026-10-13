// Offline calculation only. Transcribed repository rows from the user's
// SELECT export checked_at 2026-10-11 01:36:51.521976+00. No DB/network client.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = 'C:/Users/Edgar/signal-clock-scoped-clean';
const sha = '39da4ef4885d0d8637ebf1c7c032e4984f2afa04';
const git = args => execFileSync('git', ['-c', `safe.directory=${root}`, '-C', root, ...args], { encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), sha);
assert.equal(git(['status', '--porcelain']), '', 'Deployed checkout must remain clean');
const tenant = '3a4b9110-74c6-47f8-bd06-6b099834cf7f';
const employee = '577c199c-b787-4f06-b7c7-685e84f8e0ad';
const device = { id: '9c29c4d5-53d3-4081-94f6-db3f5c5e80c4', cliente_id: tenant, timezone: 'America/Cancun' };
const events = [
  { id: 'f0a9239e-8bc0-4197-8c22-32bc6cdb78f7', verificado_at: '2026-10-11T01:00:36+00:00', tipo_verificacion: 'entrada', source_event_id: '46a68412-a946-42bb-9c68-837c27743f82' },
  { id: '7c4fd4f1-5c04-4dcc-badd-8ec65ef5ec6d', verificado_at: '2026-10-11T01:31:53+00:00', tipo_verificacion: 'salida', source_event_id: 'bd5304f0-4260-4b66-a6b3-db77bb3f9e2e' },
].map(row => ({ ...row, cliente_id: tenant, empleado_id: employee, dispositivo_id: device.id, metodo: 'huella', es_manual: false }));
const assignments = [
  { id: '69738d6e-2f34-494f-b322-7821cce39d93', horario_id: '583b4ea2-a5b5-46f5-bcc0-b56858accfb3', schedule_revision_id: '01d13d8d-73c0-42b0-ad26-d1689e70441e', fecha_inicio: '2026-10-09', fecha_fin: '2026-10-09' },
  { id: '85b669cd-e95f-4f38-8ca2-d10fcad81b20', horario_id: '916e6f42-4e0a-446f-8544-715434c306b9', schedule_revision_id: 'fae2ab33-61fa-419b-91c3-1dfb573c6142', fecha_inicio: '2026-10-10', fecha_fin: null },
].map(row => ({ ...row, cliente_id: tenant, empleado_id: employee, activo: true }));
// Compact representation of the two complete exported snapshots, with no omitted fields.
function snapshot(start, end, saturday) {
  return { dias_config: Object.fromEntries(['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'].map(day => [day, {
    activo: day !== 'dom' && (day !== 'sab' || saturday),
    salida: day === 'dom' ? '' : end,
    entrada: day === 'dom' ? '' : start,
    descanso_fin: '', tiene_descanso: false, descanso_inicio: '',
  }])), horario_activo: true, tolerancia_minutos: 10, calculation_contract_version: 1 };
}
const revisions = [
  { id: '01d13d8d-73c0-42b0-ad26-d1689e70441e', horario_id: assignments[0].horario_id, integrity_hash: 'ec423cc4d5e2cec6e251658acb20fe90cb916ced7ddd14753b9cc3953bc1162e', config_snapshot: snapshot('12:00', '17:00', false) },
  { id: 'fae2ab33-61fa-419b-91c3-1dfb573c6142', horario_id: assignments[1].horario_id, integrity_hash: '61b220e727fb7c665ca126b8d6db07087de963cf65a4281e585322fd39daa5c7', config_snapshot: snapshot('20:00', '20:30', true) },
].map(row => ({ ...row, cliente_id: tenant, version: 1 }));
const repository = {
  registro: async id => structuredClone(events.find(row => row.id === id)),
  device: async (t, id) => { assert.equal(t, tenant); assert.equal(id, device.id); return device; },
  employee: async (t, id) => { assert.equal(t, tenant); assert.equal(id, employee); return { id, cliente_id: t }; },
  scheduleContext: async (t, id) => { assert.equal(t, tenant); assert.equal(id, employee); return { assignments, revisions }; },
  current: async (t, id, date) => { assert.equal(t, tenant); assert.equal(id, employee); assert.equal(date, '2026-10-10'); return null; },
  events: async (t, id, start, end) => {
    assert.equal(t, tenant); assert.equal(id, employee);
    assert.equal(start, '2026-10-10T23:00:00.000Z'); assert.equal(end, '2026-10-11T04:30:00.000Z');
    return structuredClone(events);
  },
  devices: async (t, ids) => { assert.equal(t, tenant); assert.deepEqual(ids, [device.id]); return [device]; },
};
(async () => {
  const domain = await import(pathToFileURL(path.join(root, 'src/domain/attendance/index.ts')).href);
  const { computeScheduleRevisionIntegrityHash } = await import(pathToFileURL(path.join(root, 'src/domain/attendance/adapters/ScheduleRevisionAdapter.ts')).href);
  console.log(JSON.stringify({ revision_hash_diagnostic: revisions.map(row => ({
    id: row.id, supplied: row.integrity_hash,
    calculated: computeScheduleRevisionIntegrityHash(row.config_snapshot),
  })) }, null, 2));
  const { calculate } = require(path.join(root, 'backend/attendance-runtime-v3-standby/pipeline.js'));
  const { paramsFor } = require(path.join(root, 'backend/attendance-runtime-v3-standby/persistence.js'));
  const { fingerprint } = require(path.join(root, 'backend/attendance-runtime-v3-standby/manifests.js'));
  const run = () => calculate({ repository, registroId: events[1].id, domain });
  const result = await run();
  assert.deepEqual((await run()).record, result.record, 'Offline calculation must be deterministic');
  assert.equal(result.selection.resolution.scheduleRevisionId, revisions[1].id);
  assert.equal(result.record.source_event_count, 2);
  const rpc20 = paramsFor(result.record);
  assert.equal(Object.keys(rpc20).length, 20);
  const output = { build_sha: sha, export_checked_at: '2026-10-11 01:36:51.521976+00',
    offline_deterministic: true, writes: 0, record: result.record, rpc20,
    evidence_fingerprint: fingerprint(result.record.evidence_manifest),
    context_fingerprint: fingerprint(result.record.context_manifest) };
  const outputFile = path.resolve('.runtime-evidence/surcacen-oct10-offline-result.json');
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
