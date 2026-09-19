'use strict'

const { createHash } = require('node:crypto')

const COMPLETED_CANARY = Object.freeze({
  cliente_id: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  empleado_id: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  registro_id: '5707fc4d-833a-48ab-bf49-90f5b30e0174',
  schedule_id: '5a753368-f019-4230-89e2-79beaa39ff0f',
  workday_date: '2026-09-09',
  workday_id: '5fe7ef34-7699-474b-b312-d0c5031a1fbe',
  integrity_hash: 'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49',
  calculation_version: 3,
  registro_xmin: '16338',
})

const COMPLETED_EVIDENCE_BASELINE = Object.freeze({
  workday_fingerprint: createHash('md5').update(`${COMPLETED_CANARY.workday_id}|${COMPLETED_CANARY.cliente_id}|${COMPLETED_CANARY.empleado_id}|${COMPLETED_CANARY.workday_date}|${COMPLETED_CANARY.schedule_id}|${COMPLETED_CANARY.integrity_hash}|3`).digest('hex'),
  history_fingerprint: createHash('md5').update(`${COMPLETED_CANARY.workday_id}|${COMPLETED_CANARY.cliente_id}|${COMPLETED_CANARY.empleado_id}|${COMPLETED_CANARY.workday_date}|${COMPLETED_CANARY.integrity_hash}|3|INSERTED`).digest('hex'),
})

function exactCompletedAuthorization(row) {
  const e = COMPLETED_CANARY
  return Boolean(row) && row.cliente_id === e.cliente_id && row.feature_key === 'WORKDAY_PERSIST_CANARY' &&
    row.mode === 'PERSIST_CANARY' && row.enabled === true && row.canary_registro_id === e.registro_id &&
    row.canary_empleado_id === e.empleado_id && row.canary_schedule_id === e.schedule_id && row.canary_workday_date === e.workday_date
}

function evaluateCompletedCanaryPrecheck({ authorizationRows, workday, history, registroXmin, revisionFeatureMode, activeTenantCount } = {}) {
  const totalAuthorizationRows = Array.isArray(authorizationRows) ? authorizationRows.filter((row) => row?.feature_key === 'WORKDAY_PERSIST_CANARY').length : -1
  const exactAuthorizationRows = Array.isArray(authorizationRows) ? authorizationRows.filter(exactCompletedAuthorization).length : 0
  const e = COMPLETED_CANARY
  const workdayExact = workday?.id === e.workday_id && workday?.cliente_id === e.cliente_id && workday?.empleado_id === e.empleado_id && workday?.workday_date === e.workday_date && workday?.schedule_id === e.schedule_id && workday?.integrity_hash === e.integrity_hash && workday?.calculation_version === 3
  const historyExact = history?.workday_record_id === e.workday_id && history?.cliente_id === e.cliente_id && history?.empleado_id === e.empleado_id && history?.workday_date === e.workday_date && history?.integrity_hash === e.integrity_hash && history?.calculation_version === 3 && history?.action === 'INSERTED'
  return {
    totalAuthorizationRows, exactAuthorizationRows, workdayExact, historyExact,
    safeToRetire: totalAuthorizationRows === 1 && exactAuthorizationRows === 1 && workdayExact && historyExact &&
      registroXmin === e.registro_xmin && revisionFeatureMode === 'SHADOW' && activeTenantCount === 0,
  }
}

function evaluateCompletedCanaryPostcheck({ totalAuthorizationRows, exactAuthorizationRows, workdayExact, historyExact, workday_fingerprint, history_fingerprint, registroXmin, revisionFeatureMode, activeTenantCount, incidencias, registroAsistencia, attendanceSourceEvents } = {}) {
  const businessEvidenceUnchanged = workday_fingerprint === COMPLETED_EVIDENCE_BASELINE.workday_fingerprint && history_fingerprint === COMPLETED_EVIDENCE_BASELINE.history_fingerprint
  return Boolean(totalAuthorizationRows === 0 && exactAuthorizationRows === 0 && workdayExact && historyExact && businessEvidenceUnchanged &&
    registroXmin === COMPLETED_CANARY.registro_xmin && revisionFeatureMode === 'SHADOW' && activeTenantCount === 0 &&
    incidencias === 7 && registroAsistencia === 41 && attendanceSourceEvents === 12)
}

function assertCompletedCanaryDeleteAffectedRows(affectedRows) {
  if (affectedRows !== 1) throw new Error('COMPLETED_CANARY_RETIRE_AFFECTED_ROWS_INVALID')
  return true
}

module.exports = { COMPLETED_CANARY, COMPLETED_EVIDENCE_BASELINE, exactCompletedAuthorization, evaluateCompletedCanaryPrecheck, evaluateCompletedCanaryPostcheck, assertCompletedCanaryDeleteAffectedRows }
