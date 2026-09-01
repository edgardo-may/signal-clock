const dotenv = require('../zkteco-push-ta/node_modules/dotenv');
const path = require('path');
const http = require('http');
const { createClient } = require('../zkteco-push-ta/node_modules/@supabase/supabase-js');

dotenv.config({ path: path.join(__dirname, '../zkteco-push-ta/.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

const ADMS_HOST = 'localhost';
const ADMS_PORT = 5000;

async function requestAdms(serial, method = 'POST', body = '') {
  return new Promise((resolve) => {
    const query = serial ? `?SN=${encodeURIComponent(serial)}&table=ATTLOG` : '';
    const req = http.request(
      {
        hostname: ADMS_HOST,
        port: ADMS_PORT,
        path: `/iclock/cdata${query}`,
        method,
        headers: {
          'Content-Type': method === 'POST' ? 'text/plain' : 'text/plain',
          'User-Agent': 'ZKTeco/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

async function setup() {
  console.log("=== SETUP BÁSICO ===");
  // Limpiar attendance_logs para pruebas
  await supabase.from('attendance_logs').delete().in('device_serial', ['ZK-ATT-A', 'ZK-ATT-B', 'ZK-ATT-DISABLED']);
  
  const { data: clientes } = await supabase.from('clientes').select('id').limit(1);
  const clienteId = clientes[0].id;

  // Insertar dispositivos
  await supabase.from('devices').upsert([
    { serial_number: 'ZK-ATT-A', is_active: true, name: 'Att Test A', timezone: 'America/Mexico_City' },
    { serial_number: 'ZK-ATT-B', is_active: true, name: 'Att Test B', timezone: 'America/Mexico_City' },
    { serial_number: 'ZK-ATT-DISABLED', is_active: false, name: 'Disabled' }
  ], { onConflict: 'serial_number' });

  await supabase.from('dispositivos').upsert([
    { cliente_id: clienteId, device_id_hikvision: 'ZK-ATT-A', nombre_ubicacion: 'Loc A', estatus: 'activo' },
    { cliente_id: clienteId, device_id_hikvision: 'ZK-ATT-B', nombre_ubicacion: 'Loc B', estatus: 'activo' },
    { cliente_id: clienteId, device_id_hikvision: 'ZK-ATT-DISABLED', nombre_ubicacion: 'Loc D', estatus: 'inactivo' }
  ], { onConflict: 'cliente_id, device_id_hikvision' });

  const { data: devs } = await supabase.from('devices').select('id, serial_number').in('serial_number', ['ZK-ATT-A', 'ZK-ATT-B']);
  const devA = devs.find(d => d.serial_number === 'ZK-ATT-A').id;
  const devB = devs.find(d => d.serial_number === 'ZK-ATT-B').id;

  // Crear Empleados ficticios
  const empIdA = '11111111-1111-4111-8111-111111111111';
  const empIdB = '22222222-2222-4222-8222-222222222222';
  const empIdInactive = '33333333-3333-4333-8333-333333333333';
  
  const { error: eErr } = await supabase.from('empleados').upsert([
    { id: empIdA, cliente_id: clienteId, clave_empleado: 'EMP-A', nombre: 'Emp A', apellido: 'Test', activo: true, hikvision_device_userid: 'EMP-A' },
    { id: empIdB, cliente_id: clienteId, clave_empleado: 'EMP-B', nombre: 'Emp B', apellido: 'Test', activo: true, hikvision_device_userid: 'EMP-B' },
    { id: empIdInactive, cliente_id: clienteId, clave_empleado: 'EMP-INACT', nombre: 'Inactive', apellido: 'Test', activo: false, hikvision_device_userid: 'EMP-INACT' }
  ]);
  if (eErr) console.error('Empleados Upsert Error:', eErr);

  // Crear assignments
  const { error: aErr } = await supabase.from('device_employee_assignments').upsert([
    { id: '11111111-2222-4333-8444-111111111111', cliente_id: clienteId, device_id: devA, employee_id: empIdA, biometric_user_id: '1001', activo: true }, // A usa 1001
    { id: '11111111-2222-4333-8444-222222222222', cliente_id: clienteId, device_id: devB, employee_id: empIdB, biometric_user_id: '1001', activo: true }, // B usa 1001
    { id: '11111111-2222-4333-8444-333333333333', cliente_id: clienteId, device_id: devA, employee_id: empIdInactive, biometric_user_id: '1002', activo: true } // Inactivo
  ]);
  if (aErr) console.error('Assignments Upsert Error:', aErr);

  console.log("Setup complete.\n");
}

async function countLogs(serial) {
  const { count } = await supabase.from('attendance_logs').select('*', { count: 'exact', head: true }).eq('device_serial', serial);
  return count || 0;
}

async function runTests() {
  await setup();
  const results = {};
  
  const assert = (condition, msg, caseName) => {
    if (!condition) {
      console.error(`[FAIL] ${caseName}: ${msg}`);
      results[caseName] = 'FAIL';
      return false;
    }
    results[caseName] = 'PASS';
    return true;
  };

  // CASO E: SN desconocido
  let res = await requestAdms('ZK-FAKE', 'POST', '1001\t2026-08-26 08:00:00\t0\t15\t0\t0\n');
  assert(res.status === 401, `Status debe ser 401, fue ${res.status}`, 'E SN desconocido');

  // CASO F: Device disabled
  res = await requestAdms('ZK-ATT-DISABLED', 'POST', '1001\t2026-08-26 08:00:00\t0\t15\t0\t0\n');
  assert(res.status === 403, `Status debe ser 403, fue ${res.status}`, 'F Device disabled');

  // CASO C: PIN desconocido
  let countBefore = await countLogs('ZK-ATT-A');
  res = await requestAdms('ZK-ATT-A', 'POST', '999999\t2026-08-26 08:00:00\t0\t15\t0\t0\n');
  let countAfter = await countLogs('ZK-ATT-A');
  assert(res.status === 200 && countAfter === countBefore, "Debe retornar 200 y no insertar", 'C PIN desconocido');

  // CASO J: Empleado inactivo (PIN 1002 en ZK-ATT-A)
  countBefore = await countLogs('ZK-ATT-A');
  res = await requestAdms('ZK-ATT-A', 'POST', '1002\t2026-08-26 08:05:00\t0\t15\t0\t0\n');
  countAfter = await countLogs('ZK-ATT-A');
  assert(res.status === 200 && countAfter === countBefore, "Debe retornar 200 y no insertar inactivos", 'J Empleado inactivo');

  // CASO A: Checada válida & CASO I: Timezone
  const testTime = '2026-08-26 08:00:00'; // Hora local Mexico
  res = await requestAdms('ZK-ATT-A', 'POST', `1001\t${testTime}\t0\t15\t0\t0\n`);
  const { data: logA } = await supabase.from('attendance_logs').select('*').eq('device_serial', 'ZK-ATT-A').eq('user_id', 'EMP-A').single();
  
  if (logA) {
    // Verificar mapeo y status
    let tzValid = logA.timestamp.includes('2026-08-26T14:00:00') || logA.timestamp.includes('08:00:00-06'); // UTC or offset
    assert(logA.device_serial === 'ZK-ATT-A' && logA.user_id === 'EMP-A' && logA.status === 'check_in', "Datos deben guardarse correctamente", 'A Checada válida');
    assert(tzValid, `Timezone incorrecto, devuelto: ${logA.timestamp}`, 'I Timezone');
    console.log(`\n=== CASO I: TIMEZONE INFO ===`);
    console.log(`Timestamp enviado: ${testTime}`);
    console.log(`Timezone configurado (device): America/Mexico_City`);
    console.log(`Timestamp final almacenado: ${logA.timestamp}\n`);
  } else {
    assert(false, "No se guardó el log", 'A Checada válida');
    assert(false, "No se guardó el log", 'I Timezone');
  }

  // CASO B: Duplicado secuencial
  countBefore = await countLogs('ZK-ATT-A');
  res = await requestAdms('ZK-ATT-A', 'POST', `1001\t${testTime}\t0\t15\t0\t0\n`);
  countAfter = await countLogs('ZK-ATT-A');
  assert(res.status === 200 && countAfter === countBefore, "Debe ignorar el duplicado sin fallar", 'B Duplicado secuencial');

  // CASO D: Aislamiento multi-tenant y Aislamiento adicional
  // ZK-B manda 1001, debe ser EMP-B
  await requestAdms('ZK-ATT-B', 'POST', `1001\t${testTime}\t0\t15\t0\t0\n`);
  const { data: logB } = await supabase.from('attendance_logs').select('*').eq('device_serial', 'ZK-ATT-B').eq('user_id', 'EMP-B').single();
  
  // ZK-A manda 2000 (no asignado a A, pero imaginemos asignado a B) -> se verifica enviando a A algo no asignado
  await requestAdms('ZK-ATT-B', 'POST', `2000\t${testTime}\t0\t15\t0\t0\n`); // Pin no existente, ignorado.
  assert(logB && logB.user_id === 'EMP-B', "PIN 1001 en ZK-B debe mapear a EMP-B", 'D Aislamiento multi-tenant');

  // CASO G: Lote múltiple & CASO H: Lote parcialmente inválido
  const batchPayload = `
1001\t2026-08-26 09:00:00\t1\t15\t0\t0
1001\tINVALID_DATE_CRASH\t1\t15\t0\t0
9999\t2026-08-26 09:01:00\t1\t15\t0\t0
1001\t2026-08-26 09:02:00\t1\t15\t0\t0
`;
  countBefore = await countLogs('ZK-ATT-A');
  res = await requestAdms('ZK-ATT-A', 'POST', batchPayload);
  countAfter = await countLogs('ZK-ATT-A');
  assert(res.status === 200 && countAfter === (countBefore + 2), `Se esperaban 2 inserts nuevos, hubo ${countAfter - countBefore}`, 'G Lote múltiple');
  results['H Lote parcialmente inválido'] = results['G Lote múltiple']; // Mismos asertos aplican

  // CASO K: Duplicado concurrente
  const concTime = '2026-08-26 10:00:00';
  const concPayload = `1001\t${concTime}\t0\t15\t0\t0\n`;
  countBefore = await countLogs('ZK-ATT-A');
  
  const [res1, res2] = await Promise.all([
    requestAdms('ZK-ATT-A', 'POST', concPayload),
    requestAdms('ZK-ATT-A', 'POST', concPayload)
  ]);
  
  countAfter = await countLogs('ZK-ATT-A');
  const increment = countAfter - countBefore;
  
  if (increment === 1) {
    results['K Duplicado concurrente'] = 'PASS';
  } else if (increment > 1) {
    console.error(`[FAIL] K Duplicado concurrente: Se insertaron ${increment} registros en concurrencia.`);
    results['K Duplicado concurrente'] = 'FAIL';
  } else {
    console.error(`[FAIL] K Duplicado concurrente: No se insertó nada.`);
    results['K Duplicado concurrente'] = 'FAIL';
  }

  console.log("\n=== MATRIZ DE RESULTADOS ===");
  Object.keys(results).forEach(k => console.log(`${k.padEnd(28)} ${results[k]}`));
}

runTests();
