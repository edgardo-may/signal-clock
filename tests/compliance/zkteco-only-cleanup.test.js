import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8')
async function service(path, name, client) {
  const source = (await read(path)).replace(/^import \{ supabase \} from [^\n]+\n/m, '').replace('export const ' + name, 'const ' + name)
  return new Function('supabase', source + '\nreturn ' + name)(client)
}
test('new device requests always use ZKTECO_ADMS even if caller supplies an old protocol', async () => {
  const calls = []
  const registration = await service('src/features/biometrics/services/deviceRegistrationService.js', 'deviceRegistrationService', { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: 'request' }, error: null } } })
  const result = await registration.request({ serial_number: 'SN001', name: 'Test', protocol: 'UNSUPPORTED_PROTOCOL', timezone: 'America/Cancun' }, 'company')
  assert.equal(result.id, 'request'); assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'request_device_registration'); assert.equal(calls[0].args.p_protocol, 'ZKTECO_ADMS')
  assert.equal(calls[0].args.p_target_cliente_id, 'company')
})
test('device deletion success invokes only the canonical guarded RPC', async () => {
  const calls = []
  const api = await service('src/features/biometrics/services/biometricsService.js', 'biometricsService', { rpc: async (name, args) => { calls.push({ name, args }); return { data: { success: true }, error: null } }, from() { throw Error('Direct table mutation forbidden') } })
  assert.equal(await api.deleteDevice('device'), true)
  assert.deepEqual(calls, [{ name: 'fn_delete_device_superadmin', args: { p_device_id: 'device' } }])
})
test('missing or rejected deletion RPC never falls back to HTTP or direct DML', async () => {
  const source = await read('src/features/biometrics/services/biometricsService.js')
  const method = source.slice(source.indexOf('  async deleteDevice('), source.indexOf('  async getAttendanceLogs('))
  assert.doesNotMatch(method, /fetch\(|supabase\.auth|\.from\(/)
  for (const failure of [{ code: 'PGRST202', message: 'RPC unavailable' }, { code: '42501', message: 'permission denied' }]) {
    let calls = 0
    const api = await service('src/features/biometrics/services/biometricsService.js', 'biometricsService', { rpc: async () => { calls++; return { error: failure } }, from() { throw Error('Direct mutation forbidden') } })
    await assert.rejects(() => api.deleteDevice('device'), error => failure.code === '42501' ? /Permiso denegado/.test(error.message) : error === failure)
    assert.equal(calls, 1)
  }
})
test('invalid device identity and rejected RPC business result fail closed', async () => {
  let calls = 0
  const api = await service('src/features/biometrics/services/biometricsService.js', 'biometricsService', { rpc: async () => { calls++; return { data: { success: false, message: 'Cannot delete' }, error: null } } })
  await assert.rejects(() => api.deleteDevice(null), /ID de dispositivo requerido/); assert.equal(calls, 0)
  await assert.rejects(() => api.deleteDevice('device'), /Cannot delete/); assert.equal(calls, 1)
})
test('device form has a single protocol and never sends a protocol-secret field', async () => {
  const source = await read('src/features/biometrics/components/DeviceFormModal.jsx')
  assert.match(source, /protocol: 'ZKTECO_ADMS'/)
  assert.doesNotMatch(source, /formData\.marca|isup_key|HIKVISION_ISUP/)
  assert.match(source, /readOnly=\{isEditing\}/)
})
test('all current device consumers read canonical devices fields', async () => {
  for (const file of ['src/central/pages/CentralDashboardPage.jsx', 'src/central/pages/CentralTenantsPage.jsx', 'src/central/pages/company-detail/CompanyDetailPage.jsx', 'src/features/tenants/pages/EmpresasPage.jsx', 'src/shared/hooks/useTenantLimits.js', 'src/shared/providers/TenantProvider.jsx', 'src/features/attendance/pages/HistorialEventosPage.jsx']) {
    const source = await read(file)
    assert.match(source, /from\('devices'\)/, file); assert.doesNotMatch(source, /from\('dispositivos'\)/, file)
  }
  const history = await read('src/features/attendance/pages/HistorialEventosPage.jsx')
  assert.match(history, /select\('id, name, serial_number'\)/)
  assert.match(history, /dev\.serial_number/); assert.match(history, /dev\.name/)
})
test('approved Employee SQL artifacts remain byte-identical', async () => {
  const hashes = {
    'global_security_minimum_candidate.sql': '54A857EC2F494048A6CAA9D1D31F9CE9F213C159261D7E937553B3F47080BF48',
    'employee_web_clock_candidate.sql': 'F1C0A27143DC5FC8A0D1DD2BA4C4AAF21EE5A476D047866C05990242D44A8B52',
    'web_clock_canonical_source_delta.sql': 'EC954271070701A0E85962DC08600777652A64B2A45BF9BB09506B64045ACF6A',
    'employee_pin_conversion_candidate.sql': 'DC5B2DB38EC8BB04574B6AFF1E2AD66E113454EA6CC11063A77E8890E1E3F22A',
  }
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = await readFile(new URL('../../database/live-schema/proposals/' + name, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), expected, name)
  }
})
test('proposal preserves the catalog seven-argument contract and refuses unreviewed drift', async () => {
  const source = await read('database/live-schema/proposals/125_retire_hikvision_zkteco_only.sql')
  assert.match(source, /FUNCTION public\.request_device_registration\(p_serial text, p_name text, p_protocol text, p_timezone text, p_location text DEFAULT NULL::text, p_device_type text DEFAULT 'general'::text, p_target_cliente_id uuid DEFAULT NULL::uuid\)/)
  assert.match(source, /ZKTECO_ONLY_REVIEW_REQUIRED/); assert.match(source, /ZKTECO_ONLY_ROUTINE_DRIFT/)
  assert.match(source, /LEGACY_DEVICE_REQUESTS_REQUIRE_REVIEW/); assert.match(source, /LEGACY_DEVICE_ROWS_REQUIRE_PRESERVATION_PLAN/)
  assert.doesNotMatch(source, /p_protocol NOT IN \('ZKTECO_ADMS','HIKVISION_ISUP'\)/)
  assert.match(source, /CHECK\(protocol='ZKTECO_ADMS'\)/)
  assert.match(source, /employee_private\.web_clocks/)
  assert.doesNotMatch(source.replace(/^--.*$/gm, ''), /DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM\s+public\.(?:dispositivos|registro_asistencia)/i)
})
test('proposal precheck is SELECT-only and returns no credential values', async () => {
  const source = (await read('database/live-schema/proposals/125_retire_hikvision_zkteco_only_precheck.sql')).replace(/^--.*$/gm, '')
  assert.match(source.trim(), /^SELECT\s+jsonb_build_object/)
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL|DO)\b/i)
  assert.doesNotMatch(source, /pin_hash|session_hash|\bpin\b/)
  assert.match(source, /legacy_employee_columns/); assert.match(source, /catalog_dependencies/)
})

test('command UI no longer offers the retired socket connectivity action', async () => {
  const source = await read('src/features/biometrics/components/SendCommandModal.jsx')
  assert.doesNotMatch(source, /command: 'PING'/)
  assert.match(source, /command: 'REBOOT'/)
  assert.match(source, /onChange=\{\(e\) => setCommandString\(e\.target\.value\)\}/)
})
