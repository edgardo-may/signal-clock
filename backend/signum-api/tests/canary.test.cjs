const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function client(flag = 'true', pages = []) {
  const source = readFileSync(resolve(__dirname, '../../../src/features/employees/services/employeeApi.js'), 'utf8')
    .replace("import { supabase } from '../../../lib/supabase'", 'const supabase = authClient')
    .replaceAll('import.meta.env', 'environment');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requests = [];
  const context = {
    exports: {}, environment: { VITE_USE_EMPLOYEE_API: flag, VITE_SIGNUM_API_URL: 'http://localhost:3001' },
    authClient: { auth: { async getSession() { return { data: { session: { access_token: 'secret-jwt' } } }; } } },
    AbortSignal, async fetch(url, options) { requests.push({ url, options }); return { ok: true, async json() { return pages.shift() ?? { status: 'SUCCESS' }; } }; },
  };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, requests, context };
}
test('canary defaults off; true enables tenant users and excludes superadmin', () => {
  assert.equal(client(undefined).api.isEmployeeApiEnabled(true), false);
  assert.equal(client('false').api.isEmployeeApiEnabled(false), false);
  assert.equal(client('true').api.isEmployeeApiEnabled(false), true);
});
test('frontend create/update/import never sends tenant or persistence fields', async () => {
  const { api, requests } = client();
  const input = { nombre: 'A', apellido: 'T', cliente_id: 'foreign', tenantId: 'foreign', actualizado_at: 'fake', activo: true };
  await api.createEmployee(input);
  await api.updateEmployee('id', input);
  await api.importEmployees([input]);
  assert.doesNotMatch(JSON.stringify(requests), /foreign|cliente_id|tenantId|actualizado_at/);
  assert.equal(JSON.parse(requests[1].options.body).activo, undefined);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-jwt');
});
test('frontend pagination uses bounded requests and preserves complete directory', async () => {
  const { api, requests } = client('true', [{ data: [{ id: 'a' }], hasMore: true }, { data: [{ id: 'b' }], hasMore: false }]);
  const rows = await api.listEmployees();
  assert.equal(rows.length, 2);
  assert.ok(requests[0].url.endsWith('?limit=100&offset=0'));
  assert.ok(requests[1].url.endsWith('?limit=100&offset=100'));
});
test('frontend lifecycle uses explicit HTTP actions, with no RPC implementation', async () => {
  const { api, requests } = client();
  await api.employeeLifecycle('id', 'DEACTIVATE');
  await api.employeeLifecycle('id', 'ACTIVATE');
  assert.ok(requests[0].url.endsWith('/id/deactivate'));
  assert.ok(requests[1].url.endsWith('/id/reactivate'));
  assert.equal(requests[0].options.body, undefined);
});
test('API failure does not silently fall back to Supabase writes', async () => {
  const { api, context, requests } = client();
  context.fetch = async () => ({ ok: false, async json() { return { error: 'FORBIDDEN' }; } });
  const result = await api.employeeApiResult(() => api.createEmployee({ nombre: 'A', apellido: 'T' }));
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.equal(result.data, null);
  assert.equal(requests.length, 0);
});
