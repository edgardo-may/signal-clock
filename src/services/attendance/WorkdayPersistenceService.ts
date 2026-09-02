import type { WorkdayCalculationResult } from '../../domain/attendance/AttendanceTypes.ts'

export interface PersistenceResult {
  status: 'CREATED' | 'UNCHANGED' | 'UPDATED_VERSION' | 'ERROR'
  workdayRecordId?: string
  version?: number
  error?: string
}

export class WorkdayPersistenceService {
  /**
   * Persiste el resultado del motor de asistencia en la base de datos de manera
   * idempotente y segura contra concurrencia.
   *
   * @param supabaseClient - Cliente de supabase (backend, service role recomendado)
   * @param result - Resultado del cálculo de jornada
   * @param changeReason - Razón del cálculo (ej: INITIAL_CALCULATION, MANUAL_REPROCESS)
   * @param createdBy - Opcional. UUID del usuario que forzó la ejecución.
   */
  static async persistWorkday(
    supabaseClient: any,
    result: WorkdayCalculationResult,
    changeReason: string = 'INITIAL_CALCULATION',
    createdBy?: string
  ): Promise<PersistenceResult> {
    try {
      const payload = {
        cliente_id: result.clienteId,
        empleado_id: result.empleadoId,
        schedule_assignment_id: result.scheduleAssignmentId,
        workday_date: result.operativeDate,
        timezone: result.timezone,
        
        scheduled_start: result.scheduledStart,
        scheduled_end: result.scheduledEnd,
        actual_start: result.actualStart,
        actual_end: result.actualEnd,
        
        worked_minutes: result.workedMinutes,
        break_minutes: result.breakMinutes,
        effective_minutes: result.effectiveMinutes,
        
        late_minutes: result.lateMinutes,
        early_leave_minutes: result.earlyLeaveMinutes,
        
        ordinary_minutes: result.ordinaryMinutes,
        overtime_minutes: result.overtimeMinutes,
        
        workday_state: result.workdayState,
        calculation_version: result.calculationVersion,
        integrity_hash: result.integrityHash,
        
        source_log_ids: Array.from(result.sourceLogIds || []),
        source_window_start_utc: result.sourceWindowStartUtc,
        source_window_end_utc: result.sourceWindowEndUtc,
        punch_dispositions: result.punchDispositions || [],
        incidents: result.incidents || [],
        warnings: result.warnings || [],
        
        change_reason: changeReason,
        creado_por: createdBy
      }

      // Llamada segura a la RPC en PostgreSQL que maneja la concurrencia
      // y la inserción transaccional en history.
      const { data, error } = await supabaseClient.rpc('upsert_workday_record', {
        payload: payload
      })

      if (error) {
        return {
          status: 'ERROR',
          error: `RPC Error: ${error.message} - ${error.details || ''}`
        }
      }

      return {
        status: data.status,
        workdayRecordId: data.workday_record_id,
        version: data.version
      }

    } catch (err: any) {
      return {
        status: 'ERROR',
        error: `Unexpected error: ${err.message}`
      }
    }
  }
}
