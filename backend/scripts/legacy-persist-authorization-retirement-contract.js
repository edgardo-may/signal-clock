'use strict'

// Pure guard model for Phases 65b–65d. It has no database, network, or writer.
const LEGACY_AUTHORIZATION = Object.freeze({
  cliente_id: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  feature_key: 'WORKDAY_PERSIST_CANARY',
  mode: 'PERSIST_CANARY',
  enabled: true,
  canary_registro_id: '7f99cef9-4100-48ff-9aaf-68548c80c948',
  canary_empleado_id: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  canary_schedule_id: 'be4035c8-042c-473b-b25d-b5bf3fb99701',
  canary_workday_date: '2026-09-03',
})

const NEW_CANARY = Object.freeze({
  canary_registro_id: '5707fc4d-833a-48ab-bf49-90f5b30e0174',
  canary_schedule_id: '5a753368-f019-4230-89e2-79beaa39ff0f',
  canary_workday_date: '2026-09-09',
})

const APPROVED_RETIRED_BASELINE = Object.freeze({
  legacy_workday_rows: 0,
  legacy_history_rows: 0,
  legacy_workday_fingerprint: 'd41d8cd98f00b204e9800998ecf8427e',
  legacy_history_fingerprint: 'd41d8cd98f00b204e9800998ecf8427e',
})

const APPROVED_PREMATURE_BASELINE = Object.freeze({
  target_workday_rows: 0,
  target_history_rows: 0,
  target_workday_fingerprint: 'd41d8cd98f00b204e9800998ecf8427e',
  target_history_fingerprint: 'd41d8cd98f00b204e9800998ecf8427e',
})

class LegacyPersistAuthorizationRetirementError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'LegacyPersistAuthorizationRetirementError'
    this.code = code
  }
}

function exactLegacyRow(row) {
  return Boolean(row) && Object.entries(LEGACY_AUTHORIZATION).every(([field, value]) => row[field] === value)
}

function exactNewAuthorization(row) {
  return Boolean(row) && row.feature_key === 'WORKDAY_PERSIST_CANARY' &&
    Object.entries(NEW_CANARY).every(([field, value]) => row[field] === value)
}

function evaluateRetirementPrecheck({ authorizationRows, revisionFeatureMode, activeTenantCount } = {}) {
  if (!Array.isArray(authorizationRows)) throw new LegacyPersistAuthorizationRetirementError('Se requiere el inventario de autorizaciones.', 'LEGACY_RETIRE_PRECHECK_INVALID')
  const globalCount = authorizationRows.filter((row) => row?.feature_key === 'WORKDAY_PERSIST_CANARY').length
  const exactLegacyCount = authorizationRows.filter(exactLegacyRow).length
  const newAuthorizationCount = authorizationRows.filter(exactNewAuthorization).length
  return {
    globalCount,
    exactLegacyCount,
    newAuthorizationCount,
    revisionFeatureMode,
    activeTenantCount,
    safeToRetire: globalCount === 1 && exactLegacyCount === 1 && newAuthorizationCount === 0 &&
      revisionFeatureMode === 'SHADOW' && activeTenantCount === 0,
  }
}

function assertSingleRetirementDelete(affectedRows) {
  if (affectedRows !== 1) {
    throw new LegacyPersistAuthorizationRetirementError('El retiro debe afectar exactamente una autorización legacy.', 'LEGACY_RETIRE_AFFECTED_ROWS_INVALID')
  }
  return true
}

function exactApprovedBaseline(baseline) {
  return Boolean(baseline) && Object.entries(APPROVED_RETIRED_BASELINE).every(([field, value]) => baseline[field] === value)
}

