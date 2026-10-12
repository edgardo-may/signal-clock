import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextPunch, getPunchDay } from '../../src/features/employee/services/punchFlow.js';

const punch = (tipo, minute = 0) => ({
  tipo_verificacion: tipo,
  verificado_at: new Date(Date.UTC(2026, 9, 11, 1, minute)).toISOString(),
});

test('Con descanso recorre los cuatro pasos y no permite otra entrada después de salir', () => {
  const saved = [];
  for (const step of ['entrada', 'descanso_inicio', 'descanso_fin', 'salida']) {
    assert.equal(getNextPunch(saved, true), step);
    saved.push(punch(step, saved.length));
  }
  assert.equal(getNextPunch(saved, true), null);
});

test('Sin descanso pasa directamente de entrada a salida', () => {
  assert.equal(getNextPunch([], false), 'entrada');
  assert.equal(getNextPunch([punch('entrada')], false), 'salida');
  assert.equal(getNextPunch([punch('entrada'), punch('salida', 30)], false), null);
});

test('Restaura el paso desde registros guardados sin depender del orden recibido', () => {
  const saved = [punch('descanso_fin', 20), punch('entrada'), punch('descanso_inicio', 10)];
  assert.equal(getNextPunch(saved, true), 'salida');
  assert.equal(saved[0].tipo_verificacion, 'descanso_fin');
});

test('Un descanso iniciado se termina aunque el horario actual no indique descanso', () => {
  assert.equal(getNextPunch([punch('descanso_inicio')], false), 'descanso_fin');
});

test('Marcaje desconocido no habilita una acción incorrecta', () => {
  assert.equal(getNextPunch([punch('desconocido')], true), null);
});

test('Cancún conserva el día y las checadas al pasar medianoche UTC', () => {
  const before = getPunchDay('2026-10-10T23:59:00Z', 'America/Cancun');
  const after = getPunchDay('2026-10-11T01:00:36Z', 'America/Cancun');
  assert.deepEqual(before, after);
  assert.equal(after.localDate, '2026-10-10');
  assert.equal(after.weekday, 'sab');
  assert.equal(after.start, '2026-10-10T05:00:00.000Z');
  assert.equal(after.end, '2026-10-11T05:00:00.000Z');
});

test('El siguiente día comienza a medianoche local', () => {
  const day = getPunchDay('2026-10-11T05:00:00Z', 'America/Cancun');
  assert.equal(day.localDate, '2026-10-11');
  assert.equal(day.weekday, 'dom');
});
