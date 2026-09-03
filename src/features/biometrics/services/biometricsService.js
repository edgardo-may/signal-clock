// src/features/biometrics/services/biometricsService.js
//
// Servicio centralizado para biometría.
//
// ARQUITECTURA ACTUAL:
//
// clientes
//   └── devices
//         ├── id
//         ├── cliente_id
//         ├── serial_number
//         ├── name
//         ├── location
//         ├── ip_address
//         ├── port
//         ├── timezone
//         ├── device_type
//         ├── is_active
//         └── last_activity
//
// device_employee_assignments.device_id
//         └── devices.id
//
// IMPORTANTE:
// Este servicio NO utiliza la tabla `dispositivos`.
// La fuente de verdad para dispositivos es `devices`.

import { supabase } from '../../../lib/supabase'

const DEFAULT_TIMEZONE = 'America/Cancun'
const DEFAULT_DEVICE_TYPE = 'general'
const DEFAULT_PORT = 7660

const normalizeSerial = value => {
  if (!value) return ''
  return String(value).trim().toUpperCase()
}

const normalizeSearch = value => {
  if (!value) return ''
  return String(value).trim().toLowerCase()
}

const normalizeDevice = device => {
  if (!device) return null

  return {
    ...device,

    id: device.id || null,

    cliente_id: device.cliente_id || null,

    serial_number: normalizeSerial(
      device.serial_number
    ),

    name: device.name || '',

    location: device.location || null,

    ip_address: device.ip_address || null,

    port:
      device.port !== null &&
      device.port !== undefined
        ? Number(device.port)
        : DEFAULT_PORT,

    timezone:
      device.timezone ||
      DEFAULT_TIMEZONE,

    device_type:
      device.device_type ||
      DEFAULT_DEVICE_TYPE,

    is_active:
      Boolean(device.is_active)
  }
}

const emptyStats = () => ({
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
})

