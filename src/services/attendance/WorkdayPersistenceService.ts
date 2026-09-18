/**
 * Compatibility guard for the historical shared WorkdayPersistenceService.
 *
 * The real persistence implementation moved to
 * backend/services/attendance/WorkdayPersistenceService.js in Phase 27.
 * This shared src/ module must never receive a service-role client because src/
 * is reachable by browser build tooling. Keeping a fail-closed guard avoids an
 * accidental client-side write while WorkdayReprocessService is replaced later.
 */

export interface PersistenceResult {
  status: 'ERROR'
  error: string
}

export class WorkdayPersistenceService {
  static async persistWorkday(
    _backendClient?: unknown,
    _legacyResult?: unknown,
    _changeReason?: unknown,
    _createdBy?: unknown
  ): Promise<PersistenceResult> {
    return {
      status: 'ERROR',
      error: 'WORKDAY_PERSISTENCE_SERVER_ONLY',
    }
  }
}