function evaluateRetirementPostcheck({ baseline, current } = {}) {
  const baselineValid = exactApprovedBaseline(baseline)
  const businessUnchanged = baselineValid && current &&
    current.legacy_workday_rows === baseline.legacy_workday_rows &&
    current.legacy_history_rows === baseline.legacy_history_rows &&
    current.legacy_workday_fingerprint === baseline.legacy_workday_fingerprint &&
    current.legacy_history_fingerprint === baseline.legacy_history_fingerprint
  return {
    baselineValid,
    businessUnchanged: Boolean(businessUnchanged),
    safeToRerunPhase65: Boolean(businessUnchanged && current.legacy_authorization_rows === 0 &&
      current.total_authorization_rows === 0 && current.new_authorization_rows === 0 &&
      current.revisionFeatureMode === 'SHADOW' && current.activeTenantCount === 0),
  }
}

function exactPrematureNewAuthorization(row) {
  return Boolean(row) && row.cliente_id === LEGACY_AUTHORIZATION.cliente_id &&
    row.feature_key === 'WORKDAY_PERSIST_CANARY' && row.mode === 'PERSIST_CANARY' && row.enabled === true &&
    row.canary_empleado_id === LEGACY_AUTHORIZATION.canary_empleado_id &&
    Object.entries(NEW_CANARY).every(([field, value]) => row[field] === value)
}

function evaluatePrematureAuthorizationPrecheck({ authorizationRows, targetWorkdayRows, targetHistoryRows, revisionFeatureMode, activeTenantCount } = {}) {
  if (!Array.isArray(authorizationRows)) throw new LegacyPersistAuthorizationRetirementError('Se requiere el inventario de autorizaciones.', 'PREMATURE_AUTH_PRECHECK_INVALID')
  const totalAuthorizationRows = authorizationRows.filter((row) => row?.feature_key === 'WORKDAY_PERSIST_CANARY').length
  const exactAuthorizationRows = authorizationRows.filter(exactPrematureNewAuthorization).length
  return {
    totalAuthorizationRows,
    exactAuthorizationRows,
    targetWorkdayRows,
    targetHistoryRows,
    revisionFeatureMode,
    activeTenantCount,
    safeToRetire: totalAuthorizationRows === 1 && exactAuthorizationRows === 1 &&
      targetWorkdayRows === 0 && targetHistoryRows === 0 && revisionFeatureMode === 'SHADOW' && activeTenantCount === 0,
  }
}

function evaluatePrematureRetirementChange({ authorizationRows, targetWorkdayRows, targetHistoryRows, revisionFeatureMode, activeTenantCount } = {}) {
  const precheck = evaluatePrematureAuthorizationPrecheck({ authorizationRows, targetWorkdayRows, targetHistoryRows, revisionFeatureMode, activeTenantCount })
  return { ...precheck, deleteAllowed: precheck.safeToRetire }
}

function evaluatePrematureRetirementPostcheck({ baseline, current } = {}) {
  const baselineValid = Boolean(baseline) && Object.entries(APPROVED_PREMATURE_BASELINE).every(([field, value]) => baseline[field] === value)
  const businessUnchanged = baselineValid && current && Object.entries(APPROVED_PREMATURE_BASELINE).every(([field, value]) => current[field] === value)
  return {
    baselineValid,
    businessUnchanged: Boolean(businessUnchanged),
    safeToRerunPhase65: Boolean(businessUnchanged && current.total_authorization_rows === 0 &&
      current.premature_authorization_rows === 0 && current.revisionFeatureMode === 'SHADOW' && current.activeTenantCount === 0),
  }
}

module.exports = {
  LEGACY_AUTHORIZATION,
  NEW_CANARY,
  APPROVED_RETIRED_BASELINE,
  APPROVED_PREMATURE_BASELINE,
  LegacyPersistAuthorizationRetirementError,
  exactLegacyRow,
  exactNewAuthorization,
  evaluateRetirementPrecheck,
  assertSingleRetirementDelete,
  exactApprovedBaseline,
  evaluateRetirementPostcheck,
  exactPrematureNewAuthorization,
  evaluatePrematureAuthorizationPrecheck,
  evaluatePrematureRetirementChange,
  evaluatePrematureRetirementPostcheck,
}
