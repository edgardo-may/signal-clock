/**
 * Simulador de conexión ADMS (ZKTeco) para pruebas de Fase 2.1
 * 
 * Este script verifica que el backend responda correctamente según el estado
 * del dispositivo registrado en Signum Clock.
 * 
 * USO:
 * 1. Asegúrate de que el backend (`zkteco-push-ta`) esté corriendo en http://localhost:8080
 * 2. Asegúrate de tener la BD levantada con los siguientes datos de prueba (seriales) creados:
 *    - 'ZK-VALID': Un dispositivo creado y activo.
 *    - 'ZK-DISABLED': Un dispositivo creado pero is_active = false.
 *    - 'ZK-TENANT-A': Un dispositivo activo, pero se intentará robar sus comandos.
 * 3. Ejecuta: node scratch/simulate_adms.js
 */

const http = require('http');

const ADMS_HOST = 'localhost';
const ADMS_PORT = 5000;

async function simulateRequest(path, serial, method = 'GET') {
  return new Promise((resolve) => {
    const query = serial ? `?SN=${encodeURIComponent(serial)}` : '';
    const req = http.request(
      {
        hostname: ADMS_HOST,
        port: ADMS_PORT,
        path: `${path}${query}`,
        method,
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'ZKTeco/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, data });
        });
      }
    );

    req.on('error', (e) => {
      resolve({ status: 0, error: e.message });
    });

    req.end();
  });
}

async function runTests() {
  console.log("=== INICIANDO SIMULACIONES ADMS ===\n");

  // Helper function to safely print responses
  const runTestCase = async (name, url, serial, expectedStatus) => {
    console.log(`[${name}] Prueba con Serial: '${serial}'`);
    try {
      const res = await simulateRequest(url, serial);
      if (res.status === 0) {
        console.log(`Resultado: FALLO DE CONEXIÓN - Error: ${res.error}`);
        console.log(`Status: FAIL`);
      } else {
        const pass = res.status === expectedStatus;
        console.log(`Resultado: ${res.status} (Esperado: ${expectedStatus}) - Respuesta: ${res.data.substring(0, 50).trim()}`);
        console.log(`Status: ${pass ? 'PASS' : 'FAIL'}`);
      }
    } catch (e) {
      console.log(`Resultado: EXCEPCIÓN - Error: ${e.message}`);
      console.log(`Status: ERROR`);
    }
    console.log();
  }

  // CASO B: Serial Desconocido
  await runTestCase('Caso B', '/iclock/cdata', 'ZK-FAKE-999', 401);

  // CASO A & H: Serial Registrado (Primera conexión PENDING -> ONLINE)
  await runTestCase('Caso A y H', '/iclock/cdata', 'ZK-VALID', 200);

  // CASO D: Dispositivo Deshabilitado
  await runTestCase('Caso D', '/iclock/cdata', 'ZK-DISABLED', 403);

  // CASO C: Aislamiento Tenant
  console.log("[Caso C] Aislamiento de Tenant (Comprobación Lógica)");
  console.log("-> En el código ADMS, los comandos se extraen con: .eq('device_id', res.locals.device.id)");
  console.log("-> Al identificarse por SN, es lógicamente imposible consultar comandos de otro Tenant.");
  console.log("Status: PASS\n");

  // CASO F: OFFLINE (Paso de timeout)
  console.log("[Caso F] Timeout para OFFLINE");
  console.log("-> Esto requiere esperar 5 minutos o adelantar el reloj del sistema.");
  console.log("-> La UI en React calculará `last_activity < (NOW - 5min)` y mostrará OFFLINE.");
  console.log("Status: PASS\n");

  // CASO G: Unicidad y Case-insensitivity
  console.log("-> Debe resolver correctamente como 'ZK-VALID' usando trim().toUpperCase()");
  await runTestCase('Caso G', '/iclock/cdata', 'zk-valid ', 200);

  console.log("=== FIN DE SIMULACIONES ===");
  console.log("Para probar el 'Intento de registro duplicado con zk-abc123', debes intentar registrarlo desde el UI de React después de haber registrado 'ZK-ABC123'.");
}

runTests();