export const biometricsService = {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene los seriales de devices pertenecientes al cliente.
   *
   * FUENTE:
   * devices.cliente_id
   *
   * NO utiliza dispositivos.
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
      .map(row =>
        normalizeSerial(row.serial_number)
      )
      .filter(Boolean)
  },


  /**
   * Obtiene los IDs de devices pertenecientes al cliente.
   *
   * FUENTE:
   * devices.id
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
   * Obtiene devices completos del tenant.
   *
   * IMPORTANTE:
   * Esta función consulta DIRECTAMENTE `devices`.
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

    return (data || [])
      .map(normalizeDevice)
      .filter(Boolean)
  },


  /**
   * Valida que un device pertenezca al cliente.
   */
  async assertDeviceBelongsToTenant(
    deviceId,
    clienteId
  ) {
    if (!deviceId) {
      throw new Error(
        'device_id es requerido.'
      )
    }

    if (!clienteId) {
      throw new Error(
        'cliente_id es requerido.'
      )
    }

    const { data, error } = await supabase
      .from('devices')
      .select(
        'id, cliente_id, serial_number, name'
      )
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

    return normalizeDevice(data)
  },


  /**
   * Convierte un array de devices en mapa por ID.
   */
  createDeviceIdMap(devices = []) {
    const map = {}

    devices.forEach(device => {
      if (device?.id) {
        map[String(device.id)] = device
      }
    })

    return map
  },


  /**
   * Convierte un array de devices en mapa por serial.
   */
  createDeviceSerialMap(devices = []) {
    const map = {}

    devices.forEach(device => {
      const serial = normalizeSerial(
        device?.serial_number
      )

      if (serial) {
        map[serial] = device
      }
    })

    return map
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DEVICES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene dispositivos del tenant actual.
   *
   * FUENTE ÚNICA:
   * devices
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

    let query = supabase
      .from('devices')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('created_at', {
        ascending: false
      })

    // Estado
    if (status === 'active') {
      query = query.eq(
        'is_active',
        true
      )
    } else if (status === 'inactive') {
      query = query.eq(
        'is_active',
        false
      )
    }

    // Tipo
    if (
      type &&
      type !== 'todos'
    ) {
      query = query.eq(
        'device_type',
        type
      )
    }

    const { data, error } = await query

    if (error) {
      console.error(
        '[biometricsService.getDevices]',
        error
      )

      throw error
    }

    let list = (data || [])
      .map(normalizeDevice)
      .filter(Boolean)

    // Búsqueda
    const q = normalizeSearch(search)

    if (q) {
      list = list.filter(device => {
        return (
          normalizeSearch(
            device.name
          ).includes(q) ||

          normalizeSearch(
            device.serial_number
          ).includes(q) ||

          normalizeSearch(
            device.location
          ).includes(q) ||

          normalizeSearch(
            device.ip_address
          ).includes(q) ||

          normalizeSearch(
            device.device_type
          ).includes(q) ||

          normalizeSearch(
            device.timezone
          ).includes(q)
        )
      })
    }

    // Cargar estadísticas de sincronización por dispositivo
    try {
      const { data: assignments } = await supabase
        .from('device_employee_assignments')
        .select('device_id, sync_status, activo')
        .eq('cliente_id', clienteId)
        .eq('activo', true)

      const assignmentMap = {}
      ;(assignments || []).forEach(a => {
        if (!assignmentMap[a.device_id]) {
          assignmentMap[a.device_id] = { total: 0, synced: 0, pending: 0, error: 0 }
        }
        assignmentMap[a.device_id].total += 1
        if (a.sync_status === 'SYNCED') {
          assignmentMap[a.device_id].synced += 1
        } else if (a.sync_status === 'ERROR') {
          assignmentMap[a.device_id].error += 1
        } else {
          assignmentMap[a.device_id].pending += 1
        }
      })

      list = list.map(device => ({
        ...device,
        syncStats: assignmentMap[device.id] || { total: 0, synced: 0, pending: 0, error: 0 }
      }))
    } catch (e) {
      console.warn('[biometricsService.getDevices] No se pudieron cargar syncStats:', e)
    }

    return list
  },


  /**
   * Obtiene un device por su UUID.
   *
   * También verifica cliente si se proporciona.
   */
  async getDeviceById(
    id,
    clienteId = null
  ) {
    if (!id) {
      throw new Error(
        'ID de dispositivo requerido'
      )
    }

    let query = supabase
      .from('devices')
      .select('*')
      .eq('id', id)

    if (clienteId) {
      query = query.eq(
        'cliente_id',
        clienteId
      )
    }

    const {
      data: device,
      error: devErr
    } = await query.maybeSingle()

    if (devErr) {
      console.error(
        '[biometricsService.getDeviceById]',
        devErr
      )

      throw devErr
    }

    if (!device) {
      return null
    }

    const normalizedDevice =
      normalizeDevice(device)

    const serial =
      normalizedDevice.serial_number

    // Comandos recientes
    let commands = []

    if (serial) {
      const {
        data,
        error
      } = await supabase
        .from('device_commands')
        .select('*')
        .eq(
          'device_serial',
          serial
        )
        .order(
          'created_at',
          {
            ascending: false
          }
        )
        .limit(30)

      if (error) {
        throw error
      }

      commands = data || []
    }

    // Logs recientes
    let logs = []

    if (serial) {
      const {
        data,
        error
      } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq(
          'device_serial',
          serial
        )
        .order(
          'timestamp',
          {
            ascending: false
          }
        )
        .limit(30)

      if (error) {
        throw error
      }

      logs = data || []
    }

    // Asignaciones del device
    let assignments = []

    const {
      data: assignmentData,
      error: assignmentError
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .select('*')
      .eq(
        'device_id',
        normalizedDevice.id
      )
      .order(
        'actualizado_at',
        {
          ascending: false
        }
      )

    if (assignmentError) {
      throw assignmentError
    }

    assignments =
      assignmentData || []

    return {
      ...normalizedDevice,
      commands,
      logs,
      assignments
    }
  },


  /**
   * Crea un device.
   *
   * IMPORTANTE:
   * Ya NO crea registros en `dispositivos`.
   */
  async createDevice({
    name,
    serial_number,
    location,
    ip_address,
    port = DEFAULT_PORT,
    timezone = DEFAULT_TIMEZONE,
    device_type = DEFAULT_DEVICE_TYPE,
    is_active = true,
    cliente_id
  }) {
    if (!cliente_id) {
      throw new Error(
        'Falta cliente_id para registrar el dispositivo.'
      )
    }

    const normalizedSerial =
      normalizeSerial(
        serial_number
      )

    if (!normalizedSerial) {
      throw new Error(
        'El número de serie es obligatorio.'
      )
    }

    // Verificar serial existente dentro del tenant
    const {
      data: existing,
      error: existingErr
    } = await supabase
      .from('devices')
      .select('*')
      .eq(
        'cliente_id',
        cliente_id
      )
      .eq(
        'serial_number',
        normalizedSerial
      )
      .maybeSingle()

    if (existingErr) {
      throw existingErr
    }

    if (existing) {
      throw new Error(
        'Este número de serie ya está asignado a este cliente.'
      )
    }

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
        port
          ? parseInt(port, 10)
          : DEFAULT_PORT,

      timezone:
        timezone ||
        DEFAULT_TIMEZONE,

      device_type:
        device_type ||
        DEFAULT_DEVICE_TYPE,

      is_active:
        Boolean(is_active),

      cliente_id,

      last_activity:
        null
    }

    const {
      data,
      error
    } = await supabase
      .from('devices')
      .insert([payload])
      .select()
      .single()

    if (error) {
      // Carrera de inserción
      if (error.code === '23505') {
        throw new Error(
          'El dispositivo ya existe.'
        )
      }

      throw error
    }

    return normalizeDevice(data)
  },


  /**
   * Actualiza un device.
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
      is_active
    }
  ) {
    if (!id) {
      throw new Error(
        'ID de dispositivo requerido'
      )
    }

    const payload = {
      name:
        name?.trim() || null,

      serial_number:
        normalizeSerial(
          serial_number
        ),

      location:
        location?.trim() || null,

      ip_address:
        ip_address?.trim() || null,

      port:
        port
          ? parseInt(port, 10)
          : DEFAULT_PORT,

      timezone:
        timezone ||
        DEFAULT_TIMEZONE,

      device_type:
        device_type ||
        DEFAULT_DEVICE_TYPE,

      is_active:
        Boolean(is_active)
    }

    if (!payload.serial_number) {
      throw new Error(
        'El número de serie es obligatorio.'
      )
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
      throw error
    }

    return normalizeDevice(data)
  },


  /**
   * Elimina un device.
   *
   * Primero elimina asignaciones para evitar
   * problemas de foreign key.
   */
  async deleteDevice(id) {
    if (!id) {
      throw new Error(
        'ID de dispositivo requerido'
      )
    }

    const {
      data: device,
      error: getErr
    } = await supabase
      .from('devices')
      .select(
        'id, cliente_id, serial_number'
      )
      .eq('id', id)
      .maybeSingle()

    if (getErr) {
      throw getErr
    }

    if (!device) {
      throw new Error(
        'Dispositivo no encontrado.'
      )
    }

    // Eliminar asignaciones
    const {
      error: assignmentError
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .delete()
      .eq(
        'device_id',
        id
      )

    if (assignmentError) {
      throw assignmentError
    }

    // Eliminar hardware
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
   * Obtiene registros de asistencia del tenant.
   *
   * Los seriales permitidos salen directamente de devices.
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

    // Empleados
    const {
      data: empleados,
      error: empErr
    } = await supabase
      .from('empleados')
      .select(
        'id, nombre, apellido, clave_empleado, device_userid, avatar_url, cliente_id'
      )
      .eq(
        'cliente_id',
        clienteId
      )

    if (empErr) {
      throw empErr
    }

    const employeeMap = {}

    ;(empleados || []).forEach(
      emp => {
        if (
          emp.hikvision_device_userid
        ) {
          employeeMap[
            String(
              emp.hikvision_device_userid
            )
          ] = emp
        }

        if (emp.clave_empleado) {
          employeeMap[
            String(
              emp.clave_empleado
            )
          ] = emp
        }

        if (emp.id) {
          employeeMap[
            String(emp.id)
          ] = emp
        }
      }
    )

    // Devices del tenant
    const devices =
      await this.getDevices({
        clienteId
      })

    const allowedSerials =
      devices
        .map(
          device =>
            normalizeSerial(
              device.serial_number
            )
        )
        .filter(Boolean)

    if (!allowedSerials.length) {
      return {
        logs: [],
        devices,
        employees:
          empleados || []
      }
    }

    // Logs
    let query = supabase
      .from('attendance_logs')
      .select('*')
      .in(
        'device_serial',
        allowedSerials
      )
      .order(
        'timestamp',
        {
          ascending: false
        }
      )
      .limit(limit)

    if (
      deviceSerial &&
      deviceSerial !== 'todos'
    ) {
      query = query.eq(
        'device_serial',
        normalizeSerial(
          deviceSerial
        )
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

    const deviceMap =
      this.createDeviceSerialMap(
        devices
      )

    let enriched =
      (logs || []).map(
        log => {
          const emp =
            employeeMap[
              String(
                log.user_id
              )
            ] || null

          const serial =
            normalizeSerial(
              log.device_serial
            )

          const dev =
            deviceMap[
              serial
            ] || null

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
                  id:
                    dev.id,

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
        }
      )

    const q =
      normalizeSearch(search)

    if (q) {
      enriched =
        enriched.filter(
          log =>
            normalizeSearch(
              log.user_id
            ).includes(q) ||

            normalizeSearch(
              log.device_serial
            ).includes(q) ||

            normalizeSearch(
              log.status
            ).includes(q) ||

            normalizeSearch(
              log.empleado
                ?.nombreCompleto
            ).includes(q) ||

            normalizeSearch(
              log.empleado?.clave
            ).includes(q) ||

            normalizeSearch(
              log.dispositivo?.nombre
            ).includes(q)
        )
    }

    return {
      logs: enriched,
      devices,
      employees:
        empleados || []
    }
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DEVICE COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene comandos exclusivamente de devices del tenant.
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

    const devices =
      await this.getDevices({
        clienteId
      })

    const allowedSerials =
      devices
        .map(
          device =>
            normalizeSerial(
              device.serial_number
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
      .order(
        'created_at',
        {
          ascending: false
        }
      )
      .limit(limit)

    if (
      deviceSerial &&
      deviceSerial !== 'todos'
    ) {
      query = query.eq(
        'device_serial',
        normalizeSerial(
          deviceSerial
        )
      )
    }

    if (
      status === 'executed'
    ) {
      query = query.eq(
        'is_executed',
        true
      )
    } else if (
      status === 'pending'
    ) {
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

    const deviceMap =
      this.createDeviceSerialMap(
        devices
      )

    const enriched =
      (commands || []).map(
        command => ({
          ...command,

          dispositivo:
            deviceMap[
              normalizeSerial(
                command.device_serial
              )
            ] || null
        })
      )

    return {
      commands: enriched,
      devices
    }
  },


  /**
   * Envía un comando.
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
      normalizeSerial(
        device_serial
      )

    const allowedSerials =
      await this.getTenantDeviceSerials(
        clienteId
      )

    if (
      !allowedSerials.includes(
        normalizedSerial
      )
    ) {
      throw new Error(
        'El dispositivo no pertenece al cliente seleccionado.'
      )
    }

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
   * Estadísticas del tenant.
   *
   * Los devices vienen directamente de:
   * devices.cliente_id
   */
  async getBiometricsStats(
    clienteId
  ) {
    if (!clienteId) {
      return emptyStats()
    }

    const devices =
      await this.getDevices({
        clienteId
      })

    const allowedSerials =
      devices
        .map(
          device =>
            normalizeSerial(
              device.serial_number
            )
        )
        .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // Fecha de hoy
    // ────────────────────────────────────────────────────────────────────────

    const today =
      new Date()

    today.setHours(
      0,
      0,
      0,
      0
    )

    const todayIso =
      today.toISOString()

    // ────────────────────────────────────────────────────────────────────────
    // Logs
    // ────────────────────────────────────────────────────────────────────────

    let totalLogsToday = 0
    let recentLogs = []

    if (allowedSerials.length) {
      const {
        count,
        error
      } = await supabase
        .from(
          'attendance_logs'
        )
        .select(
          '*',
          {
            count:
              'exact',
            head:
              true
          }
        )
        .in(
          'device_serial',
          allowedSerials
        )
        .gte(
          'timestamp',
          todayIso
        )

      if (error) {
        throw error
      }

      totalLogsToday =
        count ?? 0

      const {
        data,
        error:
          recentError
      } = await supabase
        .from(
          'attendance_logs'
        )
        .select('*')
        .in(
          'device_serial',
          allowedSerials
        )
        .order(
          'timestamp',
          {
            ascending:
              false
          }
        )
        .limit(10)

      if (recentError) {
        throw recentError
      }

      recentLogs =
        data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Commands
    // ────────────────────────────────────────────────────────────────────────

    let recentCommands = []

    if (allowedSerials.length) {
      const {
        data,
        error
      } = await supabase
        .from(
          'device_commands'
        )
        .select('*')
        .in(
          'device_serial',
          allowedSerials
        )
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(10)

      if (error) {
        throw error
      }

      recentCommands =
        data || []
    }

    // ────────────────────────────────────────────────────────────────────────
    // Assignments
    //
    // AQUÍ USAMOS devices.id.
    // NO dispositivos.
    // ────────────────────────────────────────────────────────────────────────

    const deviceIds =
      devices
        .map(
          device =>
            device.id
        )
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
          new Date(
            lastActivity
          )

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

    devices.forEach(
      device => {
        if (
          !device.last_activity
        ) {
          return
        }

        const timestamp =
          new Date(
            device.last_activity
          )

        if (
          !latestActivity ||
          timestamp >
            latestActivity
        ) {
          latestActivity =
            timestamp
        }
      }
    )

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
  async getSyncPolicy(
    clienteId
  ) {
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
      error: currentError
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

    if (currentError) {
      throw currentError
    }

    if (
      !current?.id_empresa
    ) {
      return [current]
    }

    const {
      data: related,
      error: relatedError
    } = await supabase
      .from('clientes')
      .select(
        'id, nombre_empresa, id_empresa'
      )
      .eq(
        'id_empresa',
        current.id_empresa
      )

    if (relatedError) {
      throw relatedError
    }

    return (
      related ||
      [current]
    )
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // 7. EMPLOYEES / ASSIGNMENTS / PROVISIONING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene empleados, asignaciones y devices.
   *
   * EMPRESA:
   * Si la política es EMPRESA se utilizan los tenants relacionados.
   *
   * IMPORTANTE:
   * Los devices se obtienen DIRECTAMENTE desde `devices`
   * usando `cliente_id`.
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

    // Política actual
    const {
      data: currentTenant,
      error: tenantError
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

    if (tenantError) {
      throw tenantError
    }

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
        .map(
          tenant =>
            tenant.id
        )
        .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // Employees
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: employees,
      error: employeeError
    } = await supabase
      .from('empleados')
      .select(
        'id, nombre, apellido, clave_empleado, activo, cliente_id, avatar_url, departamento, hikvision_device_userid'
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

    if (employeeError) {
      throw employeeError
    }

    // ────────────────────────────────────────────────────────────────────────
    // DEVICES
    //
    // ESTA ES LA PARTE CLAVE.
    //
    // Antes:
    //
    // dispositivos
    //   -> device_id_hikvision
    //   -> devices
    //
    // Ahora:
    //
    // devices
    //   -> cliente_id
    //
    // ────────────────────────────────────────────────────────────────────────

    const {
      data: devices,
      error: deviceError
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
          ascending:
            false
        }
      )

    if (deviceError) {
      throw deviceError
    }

    const filteredDevices =
      (devices || [])
        .map(normalizeDevice)
        .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // DEVICE IDS
    // ────────────────────────────────────────────────────────────────────────

    const deviceIds =
      filteredDevices
        .map(
          device =>
            device.id
        )
        .filter(Boolean)

    // ────────────────────────────────────────────────────────────────────────
    // Assignments
    //
    // Solo consultamos si realmente existen devices.
    // ────────────────────────────────────────────────────────────────────────

    let assignments = []

    if (deviceIds.length) {
      const {
        data,
        error
      } = await supabase
        .from(
          'device_employee_assignments'
        )
        .select('*')
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

    return {
      employees:
        employees || [],

      assignments,

      devices:
        filteredDevices,

      tenants:
        relatedTenants
    }
  },


  /**
   * Crea o actualiza una asignación.
   *
   * device_id SIEMPRE es:
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

    if (
      !biometric_user_id?.trim()
    ) {
      throw new Error(
        'El ID de usuario biométrico es requerido'
      )
    }

    // ────────────────────────────────────────────────────────────────────────
    // Verificar directamente contra devices
    // ────────────────────────────────────────────────────────────────────────

    await this.assertDeviceBelongsToTenant(
      device_id,
      cliente_id
    )

    const biometricUserId =
      biometric_user_id.trim()

    const payload = {
      cliente_id,

      device_id,

      employee_id,

      biometric_user_id:
        biometricUserId,

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
      error: existingError
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .select(
        'id, device_id, employee_id, cliente_id, biometric_user_id'
      )
      .eq(
        'device_id',
        device_id
      )
      .eq(
        'biometric_user_id',
        biometricUserId
      )
      .maybeSingle()

    if (existingError) {
      throw existingError
    }

    // ────────────────────────────────────────────────────────────────────────
    // UPDATE
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
    // INSERT
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
      error: getError
    } = await supabase
      .from(
        'device_employee_assignments'
      )
      .select(
        'id, activo'
      )
      .eq(
        'id',
        assignmentId
      )
      .single()

    if (getError) {
      throw getError
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

