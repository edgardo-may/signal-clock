// src/features/biometrics/services/enrollmentService.js
//
// Servicio dedicado al enrolamiento de huellas dactilares ZKTeco.
//
// Arquitectura:
//
// React UI
//    ↓
// enrollmentService
//    ↓
// Supabase
//    ├── devices
//    ├── device_commands
//    └── biometric_templates
//             ↓
//        ZKTeco / ADMS
//
// IMPORTANTE:
// - NO utiliza `dispositivos` para localizar el checador.
// - NO utiliza `hikvision_device_userid`.
// - El checador pertenece a `devices`.
// - El identificador biométrico del empleado se obtiene de:
//      biometric_user_id
//   si existe.
// - Como fallback se utiliza `clave_empleado`.
//

import { supabase } from '../../../lib/supabase'

// ═══════════════════════════════════════════════════════════════════════════
// FINGER MAP
// ═══════════════════════════════════════════════════════════════════════════

export const FINGER_KEY_TO_FID = {
  left_thumb: 0,
  left_index: 1,
  left_middle: 2,
  left_ring: 3,
  left_pinky: 4,

  right_thumb: 5,
  right_index: 6,
  right_middle: 7,
  right_ring: 8,
  right_pinky: 9,
}

export const FID_TO_FINGER_KEY = Object.fromEntries(
  Object.entries(FINGER_KEY_TO_FID).map(([key, fid]) => [
    fid,
    key,
  ])
)

