'use strict'

// Pure local manifest contract shared by the runner and the Phase 43 renderer.
// It intentionally has no Supabase, RPC, persistence service, or filesystem I/O.
const { assertApprovedIdentity } = require('./persist-canary-design.js')

class PersistCanaryManifestContractError extends Error {
  constructor(message, code, cause) {
    super(message)
    this.name = 'PersistCanaryManifestContractError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function unwrapEvidence(value) {
  // Canonical on-disk evidence is direct. The runner also accepts the local
  // one-property wrapper, but intentionally not Supabase's outer result array.
  return value?.persist_canary_runner_precheck || value
}

function fail(message, code) {
  throw new PersistCanaryManifestContractError(message, code)
}

function assertApprovedContractEvidence(input, approvedFingerprint) {
  const evidence = unwrapEvidence(input)
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
      evidence.phase !== '36_2_persist_canary_runner_precheck' || evidence.read_only !== 'on') {
    fail('Falta evidencia read-only válida del contrato V3.', 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED')
  }
  try {
    assertApprovedIdentity(evidence.identity)
  } catch (error) {
    throw new PersistCanaryManifestContractError(error.message, 'PERSIST_CANARY_CONTRACT_EVIDENCE_DENIED', error)
  }
  if (evidence.precheck_pass !== true || evidence.candidate_exact !== true || evidence.rpc_v3_available !== true || evidence.incident_write_path !== false ||
      evidence.target_workday_rows !== 0 || evidence.target_history_rows !== 0 ||
      evidence.exact_authorization_rows !== 1 || evidence.all_authorization_rows !== 1 ||
      typeof evidence.rpc_fingerprint !== 'string' || evidence.rpc_fingerprint.toLowerCase() !== approvedFingerprint) {
    fail('La evidencia del contrato V3 no coincide con el fingerprint aprobado.', 'PERSIST_CANARY_RPC_FINGERPRINT_BLOCKED')
  }
  return evidence
}

module.exports = {
  PersistCanaryManifestContractError,
  unwrapEvidence,
  assertApprovedContractEvidence,
}
