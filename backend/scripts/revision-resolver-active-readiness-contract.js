'use strict'

const ACTIVE_READINESS = Object.freeze({
  tenant_id: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  employee_id: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  assignment_id: '2984316c-1c93-4f66-853e-349f90b9f82c',
  schedule_id: '5a753368-f019-4230-89e2-79beaa39ff0f',
  operative_date: '2026-09-09',
  revision_id: '09df6a75-e231-4654-ae70-8448bdf2c312',
  revision_hash: '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866',
  workday_id: '5fe7ef34-7699-474b-b312-d0c5031a1fbe',
  workday_hash: 'ec6d5100a838e87181c9c410bb3011cfbfe12349468db9517753d094cc086d49',
  workday_fingerprint: '668e4ccfa75a027b5fcc47d4963a06d1',
  history_fingerprint: '0f87f945e84a9747e5bc275660bc7c0a',
  runtime_version: 'attendance-runtime-v1',
  runtime_build_sha: '6a36e31633594c4b256b03b5d3ca02a72ed8874d8b941a37affa1723e34c6d66',
  rpc_fingerprint: 'a66376e83b8162084b2219d17ebdaadd',
})

function evaluateActiveReadiness(state = {}) {
  const e = ACTIVE_READINESS
  const databasePass = state.featureMode === 'SHADOW' && state.featureEnabled === true && state.activeTenantCount === 0 &&
    state.persistAuthorizationRows === 0 && state.applicableAssignmentCount === 1 && state.ambiguousAssignmentCount === 0 &&
    state.assignmentId === e.assignment_id && state.revisionId === e.revision_id && state.revisionVersion === 1 && state.revisionHash === e.revision_hash &&
    state.workdayRows === 1 && state.historyRows === 1 && state.workdayId === e.workday_id && state.workdayHash === e.workday_hash &&
    state.calculationVersion === 3 && state.workdayFingerprint === e.workday_fingerprint && state.historyFingerprint === e.history_fingerprint &&
    state.rpcFingerprint === e.rpc_fingerprint && state.liveScheduleFallbackDetected === false
  const runtimePass = state.runtimeVersion === e.runtime_version && state.runtimeBuildSha === e.runtime_build_sha && state.runtimeHealth === true
  return { databasePass, runtimePass, activeReadiness: databasePass && runtimePass }
}

module.exports = { ACTIVE_READINESS, evaluateActiveReadiness }