export const FINGER_DISPLAY_NAMES = {
  left_thumb: 'Pulgar Izquierdo',
  left_index: 'Índice Izquierdo',
  left_middle: 'Medio Izquierdo',
  left_ring: 'Anular Izquierdo',
  left_pinky: 'Meñique Izquierdo',

  right_thumb: 'Pulgar Derecho',
  right_index: 'Índice Derecho',
  right_middle: 'Medio Derecho',
  right_ring: 'Anular Derecho',
  right_pinky: 'Meñique Derecho',
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const normalizeSerial = serial => {
  if (!serial) return ''

  return String(serial)
    .trim()
    .toUpperCase()
}

const normalizeBiometricUserId = value => {
  if (
    value === null ||
    value === undefined
  ) {
    return ''
  }

  return String(value).trim()
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const enrollmentService = {

  // ═════════════════════════════════════════════════════════════════════════
  // 1. HUELLAS YA ENROLADAS
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene las huellas que ya tiene enroladas el empleado.
   *
   * Resultado:
   *
   * {
   *   left_thumb: 'enrolled',
   *   left_index: 'enrolled'
   * }
   */
  async getEnrolledFingers(empleadoId) {
    if (!empleadoId) {
      return {}
    }

    const { data, error } = await supabase
      .from('biometric_templates')
      .select(`
        indice,
        finger_key,
        template_data,
        tipo
      `)
      .eq('empleado_id', empleadoId)
      .eq('tipo', 'huella')

    if (error) {
      console.error(
        '[enrollmentService.getEnrolledFingers]',
        error
      )

      throw error
    }

    const result = {}

    ;(data || []).forEach(row => {
      const fingerKey =
        row.finger_key ||
        FID_TO_FINGER_KEY[row.indice]

      if (!fingerKey) {
        return
      }

      // PENDING no significa que ya esté enrolado.
      if (
        row.template_data &&
        row.template_data !== 'PENDING' &&
        row.template_data !== 'ERROR'
      ) {
        result[fingerKey] = 'enrolled'
      }
    })

    return result
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 2. DISPOSITIVOS ZKTECO ACTIVOS
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene los checadores ZKTeco activos del cliente.
   *
   * IMPORTANTE:
   *
   * La fuente es `devices`.
   *
   * NO consultar:
   *   - dispositivos
   *   - device_id_hikvision
   *   - numero_serie
   *   - marca
   *
   * El dispositivo tiene esta estructura:
   *
   * {
   *   id,
   *   serial_number,
   *   name,
   *   location,
   *   is_active,
   *   ip_address,
   *   port,
   *   timezone,
   *   device_type,
   *   last_activity,
   *   cliente_id
   * }
   */
  async getActiveDevices(clienteId) {
    if (!clienteId) {
      return []
    }

    const { data, error } = await supabase
      .from('devices')
      .select(`
        id,
        serial_number,
        name,
        location,
        is_active,
        ip_address,
        port,
        timezone,
        device_type,
        last_activity,
        cliente_id
      `)
      .eq('cliente_id', clienteId)
      .eq('is_active', true)
      .order('name', {
        ascending: true,
      })

    if (error) {
      console.error(
        '[enrollmentService.getActiveDevices]',
        error
      )

      throw error
    }

    return (data || []).map(device => {
      const serial = normalizeSerial(
        device.serial_number
      )

      return {
        ...device,

        // IDs
        id: device.id,
        device_id: device.id,
        deviceId: device.id,

        // Serial oficial
        serial_number: serial,
        device_serial: serial,
        deviceSerial: serial,

        // Datos para UI
        nombre:
          device.name ||
          device.location ||
          serial,

        nombre_ubicacion:
          device.name ||
          device.location ||
          serial,

        ubicacion:
          device.location || '',

        estatus:
          device.is_active
            ? 'activo'
            : 'inactivo',

        // Identificación
        tipo:
          device.device_type || 'general',

        device_type:
          device.device_type || 'general',
      }
    })
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 3. DATOS BIOMÉTRICOS DEL EMPLEADO
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene el identificador que ZKTeco utilizará para el empleado.
   *
   * IMPORTANTE:
   *
   * Ya NO utilizamos:
   *
   *   hikvision_device_userid
   *
   * Primero buscamos un campo genérico:
   *
   *   biometric_user_id
   *
   * y si no existe usamos:
   *
   *   clave_empleado
   *
   * La UI recibirá siempre:
   *
   *   biometric_user_id
   *   biometricUserId
   */
  async getEmpleadoBiometricPin(empleadoId) {
    if (!empleadoId) {
      return null
    }

    const { data, error } = await supabase
      .from('empleados')
      .select(`
        id,
        clave_empleado,
        nombre,
        apellido,
        cliente_id
      `)
      .eq('id', empleadoId)
      .maybeSingle()

      if (error) throw error

    if (!data) return null

  const biometricUserId =
    data.clave_empleado
      ? String(data.clave_empleado).trim()
      : null

  return {
    ...data,

    nombreCompleto:
      `${data.nombre || ''} ${data.apellido || ''}`.trim(),

    biometric_user_id: biometricUserId,
    biometricUserId: biometricUserId,
    biometricPin: biometricUserId,
  }
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 4. SOLICITAR ENROLAMIENTO
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Envía una solicitud de enrolamiento de huella al ZKTeco.
   *
   * Flujo:
   *
   * 1. Validar empleado.
   * 2. Validar dispositivo.
   * 3. Validar PIN/ID biométrico.
   * 4. Verificar que el dispositivo pertenece al cliente.
   * 5. Crear comando en device_commands.
   * 6. Crear template PENDING.
   * 7. El worker/ADMS procesa el comando.
   * 8. ZKTeco solicita colocar el dedo.
   * 9. Se actualiza biometric_templates.
   */
  async requestEnrollment({
    empleadoId,
    clienteId,
    deviceSerial,
    fingerKey,
    biometricPin,
  }) {
    if (!empleadoId) {
      throw new Error(
        'Se requiere el empleado.'
      )
    }

    if (!clienteId) {
      throw new Error(
        'Se requiere el cliente.'
      )
    }

    if (!deviceSerial) {
      throw new Error(
        'Se requiere seleccionar un biométrico.'
      )
    }

    if (!fingerKey) {
      throw new Error(
        'Se requiere seleccionar un dedo.'
      )
    }

    const fid =
      FINGER_KEY_TO_FID[fingerKey]

    if (fid === undefined) {
      throw new Error(
        `Dedo no reconocido: ${fingerKey}`
      )
    }

    const normalizedSerial =
      normalizeSerial(deviceSerial)

    const normalizedPin =
      normalizeBiometricUserId(
        biometricPin
      )

    if (!normalizedPin) {
      throw new Error(
        'El empleado no tiene un ID biométrico asignado.'
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VERIFICAR DISPOSITIVO
    // ═══════════════════════════════════════════════════════════════════════

    const { data: device, error: deviceError } =
      await supabase
        .from('devices')
        .select(`
          id,
          serial_number,
          name,
          is_active,
          cliente_id
        `)
        .eq(
          'serial_number',
          normalizedSerial
        )
        .eq(
          'cliente_id',
          clienteId
        )
        .maybeSingle()

    if (deviceError) {
      console.error(
        '[enrollmentService.requestEnrollment] Error verificando device:',
        deviceError
      )

      throw deviceError
    }

    if (!device) {
      throw new Error(
        'El biométrico seleccionado no pertenece al cliente.'
      )
    }

    if (!device.is_active) {
      throw new Error(
        'El biométrico seleccionado está inactivo.'
      )
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COMANDO ZKTECO
    // ═══════════════════════════════════════════════════════════════════════

    const commandString =
      `ENROLL_BIO PIN=${normalizedPin} Type=0 FID=${fid} Duress=0 Valid=1 Retry=3 OverWrite=1 ServerVer=1`

    // ═══════════════════════════════════════════════════════════════════════
    // CREAR TEMPLATE PENDING
    // ═══════════════════════════════════════════════════════════════════════

    const { error: templateError } =
      await supabase
        .from('biometric_templates')
        .upsert(
          {
            cliente_id: clienteId,
            empleado_id: empleadoId,
            tipo: 'huella',
            indice: fid,
            finger_key: fingerKey,

            // Mientras el checador no confirme:
            template_data: 'PENDING',

            actualizado_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              'empleado_id,tipo,indice',
          }
        )

    if (templateError) {
      console.error(
        '[enrollmentService.requestEnrollment] Error creando template:',
        templateError
      )

      throw templateError
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ENCOLAR COMANDO
    // ═══════════════════════════════════════════════════════════════════════

    const {
      data: command,
      error: commandError,
    } = await supabase
      .from('device_commands')
      .insert({
        device_serial: normalizedSerial,
        command_string: commandString,
        is_executed: false,
      })
      .select()
      .single()

    if (commandError) {
      console.error(
        '[enrollmentService.requestEnrollment] Error creando comando:',
        commandError
      )

      // Si el comando falló, marcar template como ERROR.
      await supabase
        .from('biometric_templates')
        .update({
          template_data: 'ERROR',
          actualizado_at:
            new Date().toISOString(),
        })
        .eq(
          'empleado_id',
          empleadoId
        )
        .eq(
          'tipo',
          'huella'
        )
        .eq(
          'indice',
          fid
        )

      throw commandError
    }

    return {
      ok: true,

      commandId:
        command?.id || null,

      empleadoId,
      clienteId,

      deviceId:
        device.id,

      deviceSerial:
        normalizedSerial,

      biometricUserId:
        normalizedPin,

      fid,
      fingerKey,

      command:
        commandString,
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 5. REALTIME
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Escucha cambios de enrolamiento del empleado.
   *
   * Estados:
   *
   * PENDING  → enrolling
   * ERROR    → error
   * template → enrolled
   */
  subscribeToEnrollmentUpdates(
    empleadoId,
    callback
  ) {
    if (!empleadoId) {
      return () => {}
    }

    const channelName =
      `enrollment:${empleadoId}`

    // Eliminar canales anteriores del mismo empleado.
    const existingChannels =
      supabase.getChannels()

    existingChannels.forEach(channel => {
      if (
        channel.topic ===
          `realtime:${channelName}` ||
        channel.topic === channelName
      ) {
        supabase.removeChannel(
          channel
        )
      }
    })

    const channel =
      supabase.channel(channelName)

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'biometric_templates',
        filter:
          `empleado_id=eq.${empleadoId}`,
      },
      payload => {
        const row =
          payload.new ||
          payload.old

        if (!row) {
          return
        }

        if (
          row.tipo !== 'huella'
        ) {
          return
        }

        const fingerKey =
          row.finger_key ||
          FID_TO_FINGER_KEY[
            row.indice
          ]

        if (!fingerKey) {
          return
        }

        let status =
          'not_enrolled'

        if (
          row.template_data ===
          'PENDING'
        ) {
          status = 'enrolling'
        } else if (
          row.template_data ===
          'ERROR'
        ) {
          status = 'error'
        } else if (
          row.template_data
        ) {
          status = 'enrolled'
        }

        callback(
          fingerKey,
          status
        )
      }
    )

    channel.subscribe()

    return () => {
      supabase.removeChannel(
        channel
      )
    }
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 6. OBTENER TEMPLATE DE UNA HUELLA
  // ═════════════════════════════════════════════════════════════════════════

  async getFingerTemplate(
    empleadoId,
    fingerKey
  ) {
    if (
      !empleadoId ||
      !fingerKey
    ) {
      return null
    }

    const fid =
      FINGER_KEY_TO_FID[
        fingerKey
      ]

    if (fid === undefined) {
      return null
    }

    const {
      data,
      error,
    } = await supabase
      .from(
        'biometric_templates'
      )
      .select('*')
      .eq(
        'empleado_id',
        empleadoId
      )
      .eq(
        'tipo',
        'huella'
      )
      .eq(
        'indice',
        fid
      )
      .maybeSingle()

    if (error) {
      throw error
    }

    return data || null
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 7. CANCELAR / LIMPIAR ENROLAMIENTO PENDIENTE
  // ═════════════════════════════════════════════════════════════════════════

  async cancelEnrollment(
    empleadoId,
    fingerKey
  ) {
    if (
      !empleadoId ||
      !fingerKey
    ) {
      throw new Error(
        'Empleado y dedo son requeridos.'
      )
    }

    const fid =
      FINGER_KEY_TO_FID[
        fingerKey
      ]

    if (fid === undefined) {
      throw new Error(
        'Dedo no reconocido.'
      )
    }

    const {
      error,
    } = await supabase
      .from(
        'biometric_templates'
      )
      .delete()
      .eq(
        'empleado_id',
        empleadoId
      )
      .eq(
        'tipo',
        'huella'
      )
      .eq(
        'indice',
        fid
      )
      .eq(
        'template_data',
        'PENDING'
      )

    if (error) {
      throw error
    }

    return true
  },
}
