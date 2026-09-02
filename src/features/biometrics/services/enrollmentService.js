// src/features/biometrics/services/enrollmentService.js
// Servicio dedicado al enrolamiento de huellas dactilares
// Separa la lógica de enrolamiento de biometricsService.js sin duplicarla.
//
// Arquitectura:
//   React UI → enrollmentService → Supabase (device_commands + biometric_templates)
//            ↓                                      ↓
//       ZKTeco ADMS                    Realtime subscription (states update live)

import { supabase } from '../../../lib/supabase'

// Mapa de claves de dedo a índice numérico ZKTeco (FID)
// ZKTeco: 0=Pulgar Izq, 1=Índice Izq, ... 5=Pulgar Der, ... 9=Meñique Der
export const FINGER_KEY_TO_FID = {
  left_thumb:  0,
  left_index:  1,
  left_middle: 2,
  left_ring:   3,
  left_pinky:  4,
  right_thumb: 5,
  right_index: 6,
  right_middle:7,
  right_ring:  8,
  right_pinky: 9,
}

export const FID_TO_FINGER_KEY = Object.fromEntries(
  Object.entries(FINGER_KEY_TO_FID).map(([k, v]) => [v, k])
)

export const FINGER_DISPLAY_NAMES = {
  left_thumb:   'Pulgar Izquierdo',
  left_index:   'Índice Izquierdo',
  left_middle:  'Medio Izquierdo',
  left_ring:    'Anular Izquierdo',
  left_pinky:   'Meñique Izquierdo',
  right_thumb:  'Pulgar Derecho',
  right_index:  'Índice Derecho',
  right_middle: 'Medio Derecho',
  right_ring:   'Anular Derecho',
  right_pinky:  'Meñique Derecho',
}

export const enrollmentService = {

  /**
   * Obtiene los dedos ya enrolados de un empleado.
   * Devuelve un objeto { fingerKey: 'enrolled' } para los dedos con template.
   */
  async getEnrolledFingers(empleadoId) {
    if (!empleadoId) return {}

    const { data, error } = await supabase
      .from('biometric_templates')
      .select('indice, finger_key')
      .eq('empleado_id', empleadoId)
      .eq('tipo', 'huella')

    if (error) throw error

    const result = {}
    ;(data || []).forEach(row => {
      // Soporte para ambos: finger_key (nuevo) e indice (legacy)
      const key = row.finger_key || FID_TO_FINGER_KEY[row.indice]
      if (key) result[key] = 'enrolled'
    })
    return result
  },

  /**
   * Envía la solicitud de enrolamiento al biométrico ZKTeco vía device_commands.
   * Crea/actualiza el registro en biometric_templates con status PENDING.
   * 
   * @param {object} params
   * @param {string} params.empleadoId   - UUID del empleado en Supabase
   * @param {string} params.clienteId    - UUID del cliente/tenant
   * @param {string} params.deviceSerial - Número de serie del biométrico ZKTeco
   * @param {string} params.fingerKey    - Clave del dedo (ej. 'left_index')
   * @param {string} params.biometricPin - PIN del empleado en el biométrico (hikvision_device_userid)
   */
  async requestEnrollment({ empleadoId, clienteId, deviceSerial, fingerKey, biometricPin }) {
    const fid = FINGER_KEY_TO_FID[fingerKey]
    if (fid === undefined) throw new Error(`Dedo no reconocido: ${fingerKey}`)
    if (!deviceSerial) throw new Error('Se requiere seleccionar un dispositivo')
    if (!biometricPin) throw new Error('El empleado no tiene un PIN biométrico asignado')

    // Comando ZKTeco ADMS para enrolamiento remoto
    // El checador físico pedirá al empleado que coloque el dedo 3 veces
    const commandString = `ENROLL_BIO PIN=${biometricPin} Type=0 FID=${fid} Duress=0 Valid=1 Retry=3 OverWrite=1 ServerVer=1`

    // 1. Encolar el comando al biométrico
    const { error: cmdError } = await supabase
      .from('device_commands')
      .insert({
        device_serial: deviceSerial,
        command_string: commandString,
        is_executed: false,
      })

    if (cmdError) throw cmdError

    // 2. Crear/actualizar el registro de template como PENDING
    const { error: tmplError } = await supabase
      .from('biometric_templates')
      .upsert({
        cliente_id: clienteId,
        empleado_id: empleadoId,
        tipo: 'huella',
        indice: fid,
        finger_key: fingerKey,
        template_data: 'PENDING',  // Se actualizará cuando el biométrico confirme
        actualizado_at: new Date().toISOString(),
      }, { onConflict: 'empleado_id,tipo,indice' })

    if (tmplError) throw tmplError

    return { ok: true, fid, fingerKey, command: commandString }
  },

  /**
   * Suscribe a actualizaciones en tiempo real del estado de templates de un empleado.
   * Llama a `callback(fingerKey, status)` cuando cambia un template.
   * 
   * @returns {function} Función para cancelar la suscripción
   */
  subscribeToEnrollmentUpdates(empleadoId, callback) {
    if (!empleadoId) return () => {}

    const channelName = `enrollment:${empleadoId}`

    // 1. Limpieza preventiva (Evita reutilizar un canal en estado 'joined' por culpa de React StrictMode)
    const existingChannels = supabase.getChannels()
    existingChannels.forEach((c) => {
      if (c.topic === `realtime:${channelName}` || c.topic === channelName) {
        supabase.removeChannel(c)
      }
    })

    // 2. Construcción estricta: channel() -> on() -> subscribe()
    const channel = supabase.channel(channelName)
    
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'biometric_templates',
        filter: `empleado_id=eq.${empleadoId}`,
      },
      (payload) => {
        const row = payload.new || payload.old
        if (!row || row.tipo !== 'huella') return

        const fingerKey = row.finger_key || FID_TO_FINGER_KEY[row.indice]
        if (!fingerKey) return

        const status = row.template_data === 'PENDING' ? 'enrolling'
                     : row.template_data === 'ERROR'   ? 'error'
                     : row.template_data              ? 'enrolled'
                     : 'not_enrolled'

        callback(fingerKey, status)
      }
    )

    channel.subscribe()

    // 3. Cleanup que elimina correctamente el canal oficial de Supabase
    return () => {
      supabase.removeChannel(channel)
    }
  },

  /**
   * Obtiene los dispositivos ZKTeco activos para el cliente.
   */
 /**
 * Obtiene los dispositivos biométricos activos del cliente.
 *
 * La tabla principal de dispositivos es `devices`.
 * NO utilizar `dispositivos` para obtener los datos del checador.
 */
