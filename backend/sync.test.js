// backend/sync.test.js
require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
//  Tests unitarios para el módulo de sincronización Consolide
//
//  Ejecutar: node sync.test.js
//  (sin dependencias externas de testing — usa asserts nativos de Node)
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const assert = require('assert')

// ── Importar funciones a testear ──────────────────────────────────────────────
const { normalizeEmpleado, hasChanges } = require('./employee-sync-service')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${err.message}`)
    failed++
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeEmpleado — Mapeo de campos externos → locales
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📋 normalizeEmpleado()')

test('mapea trab_ID → external_id (string)', () => {
  const result = normalizeEmpleado({ trab_ID: 70118, nombre: 'JUAN', paterno: 'GARCIA', materno: 'LOPEZ', estatus: 'activo' }, 'tenant-1')
  assert.strictEqual(result.external_id, '70118')
})

test('mapea nombre correctamente', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'MARIA', paterno: 'P', materno: 'M', estatus: 'activo' }, 't')
  assert.strictEqual(result.nombre, 'MARIA')
})

test('apellido combina paterno + materno', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'ROSALES', materno: 'CHAVEZ', estatus: 'activo' }, 't')
  assert.strictEqual(result.apellido, 'ROSALES CHAVEZ')
})

test('apellido solo paterno si materno vacío', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'GARCIA', materno: '', estatus: 'activo' }, 't')
  assert.strictEqual(result.apellido, 'GARCIA')
})

test('estatus "activo" → activo: true', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo' }, 't')
  assert.strictEqual(result.activo, true)
})

test('estatus "inactivo" → activo: false', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'inactivo' }, 't')
  assert.strictEqual(result.activo, false)
})

test('estatus case-insensitive: "ACTIVO" → activo: true', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'ACTIVO' }, 't')
  assert.strictEqual(result.activo, true)
})

test('mapea departamento', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo', departamento: 'VENTAS' }, 't')
  assert.strictEqual(result.departamento, 'VENTAS')
})

test('mapea puesto', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo', puesto: 'GERENTE' }, 't')
  assert.strictEqual(result.puesto, 'GERENTE')
})

test('mapea curp', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo', curp: 'XAXX010101HXXXXXX4' }, 't')
  assert.strictEqual(result.curp, 'XAXX010101HXXXXXX4')
})

test('mapea rfc', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo', rfc: 'XAXX010101XXX' }, 't')
  assert.strictEqual(result.rfc, 'XAXX010101XXX')
})

test('external_source siempre es "consolide"', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo' }, 't')
  assert.strictEqual(result.external_source, 'consolide')
})

test('cliente_id se asigna correctamente', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo' }, 'cliente-uuid-123')
  assert.strictEqual(result.cliente_id, 'cliente-uuid-123')
})

test('hikvision_device_userid es igual a trab_ID (como string)', () => {
  const result = normalizeEmpleado({ trab_ID: 9648, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo' }, 't')
  assert.strictEqual(result.hikvision_device_userid, '9648')
})

test('campos faltantes generan null (no undefined)', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo' }, 't')
  assert.strictEqual(result.departamento, null)
  assert.strictEqual(result.puesto, null)
  assert.strictEqual(result.curp, null)
  assert.strictEqual(result.rfc, null)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. hasChanges — Detección de cambios para evitar updates innecesarios
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔍 hasChanges()')

test('sin cambios → false', () => {
  const local      = { nombre: 'JUAN', apellido: 'GARCIA LOPEZ', apellido_materno: 'LOPEZ', departamento: 'VENTAS', puesto: 'GERENTE', curp: 'X', rfc: 'X', activo: true }
  const normalized = { nombre: 'JUAN', apellido: 'GARCIA LOPEZ', apellido_materno: 'LOPEZ', departamento: 'VENTAS', puesto: 'GERENTE', curp: 'X', rfc: 'X', activo: true }
  assert.strictEqual(hasChanges(local, normalized), false)
})

test('nombre diferente → true', () => {
  const local      = { nombre: 'JUAN', apellido: 'GARCIA', apellido_materno: null, departamento: null, puesto: null, curp: null, rfc: null, activo: true }
  const normalized = { nombre: 'PEDRO', apellido: 'GARCIA', apellido_materno: null, departamento: null, puesto: null, curp: null, rfc: null, activo: true }
  assert.strictEqual(hasChanges(local, normalized), true)
})

test('estatus activo→inactivo → true', () => {
  const local      = { nombre: 'X', apellido: 'X', apellido_materno: null, departamento: null, puesto: null, curp: null, rfc: null, activo: true }
  const normalized = { nombre: 'X', apellido: 'X', apellido_materno: null, departamento: null, puesto: null, curp: null, rfc: null, activo: false }
  assert.strictEqual(hasChanges(local, normalized), true)
})

test('departamento nuevo → true', () => {
  const local      = { nombre: 'X', apellido: 'X', apellido_materno: null, departamento: null,     puesto: null, curp: null, rfc: null, activo: true }
  const normalized = { nombre: 'X', apellido: 'X', apellido_materno: null, departamento: 'VENTAS', puesto: null, curp: null, rfc: null, activo: true }
  assert.strictEqual(hasChanges(local, normalized), true)
})

test('null vs undefined tratados igual (sin falso positivo)', () => {
  const local      = { nombre: 'X', apellido: 'X', apellido_materno: null,      departamento: null, puesto: null, curp: null, rfc: null, activo: true }
  const normalized = { nombre: 'X', apellido: 'X', apellido_materno: undefined,  departamento: null, puesto: null, curp: null, rfc: null, activo: true }
  // null vs undefined → ambos → null → sin cambio
  assert.strictEqual(hasChanges(local, normalized), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Seguridad — El token nunca debe aparecer en las funciones expuestas
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔐 Seguridad del Token')

test('normalizeEmpleado no contiene ningún token', () => {
  const result = normalizeEmpleado({ trab_ID: 1, nombre: 'X', paterno: 'X', materno: '', estatus: 'activo' }, 't')
  const serialized = JSON.stringify(result)
  assert.ok(!serialized.includes('Bearer'), 'No debe contener "Bearer"')
  assert.ok(!serialized.includes('CONSOLIDE_'), 'No debe contener nombres de env vars')
  assert.ok(!serialized.includes('accessToken'), 'No debe contener "accessToken"')
})

// ─────────────────────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────────────────`)
console.log(`  Resultados: ${passed} pasaron, ${failed} fallaron`)
console.log(`─────────────────────────────────────────────\n`)

if (failed > 0) process.exit(1)
