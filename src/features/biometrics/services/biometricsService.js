// src/features/biometrics/services/biometricsService.js
//
// Servicio centralizado de biométricos.
//
// ARQUITECTURA:
//
// `devices` es la tabla principal de dispositivos.
//
// Cada dispositivo tiene directamente:
//   - id
//   - cliente_id
//   - serial_number
//   - name
//   - location
//   - ip_address
//   - port
//   - timezone
//   - device_type
//   - is_active
//   - last_activity
//
// IMPORTANTE:
// Este servicio NO utiliza la tabla `dispositivos`.
// La pertenencia de un dispositivo a un cliente se determina
// exclusivamente mediante `devices.cliente_id`.
//

import { supabase } from '../../../lib/supabase'

export const biometricsService = {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normaliza un número de serie.
   */
  normalizeSerial(serial) {
    return serial
      ?.trim()
      .toUpperCase() || null
  },


  /**
   * Obtiene los seriales de los dispositivos pertenecientes al tenant.
   *
   * IMPORTANTE:
   * La pertenencia se determina directamente con devices.cliente_id.
   */
  async getTenantDeviceSerials(clienteId) {
    if (!clienteId) return []

    const { data, error } = await supabase
      .from('devices')
      .select('serial_number')
      .eq('cliente_id', clienteId)

    if (error) {
      console.error(
        '[biometricsService.getTenantDeviceSerials]',
        error
      )

      throw error
    }

    return (data || [])
      .map(row => this.normalizeSerial(row.serial_number))
      .filter(Boolean)
  },


  /**
   * Obtiene los IDs globales de devices pertenecientes al tenant.
   */
  async getTenantDeviceIds(clienteId) {
    if (!clienteId) return []

    const { data, error } = await supabase
      .from('devices')
      .select('id')
      .eq('cliente_id', clienteId)

    if (error) {
      console.error(
        '[biometricsService.getTenantDeviceIds]',
        error
      )

      throw error
    }

    return (data || [])
      .map(device => device.id)
      .filter(Boolean)
  },


  /**
   * Verifica que un device pertenezca al cliente.
   */
  async assertDeviceBelongsToTenant(deviceId, clienteId) {
    if (!deviceId) {
      throw new Error('ID de dispositivo requerido.')
    }

    if (!clienteId) {
      throw new Error('Cliente requerido.')
    }

    const { data, error } = await supabase
      .from('devices')
      .select('id, cliente_id, serial_number, name')
      .eq('id', deviceId)
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (error) {
      console.error(
        '[biometricsService.assertDeviceBelongsToTenant]',
        error
      )

      throw error
    }

    if (!data) {
      throw new Error(
        'El dispositivo no pertenece al cliente seleccionado.'
      )
    }

    return data
  },


  /**
   * Obtiene los devices del tenant.
   */
  async getTenantDevices(clienteId) {
    if (!clienteId) return []

    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('created_at', {
        ascending: false
      })

    if (error) {
      console.error(
        '[biometricsService.getTenantDevices]',
        error
      )

      throw error
    }

    return (data || []).map(device => ({
      ...device,
      serial_number: this.normalizeSerial(
        device.serial_number
      )
    }))
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DEVICES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene los dispositivos del tenant actual.
   *
   * NO utiliza `dispositivos`.
   *
   * La consulta es directamente:
   *
   * devices.cliente_id = clienteId
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
    // Consulta directa a devices
    // ────────────────────────────────────────────────────────────────────────

    let query = supabase
      .from('devices')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('created_at', {
        ascending: false
      })

    // ────────────────────────────────────────────────────────────────────────
    // Filtro por estado
    // ────────────────────────────────────────────────────────────────────────

    if (status === 'active') {
      query = query.eq('is_active', true)
    } else if (status === 'inactive') {
      query = query.eq('is_active', false)
    }

    // ────────────────────────────────────────────────────────────────────────
    // Filtro por tipo
    // ────────────────────────────────────────────────────────────────────────

    if (type && type !== 'todos') {
      query = query.eq('device_type', type)
    }

    const { data, error } = await query

    if (error) {
      console.error(
        '[biometricsService.getDevices]',
        error
      )

      throw error
    }

    // ────────────────────────────────────────────────────────────────────────
    // Normalizar dispositivos
    // ────────────────────────────────────────────────────────────────────────

    let list = (data || []).map(device => ({
      ...device,

      serial_number: this.normalizeSerial(
        device.serial_number
      )
    }))

    // ────────────────────────────────────────────────────────────────────────
    // Búsqueda client-side
    // ────────────────────────────────────────────────────────────────────────

    const normalizedSearch = search?.trim().toLowerCase()

    if (normalizedSearch) {
      list = list.filter(device =>
        device.name
          ?.toLowerCase()
          .includes(normalizedSearch) ||

        device.serial_number
          ?.toLowerCase()
          .includes(normalizedSearch) ||

        device.location
          ?.toLowerCase()
          .includes(normalizedSearch) ||

        device.ip_address
          ?.toLowerCase()
          .includes(normalizedSearch) ||

        device.device_type
          ?.toLowerCase()
          .includes(normalizedSearch) ||

        device.timezone
          ?.toLowerCase()
          .includes(normalizedSearch)
      )
    }

    return list
  },


  /**
   * Obtiene un dispositivo por ID.
   *
   * Si se proporciona clienteId, también valida que el device
   * pertenezca directamente a ese cliente.
   */
  async getDeviceById(id, clienteId = null) {
    if (!id) {
      throw new Error('ID de dispositivo requerido')
    }

    let query = supabase
      .from('devices')
      .select('*')
      .eq('id', id)

    if (clienteId) {
      query = query.eq('cliente_id', clienteId)
    }

    const {
      data: device,
      error: devErr
    } = await query.single()

    if (devErr) {
      throw devErr
    }

    if (!device) {
      return null
    }

    const normalizedSerial =
      this.normalizeSerial(device.serial_number)

    // ────────────────────────────────────────────────────────────────────────
    // Comandos recientes
    // ────────────────────────────────────────────────────────────────────────

    let commands = []

    if (normalizedSerial) {
      const {
        data,
        error: cmdErr
      } = await supabase
        .from('device_commands')
        .select('*')
        .eq('device_serial', normalizedSerial)
        .order('created_at', {
          ascending: false
        })
        .limit(30)

      if (cmdErr) {
        throw cmdErr
      }

      commands = data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Logs recientes
    // ────────────────────────────────────────────────────────────────────────

    let logs = []

    if (normalizedSerial) {
      const {
        data,
        error: logsErr
      } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('device_serial', normalizedSerial)
        .order('timestamp', {
          ascending: false
        })
        .limit(30)

      if (logsErr) {
        throw logsErr
      }

      logs = data || []
    }

    return {
      ...device,
      serial_number: normalizedSerial,
      commands,
      logs
    }
  },


  /**
   * Crea un nuevo dispositivo.
   *
   * IMPORTANTE:
   * El dispositivo se crea directamente en `devices`.
   *
   * Ya NO se crea ninguna fila en `dispositivos`.
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
      throw new Error(
        'Falta cliente_id para registrar el dispositivo.'
      )
    }

    const normalizedSerial =
      this.normalizeSerial(serial_number)

    if (!normalizedSerial) {
      throw new Error(
        'El número de serie es obligatorio.'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Verificar si el serial ya existe
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: existingDevice,
      error: existingDeviceErr
    } = await supabase
      .from('devices')
      .select('*')
      .eq('serial_number', normalizedSerial)
      .maybeSingle()

    if (existingDeviceErr) {
      throw existingDeviceErr
    }

    if (existingDevice) {
      if (
        existingDevice.cliente_id === cliente_id
      ) {
        throw new Error(
          'Este número de serie ya está registrado para este cliente.'
        )
      }

      throw new Error(
        'Este número de serie ya está registrado para otro cliente.'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Payload
    // ────────────────────────────────────────────────────────────────────────

    const hardwarePayload = {
      name: name?.trim() || normalizedSerial,

      serial_number: normalizedSerial,

      location:
        location?.trim() || null,

      ip_address:
        ip_address?.trim() || null,

      port:
        port !== undefined &&
        port !== null &&
        port !== ''
          ? parseInt(port, 10)
          : 7660,

      timezone:
        timezone || 'America/Mexico_City',

      device_type:
        device_type || 'general',

      is_active:
        Boolean(is_active),

      last_activity:
        null,

      cliente_id
    }

    // ────────────────────────────────────────────────────────────────────────
    // Crear directamente en devices
    // ────────────────────────────────────────────────────────────────────────

    const {
      data,
      error
    } = await supabase
      .from('devices')
      .insert([hardwarePayload])
      .select()
      .single()

    if (error) {
      // Carrera de inserción / unique constraint
      if (error.code === '23505') {
        throw new Error(
          'Este número de serie ya está registrado.'
        )
      }

      throw error
    }

    return {
      ...data,
      serial_number: this.normalizeSerial(
        data.serial_number
      )
    }
  },


  /**
   * Actualiza un dispositivo.
   *
   * Si clienteId viene incluido en options, se valida ownership.
   */
  async updateDevice(
    id,
    {
      name,
      serial_number,
      location,
      ip_address,
      port,
      timezone,
      device_type,
      is_active,
      cliente_id = null
    }
  ) {
    if (!id) {
      throw new Error(
        'ID de dispositivo requerido'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Verificar ownership si tenemos cliente
    // ────────────────────────────────────────────────────────────────────────

    if (cliente_id) {
      await this.assertDeviceBelongsToTenant(
        id,
        cliente_id
      )
    }

    const normalizedSerial =
      this.normalizeSerial(serial_number)

    const payload = {
      name:
        name?.trim() || null,

      serial_number:
        normalizedSerial,

      location:
        location?.trim() || null,

      ip_address:
        ip_address?.trim() || null,

      port:
        port !== undefined &&
        port !== null &&
        port !== ''
          ? parseInt(port, 10)
          : 7660,

      timezone:
        timezone || 'America/Mexico_City',

      device_type:
        device_type || 'general',

      is_active:
        Boolean(is_active)
    }

    // Si se permite actualizar cliente_id,
    // solamente hacerlo cuando explícitamente se envíe.
    if (cliente_id) {
      payload.cliente_id = cliente_id
    }

    const {
      data,
      error
    } = await supabase
      .from('devices')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new Error(
          'El número de serie ya está registrado.'
        )
      }

      throw error
    }

    return {
      ...data,
      serial_number: this.normalizeSerial(
        data.serial_number
      )
    }
  },


  /**
   * Elimina un dispositivo.
   *
   * IMPORTANTE:
   * Ya NO elimina nada de `dispositivos`.
   *
   * El device es la entidad principal.
   */
  async deleteDevice(id, clienteId = null) {
    if (!id) {
      throw new Error(
        'ID de dispositivo requerido'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Verificar ownership
    // ────────────────────────────────────────────────────────────────────────

    if (clienteId) {
      await this.assertDeviceBelongsToTenant(
        id,
        clienteId
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Obtener device
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: device,
      error: getErr
    } = await supabase
      .from('devices')
      .select('id, cliente_id, serial_number')
      .eq('id', id)
      .single()

    if (getErr) {
      throw getErr
    }

    // ────────────────────────────────────────────────────────────────────────
    // Eliminar device
    //
    // Las tablas relacionadas deberán tener FK con ON DELETE CASCADE
    // o deberán eliminarse antes si tu esquema no utiliza cascade.
    // ────────────────────────────────────────────────────────────────────────

    const {
      error
    } = await supabase
      .from('devices')
      .delete()
      .eq('id', id)

    if (error) {
      throw error
    }

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
    // 1. Empleados del tenant
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: empleados,
      error: empErr
    } = await supabase
      .from('empleados')
      .select(
        'id, nombre, apellido, clave_empleado, hikvision_device_userid, avatar_url, cliente_id'
      )
      .eq('cliente_id', clienteId)

    if (empErr) {
      throw empErr
    }

    // ────────────────────────────────────────────────────────────────────────
    // Crear mapa de empleados
    // ────────────────────────────────────────────────────────────────────────

    const employeeMap = {}

    ;(empleados || []).forEach(emp => {
      if (emp.hikvision_device_userid) {
        employeeMap[
          String(emp.hikvision_device_userid)
        ] = emp
      }

      if (emp.clave_empleado) {
        employeeMap[
          String(emp.clave_empleado)
        ] = emp
      }

      if (emp.id) {
        employeeMap[
          String(emp.id)
        ] = emp
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // 2. Devices del tenant
    // ────────────────────────────────────────────────────────────────────────

    const devices = await this.getDevices({
      clienteId
    })

    const allowedSerials = devices
      .map(dev =>
        this.normalizeSerial(
          dev.serial_number
        )
      )
      .filter(Boolean)

    if (!allowedSerials.length) {
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
      .in(
        'device_serial',
        allowedSerials
      )
      .order('timestamp', {
        ascending: false
      })
      .limit(limit)

    if (
      deviceSerial &&
      deviceSerial !== 'todos'
    ) {
      query = query.eq(
        'device_serial',
        this.normalizeSerial(deviceSerial)
      )
    }

    if (
      userId &&
      userId !== 'todos'
    ) {
      query = query.eq(
        'user_id',
        userId
      )
    }

    if (dateFrom) {
      const fromIso =
        new Date(
          `${dateFrom}T00:00:00`
        ).toISOString()

      query = query.gte(
        'timestamp',
        fromIso
      )
    }

    if (dateTo) {
      const toIso =
        new Date(
          `${dateTo}T23:59:59.999`
        ).toISOString()

      query = query.lte(
        'timestamp',
        toIso
      )
    }

    const {
      data: logs,
      error
    } = await query

    if (error) {
      throw error
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. Mapa de devices
    // ────────────────────────────────────────────────────────────────────────

    const deviceMap = {}

    ;(devices || []).forEach(device => {
      const serial =
        this.normalizeSerial(
          device.serial_number
        )

      if (serial) {
        deviceMap[serial] = device
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // 5. Enriquecer logs
    // ────────────────────────────────────────────────────────────────────────

    let enriched = (logs || []).map(log => {
      const emp =
        employeeMap[
          String(log.user_id)
        ] || null

      const serial =
        this.normalizeSerial(
          log.device_serial
        )

      const dev =
        deviceMap[serial] || null

      return {
        ...log,

        empleado: emp
          ? {
              nombreCompleto:
                `${emp.nombre || ''} ${emp.apellido || ''}`
                  .trim() ||
                'Colaborador',

              clave:
                emp.clave_empleado ||
                emp.hikvision_device_userid ||
                log.user_id,

              avatar_url:
                emp.avatar_url
            }
          : null,

        dispositivo: dev
          ? {
              id: dev.id,

              nombre:
                dev.name ||
                dev.serial_number,

              ubicacion:
                dev.location,

              ip_address:
                dev.ip_address,

              device_type:
                dev.device_type,

              serial_number:
                dev.serial_number
            }
          : null
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // 6. Búsqueda
    // ────────────────────────────────────────────────────────────────────────

    const normalizedSearch =
      search?.trim().toLowerCase()

    if (normalizedSearch) {
      enriched = enriched.filter(log =>
        String(log.user_id || '')
          .toLowerCase()
          .includes(normalizedSearch) ||

        String(log.device_serial || '')
          .toLowerCase()
          .includes(normalizedSearch) ||

        String(log.status || '')
          .toLowerCase()
          .includes(normalizedSearch) ||

        String(
          log.empleado?.nombreCompleto || ''
        )
          .toLowerCase()
          .includes(normalizedSearch) ||

        String(
          log.empleado?.clave || ''
        )
          .toLowerCase()
          .includes(normalizedSearch) ||

        String(
          log.dispositivo?.nombre || ''
        )
          .toLowerCase()
          .includes(normalizedSearch)
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
      .map(dev =>
        this.normalizeSerial(
          dev.serial_number
        )
      )
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
      .in(
        'device_serial',
        allowedSerials
      )
      .order('created_at', {
        ascending: false
      })
      .limit(limit)

    if (
      deviceSerial &&
      deviceSerial !== 'todos'
    ) {
      query = query.eq(
        'device_serial',
        this.normalizeSerial(deviceSerial)
      )
    }

    if (status === 'executed') {
      query = query.eq(
        'is_executed',
        true
      )
    } else if (status === 'pending') {
      query = query.eq(
        'is_executed',
        false
      )
    }

    const {
      data: commands,
      error
    } = await query

    if (error) {
      throw error
    }

    const deviceMap = {}

    devices.forEach(device => {
      const serial =
        this.normalizeSerial(
          device.serial_number
        )

      if (serial) {
        deviceMap[serial] = device
      }
    })

    const enriched =
      (commands || []).map(command => {
        const serial =
          this.normalizeSerial(
            command.device_serial
          )

        return {
          ...command,

          dispositivo:
            deviceMap[serial] || null
        }
      })

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
      throw new Error(
        'Cliente requerido.'
      )
    }

    if (
      !device_serial ||
      !command_string
    ) {
      throw new Error(
        'El número de serie y el comando son obligatorios.'
      )
    }

    const normalizedSerial =
      this.normalizeSerial(
        device_serial
      )

    // ────────────────────────────────────────────────────────────────────────
    // Verificar directamente en devices
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: device,
      error: deviceErr
    } = await supabase
      .from('devices')
      .select(
        'id, cliente_id, serial_number, name'
      )
      .eq(
        'cliente_id',
        clienteId
      )
      .eq(
        'serial_number',
        normalizedSerial
      )
      .maybeSingle()

    if (deviceErr) {
      throw deviceErr
    }

    if (!device) {
      throw new Error(
        'El dispositivo no pertenece al cliente seleccionado.'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Insertar comando
    // ────────────────────────────────────────────────────────────────────────

    const payload = {
      device_serial:
        normalizedSerial,

      command_string:
        command_string.trim(),

      is_executed:
        false
    }

    const {
      data,
      error
    } = await supabase
      .from('device_commands')
      .insert([payload])
      .select()
      .single()

    if (error) {
      throw error
    }

    return data
  },


  /**
   * Marca comando como ejecutado/no ejecutado.
   */
  async toggleCommandExecuted(
    id,
    is_executed
  ) {
    if (!id) {
      throw new Error(
        'ID de comando requerido'
      )
    }

    const {
      data,
      error
    } = await supabase
      .from('device_commands')
      .update({
        is_executed:
          Boolean(is_executed),

        updated_at:
          new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw error
    }

    return data
  },


  /**
   * Elimina comando.
   */
  async deleteCommand(id) {
    if (!id) {
      throw new Error(
        'ID de comando requerido'
      )
    }

    const {
      error
    } = await supabase
      .from('device_commands')
      .delete()
      .eq('id', id)

    if (error) {
      throw error
    }

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

    // ────────────────────────────────────────────────────────────────────────
    // Devices del tenant
    // ────────────────────────────────────────────────────────────────────────

    const devices = await this.getDevices({
      clienteId
    })

    const allowedSerials = devices
      .map(device =>
        this.normalizeSerial(
          device.serial_number
        )
      )
      .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // Fecha de hoy
    // ────────────────────────────────────────────────────────────────────────

    const today = new Date()

    today.setHours(
      0,
      0,
      0,
      0
    )

    const todayIso =
      today.toISOString()

    // ────────────────────────────────────────────────────────────────────────
    // Logs de hoy
    // ────────────────────────────────────────────────────────────────────────

    let totalLogsToday = 0
    let recentLogs = []

    if (allowedSerials.length) {
      const {
        count,
        error: logsCountErr
      } = await supabase
        .from('attendance_logs')
        .select('*', {
          count: 'exact',
          head: true
        })
        .in(
          'device_serial',
          allowedSerials
        )
        .gte(
          'timestamp',
          todayIso
        )

      if (logsCountErr) {
        throw logsCountErr
      }

      totalLogsToday =
        count ?? 0

      const {
        data,
        error: recentLogsErr
      } = await supabase
        .from('attendance_logs')
        .select('*')
        .in(
          'device_serial',
          allowedSerials
        )
        .order('timestamp', {
          ascending: false
        })
        .limit(10)

      if (recentLogsErr) {
        throw recentLogsErr
      }

      recentLogs =
        data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Comandos recientes
    // ────────────────────────────────────────────────────────────────────────

    let recentCommands = []

    if (allowedSerials.length) {
      const {
        data,
        error
      } = await supabase
        .from('device_commands')
        .select('*')
        .in(
          'device_serial',
          allowedSerials
        )
        .order('created_at', {
          ascending: false
        })
        .limit(10)

      if (error) {
        throw error
      }

      recentCommands =
        data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Asignaciones
    // ────────────────────────────────────────────────────────────────────────

    const deviceIds = devices
      .map(device => device.id)
      .filter(Boolean)

    let assignments = []

    if (deviceIds.length) {
      const {
        data,
        error
      } = await supabase
        .from(
          'device_employee_assignments'
        )
        .select(
          'id, device_id, employee_id, cliente_id, biometric_user_id, activo, sync_status, last_error, actualizado_at'
        )
        .eq(
          'cliente_id',
          clienteId
        )
        .in(
          'device_id',
          deviceIds
        )

      if (error) {
        throw error
      }

      assignments =
        data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Device counters
    // ────────────────────────────────────────────────────────────────────────

    const totalDevices =
      devices.length

    const activeDevices =
      devices.filter(
        device =>
          device.is_active
      ).length

    const inactiveDevices =
      totalDevices -
      activeDevices

    const isOnline =
      lastActivity => {
        if (!lastActivity) {
          return false
        }

        const diffMs =
          new Date() -
          new Date(lastActivity)

        return (
          diffMs <
          5 * 60 * 1000
        )
      }

    const onlineDevices =
      devices.filter(
        device =>
          device.is_active &&
          isOnline(
            device.last_activity
          )
      ).length

    const offlineDevices =
      totalDevices -
      onlineDevices

    // ────────────────────────────────────────────────────────────────────────
    // Command counters
    // ────────────────────────────────────────────────────────────────────────

    const pendingCommands =
      recentCommands.filter(
        command =>
          !command.is_executed
      ).length

    const executedCommands =
      recentCommands.filter(
        command =>
          command.is_executed
      ).length

    // ────────────────────────────────────────────────────────────────────────
    // Última actividad
    // ────────────────────────────────────────────────────────────────────────

    let latestActivity = null

    devices.forEach(device => {
      if (!device.last_activity) {
        return
      }

      const timestamp =
        new Date(
          device.last_activity
        )

      if (
        !latestActivity ||
        timestamp > latestActivity
      ) {
        latestActivity =
          timestamp
      }
    })

    // ────────────────────────────────────────────────────────────────────────
    // Assignment counters
    // ────────────────────────────────────────────────────────────────────────

    const syncedAssignments =
      assignments.filter(
        assignment =>
          assignment.sync_status ===
          'SYNCED'
      ).length

    const pendingAssignments =
      assignments.filter(
        assignment =>
          assignment.sync_status ===
            'PENDING' ||
          assignment.sync_status ===
            'SYNCING'
      ).length

    const errorAssignments =
      assignments.filter(
        assignment =>
          assignment.sync_status ===
          'ERROR'
      ).length

    const recentSyncs =
      assignments
        .filter(
          assignment =>
            assignment.sync_status ===
            'SYNCED'
        )
        .sort(
          (a, b) =>
            new Date(
              b.actualizado_at
            ) -
            new Date(
              a.actualizado_at
            )
        )
        .slice(0, 5)

    const recentErrors =
      assignments
        .filter(
          assignment =>
            assignment.sync_status ===
            'ERROR'
        )
        .sort(
          (a, b) =>
            new Date(
              b.actualizado_at
            ) -
            new Date(
              a.actualizado_at
            )
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
    if (!clienteId) {
      return null
    }

    const {
      data,
      error
    } = await supabase
      .from('clientes')
      .select(
        'id, nombre_empresa, biometric_sync_policy, id_empresa'
      )
      .eq(
        'id',
        clienteId
      )
      .single()

    if (error) {
      throw error
    }

    return data
  },


  /**
   * Actualiza política.
   */
  async updateSyncPolicy(
    clienteId,
    policy
  ) {
    if (
      !clienteId ||
      !policy
    ) {
      throw new Error(
        'Cliente y política requeridos'
      )
    }

    const {
      data,
      error
    } = await supabase
      .from('clientes')
      .update({
        biometric_sync_policy:
          policy,

        actualizado_at:
          new Date().toISOString()
      })
      .eq(
        'id',
        clienteId
      )
      .select()
      .single()

    if (error) {
      throw error
    }

    return data
  },


  /**
   * Obtiene tenants relacionados que comparten empresa.
   */
  async getRelatedTenants(
    clienteId
  ) {
    if (!clienteId) {
      return []
    }

    const {
      data: current,
      error: curErr
    } = await supabase
      .from('clientes')
      .select(
        'id, nombre_empresa, id_empresa'
      )
      .eq(
        'id',
        clienteId
      )
      .single()

    if (curErr) {
      throw curErr
    }

    if (!current?.id_empresa) {
      return [current]
    }

    const {
      data: related,
      error: relErr
    } = await supabase
      .from('clientes')
      .select(
        'id, nombre_empresa, id_empresa'
      )
      .eq(
        'id_empresa',
        current.id_empresa
      )

    if (relErr) {
      throw relErr
    }

    return related || [current]
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 7. EMPLOYEES / ASSIGNMENTS / PROVISIONING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene colaboradores y asignaciones.
   *
   * Respeta la política EMPRESA:
   *
   * - EMPRESA:
   *   utiliza los tenants relacionados.
   *
   * - cualquier otra política:
   *   utiliza solamente el tenant actual.
   *
   * Los devices se obtienen directamente desde:
   *
   * devices.cliente_id
   */
  async getEmployeesSync(
    clienteId
  ) {
    if (!clienteId) {
      return {
        employees: [],
        assignments: [],
        devices: [],
        tenants: []
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 1. Obtener tenant actual
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: currentTenant,
      error: tenantErr
    } = await supabase
      .from('clientes')
      .select(
        'id, nombre_empresa, id_empresa, biometric_sync_policy'
      )
      .eq(
        'id',
        clienteId
      )
      .single()

    if (tenantErr) {
      throw tenantErr
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. Determinar alcance
    // ────────────────────────────────────────────────────────────────────────

    let relatedTenants = [
      currentTenant
    ]

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
      relatedTenants
        .map(tenant => tenant.id)
        .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // 3. Empleados
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: employees,
      error: empErr
    } = await supabase
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
        {
          ascending: true
        }
      )

    if (empErr) {
      throw empErr
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. Devices
    //
    // AQUÍ ESTÁ EL CAMBIO IMPORTANTE:
    //
    // Antes:
    //
    //   dispositivos
    //      ↓
    //   device_id_hikvision
    //      ↓
    //   devices
    //
    // Ahora:
    //
    //   devices.cliente_id
    //      ↓
    //   devices
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: filteredDevices,
      error: devErr
    } = await supabase
      .from('devices')
      .select('*')
      .in(
        'cliente_id',
        tenantIds
      )
      .order(
        'created_at',
        {
          ascending: false
        }
      )

    if (devErr) {
      throw devErr
    }

    const normalizedDevices =
      (filteredDevices || []).map(
        device => ({
          ...device,

          serial_number:
            this.normalizeSerial(
              device.serial_number
            )
        })
      )

    // ────────────────────────────────────────────────────────────────────────
    // 5. Asignaciones
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: assignments,
      error: assignErr
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .select('*')
      .in(
        'cliente_id',
        tenantIds
      )

    if (assignErr) {
      throw assignErr
    }

    return {
      employees:
        employees || [],

      assignments:
        assignments || [],

      devices:
        normalizedDevices,

      tenants:
        relatedTenants
    }
  },


  /**
   * Crea o actualiza una asignación.
   *
   * device_id corresponde directamente a:
   *
   * devices.id
   */
  async saveAssignment({
    cliente_id,
    device_id,
    employee_id,
    biometric_user_id,
    activo = true
  }) {
    if (!cliente_id) {
      throw new Error(
        'cliente_id es requerido'
      )
    }

    if (!device_id) {
      throw new Error(
        'device_id es requerido'
      )
    }

    if (!employee_id) {
      throw new Error(
        'employee_id es requerido'
      )
    }

    if (!biometric_user_id?.trim()) {
      throw new Error(
        'El ID de usuario biométrico es requerido'
      )
    }

    const normalizedBiometricUserId =
      biometric_user_id.trim()

    // ────────────────────────────────────────────────────────────────────────
    // Verificar directamente en devices
    // ────────────────────────────────────────────────────────────────────────

    await this.assertDeviceBelongsToTenant(
      device_id,
      cliente_id
    )

    // ────────────────────────────────────────────────────────────────────────
    // Payload
    // ────────────────────────────────────────────────────────────────────────

    const payload = {
      cliente_id,

      device_id,

      employee_id,

      biometric_user_id:
        normalizedBiometricUserId,

      activo:
        Boolean(activo),

      sync_status:
        'PENDING',

      last_error:
        null,

      actualizado_at:
        new Date().toISOString()
    }

    // ────────────────────────────────────────────────────────────────────────
    // Buscar asignación existente
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: existing,
      error: existingErr
    } = await supabase
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
        normalizedBiometricUserId
      )
      .maybeSingle()

    if (existingErr) {
      throw existingErr
    }

    // ────────────────────────────────────────────────────────────────────────
    // Actualizar
    // ────────────────────────────────────────────────────────────────────────

    if (existing) {
      const {
        data,
        error
      } = await supabase
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

      if (error) {
        throw error
      }

      return data
    }

    // ────────────────────────────────────────────────────────────────────────
    // Crear
    // ────────────────────────────────────────────────────────────────────────

    const {
      data,
      error
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .insert([payload])
      .select()
      .single()

    if (error) {
      throw error
    }

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

    const {
      data,
      error
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .update({
        activo:
          false,

        sync_status:
          'PENDING',

        last_error:
          null,

        actualizado_at:
          new Date().toISOString()
      })
      .eq(
        'id',
        assignmentId
      )
      .select()
      .single()

    if (error) {
      throw error
    }

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
      .select(
        'activo'
      )
      .eq(
        'id',
        assignmentId
      )
      .single()

    if (getErr) {
      throw getErr
    }

    const {
      data,
      error
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .update({
        activo:
          current.activo,

        sync_status:
          'PENDING',

        last_error:
          null,

        actualizado_at:
          new Date().toISOString()
      })
      .eq(
        'id',
        assignmentId
      )
      .select()
      .single()

    if (error) {
      throw error
    }

    return data
  }

}

