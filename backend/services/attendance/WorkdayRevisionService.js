'use strict'

class WorkdayRevisionService {
  constructor(backendRpcClient) { this.client = backendRpcClient }
  async _call(name, params) {
    const { data, error } = await this.client.rpc(name, params)
    if (error) {
      const failure = new Error(error.message)
      failure.code = error.message
      try { Object.assign(failure, JSON.parse(error.details || '{}')) } catch {}
      throw failure
    }
    const rows = Array.isArray(data) ? data : [data]
    if (rows.length !== 1 || !rows[0]) throw new Error('WORKDAY_REVISION_RESPONSE_INVALID')
    return rows[0]
  }
  createCandidate(record, snapshot) {
    return this._call('create_workday_revision_candidate', {
      p_cliente_id: record.cliente_id, p_empleado_id: record.empleado_id, p_workday_date: record.workday_date,
      p_snapshot: snapshot, p_evidence_manifest: record.evidence_manifest, p_context_manifest: record.context_manifest,
      p_source_observed_at: record.source_observed_at, p_source_event_count: record.source_event_count,
    })
  }
  promote({ clienteId, empleadoId, workdayDate, candidateRevisionId, expectedCurrentRevisionId, expectedEvidenceFingerprint }) {
    return this._call('promote_workday_revision', {
      p_cliente_id: clienteId, p_empleado_id: empleadoId, p_workday_date: workdayDate,
      p_candidate_revision_id: candidateRevisionId, p_expected_current_revision_id: expectedCurrentRevisionId,
      p_expected_evidence_fingerprint: expectedEvidenceFingerprint,
    })
  }
}
module.exports = { WorkdayRevisionService }
