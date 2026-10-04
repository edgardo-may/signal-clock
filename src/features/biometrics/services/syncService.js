// src/features/biometrics/services/syncService.js
import { supabase } from '../../../lib/supabase'

/**
 * Normaliza y trunca el nombre al estándar admitido por los firmwares ZKTeco (ASCII / max 24 caracteres).
 */
function sanitizeZkName(nombre = '', apellido = '') {
  const full = `${nombre} ${apellido}`.trim()
  return full
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
    .replace(/[^\w\s.-]/gi, '')      // Caracteres alfanuméricos seguros
    .slice(0, 24)
    .trim()
}

/**
 * Fail-closed guard: rechaza cualquier valor que no sea un template biométrico real.
 *
 * La BD puede contener registros con template_data = 'PENDING' o 'ERROR'
 * durante el proceso de enrolamiento. Esos valores NUNCA deben enviarse al
 * dispositivo como payload de FINGERTMP o BIOPHOTO.
 *
 * Un template real de ZKTeco ocupa cientos de bytes codificados en base64/hex;
 * exigimos un mínimo de 20 caracteres como barrera de cordura.
 */
function isValidTemplateData(tmplData) {
  if (!tmplData) return false
  if (typeof tmplData !== 'string') return false
  const t = tmplData.trim()
  if (t === '') return false
  if (t === 'PENDING') return false
  if (t === 'ERROR') return false
  if (t === 'NULL') return false
  // Real ZKTeco templates are hundreds of encoded bytes.
  // A string shorter than 20 chars is never a valid template.
  if (t.length < 20) return false
  return true
}

