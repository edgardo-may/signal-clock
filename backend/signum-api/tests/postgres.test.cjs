const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresConnection } = require('../dist/db/postgres/connection.js');
const { PostgresEmployeeRepository } = require('../dist/db/postgres/repositories/PostgresEmployeeRepository.js');
const { PostgresTenantResolver } = require('../dist/db/postgres/PostgresTenantResolver.js');
const ctx = { userId: 'user-a', tenantId: 'tenant-a', role: 'admin' };

function fixture(respond = () => ({ rows: [] })) {
  const calls = [];
  const releases = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); return respond(sql, values); }, release(discard) { releases.push(discard); } };
  const db = new PostgresConnection({ async connect() { return client; } }, 10000, () => {});
  return { db, calls, releases, repo: new PostgresEmployeeRepository(db) };
}
test('pool transaction binds verified subject, authenticated role, RLS and local timeouts', async () => {
  const { db, calls, releases } = fixture();
  await db.transaction(ctx.userId, async () => 1);
  assert.deepEqual(calls.slice(0, 3).map(c => c.sql), ['BEGIN', 'SET LOCAL ROLE authenticated', 'SET LOCAL row_security = on']);
  assert.deepEqual(JSON.parse(calls[3].values[0]), { sub: ctx.userId, role: 'authenticated' });
  assert.match(calls[3].sql, /set_config\('statement_timeout'.*true/);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.deepEqual(releases, [false]);
});
test('rollback and release after failure; failed rollback destroys pooled connection', async () => {
  const { db, calls, releases } = fixture(sql => { if (sql === 'ROLLBACK') throw Error('connection lost'); return { rows: [] }; });
  await assert.rejects(db.transaction(ctx.userId, async () => { throw Error('operation failed'); }));
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(releases, [true]);
});
test('list SQL parameterizes tenant and pagination and omits tenant from public columns', async () => {
  const { repo, calls } = fixture();
  await repo.findAll(ctx, { limit: 50, offset: 10 });
  const query = calls.find(c => c.sql.includes('FROM public.empleados'));
  assert.match(query.sql, /WHERE cliente_id = \$1 ORDER BY apellido, id LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(query.values, ['tenant-a', 51, 10]);
  assert.doesNotMatch(query.sql.split('FROM')[0], /cliente_id/);
});
test('update uses field allowlist and tenant predicate', async () => {
  const { repo, calls } = fixture();
  await repo.update(ctx, 'employee-a', { nombre: 'safe', cliente_id: 'foreign', activo: false });
  const query = calls.find(c => c.sql.startsWith('UPDATE'));
  assert.match(query.sql, /WHERE cliente_id = \$1 AND id = \$2/);
  assert.doesNotMatch(query.sql, /SET cliente_id|activo =/);
  assert.deepEqual(query.values, ['tenant-a', 'employee-a', 'safe']);
});
test('lifecycle foreign/missing record never calls RPC', async () => {
  const { repo, calls } = fixture();
  await assert.rejects(repo.lifecycle(ctx, 'foreign', 'DEACTIVATE'), error => error.status === 404);
  assert.ok(!calls.some(c => c.sql.includes('fn_employee_lifecycle')));
});
for (const action of ['DEACTIVATE', 'ACTIVATE', 'DELETE', 'CHECK']) {
  test(`lifecycle ${action} uses original RPC within tenant checked transaction`, async () => {
    const { repo, calls } = fixture(sql => ({ rows: sql.includes('FROM public.empleados') ? [{ id: 'employee-a' }] :
      sql.includes('fn_employee_lifecycle') ? [{ result: { status: 'SUCCESS', biometrics: 'RE_ENROLLMENT_REQUIRED' } }] : [] }));
    const result = await repo.lifecycle(ctx, 'employee-a', action);
    assert.equal(result.biometrics, 'RE_ENROLLMENT_REQUIRED');
    const rpc = calls.find(c => c.sql.includes('fn_employee_lifecycle'));
    assert.deepEqual(rpc.values, ['employee-a', action]);
    if (action !== 'CHECK') assert.match(calls.find(c => c.sql.includes('FROM public.empleados')).sql, /FOR UPDATE$/);
  });
}
test('lifecycle rule error rolls back instead of returning apparent success', async () => {
  const { repo, calls } = fixture(sql => ({ rows: sql.includes('FROM public.empleados') ? [{ id: 'employee-a' }] :
    sql.includes('fn_employee_lifecycle') ? [{ result: { status: 'ERROR', message: 'sensitive sql' } }] : [] }));
  await assert.rejects(repo.lifecycle(ctx, 'employee-a', 'DEACTIVATE'), error => error.status === 409 && !error.message.includes('sensitive'));
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});
test('tenant resolver reads authoritative profile, rejects missing/suspended/global context', async () => {
  for (const profile of [null, { cliente_id: 'a', rol: 'admin', estatus_cuenta: 'suspendido' },
    { cliente_id: null, rol: 'admin', estatus_cuenta: 'activo' }, { cliente_id: 'a', rol: 'superadmin', estatus_cuenta: 'activo' }]) {
    const { db } = fixture(sql => ({ rows: sql.includes('usuarios_perfiles') && profile ? [profile] : [] }));
    await assert.rejects(new PostgresTenantResolver(db).resolve({ userId: ctx.userId }), error => error.status === 403);
  }
});
test('tenant resolver never resolves from supplied metadata', async () => {
  const { db, calls } = fixture(sql => ({ rows: sql.includes('usuarios_perfiles') ? [{ cliente_id: 'a', rol: 'admin', estatus_cuenta: 'activo' }] : [{ disabled: false }] }));
  const result = await new PostgresTenantResolver(db).resolve({ userId: 'verified', tenantId: 'b', role: 'superadmin' });
  assert.deepEqual(result, { userId: 'verified', tenantId: 'a', role: 'admin' });
  assert.deepEqual(calls.find(c => c.sql.includes('usuarios_perfiles')).values, ['verified']);
});
test('disabled employee module fails closed', async () => {
  const { db } = fixture(sql => ({ rows: sql.includes('usuarios_perfiles') ? [{ cliente_id: 'a', rol: 'admin', estatus_cuenta: 'activo' }] : [{ disabled: true }] }));
  await assert.rejects(new PostgresTenantResolver(db).resolve({ userId: 'verified' }), error => error.status === 403);
});
test('bootstrap refuses unsafe RLS execution role', async () => {
  const { db } = fixture(() => ({ rows: [{ safe: false }] }));
  await assert.rejects(db.verifyRls(), /must enforce/);
});
test('CSV import uses one transaction and rolls back on the second row failure', async () => {
  let inserted = 0;
  const { repo, calls } = fixture(sql => {
    if (sql.startsWith('INSERT')) {
      if (++inserted === 2) throw Object.assign(Error('duplicate'), { code: '23505' });
      return { rows: [{ id: 'employee-a' }] };
    }
    return { rows: [] };
  });
  await assert.rejects(repo.createMany(ctx, [{ nombre: 'A', apellido: 'T' }, { nombre: 'B', apellido: 'T' }]));
  assert.equal(calls.filter(call => call.sql === 'BEGIN').length, 1);
  assert.equal(calls.filter(call => call.sql === 'COMMIT').length, 0);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});
