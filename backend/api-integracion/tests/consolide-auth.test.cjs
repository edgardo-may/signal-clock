const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchEmpleados } = require('../consolide-client');
const query = { idEmpresa: 39, trabId: '91812', fechaInicio: '2020-01-01', fechaFin: '2026-10-08' };

function setup(t, respond) {
  for (const key of ['CONSOLIDE_USERNAME', 'CONSOLIDE_PASSWORD']) {
    const previous = process.env[key];
    process.env[key] = 'test-only';
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', respond);
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('Every employee query authenticates and uses its new Bearer token', async t => {
  let authCount = 0;
  const calls = [];
  setup(t, async (url, options) => {
    if (url.endsWith('/identity/authentication')) {
      calls.push('auth');
      return json({ esExitosa: true, datos: { accessToken: `test-token-${++authCount}` } });
    }
    calls.push('employees');
    assert.ok(url.endsWith('/API_RelojesIncidenciasv2/api/Empleados/PostListEmpleados'));
    assert.equal(options.headers.Authorization, `Bearer test-token-${authCount}`);
    assert.equal(options.headers.IDEmpresa, '39');
    assert.deepEqual(JSON.parse(options.body), {
      empresa_ID: 39, trab_ID: '91812', fecha_Movimiento_Inicio: '2020-01-01', fecha_Movimiento_Fin: '2026-10-08',
    });
    return json({ resultado: [{ trab_ID: '91812' }] });
  });
  for (let i = 0; i < 2; i++) assert.equal((await fetchEmpleados(query))[0].trab_ID, '91812');
  assert.deepEqual(calls, ['auth', 'employees', 'auth', 'employees']);
});

test('An expired token gets exactly one renewed-token retry', async t => {
  let authCount = 0;
  let employeeCount = 0;
  setup(t, async (url, options) => {
    if (url.endsWith('/identity/authentication')) return json({ esExitosa: true, datos: { accessToken: `test-token-${++authCount}` } });
    assert.equal(options.headers.Authorization, `Bearer test-token-${authCount}`);
    employeeCount++;
    return employeeCount === 1 ? json({}, 401) : json({ resultado: [{ trab_ID: '91812' }] });
  });
  assert.equal((await fetchEmpleados(query)).length, 1);
  assert.equal(authCount, 2);
  assert.equal(employeeCount, 2);
});

test('Failed authentication stops before querying employees', async t => {
  let calls = 0;
  setup(t, async url => {
    calls++;
    assert.ok(url.endsWith('/identity/authentication'));
    return json({}, 401);
  });
  await assert.rejects(fetchEmpleados(query), error => error.statusCode === 401);
  assert.equal(calls, 1);
});

test('Repeated 401 is reported instead of endlessly retrying', async t => {
  let authCount = 0;
  let employeeCount = 0;
  setup(t, async url => {
    if (url.endsWith('/identity/authentication')) return json({ esExitosa: true, datos: { accessToken: `test-token-${++authCount}` } });
    employeeCount++;
    return json({}, 401);
  });
  await assert.rejects(fetchEmpleados(query), error => error.statusCode === 401);
  assert.equal(authCount, 2);
  assert.equal(employeeCount, 2);
});
