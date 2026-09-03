// src/features/biometrics/services/syncService.js
import { supabase } from '../../../lib/supabase'

/**
 * Normaliza y trunca el nombre al estándar admitido por los firmwares ZKTeco (ASCII/24 caracteres).
 */
function sanitizeZkName(nombre = '', apellido = '') {
  const full = `${nombre} ${apellido}`.trim()
  return full
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos y diacríticos
    .replace(/[^\w\s.-]/gi, '')     // Caracteres seguros
    .slice(0, 24)
    .trim()
}

export const syncService = {
  /**
   * Valida si un dispositivo está físicamente conectado y enviando heartbeats (ventana de 120s).
   */
  async checkDeviceOnline(deviceId) {
    const { data: device, error } = await supabase
      .from('devices')
      .select('id, serial_number, is_online, last_heartbeat')
      .eq('id', deviceId)
      .single()

    if (error || !device) {
      throw new Error('No se pudo verificar el estado del dispositivo.')
    }

    const lastSeen = device.last_heartbeat ? new Date(device.last_heartbeat).getTime() : 0
    const now = Date.now()
    const isOnline = Boolean(device.is_online) && (now - lastSeen <= 120000)

    return {
      isOnline,
      serialNumber: device.serial_number,
      lastHeartbeat: device.last_heartbeat
    }
  },

  /**
   * Encola comandos de sincronización de todos los empleados activos hacia un dispositivo ZKTeco.
   * Si el dispositivo está OFFLINE, aborta la sincronización para evitar saturar la cola.
   */
  async syncAllEmployeesToDevice({ clienteId, deviceSerial, deviceId }) {
    if (!clienteId || !deviceSerial || !deviceId) {
      throw new Error('Cliente, dispositivo y número de serie del checador son requeridos.')
    }

    // 1. Validar si el checador está online
    const { isOnline } = await this.checkDeviceOnline(deviceId)
    if (!isOnline) {
      return {
        success: false,
        skipped: true,
        message: `El dispositivo (${deviceSerial}) se encuentra fuera de línea. Sincronización omitida.`
      }
    }

    // 2. Obtener los empleados activos del cliente
    const { data: empleados, error: empError } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, device_userid, activo, cliente_id')
      .eq('cliente_id', clienteId)
      .eq('activo', true)

    if (empError) throw empError
    if (!empleados || empleados.length === 0) {
      return { total: 0, message: 'No hay colaboradores activos para sincronizar.' }
    }

    // 3. Filtrar únicamente los que tienen device_userid numérico válido
    const validEmployees = empleados.filter((emp) => {
      const pin = emp.device_userid ? String(emp.device_userid).trim() : ''
      return pin && /^\d+$/.test(pin)
    })

    if (validEmployees.length === 0) {
      throw new Error('Ningún colaborador activo tiene un device_userid numérico asignado.')
    }

    const assignmentUpserts = []
    const commandInserts = []
    const nowIso = new Date().toISOString()

    for (const emp of validEmployees) {
      const pin = String(emp.device_userid).trim()
      const cleanName = sanitizeZkName(emp.nombre, emp.apellido)

      assignmentUpserts.push({
        cliente_id: clienteId,
        device_id: deviceId,
        employee_id: emp.id,
        biometric_user_id: pin,
        activo: true,
        sync_status: 'PENDING',
        last_attempt_at: nowIso
      })

      // Comando formal ZKTeco Push ADMS con tabuladores (\t)
      commandInserts.push({
        device_serial: deviceSerial,
        command_string: `DATA UPDATE USERINFO PIN=${pin}\tName=${cleanName}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000`,
        is_executed: false
      })
    }

    // 4. Actualizar asignaciones
    const { error: assignErr } = await supabase
      .from('device_employee_assignments')
      .upsert(assignmentUpserts, {
        onConflict: 'device_id,biometric_user_id'
      })

    if (assignErr) {
      console.error('[syncService.syncAllEmployeesToDevice] Error actualizando assignments:', assignErr)
      throw assignErr
    }

    // 5. Encolar comandos hacia el biométrico
    const { error: cmdErr } = await supabase
      .from('device_commands')
      .insert(commandInserts)

    if (cmdErr) {
      console.error('[syncService.syncAllEmployeesToDevice] Error insertando comandos:', cmdErr)
      throw cmdErr
    }

    return {
      success: true,
      total: commandInserts.length,
      message: `Se encolaron ${commandInserts.length} colaboradores para el biométrico ${deviceSerial}.`
    }
  },

  /**
   * Sincroniza un único empleado hacia un dispositivo específico.
   */
  async syncSingleEmployeeToDevice({ clienteId, deviceId, deviceSerial, employeeId, pin }) {
    if (!clienteId || !deviceId || !deviceSerial || !employeeId || !pin) {
      throw new Error('Todos los parámetros son requeridos para sincronizar al colaborador.')
    }

    const cleanPin = String(pin).trim()
    if (!/^\d+$/.test(cleanPin)) {
      throw new Error(`El PIN "${pin}" debe ser puramente numérico.`)
    }

    // 1. Validar si el checador está online
    const { isOnline } = await this.checkDeviceOnline(deviceId)
    if (!isOnline) {
      return {
        success: false,
        skipped: true,
        message: `El dispositivo (${deviceSerial}) está fuera de línea. No se encoló la sincronización.`
      }
    }

    // 2. Obtener datos del empleado para armar el comando
    const { data: emp, error: empErr } = await supabase
      .from('empleados')
      .select('nombre, apellido')
      .eq('id', employeeId)
      .single()

    if (empErr || !emp) {
      throw new Error('No se encontró la información del colaborador a sincronizar.')
    }

    const cleanName = sanitizeZkName(emp.nombre, emp.apellido)

    // 3. Upsert en assignments con estado PENDING
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

    // 4. Insertar comando en la cola
    const { error: cmdErr } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: `DATA UPDATE USERINFO PIN=${cleanPin}\tName=${cleanName}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000`,
        is_executed: false
      })

    if (cmdErr) throw cmdErr

    return {
      success: true
    }
  },

  /**
   * Encola el comando de sincronización de fecha, hora y timezone física al ZKTeco.
   */
  async syncDeviceTime({ deviceSerial, timezone = 'America/Cancun' }) {
    if (!deviceSerial) {
      throw new Error('Número de serie del biométrico requerido.')
    }

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
