// src/features/biometrics/services/biometricsService.js
// Servicio centralizado para interactuar con: devices, attendance_logs y device_commands

import { supabase } from '../../../lib/supabase'

export const biometricsService = {
  // ── 1. DEVICES ─────────────────────────────────────────────────────────────
  
  /**
   * Obtiene todos los dispositivos con filtros por estado y tipo
   */
  async getDevices({ search = '', status = 'todos', type = 'todos' } = {}) {
    let query = supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: false })

    if (status === 'active') {
      query = query.eq('is_active', true)
    } else if (status === 'inactive') {
      query = query.eq('is_active', false)
    }

    if (type && type !== 'todos') {
      try {
        query = query.eq('device_type', type)
      } catch (_) {}
    }

    const { data, error } = await query

    if (error) throw error

    let list = data || []
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        d.name?.toLowerCase().includes(q) ||
        d.serial_number?.toLowerCase().includes(q) ||
        d.location?.toLowerCase().includes(q) ||
        d.ip_address?.toLowerCase().includes(q) ||
        d.device_type?.toLowerCase().includes(q) ||
        d.timezone?.toLowerCase().includes(q)
      )
    }

    return list
  },

  /**
   * Obtiene un dispositivo por su ID junto con sus comandos y logs asociados
   */
  async getDeviceById(id) {
    const { data: device, error: devErr } = await supabase
      .from('devices')
      .select('*')
      .eq('id', id)
      .single()

    if (devErr) throw devErr

    if (!device) return null

    // Consultar comandos recientes del dispositivo por serial_number
    const { data: commands } = await supabase
      .from('device_commands')
      .select('*')
      .eq('device_serial', device.serial_number)
      .order('created_at', { ascending: false })
      .limit(30)

    // Consultar registros de asistencia recientes del dispositivo por serial_number
    const { data: logs } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('device_serial', device.serial_number)
      .order('timestamp', { ascending: false })
      .limit(30)

    return {
      ...device,
      commands: commands || [],
      logs: logs || []
    }
  },

  /**
   * Crea un nuevo dispositivo en la tabla `devices` con soporte para campos extendidos
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
    cliente_id // Obtenido del tenant actual
  }) {
    if (!cliente_id) throw new Error("Falta cliente_id para registrar el dispositivo.")

    const hardwarePayload = {
      name: name?.trim(),
      serial_number: serial_number?.trim().toUpperCase(),
      location: location?.trim() || null,
      ip_address: ip_address?.trim() || null,
      port: port ? parseInt(port, 10) : 7660,
      timezone: timezone || 'America/Mexico_City',
      device_type: device_type || 'general',
      is_active: Boolean(is_active),
      last_activity: null // Explicitly null for PENDING_CONNECTION
    }

    // 1. Insertar en devices (Registro Global)
    let { data: device, error: devErr } = await supabase
      .from('devices')
      .insert([hardwarePayload])
      .select()
      .single()

    // Manejo de schema viejo si es necesario
    if (devErr && (devErr.message?.includes('does not exist') || devErr.code === '42703')) {
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
      device = retry.data
    } else if (devErr) {
      if (devErr.code === '23505') throw new Error('Este número de serie ya está registrado en la plataforma.');
      throw devErr;
    }

    // 2. Insertar en dispositivos (Registro Tenant)
    const tenantPayload = {
      cliente_id,
      device_id_hikvision: hardwarePayload.serial_number,
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
      if (dispErr.code === '23505') throw new Error('Este número de serie ya está asignado a un tenant.');
      throw dispErr;
    }

    return { ...device, dispositivo }
  },

  /**
   * Actualiza un dispositivo existente
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
    let payload = {
      name: name?.trim(),
      serial_number: serial_number?.trim(),
      location: location?.trim() || null,
      ip_address: ip_address?.trim() || null,
      port: port ? parseInt(port, 10) : 7660,
      timezone: timezone || 'America/Mexico_City',
      device_type: device_type || 'general',
      is_active: Boolean(is_active),
    }

    let { data, error } = await supabase
      .from('devices')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    // Fallback si columnas extendidas no existen en la BD todavía
    if (error && (error.message?.includes('does not exist') || error.code === '42703')) {
      const basePayload = {
        name: payload.name,
        serial_number: payload.serial_number,
        location: payload.location,
        is_active: payload.is_active,
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
   * Elimina un dispositivo por ID
   */
  async deleteDevice(id) {
    const { error } = await supabase
      .from('devices')
      .delete()
      .eq('id', id)

    if (error) throw error
    return true
  },


  // ── 2. ATTENDANCE LOGS ─────────────────────────────────────────────────────

  /**
   * Obtiene registros de asistencia biométrica con filtros y mapa de empleados
   */
  async getAttendanceLogs({
    search = '',
    deviceSerial = 'todos',
    userId = 'todos',
    dateFrom = '',
    dateTo = '',
    limit = 200
  } = {}) {
    // 1. Obtener empleados para mapear user_id a nombre y avatar
    const { data: empleados } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, clave_empleado, hikvision_device_userid, avatar_url')

    const employeeMap = {}
    ;(empleados || []).forEach(emp => {
      if (emp.hikvision_device_userid) employeeMap[emp.hikvision_device_userid] = emp
      if (emp.clave_empleado) employeeMap[emp.clave_empleado] = emp
      if (emp.id) employeeMap[emp.id] = emp
    })

    // 2. Obtener devices para mapear device_serial a nombre del dispositivo
    const { data: devices } = await supabase
      .from('devices')
      .select('id, name, serial_number, location, ip_address, port, timezone, device_type')

    const deviceMap = {}
    ;(devices || []).forEach(dev => {
      if (dev.serial_number) deviceMap[dev.serial_number] = dev
    })

    // 3. Consultar attendance_logs
    let query = supabase
      .from('attendance_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (deviceSerial && deviceSerial !== 'todos') {
      query = query.eq('device_serial', deviceSerial)
    }

    if (userId && userId !== 'todos') {
      query = query.eq('user_id', userId)
    }

    if (dateFrom) {
      const fromIso = new Date(dateFrom + 'T00:00:00').toISOString()
      query = query.gte('timestamp', fromIso)
    }

    if (dateTo) {
      const toIso = new Date(dateTo + 'T23:59:59.999').toISOString()
      query = query.lte('timestamp', toIso)
    }

    const { data: logs, error } = await query

    if (error) throw error

    // Enriquecer registros con datos de empleado y dispositivo
    let enriched = (logs || []).map(log => {
      const emp = employeeMap[log.user_id] || null
      const dev = deviceMap[log.device_serial] || null

      return {
        ...log,
        empleado: emp ? {
          nombreCompleto: `${emp.nombre || ''} ${emp.apellido || ''}`.trim() || 'Colaborador',
          clave: emp.clave_empleado || emp.hikvision_device_userid || log.user_id,
          avatar_url: emp.avatar_url,
        } : null,
        dispositivo: dev ? {
          nombre: dev.name || dev.serial_number,
          ubicacion: dev.location,
          ip_address: dev.ip_address,
          device_type: dev.device_type,
        } : null
      }
    })

    // Filtrado de búsqueda client-side para búsquedas compuestas
    if (search.trim()) {
      const q = search.toLowerCase()
      enriched = enriched.filter(l =>
        l.user_id?.toLowerCase().includes(q) ||
        l.device_serial?.toLowerCase().includes(q) ||
        l.status?.toLowerCase().includes(q) ||
        l.empleado?.nombreCompleto?.toLowerCase().includes(q) ||
        l.empleado?.clave?.toLowerCase().includes(q) ||
        l.dispositivo?.nombre?.toLowerCase().includes(q)
      )
    }

    return { logs: enriched, devices: devices || [], employees: empleados || [] }
  },


  // ── 3. DEVICE COMMANDS ─────────────────────────────────────────────────────

  /**
   * Obtiene la cola de comandos enviados a los dispositivos
   */
  async getDeviceCommands({ deviceSerial = 'todos', status = 'todos', limit = 100 } = {}) {
    let query = supabase
      .from('device_commands')
      .select('*')
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

    // Obtener nombres de dispositivos
    const { data: devices } = await supabase.from('devices').select('name, serial_number, location')
    const deviceMap = {}
    ;(devices || []).forEach(d => { deviceMap[d.serial_number] = d })

    const enriched = (commands || []).map(cmd => ({
      ...cmd,
      dispositivo: deviceMap[cmd.device_serial] || null
    }))

    return { commands: enriched, devices: devices || [] }
  },

  /**
   * Envia un nuevo comando para un dispositivo
   */
  async sendCommand({ device_serial, command_string }) {
    if (!device_serial || !command_string) {
      throw new Error('El número de serie y el comando son obligatorios.')
    }

    const payload = {
      device_serial: device_serial.trim(),
      command_string: command_string.trim(),
      is_executed: false,
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
   * Marca un comando como ejecutado o no ejecutado
   */
  async toggleCommandExecuted(id, is_executed) {
    const { data, error } = await supabase
      .from('device_commands')
      .update({ is_executed: Boolean(is_executed), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * Elimina un comando de la cola
   */
  async deleteCommand(id) {
    const { error } = await supabase
      .from('device_commands')
      .delete()
      .eq('id', id)

    if (error) throw error
    return true
  },


  // ── 4. STATS Y MÉTRICAS ────────────────────────────────────────────────────

  /**
   * Calcula las estadísticas consolidadas para el Dashboard de Biométricos
   */
  async getBiometricsStats() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayIso = today.toISOString()

    const [
      { data: allDevices, error: devErr },
      { count: totalLogsToday },
      { data: recentLogs },
      { data: recentCommands },
      { data: assignments, error: assignErr }
    ] = await Promise.all([
      supabase.from('devices').select('*'),
      supabase.from('attendance_logs').select('*', { count: 'exact', head: true }).gte('timestamp', todayIso),
      supabase.from('attendance_logs').select('*').order('timestamp', { ascending: false }).limit(10),
      supabase.from('device_commands').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('device_employee_assignments').select('sync_status, last_error, actualizado_at')
    ])

    if (devErr) throw devErr

    const devices = allDevices || []
    const totalDevices = devices.length

    // Heartbeat en los últimos 5 minutos determina ONLINE
    const isOnline = (lastActivity) => {
      if (!lastActivity) return false
      const diffMs = new Date() - new Date(lastActivity)
      return diffMs < 5 * 60 * 1000
    }

    const onlineDevices = devices.filter(d => d.is_active && isOnline(d.last_activity)).length
    const offlineDevices = totalDevices - onlineDevices
    const activeDevices = devices.filter(d => d.is_active).length
    const inactiveDevices = totalDevices - activeDevices

    // Contar comandos pendientes y ejecutados
    const pendingCommands = (recentCommands || []).filter(c => !c.is_executed).length
    const executedCommands = (recentCommands || []).filter(c => c.is_executed).length

    // Última actividad global de dispositivos
    let latestActivity = null
    devices.forEach(d => {
      if (d.last_activity) {
        const t = new Date(d.last_activity)
        if (!latestActivity || t > latestActivity) {
          latestActivity = t
        }
      }
    })

    // Sincronizaciones por estado
    const syncedAssignments = (assignments || []).filter(a => a.sync_status === 'SYNCED').length
    const pendingAssignments = (assignments || []).filter(a => a.sync_status === 'PENDING' || a.sync_status === 'SYNCING').length
    const errorAssignments = (assignments || []).filter(a => a.sync_status === 'ERROR').length

    return {
      totalDevices,
      activeDevices,
      inactiveDevices,
      onlineDevices,
      offlineDevices,
      totalLogsToday: totalLogsToday ?? 0,
      pendingCommands,
      executedCommands,
      latestActivity: latestActivity ? latestActivity.toISOString() : null,
      devices,
      recentLogs: recentLogs || [],
      recentCommands: recentCommands || [],
      syncedAssignments,
      pendingAssignments,
      errorAssignments,
      recentSyncs: (assignments || []).filter(a => a.sync_status === 'SYNCED').sort((a,b) => new Date(b.actualizado_at) - new Date(a.actualizado_at)).slice(0, 5),
      recentErrors: (assignments || []).filter(a => a.sync_status === 'ERROR').sort((a,b) => new Date(b.actualizado_at) - new Date(a.actualizado_at)).slice(0, 5)
    }
  },

  // ── 5. SINCRONIZACIÓN Y ASIGNACIONES (ZKTeco ADMS) ──────────────────────────

  /**
   * Obtiene la política de sincronización actual del cliente
   */
  async getSyncPolicy(clienteId) {
    if (!clienteId) return null
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre_empresa, biometric_sync_policy, id_empresa')
      .eq('id', clienteId)
      .single()

    if (error) throw error
    return data
  },

  /**
   * Actualiza la política de sincronización de un cliente
   */
  async updateSyncPolicy(clienteId, policy) {
    if (!clienteId || !policy) throw new Error('Cliente y política requeridos')
    const { data, error } = await supabase
      .from('clientes')
      .update({ biometric_sync_policy: policy, actualizado_at: new Date().toISOString() })
      .eq('id', clienteId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * Obtiene todos los clientes relacionados que comparten la misma empresa
   */
  async getRelatedTenants(clienteId) {
    if (!clienteId) return []
    const { data: current, error: curErr } = await supabase
      .from('clientes')
      .select('id, nombre_empresa, id_empresa')
      .eq('id', clienteId)
      .single()

    if (curErr) throw curErr
    if (!current?.id_empresa) return [current]

    const { data: related, error: relErr } = await supabase
      .from('clientes')
      .select('id, nombre_empresa, id_empresa')
      .eq('id_empresa', current.id_empresa)

    if (relErr) throw relErr
    return related || [current]
  },

  /**
   * Obtiene colaboradores con sus dispositivos y estados de sincronización
   */
  async getEmployeesSync(clienteId) {
    if (!clienteId) return { employees: [], assignments: [], devices: [] }

    // 1. Obtener tenants relacionados (por si la política es EMPRESA)
    const relatedTenants = await this.getRelatedTenants(clienteId)
    const tenantIds = relatedTenants.map(t => t.id)

    // 2. Obtener todos los colaboradores en el alcance
    const { data: employees, error: empErr } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, clave_empleado, activo, cliente_id, avatar_url, departamento')
      .in('cliente_id', tenantIds)
      .order('nombre', { ascending: true })

    if (empErr) throw empErr

    // 3. Obtener todos los dispositivos en el alcance
    const { data: devices, error: devErr } = await supabase
      .from('devices')
      .select('*')

    if (devErr) throw devErr

    const { data: dispositivos, error: dispErr } = await supabase
      .from('dispositivos')
      .select('device_id_hikvision, cliente_id')
      .in('cliente_id', tenantIds)

    if (dispErr) throw dispErr

    // Mapear dispositivos asociados al alcance
    const allowedSerials = new Set((dispositivos || []).map(d => d.device_id_hikvision))
    const filteredDevices = (devices || []).filter(d => allowedSerials.has(d.serial_number))

    // 4. Obtener las asignaciones
    const { data: assignments, error: assignErr } = await supabase
      .from('device_employee_assignments')
      .select('*')
      .in('cliente_id', tenantIds)

    if (assignErr) throw assignErr

    return {
      employees: employees || [],
      assignments: assignments || [],
      devices: filteredDevices || [],
      tenants: relatedTenants
    }
  },

  /**
   * Crea o actualiza una asignación individual (Aprovisionar)
   */
  async saveAssignment({ cliente_id, device_id, employee_id, biometric_user_id, activo = true }) {
    const payload = {
      cliente_id,
      device_id,
      employee_id,
      biometric_user_id: biometric_user_id?.trim(),
      activo: Boolean(activo),
      sync_status: 'PENDING',
      last_error: null,
      actualizado_at: new Date().toISOString()
    }

    // Buscar si existe para evitar conflictos
    const { data: existing } = await supabase
      .from('device_employee_assignments')
      .select('id')
      .eq('device_id', device_id)
      .eq('biometric_user_id', biometric_user_id)
      .maybeSingle()

    let result
    if (existing) {
      const { data, error } = await supabase
        .from('device_employee_assignments')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single()
      if (error) throw error
      result = data
    } else {
      const { data, error } = await supabase
        .from('device_employee_assignments')
        .insert([payload])
        .select()
        .single()
      if (error) throw error
      result = data
    }

    return result
  },

  /**
   * Desaprovisiona un colaborador (Quitar de biométrico)
   */
  async deactivateAssignment(assignmentId) {
    if (!assignmentId) throw new Error('ID de asignación es requerido')
    const { data, error } = await supabase
      .from('device_employee_assignments')
      .update({
        activo: false,
        sync_status: 'PENDING',
        last_error: null,
        actualizado_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * Fuerza la sincronización / reintento de una asignación
   */
  async syncAssignmentNow(assignmentId) {
    if (!assignmentId) throw new Error('ID de asignación es requerido')
    const { data: current, error: getErr } = await supabase
      .from('device_employee_assignments')
      .select('activo')
      .eq('id', assignmentId)
      .single()

    if (getErr) throw getErr

    const { data, error } = await supabase
      .from('device_employee_assignments')
      .update({
        activo: current.activo,
        sync_status: 'PENDING',
        last_error: null,
        actualizado_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select()
      .single()

    if (error) throw error
    return data
  }
}