async getActiveDevices(clienteId) {
  if (!clienteId) return []

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
    .order('name', { ascending: true })

  if (error) {
    console.error(
      '[biometricsService.getActiveDevices] Error obteniendo dispositivos:',
      error
    )

    throw error
  }

  return (data || []).map(device => ({
    ...device,

    // Alias que puede utilizar la pantalla de enrolamiento
    id: device.id,
    device_id: device.id,
    deviceId: device.id,

    serial_number: device.serial_number
      ?.trim()
      .toUpperCase(),

    device_serial: device.serial_number
      ?.trim()
      .toUpperCase(),

    nombre_ubicacion:
      device.name ||
      device.location ||
      device.serial_number,

    nombre:
      device.name ||
      device.serial_number,

    ubicacion:
      device.location || '',

    estatus:
      device.is_active ? 'activo' : 'inactivo'
  }))
},


/**
 * Obtiene los datos biométricos del empleado.
 *
 * `hikvision_device_userid` es el identificador que utilizará
 * el checador para el empleado.
 */
async getEmpleadoBiometricPin(empleadoId) {
  if (!empleadoId) return null

  const { data, error } = await supabase
    .from('empleados')
    .select(`
      id,
      hikvision_device_userid,
      clave_empleado,
      nombre,
      apellido,
      cliente_id
    `)
    .eq('id', empleadoId)
    .maybeSingle()

  if (error) {
    console.error(
      '[biometricsService.getEmpleadoBiometricPin] Error obteniendo empleado:',
      error
    )

    throw error
  }

  if (!data) return null

  return {
    ...data,

    // Nombre completo para la pantalla de enrolamiento
    nombreCompleto:
      `${data.nombre || ''} ${data.apellido || ''}`.trim(),

    // PIN/ID que ya tiene el empleado en Hikvision
    biometric_user_id:
      data.hikvision_device_userid || null,

    biometricUserId:
      data.hikvision_device_userid || null
  }
},
}
