// src/features/biometrics/services/syncService.js
import { supabase } from '../../../lib/supabase'

export const syncService = {
  /**
   * Encola comandos de sincronización de todos los empleados activos hacia un dispositivo ZKTeco.
   * Utiliza exclusivamente empleados.device_userid (numérico) sin fallback a clave_empleado.
   */
  async syncAllEmployeesToDevice({ clienteId, deviceSerial, deviceId }) {
    if (!clienteId || !deviceSerial || !deviceId) {
      throw new Error('Cliente, dispositivo y número de serie del checador son requeridos.')
    }

    // 1. Obtener los empleados activos del cliente
    const { data: empleados, error: empError } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, device_userid, activo, cliente_id')
      .eq('cliente_id', clienteId)
      .eq('activo', true)

    if (empError) throw empError
    if (!empleados || empleados.length === 0) {
      return { total: 0, message: 'No hay colaboradores activos para sincronizar.' }
    }

    // 2. Filtrar únicamente los que tienen device_userid numérico válido
    const validEmployees = empleados.filter((emp) => {
      const pin = emp.device_userid ? String(emp.device_userid).trim() : ''
      return pin && /^\d+$/.test(pin)
    })

    if (validEmployees.length === 0) {
      throw new Error('Ningún colaborador activo tiene un device_userid numérico asignado.')
    }

    const commandsToInsert = []
    const assignmentUpserts = []

    for (const emp of validEmployees) {
      const pin = String(emp.device_userid).trim()
      const rawName = `${emp.nombre || ''} ${emp.apellido || ''}`.trim() || `User_${pin}`
      const fullName = rawName.substring(0, 20).trim()

      // Sintaxis estándar ZKTeco ADMS
      const commandString = `DATA UPDATE USERINFO Pin=${pin}\tName=${fullName}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000`

      commandsToInsert.push({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })

      assignmentUpserts.push({
        cliente_id: clienteId,
        device_id: deviceId,
        employee_id: emp.id,
        biometric_user_id: pin,
        activo: true,
        sync_status: 'PENDING',
        last_attempt_at: new Date().toISOString()
      })
    }

    // 3. Upsert en device_employee_assignments
    const { error: assignErr } = await supabase
      .from('device_employee_assignments')
      .upsert(assignmentUpserts, {
        onConflict: 'device_id,biometric_user_id'
      })

    if (assignErr) {
      console.error('[syncService.syncAllEmployeesToDevice] Error actualizando assignments:', assignErr)
      throw assignErr
    }

    // 4. Encolar comandos en device_commands
    const { error: cmdError } = await supabase
      .from('device_commands')
      .insert(commandsToInsert)

    if (cmdError) {
      console.error('[syncService.syncAllEmployeesToDevice] Error encolando comandos:', cmdError)
      throw cmdError
    }

    return {
      success: true,
      total: commandsToInsert.length
    }
  },

  /**
   * Sincroniza un único empleado hacia un dispositivo específico.
   * Utilizado en el flujo de enrolamiento para habilitar inmediatamente al colaborador.
   */
  async syncSingleEmployeeToDevice({ clienteId, deviceId, deviceSerial, employeeId, pin, fullName }) {
    if (!clienteId || !deviceId || !deviceSerial || !employeeId || !pin) {
      throw new Error('Todos los parámetros son requeridos para sincronizar al colaborador.')
    }

    const cleanPin = String(pin).trim()
    if (!/^\d+$/.test(cleanPin)) {
      throw new Error(`El PIN "${pin}" debe ser puramente numérico.`)
    }

    const safeName = (fullName || `User_${cleanPin}`).substring(0, 20).trim()
    const commandString = `DATA UPDATE USERINFO Pin=${cleanPin}\tName=${safeName}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000`

    // 1. Upsert en assignments con estado PENDING
    const { error: assignErr } = await supabase
      .from('device_employee_assignments')
      .upsert({
        cliente_id: clienteId,
        device_id: deviceId,
        employee_id: employeeId,
        biometric_user_id: cleanPin,
        activo: true,
        sync_status: 'PENDING',
        last_attempt_at: new Date().toISOString()
      }, {
        onConflict: 'device_id,biometric_user_id'
      })

    if (assignErr) throw assignErr

    // 2. Encolar comando en device_commands
    const { data: cmd, error: cmdErr } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })
      .select()
      .single()

    if (cmdErr) throw cmdErr

    return {
      success: true,
      commandId: cmd.id
    }
  },

  /**
   * Encola el comando de sincronización de fecha, hora y timezone física al ZKTeco.
   * Sintaxis oficial ZKTeco ADMS: SET OPTIONS DateTime=<unix_seconds>,TimeZone=<offset_hours>
   */
  async syncDeviceTime({ deviceSerial, timezone = 'America/Cancun' }) {
    if (!deviceSerial) {
      throw new Error('Número de serie del biométrico requerido.')
    }

    // Calcular offset numérico en horas según la zona IANA
    let tzOffset = -5
    try {
      const d = new Date()
      const str = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).format(d)
      const match = str.match(/GMT([+-]?\d+)/)
      if (match) {
        tzOffset = parseInt(match[1], 10)
      }
    } catch {
      tzOffset = -5
    }

    const unixSeconds = Math.floor(Date.now() / 1000)
    const commandString = `SET OPTIONS DateTime=${unixSeconds},TimeZone=${tzOffset}`

    const { data: cmd, error } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })
      .select()
      .single()

    if (error) {
      console.error('[syncService.syncDeviceTime] Error encolando comando de hora:', error)
      throw error
    }

    return {
      success: true,
      commandId: cmd.id,
      commandString,
      unixSeconds,
      tzOffset
    }
  },

  /**
   * Obtiene resumen de sincronización de colaboradores para una terminal.
   */
  async getDeviceSyncStats(deviceId, clienteId) {
    if (!deviceId || !clienteId) {
      return { total: 0, synced: 0, pending: 0, error: 0 }
    }

    const { data, error } = await supabase
      .from('device_employee_assignments')
      .select('sync_status')
      .eq('device_id', deviceId)
      .eq('cliente_id', clienteId)
      .eq('activo', true)

    if (error) {
      console.error('[syncService.getDeviceSyncStats] Error consultando stats:', error)
      return { total: 0, synced: 0, pending: 0, error: 0 }
    }

    const total = data.length
    const synced = data.filter(a => a.sync_status === 'SYNCED').length
    const syncing = data.filter(a => a.sync_status === 'SYNCING').length
    const pending = data.filter(a => a.sync_status === 'PENDING').length
    const err = data.filter(a => a.sync_status === 'ERROR').length

    return {
      total,
      synced,
      pending: pending + syncing,
      error: err
    }
  }
}
