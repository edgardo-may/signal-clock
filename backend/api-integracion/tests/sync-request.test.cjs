const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRequest } = require('../sync-request');

test('General query includes historical movements from 2020', () => {
  const request = normalizeRequest({ targetClienteId: 'tenant' }, new Date('2026-10-08T16:00:00Z'));
  assert.equal(request.fechaInicio, '2020-01-01');
  assert.equal(request.fechaFin, '2026-10-08');
  assert.equal(request.targetClienteId, 'tenant');
});
test('Individual query uses the same historical range', () => {
  const request = normalizeRequest({ trabId: '70118' }, new Date('2026-10-08T16:00:00Z'));
  assert.equal(request.fechaInicio, '2020-01-01');
  assert.equal(request.fechaFin, '2026-10-08');
  assert.equal(request.trabId, '70118');
});
test('End date follows Cancun before and at local midnight', () => {
  assert.equal(normalizeRequest({}, new Date('2026-10-09T04:59:59Z')).fechaFin, '2026-10-08');
  assert.equal(normalizeRequest({}, new Date('2026-10-09T05:00:00Z')).fechaFin, '2026-10-09');
});
test('Explicit caller date ranges are preserved', () => {
  const request = normalizeRequest({ fechaInicio: '2015-01-01', fechaFin: '2026-09-30' });
  assert.equal(request.fechaInicio, '2015-01-01');
  assert.equal(request.fechaFin, '2026-09-30');
});
test('Partial date ranges default only the missing boundary', () => {
  const now = new Date('2026-10-08T16:00:00Z');
  assert.equal(normalizeRequest({ fechaInicio: '2019-01-01' }, now).fechaFin, '2026-10-08');
  assert.equal(normalizeRequest({ fechaFin: '2025-12-31' }, now).fechaInicio, '2020-01-01');
});
