import { AttendanceEngine } from '../../domain/attendance/AttendanceEngine.ts'
import { WorkdayPersistenceService } from './WorkdayPersistenceService.ts'
import type { PersistenceResult } from './WorkdayPersistenceService.ts'
import type { ShiftWindowConfig, RawAttendancePunch } from '../../domain/attendance/AttendanceTypes.ts'

export interface ProcessWorkdayParams {
  supabaseClient: any
  clienteId: string
  empleadoId: string
  workdayDate: string // YYYY-MM-DD
  changeReason?: string
  createdBy?: string
}

export class WorkdayReprocessService {
  /**
   * Servicio para reprocesar o generar una jornada de manera manual o batch.
   * Ejecuta el pipeline completo de manera aislada y persiste el resultado.
   */
  static async processWorkday(params: ProcessWorkdayParams): Promise<PersistenceResult> {
    const { supabaseClient, clienteId, empleadoId, workdayDate, changeReason = 'MANUAL_REPROCESS', createdBy } = params

    // 0. Feature Flags check (P2-018 / P2-019)
    const readFeature = async (featureKey: string) => {
      const { data, error } = await supabaseClient.from('tenant_features').select('state').eq('cliente_id', clienteId).eq('feature_key', featureKey).single()
      return error ? 'OFF' : (data?.state || 'OFF')
    }
    const [engineState, recordState] = await Promise.all([
      readFeature('attendance_engine_v2'),
      readFeature('electronic_workday_record')
    ])
    if (engineState === 'OFF' || recordState === 'OFF') {
      return { status: 'ERROR', error: 'FEATURE_DISABLED' }
    }

    // 1. Obtain tenant timezone explicitly; only the documented fallback is used.
    const { data: tenantData, error: tenantError } = await supabaseClient
      .from('clientes')
      .select('timezone')
      .eq('id', clienteId)
      .single()

    if (tenantError || !tenantData) {
      return { status: 'ERROR', error: 'Tenant no encontrado' }
    }

    // 2. Obtener Empleado y Configuración Timezone
    const { data: empData, error: empError } = await supabaseClient
      .from('empleados')
      .select('hikvision_device_userid')
      .eq('id', empleadoId)
      .eq('cliente_id', clienteId)
      .single()

    if (empError || !empData) {
      return { status: 'ERROR', error: 'Empleado no encontrado' }
    }

    const biometricUserId = empData.hikvision_device_userid
    const timezone = tenantData.timezone || 'America/Mexico_City'

    // 3. Leer Horario (Schedule Assignment) con detección de ambigüedad (P2-017)
    const { data: assignments, error: assignError } = await supabaseClient
      .from('empleados_horarios')
      .select('id, horario_id, horarios(*), fecha_fin')
      .eq('cliente_id', clienteId)
      .eq('empleado_id', empleadoId)
      .eq('activo', true)
      .lte('fecha_inicio', workdayDate)

    if (assignError) {
      return { status: 'ERROR', error: `Error buscando asignación: ${assignError.message}` }
    }

    const validAssignments = (assignments || []).filter((a: any) => !a.fecha_fin || a.fecha_fin >= workdayDate)

    if (validAssignments.length > 1) {
      return { status: 'ERROR', error: 'AMBIGUOUS_SCHEDULE_ASSIGNMENT' }
    }

    let shiftConfig: ShiftWindowConfig | undefined = undefined
    let scheduleAssignmentId: string | undefined = undefined

    if (validAssignments.length === 1 && validAssignments[0].horarios) {
      const assignment = validAssignments[0]
      const h = assignment.horarios
      scheduleAssignmentId = assignment.id

      // Mapear configuración del día. Simplificación: asume día de la semana desde workdayDate local
      const dateObj = new Date(workdayDate + 'T12:00:00Z') // Forzar fecha correcta
      const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
      const dayKey = days[dateObj.getUTCDay()]

      const dayConfig = h.dias_config[dayKey]
      
      if (dayConfig && dayConfig.activo) {
        shiftConfig = {
          id: h.id,
          name: h.nombre,
          operativeDate: workdayDate,
          startTime: dayConfig.entrada,
          endTime: dayConfig.salida,
          toleranceMinutes: h.tolerancia_minutos,
          hasBreak: !!dayConfig.descanso_inicio && !!dayConfig.descanso_fin,
          breakConfig: dayConfig.descanso_inicio ? {
            startTime: dayConfig.descanso_inicio,
            endTime: dayConfig.descanso_fin
          } : undefined
        }
      }
    }

    // 4. Leer RAW Logs con ventana temporal acotada y Timezone-aware (P2-007)
    // Para simplificar, traemos de -12h a +24h desde el inicio del workday local
    // Idealmente, se calcula en función al horario programado
    // Date construction uses the configured tenant timezone, never the host timezone.
    const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    const offset = offsetFormatter.formatToParts(new Date(`${workdayDate}T12:00:00.000Z`)).find(p => p.type === 'timeZoneName')?.value?.replace('GMT', '') || '-06:00'
    const baseDate = new Date(`${workdayDate}T00:00:00.000${offset}`)
    const windowStart = new Date(baseDate.getTime() - (12 * 60 * 60 * 1000)).toISOString()
    const windowEnd = new Date(baseDate.getTime() + (36 * 60 * 60 * 1000)).toISOString()

    const { data: rawLogs, error: rawLogsError } = await supabaseClient
      .from('attendance_logs')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('biometric_user_id', biometricUserId)
      .gte('timestamp', windowStart)
      .lte('timestamp', windowEnd)

    if (rawLogsError) {
      return { status: 'ERROR', error: `Error leyendo RAW logs: ${rawLogsError.message}` }
    }

    const rawPunches: RawAttendancePunch[] = (rawLogs || []).map((log: any) => ({
      id: log.id,
      clienteId: log.cliente_id,
      empleadoId: empleadoId,
      timestamp: log.timestamp,
      deviceSerial: log.numero_serie,
      verifyType: log.verify_type,
      inOutState: log.in_out_state,
      rawPayload: log.raw_data
    }))

    // 5. Ejecutar AttendanceEngine
    const result = AttendanceEngine.process(
      clienteId,
      empleadoId,
      shiftConfig,
      rawPunches,
      { timezone, operativeDate: workdayDate }
    )
    // Inyectar el assignment ID resuelto para persistencia (P2-003)
    result.scheduleAssignmentId = scheduleAssignmentId
    result.sourceWindowStartUtc = windowStart
    result.sourceWindowEndUtc = windowEnd

    // 6. Persistir (Sólo persistimos si no está en OFF, SHADOW y ACTIVE comparten este flujo)
    return WorkdayPersistenceService.persistWorkday(supabaseClient, result, changeReason, createdBy)
  }
}
