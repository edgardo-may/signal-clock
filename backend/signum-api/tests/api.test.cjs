const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../dist/app.js');
const { ApiError } = require('../dist/errors.js');
const { SupabaseAuthProvider } = require('../dist/auth/SupabaseAuthProvider.js');
const { loadConfig } = require('../dist/config/env.js');
const { createDatabaseProvider } = require('../dist/db/DatabaseProvider.js');

const A = '10000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000001';
const A1 = '10000000-0000-4000-8000-000000000002';
const B1 = '20000000-0000-4000-8000-000000000002';
const newInput = { nombre: 'Ana', apellido: 'Test', device_userid: '22' };

async function fixture(t, options = {}) {
  const rows = new Map([[A1, { id: A1, tenant: A, nombre: 'A1', apellido: 'Test', activo: true }],
    [B1, { id: B1, tenant: B, nombre: 'B1', apellido: 'Test', activo: true }]]);
  const log = [];
  const visible = (ctx, id) => rows.get(id)?.tenant === ctx.tenantId ? rows.get(id) : null;
  const repositories = {
    async capacity(ctx) { return { nombre_empresa: 'Test', empleados_actuales: [...rows.values()].filter(row => row.tenant === ctx.tenantId).length, limite_empleados: 50 }; },
    async findAll(ctx, q) {
      const all = [...rows.values()].filter(row => row.tenant === ctx.tenantId);
      return { data: all.slice(q.offset, q.offset + q.limit), ...q, hasMore: all.length > q.offset + q.limit };
    },
    async findById(ctx, id) { return visible(ctx, id); },
    async create(ctx, input) { const row = { ...input, id: A1, tenant: ctx.tenantId, activo: input.activo ?? true }; rows.set(A1, row); return row; },
    async createMany(_ctx, inputs) { return inputs.length; },
    async update(ctx, id, input) { const row = visible(ctx, id); if (!row) return null; Object.assign(row, input); return row; },
    async lifecycle(ctx, id, action) {
      const row = visible(ctx, id);
      if (!row) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND');
      if (action === 'CHECK') return { status: 'CAN_DEACTIVATE' };
      if (action === 'DELETE') rows.delete(id);
      else row.activo = action === 'ACTIVATE';
      return { status: 'SUCCESS' };
    },
  };
  const app = createApp({
    auth: { async verifyToken(token) {
      if (!['A', 'B', 'auditor', 'missing-tenant'].includes(token)) throw new ApiError(401, 'INVALID_TOKEN');
      return { userId: token };
    } },
    tenants: { async resolve(identity) {
      if (identity.userId === 'missing-tenant') throw new ApiError(403, 'TENANT_CONTEXT_UNAVAILABLE');
      return { userId: identity.userId, tenantId: identity.userId === 'B' ? B : A,
        role: identity.userId === 'auditor' ? 'auditor' : 'admin' };
    } }, employees: repositories, log: record => log.push(record), ...options,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path = '', { token = 'A', method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  return { request, rows, log };
}

test('health is public, exact and does not access authentication or persistence', async t => {
  const { request } = await fixture(t, { auth: { verifyToken() { throw Error('must not run'); } },
    employees: { findAll() { throw Error('must not run'); } } });
  assert.deepEqual((await request('/health', { token: null })).data, { status: 'ok' });
});
for (const [name, token] of [['missing JWT', null], ['invalid JWT', 'invalid']]) {
  test(`${name} returns 401`, async t => {
    const { request } = await fixture(t);
    assert.equal((await request('/employees', { token })).status, 401);
  });
}
test('valid JWT continues and tenant A sees A1, never B1', async t => {
  const { request } = await fixture(t);
  const result = await request('/employees');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.data.map(row => row.id), [A1]);
});
test('tenant B sees B1, never A1', async t => {
  const { request } = await fixture(t);
  assert.deepEqual((await request('/employees', { token: 'B' })).data.data.map(row => row.id), [B1]);
});
test('tenant A cannot get B1, same response as unknown employee', async t => {
  const { request } = await fixture(t);
  const foreign = await request(`/employees/${B1}`);
  const missing = await request('/employees/30000000-0000-4000-8000-000000000003');
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.data, missing.data);
});
test('get own employee', async t => {
  const { request } = await fixture(t);
  assert.equal((await request(`/employees/${A1}`)).data.nombre, 'A1');
});
test('create employee derives tenant from authenticated identity', async t => {
  const { request } = await fixture(t);
  const result = await request('/employees', { method: 'POST', body: newInput });
  assert.equal(result.status, 201);
  assert.equal(result.data.tenant, A);
});
test('patch own employee', async t => {
  const { request } = await fixture(t);
  assert.equal((await request(`/employees/${A1}`, { method: 'PATCH', body: { nombre: 'Edited' } })).data.nombre, 'Edited');
});
test('capacity is tenant-scoped and hides database identifiers', async t => {
  const { request } = await fixture(t);
  const result = await request('/employees/capacity');
  assert.equal(result.status, 200);
  assert.equal(result.data.empleados_actuales, 1);
  assert.equal(result.data.cliente_id, undefined);
});
test('initial inactive employee remains supported', async t => {
  const { request } = await fixture(t);
  const result = await request('/employees', { method: 'POST', body: { ...newInput, activo: false } });
  assert.equal(result.status, 201);
  assert.equal(result.data.activo, false);
});
test('PATCH cannot bypass lifecycle by setting activo', async t => {
  const { request } = await fixture(t);
  assert.equal((await request(`/employees/${A1}`, { method: 'PATCH', body: { activo: false } })).status, 400);
});
test('CSV import validates every row and forbids nested tenant injection', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/employees/import', { method: 'POST', body: { employees: [newInput] } })).status, 201);
  assert.equal((await request('/employees/import', { method: 'POST', body: { employees: [newInput, { ...newInput, cliente_id: B }] } })).status, 400);
  assert.equal((await request('/employees/import', { method: 'POST', body: { employees: Array(1001).fill(newInput) } })).status, 400);
});
test('oversized bodies return 413 without echoing payload', async t => {
  const { request } = await fixture(t);
  const result = await request('/employees', { method: 'POST', body: { nombre: 'a'.repeat(1024 * 1024) } });
  assert.equal(result.status, 413);
  assert.deepEqual(result.data, { error: 'PAYLOAD_TOO_LARGE' });
});
for (const [method, suffix, body] of [['PATCH', '', { nombre: 'Intruder' }], ['POST', '/deactivate', undefined],
  ['POST', '/reactivate', undefined], ['DELETE', '', undefined], ['POST', '/lifecycle-check', undefined]]) {
  test(`cross-tenant ${method} ${suffix || 'employee'} returns 404`, async t => {
    const { request, rows } = await fixture(t);
    assert.equal((await request(`/employees/${B1}${suffix}`, { method, body })).status, 404);
    assert.equal(rows.get(B1).nombre, 'B1');
  });
}
test('deactivate/reactivate explicit actions preserve employee record', async t => {
  const { request, rows } = await fixture(t);
  assert.equal((await request(`/employees/${A1}/deactivate`, { method: 'POST' })).status, 200);
  assert.equal(rows.get(A1).activo, false);
  assert.equal((await request(`/employees/${A1}/reactivate`, { method: 'POST' })).status, 200);
  assert.equal(rows.get(A1).activo, true);
});
for (const [method, suffix, body] of [['POST', '', newInput], ['PATCH', `/${A1}`, { nombre: 'x' }],
  ['POST', `/${A1}/deactivate`, undefined], ['POST', `/${A1}/reactivate`, undefined], ['DELETE', `/${A1}`, undefined]]) {
  test(`auditor cannot ${method} ${suffix}`, async t => {
    const { request } = await fixture(t);
    assert.equal((await request(`/employees${suffix}`, { token: 'auditor', method, body })).status, 403);
  });
}
test('auditor read remains available under historical RLS contract', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/employees', { token: 'auditor' })).status, 200);
});
for (const [query, expected, limit] of [['', 200, 50], ['?limit=100', 200, 100], ['?limit=100000', 400],
  ['?limit=0', 400], ['?limit=-1', 400], ['?limit=NaN', 400], ['?limit=1.5', 400], ['?limit=1&limit=2', 400], ['?offset=-1', 400]]) {
  test(`pagination ${query || 'default'}`, async t => {
    const { request } = await fixture(t);
    const result = await request(`/employees${query}`);
    assert.equal(result.status, expected);
    if (limit) assert.equal(result.data.limit, limit);
  });
}
test('offset returns next page without exceeding limit', async t => {
  const { request, rows } = await fixture(t);
  rows.set('extra', { id: 'extra', tenant: A, nombre: 'next' });
  const first = await request('/employees?limit=1');
  assert.equal(first.data.hasMore, true);
  assert.equal(first.data.data.length, 1);
  assert.equal((await request('/employees?limit=1&offset=1')).data.data[0].nombre, 'next');
});
for (const body of [{}, { ...newInput, cliente_id: B }, { ...newInput, role: 'admin' },
  { ...newInput, activo: 'false' }, { ...newInput, fecha_ingreso: '2026-02-30' }, { ...newInput, nombre: '' }]) {
  test(`reject unvalidated create ${JSON.stringify(body)}`, async t => {
    const { request } = await fixture(t);
    assert.equal((await request('/employees', { method: 'POST', body })).status, 400);
  });
}
test('tenant query and header cannot select identity', async t => {
  const { request } = await fixture(t);
  assert.equal((await request(`/employees?cliente_id=${B}`)).status, 400);
  assert.equal((await request('/employees', { headers: { cliente_id: B } })).status, 400);
});
test('missing authoritative tenant fails closed', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/employees', { token: 'missing-tenant' })).status, 403);
});
test('invalid ID fails before repository access', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/employees/not-a-uuid')).status, 400);
});
test('rate limit returns 429 and retry-after; health remains live', async t => {
  const { request } = await fixture(t, { rateMax: 1 });
  await request('/employees');
  const result = await request('/employees');
  assert.equal(result.status, 429);
  assert.ok(Number(result.headers.get('retry-after')) > 0);
  assert.equal((await request('/health')).status, 200);
});
test('logs contain metrics, never bearer token, PIN or body', async t => {
  const { request, log } = await fixture(t);
  await request('/employees', { method: 'POST', body: { ...newInput, pin: 'SECRET-PIN' } });
  const record = log.at(-1);
  assert.equal(record.tenant, A);
  assert.equal(record.rowsReturned, 1);
  assert.equal(typeof record.durationMs, 'number');
  assert.equal(typeof record.queryCount, 'number');
  assert.doesNotMatch(JSON.stringify(log), /SECRET-PIN|Bearer|Authorization/);
});
test('unexpected errors sanitized and recorded as 500', async t => {
  const { request, log } = await fixture(t, { employees: { async findAll() { throw Error('PASSWORD-SECRET'); } } });
  const result = await request('/employees');
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.data), /PASSWORD/);
  assert.equal(log.at(-1).status, 500);
});
test('SQL Server fails explicitly at provider bootstrap', () => {
  assert.throws(() => createDatabaseProvider({ DB_PROVIDER: 'sqlserver' }), /not implemented/);
});
test('configuration never includes secret values in error', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'SECRET-invalid' }), error => !error.message.includes('SECRET'));
});
test('SupabaseAuthProvider verifies remotely; ignores user-editable metadata', async () => {
  const provider = new SupabaseAuthProvider('https://example.supabase.co', 'public-key');
  provider.client.auth.getUser = async token => ({ data: { user: { id: A, user_metadata: { cliente_id: B, rol: 'superadmin' } } }, error: null });
  assert.deepEqual(await provider.verifyToken('token'), { userId: A });
  provider.client.auth.getUser = async () => ({ data: { user: null }, error: new Error('bad jwt') });
  await assert.rejects(provider.verifyToken('bad'), error => error.status === 401);
});
test('baseline through the real HTTP/controller/service/adapters with simulated PostgreSQL I/O', async t => {
  const { PostgresConnection } = require('../dist/db/postgres/connection.js');
  const { PostgresEmployeeRepository } = require('../dist/db/postgres/repositories/PostgresEmployeeRepository.js');
  const { PostgresTenantResolver } = require('../dist/db/postgres/PostgresTenantResolver.js');
  const db = new PostgresConnection({ async connect() { return {
    release() {}, async query(sql) {
      if (sql.includes('FROM public.usuarios_perfiles')) return { rows: [{ cliente_id: A, rol: 'admin', estatus_cuenta: 'activo' }] };
      if (sql.includes('AS disabled')) return { rows: [{ disabled: false }] };
      if (sql.includes('FROM public.empleados')) return { rows: [{ id: A1, nombre: 'A1', apellido: 'Test' }] };
      return { rows: [] };
    },
  }; } }, 10000, () => {});
  const { request, log } = await fixture(t, { tenants: new PostgresTenantResolver(db), employees: new PostgresEmployeeRepository(db) });
  const durations = [];
  for (let i = 0; i < 20; i++) {
    assert.equal((await request('/employees')).status, 200);
    const metric = log.at(-1);
    assert.equal(metric.queryCount, 13);
    assert.equal(metric.rowsReturned, 1);
    assert.equal(metric.endpoint, '/api/v1/employees');
    durations.push(metric.durationMs);
  }
  durations.sort((a, b) => a - b);
  t.diagnostic(JSON.stringify({ baseline: 'simulated-postgres-not-production', requests: 20,
    queryCount: 13, rowsReturned: 1, durationP50Ms: durations[9], durationP95Ms: durations[18] }));
});
