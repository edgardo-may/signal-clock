// src/features/biometrics/services/biometricsService.js
// Servicio centralizado para interactuar con:
// devices, dispositivos, attendance_logs, device_commands,
// device_employee_assignments y clientes.

import { supabase } from '../../../lib/supabase'

export const biometricsService = {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene los seriales de dispositivos pertenecientes al tenant.
   *
   * La tabla `devices` es global, mientras que `dispositivos`
   * contiene la relación dispositivo <-> cliente.
   */
  async getTenantDeviceSerials(clienteId) {
    if (!clienteId) return []

    const { data, error } = await supabase
      .from('dispositivos')
      .select('device_id_hikvision')
      .eq('cliente_id', clienteId)

    if (error) throw error

    return (data || [])
      .map(row => row.device_id_hikvision)
      .filter(Boolean)
      .map(serial => serial.trim().toUpperCase())
  },

  /**
   * Obtiene los IDs globales de devices pertenecientes al tenant.
   */
  async getTenantDeviceIds(clienteId) {
    if (!clienteId) return []

    const serials = await this.getTenantDeviceSerials(clienteId)

    if (!serials.length) return []

    const { data, error } = await supabase
      .from('devices')
      .select('id, serial_number')
      .in('serial_number', serials)

    if (error) throw error

    return (data || []).map(device => device.id)
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DEVICES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
 * Obtiene los dispositivos del tenant actual.
 *
 * ARQUITECTURA:
 *
 * - `dispositivos` = relación cliente <-> dispositivo
 * - `devices` = información completa del hardware
 *
 * La información visual del dispositivo SIEMPRE sale de `devices`.
 * La tabla `dispositivos` solamente se utiliza para determinar qué
 * seriales pertenecen al cliente.
 */
async getDevices({
  clienteId,
  search = '',
  status = 'todos',
  type = 'todos'
} = {}) {
  if (!clienteId) {
    return []
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. Obtener dispositivos asociados al cliente
  // ────────────────────────────────────────────────────────────────────────

  const { data: tenantDevices, error: tenantErr } = await supabase
    .from('dispositivos')
    .select('device_id_hikvision')
    .eq('cliente_id', clienteId)

  if (tenantErr) {
    console.error(
      '[biometricsService.getDevices] Error obteniendo relaciones tenant:',
      tenantErr
    )

    throw tenantErr
  }

  const allowedSerials = (tenantDevices || [])
    .map(row => row.device_id_hikvision)
    .filter(Boolean)
    .map(serial => serial.trim().toUpperCase())

  // Si el cliente no tiene dispositivos asociados,
  // no devolver dispositivos de otro tenant.
  if (!allowedSerials.length) {
    return []
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2. Obtener información completa desde `devices`
  // ────────────────────────────────────────────────────────────────────────

  let query = supabase
    .from('devices')
    .select('*')
    .in('serial_number', allowedSerials)
    .order('created_at', { ascending: false })

  // ────────────────────────────────────────────────────────────────────────
  // 3. Filtro por estado
  // ────────────────────────────────────────────────────────────────────────

  if (status === 'active') {
    query = query.eq('is_active', true)
  } else if (status === 'inactive') {
    query = query.eq('is_active', false)
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4. Filtro por tipo
  // ────────────────────────────────────────────────────────────────────────

  if (type && type !== 'todos') {
    query = query.eq('device_type', type)
  }

  const { data, error } = await query

  if (error) {
    console.error(
      '[biometricsService.getDevices] Error obteniendo devices:',
      error
    )

    throw error
  }

  let list = (data || []).map(device => ({
    ...device,

    // Normalizamos serial para evitar problemas de comparación
    serial_number: device.serial_number
      ?.trim()
      .toUpperCase()
  }))

  // ────────────────────────────────────────────────────────────────────────
  // 5. Búsqueda client-side
  // ────────────────────────────────────────────────────────────────────────

  if (search.trim()) {
    const q = search.trim().toLowerCase()

    list = list.filter(device =>
      device.name?.toLowerCase().includes(q) ||
      device.serial_number?.toLowerCase().includes(q) ||
      device.location?.toLowerCase().includes(q) ||
      device.ip_address?.toLowerCase().includes(q) ||
      device.device_type?.toLowerCase().includes(q) ||
      device.timezone?.toLowerCase().includes(q)
    )
  }

  return list
},



  /**
   * Obtiene un dispositivo por ID verificando que pertenezca al tenant.
   */
  async getDeviceById(id, clienteId = null) {
    if (!id) throw new Error('ID de dispositivo requerido')

    const { data: device, error: devErr } = await supabase
      .from('devices')
      .select('*')
      .eq('id', id)
      .single()

    if (devErr) throw devErr
    if (!device) return null

    // Verificación tenant
    if (clienteId) {
      const serials = await this.getTenantDeviceSerials(clienteId)

      if (!serials.includes(device.serial_number?.trim().toUpperCase())) {
        throw new Error('El dispositivo no pertenece al cliente seleccionado.')
      }
    }

    // Comandos recientes
    const { data: commands, error: cmdErr } = await supabase
      .from('device_commands')
      .select('*')
      .eq('device_serial', device.serial_number)
      .order('created_at', { ascending: false })
      .limit(30)

    if (cmdErr) throw cmdErr

    // Logs recientes
    const { data: logs, error: logsErr } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('device_serial', device.serial_number)
      .order('timestamp', { ascending: false })
      .limit(30)

    if (logsErr) throw logsErr

    return {
      ...device,
      commands: commands || [],
      logs: logs || []
    }
  },


  /**
   * Crea un nuevo dispositivo.
   */
  async createDevice({
    name,
    serial_number,
    location,
    ip_address,
    port = 7660,
    timezone = 'America/Mexico_City',
    device_type = 'general',
    is_active = true,
    cliente_id
  }) {
    if (!cliente_id) {
      throw new Error('Falta cliente_id para registrar el dispositivo.')
    }

    const normalizedSerial = serial_number?.trim().toUpperCase()

    if (!normalizedSerial) {
      throw new Error('El número de serie es obligatorio.')
    }

    const hardwarePayload = {
      name: name?.trim(),
      serial_number: normalizedSerial,
      location: location?.trim() || null,
      ip_address: ip_address?.trim() || null,
      port: port ? parseInt(port, 10) : 7660,
      timezone: timezone || 'America/Mexico_City',
      device_type: device_type || 'general',
      is_active: Boolean(is_active),
      last_activity: null
    }

    // ────────────────────────────────────────────────────────────────────────
    // 1. Verificar si ya existe relación tenant <-> dispositivo
    // ────────────────────────────────────────────────────────────────────────

    const { data: existingTenantDevice } = await supabase
      .from('dispositivos')
      .select('*')
      .eq('cliente_id', cliente_id)
      .eq('device_id_hikvision', normalizedSerial)
      .maybeSingle()

    if (existingTenantDevice) {
      throw new Error('Este número de serie ya está asignado a este cliente.')
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. Buscar si el hardware ya existe globalmente
    // ────────────────────────────────────────────────────────────────────────

    const { data: existingDevice, error: existingDeviceErr } = await supabase
      .from('devices')
      .select('*')
      .eq('serial_number', normalizedSerial)
      .maybeSingle()

    if (existingDeviceErr) throw existingDeviceErr

    let device

    if (existingDevice) {
      device = existingDevice
    } else {
      // ──────────────────────────────────────────────────────────────────────
      // 3. Crear hardware global
      // ──────────────────────────────────────────────────────────────────────

      let { data: createdDevice, error: devErr } = await supabase
        .from('devices')
        .insert([hardwarePayload])
        .select()
        .single()

      // Fallback para schema antiguo
      if (
        devErr &&
        (
          devErr.message?.includes('does not exist') ||
          devErr.code === '42703'
        )
      ) {
        const basePayload = {
          name: hardwarePayload.name,
          serial_number: hardwarePayload.serial_number,
          location: hardwarePayload.location,
          is_active: hardwarePayload.is_active,
          last_activity: hardwarePayload.last_activity
        }

        const retry = await supabase
          .from('devices')
          .insert([basePayload])
          .select()
          .single()

        if (retry.error) throw retry.error

        createdDevice = retry.data
      } else if (devErr) {
        if (devErr.code === '23505') {
          // Puede haber ocurrido una carrera de inserción.
          const { data: raceDevice, error: raceErr } = await supabase
            .from('devices')
            .select('*')
            .eq('serial_number', normalizedSerial)
            .single()

          if (raceErr) throw raceErr

          createdDevice = raceDevice
        } else {
          throw devErr
        }
      }

      device = createdDevice
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. Crear relación tenant <-> dispositivo
    // ────────────────────────────────────────────────────────────────────────

    const tenantPayload = {
      cliente_id,
      device_id_hikvision: normalizedSerial,
      nombre_ubicacion: hardwarePayload.name,
      estatus: is_active ? 'activo' : 'inactivo',
      ip_local: hardwarePayload.ip_address
    }

    const { data: dispositivo, error: dispErr } = await supabase
      .from('dispositivos')
      .insert([tenantPayload])
      .select()
      .single()

    if (dispErr) {
      if (dispErr.code === '23505') {
        throw new Error('Este número de serie ya está asignado a un tenant.')
      }

      throw dispErr
    }

    return {
      ...device,
      dispositivo
    }
  },


  /**
   * Actualiza un dispositivo.
   */
  async updateDevice(id, {
    name,
    serial_number,
    location,
    ip_address,
    port,
    timezone,
    device_type,
    is_active
  }) {
    if (!id) throw new Error('ID de dispositivo requerido')

    const payload = {
      name: name?.trim(),
      serial_number: serial_number?.trim().toUpperCase(),
      location: location?.trim() || null,
      ip_address: ip_address?.trim() || null,
      port: port ? parseInt(port, 10) : 7660,
      timezone: timezone || 'America/Mexico_City',
      device_type: device_type || 'general',
      is_active: Boolean(is_active)
    }

    let { data, error } = await supabase
      .from('devices')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    // Fallback schema antiguo
    if (
      error &&
      (
        error.message?.includes('does not exist') ||
        error.code === '42703'
      )
    ) {
      const basePayload = {
        name: payload.name,
        serial_number: payload.serial_number,
        location: payload.location,
        is_active: payload.is_active
      }

      const retry = await supabase
        .from('devices')
        .update(basePayload)
        .eq('id', id)
        .select()
        .single()

      if (retry.error) throw retry.error

      return retry.data
    }

    if (error) throw error

    return data
  },


  /**
   * Elimina un dispositivo por ID.
   */
  async deleteDevice(id) {
    if (!id) throw new Error('ID de dispositivo requerido')

    const { data: device, error: getErr } = await supabase
      .from('devices')
      .select('serial_number')
      .eq('id', id)
      .single()

    if (getErr) throw getErr

    // Primero eliminar relación tenant.
    // Esto evita dejar un vínculo huérfano.
    const { error: dispErr } = await supabase
      .from('dispositivos')
      .delete()
      .eq('device_id_hikvision', device.serial_number)

    if (dispErr) throw dispErr

    // Después eliminar hardware global.
    const { error } = await supabase
      .from('devices')
      .delete()
      .eq('id', id)

    if (error) throw error

    return true
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ATTENDANCE LOGS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene registros de asistencia exclusivamente del tenant.
   */
  async getAttendanceLogs({
    clienteId,
    search = '',
    deviceSerial = 'todos',
    userId = 'todos',
    dateFrom = '',
    dateTo = '',
    limit = 200
  } = {}) {
    if (!clienteId) {
      return {
        logs: [],
        devices: [],
        employees: []
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 1. Obtener empleados del tenant
    // ────────────────────────────────────────────────────────────────────────

    const { data: empleados, error: empErr } = await supabase
      .from('empleados')
      .select(
        'id, nombre, apellido, clave_empleado, hikvision_device_userid, avatar_url, cliente_id'
      )
      .eq('cliente_id', clienteId)

    if (empErr) throw empErr

    const employeeMap = {}

    ;(empleados || []).forEach(emp => {
      if (emp.hikvision_device_userid) {
        employeeMap[String(emp.hikvision_device_userid)] = emp
      }

      if (emp.clave_empleado) {
        employeeMap[String(emp.clave_empleado)] = emp
      }

      if (emp.id) {
        employeeMap[String(emp.id)] = emp
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // 2. Obtener dispositivos del tenant
    // ────────────────────────────────────────────────────────────────────────

    const devices = await this.getDevices({
      clienteId
    })

    const allowedSerials = new Set(
      devices
        .map(dev => dev.serial_number)
        .filter(Boolean)
        .map(serial => serial.trim().toUpperCase())
    )

    if (!allowedSerials.size) {
      return {
        logs: [],
        devices,
        employees: empleados || []
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. Consultar logs
    // ────────────────────────────────────────────────────────────────────────

    let query = supabase
      .from('attendance_logs')
      .select('*')
      .in('device_serial', Array.from(allowedSerials))
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (deviceSerial && deviceSerial !== 'todos') {
      query = query.eq('device_serial', deviceSerial)
    }

    if (userId && userId !== 'todos') {
      query = query.eq('user_id', userId)
    }

    if (dateFrom) {
      const fromIso = new Date(
        `${dateFrom}T00:00:00`
      ).toISOString()

      query = query.gte('timestamp', fromIso)
    }

    if (dateTo) {
      const toIso = new Date(
        `${dateTo}T23:59:59.999`
      ).toISOString()

      query = query.lte('timestamp', toIso)
    }

    const { data: logs, error } = await query

    if (error) throw error

    // ────────────────────────────────────────────────────────────────────────
    // 4. Crear mapa de dispositivos
    // ────────────────────────────────────────────────────────────────────────

    const deviceMap = {}

    ;(devices || []).forEach(dev => {
      if (dev.serial_number) {
        deviceMap[dev.serial_number] = dev
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // 5. Enriquecer registros
    // ────────────────────────────────────────────────────────────────────────

    let enriched = (logs || []).map(log => {
      const emp = employeeMap[String(log.user_id)] || null
      const dev = deviceMap[log.device_serial] || null

      return {
        ...log,

        empleado: emp
          ? {
              nombreCompleto:
                `${emp.nombre || ''} ${emp.apellido || ''}`.trim() ||
                'Colaborador',

              clave:
                emp.clave_empleado ||
                emp.hikvision_device_userid ||
                log.user_id,

              avatar_url: emp.avatar_url
            }
          : null,

        dispositivo: dev
          ? {
              nombre: dev.name || dev.serial_number,
              ubicacion: dev.location,
              ip_address: dev.ip_address,
              device_type: dev.device_type
            }
          : null
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // 6. Búsqueda client-side
    // ────────────────────────────────────────────────────────────────────────

    if (search.trim()) {
      const q = search.toLowerCase()

      enriched = enriched.filter(l =>
        l.user_id?.toLowerCase().includes(q) ||
        l.device_serial?.toLowerCase().includes(q) ||
        l.status?.toLowerCase().includes(q) ||
        l.empleado?.nombreCompleto?.toLowerCase().includes(q) ||
        String(l.empleado?.clave || '').toLowerCase().includes(q) ||
        l.dispositivo?.nombre?.toLowerCase().includes(q)
      )
    }

    return {
      logs: enriched,
      devices: devices || [],
      employees: empleados || []
    }
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DEVICE COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene comandos exclusivamente de dispositivos del tenant.
   */
  async getDeviceCommands({
    clienteId,
    deviceSerial = 'todos',
    status = 'todos',
    limit = 100
  } = {}) {
    if (!clienteId) {
      return {
        commands: [],
        devices: []
      }
    }

    const devices = await this.getDevices({
      clienteId
    })

    const allowedSerials = devices
      .map(dev => dev.serial_number)
      .filter(Boolean)

    if (!allowedSerials.length) {
      return {
        commands: [],
        devices
      }
    }

    let query = supabase
      .from('device_commands')
      .select('*')
      .in('device_serial', allowedSerials)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (deviceSerial && deviceSerial !== 'todos') {
      query = query.eq('device_serial', deviceSerial)
    }

    if (status === 'executed') {
      query = query.eq('is_executed', true)
    } else if (status === 'pending') {
      query = query.eq('is_executed', false)
    }

    const { data: commands, error } = await query

    if (error) throw error

    const deviceMap = {}

    devices.forEach(device => {
      if (device.serial_number) {
        deviceMap[device.serial_number] = device
      }
    })

    const enriched = (commands || []).map(cmd => ({
      ...cmd,
      dispositivo: deviceMap[cmd.device_serial] || null
    }))

    return {
      commands: enriched,
      devices
    }
  },


  /**
   * Envía un nuevo comando.
   */
  async sendCommand({
    clienteId,
    device_serial,
    command_string
  }) {
    if (!clienteId) {
      throw new Error('Cliente requerido.')
    }

    if (!device_serial || !command_string) {
      throw new Error(
        'El número de serie y el comando son obligatorios.'
      )
    }

    const normalizedSerial = device_serial.trim().toUpperCase()

    // Verificar que el dispositivo pertenezca al tenant.
    const allowedSerials =
      await this.getTenantDeviceSerials(clienteId)

    if (!allowedSerials.includes(normalizedSerial)) {
      throw new Error(
        'El dispositivo no pertenece al cliente seleccionado.'
      )
    }

    const payload = {
      device_serial: normalizedSerial,
      command_string: command_string.trim(),
      is_executed: false
    }

    const { data, error } = await supabase
      .from('device_commands')
      .insert([payload])
      .select()
      .single()

    if (error) throw error

    return data
  },


  /**
   * Marca comando como ejecutado/no ejecutado.
   */
  async toggleCommandExecuted(id, is_executed) {
    if (!id) throw new Error('ID de comando requerido')

    const { data, error } = await supabase
      .from('device_commands')
      .update({
        is_executed: Boolean(is_executed),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return data
  },


  /**
   * Elimina comando.
   */
  async deleteCommand(id) {
    if (!id) throw new Error('ID de comando requerido')

    const { error } = await supabase
      .from('device_commands')
      .delete()
      .eq('id', id)

    if (error) throw error

    return true
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 5. STATS / DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Estadísticas exclusivamente del tenant.
   */
  async getBiometricsStats(clienteId) {
    if (!clienteId) {
      return {
        totalDevices: 0,
        activeDevices: 0,
        inactiveDevices: 0,
        onlineDevices: 0,
        offlineDevices: 0,
        totalLogsToday: 0,
        pendingCommands: 0,
        executedCommands: 0,
        latestActivity: null,
        devices: [],
        recentLogs: [],
        recentCommands: [],
        syncedAssignments: 0,
        pendingAssignments: 0,
        errorAssignments: 0,
        recentSyncs: [],
        recentErrors: []
      }
    }

    const devices = await this.getDevices({
      clienteId
    })

    const allowedSerials = devices
      .map(d => d.serial_number)
      .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // Fecha de hoy
    // ────────────────────────────────────────────────────────────────────────

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayIso = today.toISOString()

    // ────────────────────────────────────────────────────────────────────────
    // Logs de hoy
    // ────────────────────────────────────────────────────────────────────────

    let totalLogsToday = 0
    let recentLogs = []

    if (allowedSerials.length) {
      const { count, error: logsCountErr } = await supabase
        .from('attendance_logs')
        .select('*', {
          count: 'exact',
          head: true
        })
        .in('device_serial', allowedSerials)
        .gte('timestamp', todayIso)

      if (logsCountErr) throw logsCountErr

      totalLogsToday = count ?? 0

      const { data, error: recentLogsErr } = await supabase
        .from('attendance_logs')
        .select('*')
        .in('device_serial', allowedSerials)
        .order('timestamp', {
          ascending: false
        })
        .limit(10)

      if (recentLogsErr) throw recentLogsErr

      recentLogs = data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Comandos
    // ────────────────────────────────────────────────────────────────────────

    let recentCommands = []

    if (allowedSerials.length) {
      const { data, error } = await supabase
        .from('device_commands')
        .select('*')
        .in('device_serial', allowedSerials)
        .order('created_at', {
          ascending: false
        })
        .limit(10)

      if (error) throw error

      recentCommands = data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Asignaciones
    // ────────────────────────────────────────────────────────────────────────

    const deviceIds = devices
      .map(d => d.id)
      .filter(Boolean)

    let assignments = []

    if (deviceIds.length) {
      const { data, error } = await supabase
        .from('device_employee_assignments')
        .select(
          'id, device_id, employee_id, cliente_id, biometric_user_id, activo, sync_status, last_error, actualizado_at'
        )
        .eq('cliente_id', clienteId)
        .in('device_id', deviceIds)

      if (error) throw error

      assignments = data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Device counters
    // ────────────────────────────────────────────────────────────────────────

    const totalDevices = devices.length

    const activeDevices = devices.filter(
      d => d.is_active
    ).length

    const inactiveDevices =
      totalDevices - activeDevices

    const isOnline = lastActivity => {
      if (!lastActivity) return false

      const diffMs =
        new Date() - new Date(lastActivity)

      return diffMs < 5 * 60 * 1000
    }

    const onlineDevices = devices.filter(
      d =>
        d.is_active &&
        isOnline(d.last_activity)
    ).length

    const offlineDevices =
      totalDevices - onlineDevices

    // ────────────────────────────────────────────────────────────────────────
    // Command counters
    // ────────────────────────────────────────────────────────────────────────

    const pendingCommands =
      recentCommands.filter(
        c => !c.is_executed
      ).length

    const executedCommands =
      recentCommands.filter(
        c => c.is_executed
      ).length

    // ────────────────────────────────────────────────────────────────────────
    // Última actividad
    // ────────────────────────────────────────────────────────────────────────

    let latestActivity = null

    devices.forEach(device => {
      if (!device.last_activity) return

      const timestamp =
        new Date(device.last_activity)

      if (
        !latestActivity ||
        timestamp > latestActivity
      ) {
        latestActivity = timestamp
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // Assignment counters
    // ────────────────────────────────────────────────────────────────────────

    const syncedAssignments =
      assignments.filter(
        a => a.sync_status === 'SYNCED'
      ).length

    const pendingAssignments =
      assignments.filter(
        a =>
          a.sync_status === 'PENDING' ||
          a.sync_status === 'SYNCING'
      ).length

    const errorAssignments =
      assignments.filter(
        a => a.sync_status === 'ERROR'
      ).length

    const recentSyncs =
      assignments
        .filter(
          a => a.sync_status === 'SYNCED'
        )
        .sort(
          (a, b) =>
            new Date(b.actualizado_at) -
            new Date(a.actualizado_at)
        )
        .slice(0, 5)

    const recentErrors =
      assignments
        .filter(
          a => a.sync_status === 'ERROR'
        )
        .sort(
          (a, b) =>
            new Date(b.actualizado_at) -
            new Date(a.actualizado_at)
        )
        .slice(0, 5)

    return {
      totalDevices,
      activeDevices,
      inactiveDevices,
      onlineDevices,
      offlineDevices,
      totalLogsToday,
      pendingCommands,
      executedCommands,
      latestActivity:
        latestActivity
          ? latestActivity.toISOString()
          : null,
      devices,
      recentLogs,
      recentCommands,
      syncedAssignments,
      pendingAssignments,
      errorAssignments,
      recentSyncs,
      recentErrors
    }
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SYNC POLICY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene política de sincronización.
   */
  async getSyncPolicy(clienteId) {
    if (!clienteId) return null

    const { data, error } = await supabase
      .from('clientes')
      .select(
        'id, nombre_empresa, biometric_sync_policy, id_empresa'
      )
      .eq('id', clienteId)
      .single()

    if (error) throw error

    return data
  },


  /**
   * Actualiza política.
   */
  async updateSyncPolicy(clienteId, policy) {
    if (!clienteId || !policy) {
      throw new Error(
        'Cliente y política requeridos'
      )
    }

    const { data, error } = await supabase
      .from('clientes')
      .update({
        biometric_sync_policy: policy,
        actualizado_at:
          new Date().toISOString()
      })
      .eq('id', clienteId)
      .select()
      .single()

    if (error) throw error

    return data
  },


  /**
   * Obtiene tenants relacionados que comparten empresa.
   */
  async getRelatedTenants(clienteId) {
    if (!clienteId) return []

    const { data: current, error: curErr } =
      await supabase
        .from('clientes')
        .select(
          'id, nombre_empresa, id_empresa'
        )
        .eq('id', clienteId)
        .single()

    if (curErr) throw curErr

    if (!current?.id_empresa) {
      return [current]
    }

    const { data: related, error: relErr } =
      await supabase
        .from('clientes')
        .select(
          'id, nombre_empresa, id_empresa'
        )
        .eq(
          'id_empresa',
          current.id_empresa
        )

    if (relErr) throw relErr

    return related || [current]
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 7. EMPLOYEES / ASSIGNMENTS / PROVISIONING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene colaboradores y asignaciones.
   *
   * Respeta la política EMPRESA:
   * - Si la política es por empresa, obtiene tenants relacionados.
   * - Si no, trabaja únicamente con el tenant actual.
   */
  async getEmployeesSync(clienteId) {
    if (!clienteId) {
      return {
        employees: [],
        assignments: [],
        devices: [],
        tenants: []
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 1. Obtener política
    // ────────────────────────────────────────────────────────────────────────

    let currentTenant

    const { data: tenant, error: tenantErr } =
      await supabase
        .from('clientes')
        .select(
          'id, nombre_empresa, id_empresa, biometric_sync_policy'
        )
        .eq('id', clienteId)
        .single()

    if (tenantErr) throw tenantErr

    currentTenant = tenant

    // ────────────────────────────────────────────────────────────────────────
    // 2. Determinar alcance
    // ────────────────────────────────────────────────────────────────────────

    let relatedTenants = [currentTenant]

    if (
      currentTenant.biometric_sync_policy ===
      'EMPRESA'
    ) {
      relatedTenants =
        await this.getRelatedTenants(
          clienteId
        )
    }

    const tenantIds =
      relatedTenants.map(t => t.id)

    // ────────────────────────────────────────────────────────────────────────
    // 3. Empleados
    // ────────────────────────────────────────────────────────────────────────

    const { data: employees, error: empErr } =
      await supabase
        .from('empleados')
        .select(
          'id, nombre, apellido, clave_empleado, activo, cliente_id, avatar_url, departamento'
        )
        .in(
          'cliente_id',
          tenantIds
        )
        .order(
          'nombre',
          { ascending: true }
        )

    if (empErr) throw empErr

    // ────────────────────────────────────────────────────────────────────────
    // 4. Dispositivos asociados
    // ────────────────────────────────────────────────────────────────────────

    const { data: dispositivos, error: dispErr } =
      await supabase
        .from('dispositivos')
        .select(
          'device_id_hikvision, cliente_id'
        )
        .in(
          'cliente_id',
          tenantIds
        )

    if (dispErr) throw dispErr

    const allowedSerials = new Set(
      (dispositivos || [])
        .map(d =>
          d.device_id_hikvision
            ?.trim()
            .toUpperCase()
        )
        .filter(Boolean)
    )

    let filteredDevices = []

    if (allowedSerials.size) {
      const { data: devices, error: devErr } =
        await supabase
          .from('devices')
          .select('*')
          .in(
            'serial_number',
            Array.from(allowedSerials)
          )

      if (devErr) throw devErr

      filteredDevices = devices || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // 5. Asignaciones
    // ────────────────────────────────────────────────────────────────────────

    const { data: assignments, error: assignErr } =
      await supabase
        .from('device_employee_assignments')
        .select('*')
        .in(
          'cliente_id',
          tenantIds
        )

    if (assignErr) throw assignErr

    return {
      employees: employees || [],
      assignments: assignments || [],
      devices: filteredDevices,
      tenants: relatedTenants
    }
  },


  /**
   * Crea o actualiza una asignación.
   */
  async saveAssignment({
    cliente_id,
    device_id,
    employee_id,
    biometric_user_id,
    activo = true
  }) {
    if (!cliente_id) {
      throw new Error('cliente_id es requerido')
    }

    if (!device_id) {
      throw new Error('device_id es requerido')
    }

    if (!employee_id) {
      throw new Error('employee_id es requerido')
    }

    if (!biometric_user_id?.trim()) {
      throw new Error(
        'El ID de usuario biométrico es requerido'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Verificar dispositivo pertenece al tenant
    // ────────────────────────────────────────────────────────────────────────

    const tenantDeviceIds =
      await this.getTenantDeviceIds(
        cliente_id
      )

    if (!tenantDeviceIds.includes(device_id)) {
      throw new Error(
        'El dispositivo no pertenece al cliente seleccionado.'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Payload
    // ────────────────────────────────────────────────────────────────────────

    const payload = {
      cliente_id,
      device_id,
      employee_id,
      biometric_user_id:
        biometric_user_id.trim(),
      activo: Boolean(activo),
      sync_status: 'PENDING',
      last_error: null,
      actualizado_at:
        new Date().toISOString()
    }

    // ────────────────────────────────────────────────────────────────────────
    // Buscar asignación existente
    // ────────────────────────────────────────────────────────────────────────

    const { data: existing, error: existingErr } =
      await supabase
        .from(
          'device_employee_assignments'
        )
        .select('id')
        .eq(
          'device_id',
          device_id
        )
        .eq(
          'biometric_user_id',
          biometric_user_id.trim()
        )
        .maybeSingle()

    if (existingErr) throw existingErr

    if (existing) {
      const { data, error } =
        await supabase
          .from(
            'device_employee_assignments'
          )
          .update(payload)
          .eq(
            'id',
            existing.id
          )
          .select()
          .single()

      if (error) throw error

      return data
    }

    const { data, error } =
      await supabase
        .from(
          'device_employee_assignments'
        )
        .insert([payload])
        .select()
        .single()

    if (error) throw error

    return data
  },


  /**
   * Desaprovisiona colaborador.
   */
  async deactivateAssignment(
    assignmentId
  ) {
    if (!assignmentId) {
      throw new Error(
        'ID de asignación es requerido'
      )
    }

    const { data, error } =
      await supabase
        .from(
          'device_employee_assignments'
        )
        .update({
          activo: false,
          sync_status: 'PENDING',
          last_error: null,
          actualizado_at:
            new Date().toISOString()
        })
        .eq(
          'id',
          assignmentId
        )
        .select()
        .single()

    if (error) throw error

    return data
  },


  /**
   * Fuerza sincronización.
   */
  async syncAssignmentNow(
    assignmentId
  ) {
    if (!assignmentId) {
      throw new Error(
        'ID de asignación es requerido'
      )
    }

    const {
      data: current,
      error: getErr
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .select('activo')
      .eq(
        'id',
        assignmentId
      )
      .single()

    if (getErr) throw getErr

    const { data, error } =
      await supabase
        .from(
          'device_employee_assignments'
        )
        .update({
          activo: current.activo,
          sync_status: 'PENDING',
          last_error: null,
          actualizado_at:
            new Date().toISOString()
        })
        .eq(
          'id',
          assignmentId
        )
        .select()
        .single()

    if (error) throw error

    return data
  }
}