export const syncService = {
  /**
   * Valida si un dispositivo está físicamente conectado según su last_activity.
   */
  async checkDeviceOnline(deviceId, clienteId) {
    const { data: device, error } = await supabase
      .from('devices')
      .select('id, serial_number, is_active, last_activity')
      .eq('id', deviceId)
      .eq('cliente_id', clienteId)
      .single()

    if (error || !device) {
      throw new Error('No se pudo verificar el estado del checador.')
    }

    const lastSeen = device.last_activity ? new Date(device.last_activity).getTime() : 0
    const now = Date.now()
    const diffSeconds = Math.round((now - lastSeen) / 1000)
    const isOnline = Boolean(device.is_active) && (diffSeconds <= 180)

    return {
      isOnline,
      diffSeconds,
      serialNumber: device.serial_number,
      lastActivity: device.last_activity
    }
  },

  /**
   * Encola comandos de sincronización masiva (USERINFO, FINGERTMP, BIOPHOTO).
   */
  async syncAllEmployeesToDevice({ clienteId, deviceSerial, deviceId }) {
    if (!clienteId || !deviceSerial || !deviceId) {
      throw new Error('Cliente, dispositivo y número de serie del checador son requeridos.')
    }

    const { isOnline, diffSeconds } = await this.checkDeviceOnline(deviceId, clienteId)
    if (!isOnline) {
      return {
        success: false,
        skipped: true,
        message: `El dispositivo ${deviceSerial} está fuera de línea (último contacto hace ${diffSeconds}s). Sincronización omitida.`
      }
    }

    const { data: empleados, error: empError } = await supabase
      .from('empleados')
      .select('id, device_userid')
      .eq('cliente_id', clienteId)
      .eq('activo', true)

    if (empError) throw empError
    if (!empleados || empleados.length === 0) {
      return { total: 0, message: 'No hay colaboradores activos para sincronizar.' }
    }

    const validEmployees = empleados.filter((emp) => {
      const pin = emp.device_userid ? String(emp.device_userid).trim() : ''
      return pin && /^\d+$/.test(pin)
    })

    if (validEmployees.length === 0) {
      throw new Error('Ningún colaborador activo tiene un ID biométrico numérico asignado.')
    }

    const employeeIds = validEmployees.map(e => e.id)

    // Obtener templates biométricos filtrados por device_id.
    // CRITICAL: se filtra por device_id para que un template enrolado en un
    // dispositivo físico distinto no se envíe a este checador.
    const { data: templates } = await supabase
      .from('biometric_templates')
      .select('empleado_id, tipo, indice, template_data')
      .eq('cliente_id', clienteId)
      .eq('device_id', deviceId)
      .in('empleado_id', employeeIds)

    const templatesByEmp = (templates || []).reduce((acc, curr) => {
      if (!acc[curr.empleado_id]) acc[curr.empleado_id] = []
      acc[curr.empleado_id].push(curr)
      return acc
    }, {})

    const commandInserts = []
    const nowIso = new Date().toISOString()

    for (const emp of validEmployees) {
      const pin = String(emp.device_userid).trim()
      // Registrar o actualizar asignación individualmente de forma segura
      const { data: existingAssign } = await supabase
        .from('device_employee_assignments')
        .select('id')
        .eq('device_id', deviceId)
        .eq('employee_id', emp.id)
        .eq('cliente_id', clienteId)
        .maybeSingle()

      if (existingAssign?.id) {
        await supabase
          .from('device_employee_assignments')
          .update({
            biometric_user_id: pin,
            activo: true,
            sync_status: 'PENDING',
            last_attempt_at: nowIso
          })
          .eq('id', existingAssign.id)
      } else {
        await supabase
          .from('device_employee_assignments')
          .insert({
            cliente_id: clienteId,
            device_id: deviceId,
            employee_id: emp.id,
            biometric_user_id: pin,
            activo: true,
            sync_status: 'PENDING',
            last_attempt_at: nowIso
          })
      }

      // USERINFO is enqueued only by proc_sync_employee_assignment when the
      // assignment above changes. Templates remain separate ADMS operations.
      const empTemplates = templatesByEmp[emp.id] || []
      for (const tmpl of empTemplates) {
        // Fail-closed: PENDING, ERROR, vacío o stub nunca llegan al hardware.
        if (!isValidTemplateData(tmpl.template_data)) continue

        const tipo = (tmpl.tipo || '').toLowerCase().trim()
        if (tipo === 'huella' || tipo === 'fingerprint') {
          const fid = tmpl.indice ?? 0
          const size = tmpl.template_data.length
          commandInserts.push({
            device_serial: deviceSerial,
            command_string: `DATA UPDATE FINGERTMP PIN=${pin}\tFID=${fid}\tSize=${size}\tValid=1\tTMP=${tmpl.template_data}`,
            is_executed: false
          })
        } else if (tipo === 'rostro' || tipo === 'face') {
          const byteSize = Math.round((tmpl.template_data.length * 3) / 4)
          commandInserts.push({
            device_serial: deviceSerial,
            command_string: `DATA UPDATE BIOPHOTO PIN=${pin}\tType=9\tSize=${byteSize}\tContent=${tmpl.template_data}`,
            is_executed: false
          })
        }
      }
    }

    // Inserción en bloques de 30 para evitar límites de tamaño de paquete
    const CHUNK_SIZE = 30
    for (let i = 0; i < commandInserts.length; i += CHUNK_SIZE) {
      const chunk = commandInserts.slice(i, i + CHUNK_SIZE)
      const { error: cmdErr } = await supabase
        .from('device_commands')
        .insert(chunk)

      if (cmdErr) throw cmdErr
    }

    return {
      success: true,
      totalEmployees: validEmployees.length,
      totalCommands: validEmployees.length + commandInserts.length,
      message: `Se encolaron ${validEmployees.length} USERINFO canónicos y ${commandInserts.length} órdenes de template para el checador ${deviceSerial}.`
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

    const { isOnline, diffSeconds } = await this.checkDeviceOnline(deviceId, clienteId)
    if (!isOnline) {
      return {
        success: false,
        skipped: true,
        message: `El dispositivo ${deviceSerial} está fuera de línea (hace ${diffSeconds}s). Operación omitida.`
      }
    }

    const { data: emp, error: empErr } = await supabase
      .from('empleados')
      .select('id')
      .eq('id', employeeId)
      .eq('cliente_id', clienteId)
      .single()

    if (empErr || !emp) throw new Error('No se encontró la información del colaborador.')

    // Actualizar o crear asignación evitando error de onConflict
    const { data: existingAssign } = await supabase
      .from('device_employee_assignments')
      .select('id')
      .eq('device_id', deviceId)
      .eq('employee_id', employeeId)
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (existingAssign?.id) {
      await supabase
        .from('device_employee_assignments')
        .update({
          biometric_user_id: cleanPin,
          activo: true,
          sync_status: 'PENDING',
          last_attempt_at: new Date().toISOString()
        })
        .eq('id', existingAssign.id)
    } else {
      await supabase
        .from('device_employee_assignments')
        .insert({
          cliente_id: clienteId,
          device_id: deviceId,
          employee_id: employeeId,
          biometric_user_id: cleanPin,
          activo: true,
          sync_status: 'PENDING',
          last_attempt_at: new Date().toISOString()
        })
    }

    // Templates biométricos — filtrados por device_id (mismo dispositivo que enroló).
    // CRITICAL: filtrar por device_id impide enviar un template de device A a device B.
    const { data: empTemplates } = await supabase
      .from('biometric_templates')
      .select('tipo, indice, template_data')
      .eq('empleado_id', employeeId)
      .eq('cliente_id', clienteId)
      .eq('device_id', deviceId)

    // The assignment update above is the only USERINFO producer.
    const commandsToInsert = []

    for (const tmpl of (empTemplates || [])) {
      // Fail-closed: PENDING, ERROR, vacío o stub nunca llegan al hardware.
      if (!isValidTemplateData(tmpl.template_data)) continue
      const tipo = (tmpl.tipo || '').toLowerCase().trim()

      if (tipo === 'huella' || tipo === 'fingerprint') {
        const fid = tmpl.indice ?? 0
        const size = tmpl.template_data.length
        commandsToInsert.push({
          device_serial: deviceSerial,
          command_string: `DATA UPDATE FINGERTMP PIN=${cleanPin}\tFID=${fid}\tSize=${size}\tValid=1\tTMP=${tmpl.template_data}`,
          is_executed: false
        })
      } else if (tipo === 'rostro' || tipo === 'face') {
        const byteSize = Math.round((tmpl.template_data.length * 3) / 4)
        commandsToInsert.push({
          device_serial: deviceSerial,
          command_string: `DATA UPDATE BIOPHOTO PIN=${cleanPin}\tType=9\tSize=${byteSize}\tContent=${tmpl.template_data}`,
          is_executed: false
        })
      }
    }

    if (commandsToInsert.length > 0) {
      const { error: cmdErr } = await supabase
        .from('device_commands')
        .insert(commandsToInsert)

      if (cmdErr) throw cmdErr
    }

    return {
      success: true,
      totalCommands: 1 + commandsToInsert.length
    }
  },

  /**
   * Sincronización de fecha, hora y zona horaria.
   * Emite el comando canónico ZKTeco ADMS: SET OPTIONS DateTime=YYYY-MM-DD HH:mm:ss,TimeZone=<offset>
   *
   * Antes de encolar el nuevo comando, cancela cualquier SET OPTIONS pendiente
   * anterior para este dispositivo. Esto evita que comandos de hora "viejos"
   * bloqueen la cola y que el checador siempre reciba la hora/zona actualizada.
   */
  async syncDeviceTime({ deviceSerial, timezone = 'America/Cancun' }) {
    if (!deviceSerial) throw new Error('Número de serie del biométrico requerido.')

    let tzOffset = -5
    let localFormatted = ''
    try {
      const d = new Date()
      const str = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).format(d)
      const match = str.match(/GMT([+-]?\d+)/)
      if (match) tzOffset = parseInt(match[1], 10)

      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).formatToParts(d)

      const p = {}
      parts.forEach(({ type, value }) => { p[type] = value })
      localFormatted = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
    } catch {
      tzOffset = -5
      localFormatted = new Date().toISOString().replace('T', ' ').slice(0, 19)
    }

    // ── Cancelar SET OPTIONS pendientes anteriores ──────────────────────────────
    // Si hay comandos de hora viejos en cola (is_executed = false), los marcamos
    // como ejecutados para que no bloqueen al nuevo. El checador solo ejecutará
    // el comando más reciente que llegue por la cola ADMS.
    try {
      const { data: pendingSetOptions } = await supabase
        .from('device_commands')
        .select('id')
        .eq('device_serial', deviceSerial)
        .eq('is_executed', false)
        .like('command_string', 'SET OPTIONS%')

      if (pendingSetOptions && pendingSetOptions.length > 0) {
        const ids = pendingSetOptions.map(r => r.id)
        await supabase
          .from('device_commands')
          .update({ is_executed: true })
          .in('id', ids)
      }
    } catch (cleanupErr) {
      // No bloqueamos la inserción si la limpieza falla
      console.warn('[syncDeviceTime] Aviso al limpiar SET OPTIONS pendientes:', cleanupErr?.message)
    }
    // ───────────────────────────────────────────────────────────────────────────

    // Se envía formato legible estándar y timezone canónico ADMS
    const commandString = `SET OPTIONS DateTime=${localFormatted},TimeZone=${tzOffset}`

    const { data: cmd, error } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })
      .select()
      .single()

    if (error) throw error

    return {
      success: true,
      commandId: cmd.id,
      commandString,
      localFormatted,
      tzOffset
    }
  },

  /**
   * Encola el comando canónico INFO para solicitar la información del dispositivo / firmware.
   */
  async enqueueDeviceInfoCommand({ deviceSerial }) {
    if (!deviceSerial) throw new Error('Número de serie del biométrico requerido.')

    const commandString = 'INFO'
    const { data: cmd, error } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })
      .select()
      .single()

    if (error) throw error

    return {
      success: true,
      commandId: cmd.id,
      commandString
    }
  },

  /**
   * Encola el comando canónico DATA QUERY USERINFO para solicitar el listado de usuarios al checador.
   */
  async enqueueQueryUsersCommand({ deviceSerial }) {
    if (!deviceSerial) throw new Error('Número de serie del biométrico requerido.')

    const commandString = 'DATA QUERY USERINFO'
    const { data: cmd, error } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false
      })
      .select()
      .single()

    if (error) throw error

    return {
      success: true,
      commandId: cmd.id,
      commandString
    }
  },

  /**
   * Obtiene el conteo exacto de usuarios asignados, rostros y huellas registrados en un checador.
   */
  async getDeviceBiometricsSummary({ deviceId, clienteId }) {
    if (!deviceId || !clienteId) {
      return { totalUsers: 0, totalFaces: 0, totalFingers: 0 }
    }

    try {
      // 1. Total de usuarios asignados activos en este checador
      const { data: assignments, error: assignErr } = await supabase
        .from('device_employee_assignments')
        .select('id, employee_id, biometric_user_id')
        .eq('device_id', deviceId)
        .eq('cliente_id', clienteId)
        .eq('activo', true)

      if (assignErr) throw assignErr
      const totalUsers = (assignments || []).length
      const employeeIds = (assignments || []).map(a => a.employee_id).filter(Boolean)

      // 2. Conteo de templates biométricos (huellas y rostros) para este dispositivo
      let totalFaces = 0
      let totalFingers = 0

      // Consultar templates vinculados directamente al device_id o a los colaboradores asignados
      let query = supabase
        .from('biometric_templates')
        .select('tipo, template_data, device_id')
        .eq('cliente_id', clienteId)

      if (employeeIds.length > 0) {
        query = query.or(`device_id.eq.${deviceId},empleado_id.in.(${employeeIds.join(',')})`)
      } else {
        query = query.eq('device_id', deviceId)
      }

      const { data: templates, error: tmplErr } = await query
      if (!tmplErr && templates) {
        for (const tmpl of templates) {
          if (!isValidTemplateData(tmpl.template_data)) continue
          const tipo = (tmpl.tipo || '').toLowerCase().trim()
          if (tipo === 'rostro' || tipo === 'face') {
            totalFaces++
          } else if (tipo === 'huella' || tipo === 'fingerprint') {
            totalFingers++
          }
        }
      }

      return {
        totalUsers,
        totalFaces,
        totalFingers
      }
    } catch (err) {
      console.warn('[getDeviceBiometricsSummary] Error calculando resumen biométrico:', err.message)
      return { totalUsers: 0, totalFaces: 0, totalFingers: 0 }
    }
  },

  /**
   * Métricas de sincronización.
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

    if (error) return { total: 0, synced: 0, pending: 0, error: 0 }

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
