import { supabase } from '../../../lib/supabase'

export const syncService = {
  /**
   * Encola comandos de sincronización de todos los empleados activos hacia un dispositivo ZKTeco.
   */
  async syncAllEmployeesToDevice({ clienteId, deviceSerial, deviceId }) {
    if (!clienteId || !deviceSerial) {
      throw new Error('Cliente y número de serie del checador son requeridos.')
    }

    // 1. Obtener los empleados activos del cliente
    const { data: empleados, error: empError } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, clave_empleado, device_userid, activo')
      .eq('cliente_id', clienteId)
      .eq('activo', true)

    if (empError) throw empError
    if (!empleados || empleados.length === 0) {
      return { total: 0, message: 'No hay colaboradores activos para sincronizar.' }
    }

    // 2. Construir los comandos ADMS respetando tabulaciones (\t)
    const commandsToInsert = []
    const assignmentUpserts = []

    for (const emp of empleados) {
      const pin = String(emp.device_userid || emp.clave_empleado || '').trim()
      if (!pin) continue

      const fullName = `${emp.nombre || ''} ${emp.apellido || ''}`.trim() || `User_${pin}`

      // Formato estricto ZKTeco: DATA UPDATE USERINFO Pin=... separado por \t
      const commandString = `DATA UPDATE USERINFO Pin=${pin}\tName=${fullName}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000`

      commandsToInsert.push({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })

      if (deviceId) {
        assignmentUpserts.push({
          device_id: deviceId,
          biometric_user_id: pin,
          sync_status: 'PENDING',
          activo: true,
          last_attempt_at: new Date().toISOString()
        })
      }
    }

    if (commandsToInsert.length === 0) {
      throw new Error('Ningún colaborador cuenta con PIN o clave de empleado válida.')
    }

    // 3. Encolar en device_commands
    const { error: cmdError } = await supabase
      .from('device_commands')
      .insert(commandsToInsert)

    if (cmdError) throw cmdError

    // 4. Actualizar estado en device_employee_assignments (si aplica en tu esquema)
    if (assignmentUpserts.length > 0) {
      await supabase
        .from('device_employee_assignments')
        .upsert(assignmentUpserts, {
          onConflict: 'device_id,biometric_user_id'
        })
    }

    return {
      success: true,
      total: commandsToInsert.length
    }
  }
}
