import { AttendanceEngine } from '../../domain/attendance/AttendanceEngine.ts'
import { WorkdayPersistenceService } from './WorkdayPersistenceService.ts'
import type { PersistenceResult } from './WorkdayPersistenceService.ts'
import type { ShiftWindowConfig, RawAttendancePunch } from '../../domain/attendance/AttendanceTypes.ts'

export interface ProcessWorkdayParams {
  supabaseClient: any
  clienteId: string
  empleadoId: string
  workdayDate: string
  changeReason?: string
  createdBy?: string
}

export class WorkdayReprocessService {
  /**
   * Servicio para reprocesar o generar una jornada de manera manual.
   * Ejecuta el pipeline completo de manera aislada y persiste el resultado.
   */
  static async processWorkday(params: ProcessWorkdayParams): Promise<PersistenceResult> {
    const { supabaseClient, clienteId, empleadoId, workdayDate, changeReason = 'MANUAL_REPROCESS', createdBy } = params

    // 1. Leer RAW Logs
    // Se requieren los logs del empleado para una ventana que cubra el día operativo.
    // Como simplificación inicial: leemos el día completo en UTC.
    // Para producción se debe usar una ventana de -12h a +24h según el timezone del empleado.
    const { data: logsData, error: logsError } = await supabaseClient
      .from('attendance_logs')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('biometric_user_id', empleadoId) // Asumiendo que están mapeados por biometric_user_id temporalmente, O un join. 
      // NOTA: Para FASE 2, el mapeo exacto de biometric_user_id puede requerir leer la tabla empleados.
      // Ajustamos:
    
    // Primero obtener el empleado para su timezone (si existe) y biometric ID
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
    // Default timezone for Mexico
    const timezone = 'America/Mexico_City' 

    const { data: rawLogs, error: rawLogsError } = await supabaseClient
      .from('attendance_logs')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('biometric_user_id', biometricUserId)
      // Idealmente aquí se filtra por un rango de fechas.

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

    // 2. Leer Horario
    // Buscamos si el empleado tiene un horario asignado activo en esa fecha
    const { data: assignmentData, error: assignError } = await supabaseClient
      .from('empleados_horarios')
      .select('horario_id, horarios(*)')
      .eq('cliente_id', clienteId)
      .eq('empleado_id', empleadoId)
      .eq('activo', true)
      .lte('fecha_inicio', workdayDate)
      .limit(1)
      .maybeSingle()
      
    let shiftConfig: ShiftWindowConfig | undefined = undefined
    
    if (assignmentData && assignmentData.horarios) {
      const h = assignmentData.horarios
      // Mapear configuración del día. Simplificación: asume día de la semana desde workdayDate
      const dateObj = new Date(workdayDate)
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

    // 3. Ejecutar AttendanceEngine
    const result = AttendanceEngine.process(
      clienteId,
      empleadoId,
      shiftConfig, // puede ser undefined para UNSCHEDULED
      rawPunches,
      { timezone, operativeDate: workdayDate }
    )

    // 4. Persistir
    return WorkdayPersistenceService.persistWorkday(supabaseClient, result, changeReason, createdBy)
  }
}
