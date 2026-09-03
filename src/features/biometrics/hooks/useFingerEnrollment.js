// src/features/biometrics/hooks/useFingerEnrollment.js
//
// Hook que orquesta el estado completo del enrolamiento
// de huellas dactilares para dispositivos ZKTeco.
//
// Estados por dedo:
//   not_enrolled → selected → enrolling → success → enrolled
//                                       → error   → not_enrolled (retry)

import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import { syncService } from '../services/syncService'

import {
  enrollmentService,
  FINGER_DISPLAY_NAMES,
  FINGER_KEY_TO_FID,
} from '../services/enrollmentService'

const ALL_FINGERS = Object.keys(FINGER_KEY_TO_FID)

const INITIAL_STATES = () =>
  Object.fromEntries(
    ALL_FINGERS.map(key => [key, 'not_enrolled'])
  )

const ENROLL_TIMEOUT_MS = 30_000

/**
 * @param {string|null} empleadoId
 * @param {string|null} clienteId
 */
export function useFingerEnrollment(empleadoId, clienteId) {
  // ─────────────────────────────────────────────────────────────────────────
  // ESTADO
  // ─────────────────────────────────────────────────────────────────────────

  const [fingerStates, setFingerStates] = useState(
    INITIAL_STATES()
  )

  const [selectedFinger, setSelectedFinger] = useState(null)

  // Dispositivos ZKTeco disponibles
  const [devices, setDevices] = useState([])

  // ID global del device
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  // Serial del device ZKTeco
  const [selectedDeviceSerial, setSelectedDeviceSerial] = useState('')

  const [loading, setLoading] = useState(false)

  // Estado de sincronización del colaborador con la terminal seleccionada
  // 'SYNCED' | 'NOT_SYNCED' | 'PENDING' | 'SYNCING' | 'ERROR' | null
  const [deviceSyncStatus, setDeviceSyncStatus] = useState(null)
  const [checkingSync, setCheckingSync] = useState(false)
  const [syncingEmployee, setSyncingEmployee] = useState(false)

  // Datos del empleado
  const [empleadoData, setEmpleadoData] = useState(null)

  // Timeout del enrolamiento
  const enrollTimeoutRef = useRef(null)

  // Suscripción Realtime
  const unsubscribeRef = useRef(null)
  const selectedDeviceIdRef = useRef('')

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER
  // ─────────────────────────────────────────────────────────────────────────

  const setFingerState = useCallback(
    (fingerKey, state) => {
      setFingerStates(prev => ({
        ...prev,
        [fingerKey]: state
      }))
    },
    []
  )

  // Verificar estado de asignación / sincronización para el device y empleado
  const checkSyncStatus = useCallback(
    async (devId, empId) => {
      if (!devId || !empId || !clienteId) {
        setDeviceSyncStatus(null)
        return
      }

      setCheckingSync(true)
      try {
        const { data: ass, error } = await supabase
          .from('device_employee_assignments')
          .select('sync_status, biometric_user_id, activo')
          .eq('device_id', devId)
          .eq('employee_id', empId)
          .eq('cliente_id', clienteId)
          .maybeSingle()

        if (error) {
          console.error('[useFingerEnrollment] Error consultando sync status:', error)
          setDeviceSyncStatus('NOT_SYNCED')
          return
        }

        if (!ass || !ass.activo) {
          setDeviceSyncStatus('NOT_SYNCED')
        } else {
          setDeviceSyncStatus(ass.sync_status || 'NOT_SYNCED')
        }
      } catch (err) {
        console.error('[useFingerEnrollment] Error en checkSyncStatus:', err)
        setDeviceSyncStatus('NOT_SYNCED')
      } finally {
        setCheckingSync(false)
      }
    },
    [clienteId]
  )

  useEffect(() => {
    if (!selectedDeviceId || !empleadoId || !clienteId) {
      setDeviceSyncStatus(null)
      return
    }

    checkSyncStatus(selectedDeviceId, empleadoId)
  }, [
    selectedDeviceId,
    empleadoId,
    clienteId,
    checkSyncStatus
  ])

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId
  }, [selectedDeviceId])

  useEffect(() => {
    if (!selectedDeviceId || !empleadoId || !clienteId) {
      setFingerStates(INITIAL_STATES())
      return
    }

    let cancelled = false

    const loadEnrolledFingers = async () => {
      try {
        const enrolledMap = await enrollmentService.getEnrolledFingers(
          empleadoId,
          selectedDeviceId
        )

        if (!cancelled) {
          setFingerStates({
            ...INITIAL_STATES(),
            ...(enrolledMap || {})
          })
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[useFingerEnrollment] Error loading fingerprints:', err)
          setFingerStates(INITIAL_STATES())
        }
      }
    }

    loadEnrolledFingers()

    return () => {
      cancelled = true
    }
  }, [selectedDeviceId, empleadoId, clienteId])

  // Disparar sincronización inmediata de este colaborador hacia la terminal seleccionada
  const handleSyncEmployeeNow = useCallback(async () => {
    if (!selectedDeviceId || !selectedDeviceSerial || !empleadoId || !empleadoData) {
      toast.error('Selecciona una terminal activa para sincronizar.')
      return
    }

    const pin = empleadoData.device_userid
    if (!pin || !/^\d+$/.test(String(pin).trim())) {
      toast.error('El colaborador no cuenta con un device_userid numérico asignado.')
      return
    }

    setSyncingEmployee(true)
    try {
      await syncService.syncSingleEmployeeToDevice({
        clienteId,
        deviceId: selectedDeviceId,
        deviceSerial: selectedDeviceSerial,
        employeeId,
        pin: String(pin).trim(),
        fullName: empleadoData.nombreCompleto
      })

      toast.success('Comando de sincronización encolado para la terminal.')
      setDeviceSyncStatus('PENDING')

      // Sondeo periódico para detectar confirmación de la terminal
      let attempts = 0
      const pollInterval = setInterval(async () => {
        attempts += 1
        const { data: updated } = await supabase
          .from('device_employee_assignments')
          .select('sync_status')
          .eq('device_id', selectedDeviceId)
          .eq('employee_id', empleadoId)
          .maybeSingle()

        if (updated?.sync_status === 'SYNCED') {
          setDeviceSyncStatus('SYNCED')
          toast.success('¡Colaborador confirmado en la terminal! Ya puedes enrolar.')
          clearInterval(pollInterval)
        } else if (updated?.sync_status === 'ERROR' || attempts >= 10) {
          clearInterval(pollInterval)
          if (updated?.sync_status === 'ERROR') {
            setDeviceSyncStatus('ERROR')
            toast.error('La terminal reportó un error al sincronizar al colaborador.')
          }
        }
      }, 3000)
    } catch (err) {
      console.error('[useFingerEnrollment] Error sincronizando colaborador:', err)
      toast.error('Error al sincronizar: ' + err.message)
    } finally {
      setSyncingEmployee(false)
    }
  }, [clienteId, selectedDeviceId, selectedDeviceSerial, empleadoId, empleadoData])

  // ─────────────────────────────────────────────────────────────────────────
  // CARGA INICIAL
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!empleadoId || !clienteId) {
      setFingerStates(INITIAL_STATES())
      setSelectedFinger(null)
      setSelectedDeviceId('')
      setSelectedDeviceSerial('')
      setDevices([])
      setEmpleadoData(null)

      return
    }

    // Cancelar suscripción anterior
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }

    // Cancelar timeout anterior
    if (enrollTimeoutRef.current) {
      clearTimeout(enrollTimeoutRef.current)
      enrollTimeoutRef.current = null
    }

    const init = async () => {
      setLoading(true)

      setFingerStates(INITIAL_STATES())
      setSelectedFinger(null)
      setSelectedDeviceId('')
      setSelectedDeviceSerial('')

      try {
        // Cargar todo en paralelo
        const [devList, empData] = await Promise.all([
          enrollmentService.getActiveDevices(
            clienteId
          ),

          enrollmentService.getEmpleadoBiometricPin(
            empleadoId
          )
        ])

        // ───────────────────────────────────────────────────────────────────
        // HUELLAS YA ENROLADAS
        // ───────────────────────────────────────────────────────────────────

        // ───────────────────────────────────────────────────────────────────
        // EMPLEADO
        // ───────────────────────────────────────────────────────────────────

        setEmpleadoData(empData || null)

        // ───────────────────────────────────────────────────────────────────
        // DEVICES ZKTECO
        // ───────────────────────────────────────────────────────────────────

        const normalizedDevices = (devList || [])
          .filter(device => device && device.id)
          .map(device => ({
            ...device,

            // ID global de devices
            id: device.id,

            device_id: device.id,

            deviceId: device.id,

            // Serial ZKTeco
            serial_number:
              device.serial_number
                ?.trim()
                .toUpperCase() || '',

            device_serial:
              device.serial_number
                ?.trim()
                .toUpperCase() || '',

            // Nombre para UI
            name:
              device.name ||
              device.serial_number ||
              'Terminal ZKTeco',

            nombre:
              device.name ||
              device.serial_number ||
              'Terminal ZKTeco',

            location:
              device.location || '',

            ubicacion:
              device.location || '',

            // Estado
            is_active:
              device.is_active === true,

            estatus:
              device.is_active
                ? 'activo'
                : 'inactivo'
          }))

        setDevices(normalizedDevices)

        // ───────────────────────────────────────────────────────────────────
        // SELECCIONAR PRIMER DEVICE AUTOMÁTICAMENTE
        // ───────────────────────────────────────────────────────────────────

        if (normalizedDevices.length > 0) {
          const firstDevice = normalizedDevices[0]

          setSelectedDeviceId(
            firstDevice.id
          )

          setSelectedDeviceSerial(
            firstDevice.serial_number
          )
        }

        // ───────────────────────────────────────────────────────────────────
        // REALTIME
        // ───────────────────────────────────────────────────────────────────

        unsubscribeRef.current =
          enrollmentService.subscribeToEnrollmentUpdates(
            empleadoId,
            (fingerKey, status, row) => {
              if (row.device_id !== selectedDeviceIdRef.current) {
                return
              }

              setFingerStates(prev => {
                const current =
                  prev[fingerKey]

                // ───────────────────────────────────────────────────────────
                // ÉXITO
                // ───────────────────────────────────────────────────────────

                if (
                  status === 'enrolled' &&
                  current === 'enrolling'
                ) {
                  if (
                    enrollTimeoutRef.current
                  ) {
                    clearTimeout(
                      enrollTimeoutRef.current
                    )

                    enrollTimeoutRef.current =
                      null
                  }

                  toast.dismiss(
                    `enroll-${fingerKey}`
                  )

                  toast.success(
                    `${FINGER_DISPLAY_NAMES[fingerKey]} enrolado exitosamente`
                  )

                  setSelectedFinger(null)

                  return {
                    ...prev,
                    [fingerKey]: 'success'
                  }
                }

                // ───────────────────────────────────────────────────────────
                // ERROR
                // ───────────────────────────────────────────────────────────

                if (
                  status === 'error' &&
                  current === 'enrolling'
                ) {
                  if (
                    enrollTimeoutRef.current
                  ) {
                    clearTimeout(
                      enrollTimeoutRef.current
                    )

                    enrollTimeoutRef.current =
                      null
                  }

                  toast.dismiss(
                    `enroll-${fingerKey}`
                  )

                  toast.error(
                    `Error al enrolar ${FINGER_DISPLAY_NAMES[fingerKey]}`
                  )

                  return {
                    ...prev,
                    [fingerKey]: 'error'
                  }
                }

                return prev
              })

              // ─────────────────────────────────────────────────────────────
              // SUCCESS → ENROLLED
              // ─────────────────────────────────────────────────────────────

              if (status === 'enrolled') {
                setTimeout(() => {
                  setFingerStates(prev => {
                    if (
                      prev[fingerKey] ===
                      'success'
                    ) {
                      return {
                        ...prev,
                        [fingerKey]: 'enrolled'
                      }
                    }

                    return prev
                  })
                }, 2000)
              }
            }
          )
      } catch (err) {
        console.error(
          '[useFingerEnrollment] Error al inicializar:',
          err
        )

        toast.error(
          err?.message ||
          'Error al cargar el estado de huellas'
        )
      } finally {
        setLoading(false)
      }
    }

    init()

    // ───────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ───────────────────────────────────────────────────────────────────────

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()

        unsubscribeRef.current = null
      }

      if (enrollTimeoutRef.current) {
        clearTimeout(
          enrollTimeoutRef.current
        )

        enrollTimeoutRef.current = null
      }
    }
  }, [empleadoId, clienteId])

  // ─────────────────────────────────────────────────────────────────────────
  // SELECCIONAR DEDO
  // ─────────────────────────────────────────────────────────────────────────

  const selectFinger = useCallback(
    fingerKey => {
      setFingerStates(prev => {
        const current =
          prev[fingerKey]

        // No cambiar mientras está enrolando
        if (
          current === 'enrolling'
        ) {
          return prev
        }

        // ───────────────────────────────────────────────────────────────
        // DESELECCIONAR
        // ───────────────────────────────────────────────────────────────

        if (
          selectedFinger === fingerKey
        ) {
          setSelectedFinger(null)

          if (
            current === 'error' ||
            current === 'selected'
          ) {
            return {
              ...prev,
              [fingerKey]:
                'not_enrolled'
            }
          }

          return prev
        }

        // ───────────────────────────────────────────────────────────────
        // DESELECCIONAR ANTERIOR
        // ───────────────────────────────────────────────────────────────

        const newStates = {
          ...prev
        }

        if (
          selectedFinger &&
          newStates[selectedFinger] ===
            'selected'
        ) {
          newStates[selectedFinger] =
            'not_enrolled'
        }

        // ───────────────────────────────────────────────────────────────
        // SELECCIONAR NUEVO
        // ───────────────────────────────────────────────────────────────

        newStates[fingerKey] =
          'selected'

        setSelectedFinger(
          fingerKey
        )

        return newStates
      })
    },
    [selectedFinger]
  )

  // ─────────────────────────────────────────────────────────────────────────
  // SOLICITAR ENROLAMIENTO
  // ─────────────────────────────────────────────────────────────────────────

  const requestEnrollment =
    useCallback(async () => {
      // ───────────────────────────────────────────────────────────────────
      // VALIDACIONES
      // ───────────────────────────────────────────────────────────────────

      if (!selectedFinger) {
        toast.error(
          'Selecciona un dedo primero'
        )

        return
      }

      if (!selectedDeviceId) {
        toast.error(
          'Selecciona una terminal biométrica'
        )

        return
      }

      if (!selectedDeviceSerial) {
        toast.error(
          'La terminal seleccionada no tiene número de serie'
        )

        return
      }

      if (!empleadoData) {
        toast.error(
          'No se encontraron datos del empleado'
        )

        return
      }

      if (deviceSyncStatus !== 'SYNCED') {
        toast.error(
          'Este colaborador aún no está sincronizado con esta terminal. Pulsa "Sincronizar ahora" antes de enrolar.'
        )

        return
      }

      // ───────────────────────────────────────────────────────────────────
      // IDENTIFICADOR DEL USUARIO EN ZKTECO
      //
      // IMPORTANTE:
      //
      // Ya NO usamos hikvision_device_userid.
      //
      // Primero intentamos:
      //   biometric_user_id
      //
      // Después:
      //   zkteco_user_id
      //
      // Después:
      //   clave_empleado
      //
      // Esto permite trabajar con el esquema actual sin depender
      // de Hikvision.
      // ───────────────────────────────────────────────────────────────────

      const biometricPin =
        empleadoData.device_userid ||
        empleadoData.biometric_user_id ||
        empleadoData.biometricUserId ||
        empleadoData.biometricPin

      if (!biometricPin || !/^\d+$/.test(String(biometricPin).trim())) {
        toast.error(
          'El empleado no tiene un device_userid numérico asignado para ZKTeco.'
        )

        return
      }

      // ───────────────────────────────────────────────────────────────────
      // FINGER ID
      // ───────────────────────────────────────────────────────────────────

      const fingerId =
        FINGER_KEY_TO_FID[
          selectedFinger
        ]

      if (
        fingerId === undefined ||
        fingerId === null
      ) {
        toast.error(
          'No se pudo determinar el ID del dedo seleccionado.'
        )

        return
      }

      // ───────────────────────────────────────────────────────────────────
      // GUARDAR REFERENCIAS
      // ───────────────────────────────────────────────────────────────────

      const currentFinger =
        selectedFinger

      const currentDeviceId =
        selectedDeviceId

      const currentDeviceSerial =
        selectedDeviceSerial

      // ───────────────────────────────────────────────────────────────────
      // MARCAR COMO ENROLLING
      // ───────────────────────────────────────────────────────────────────

      setFingerState(
        currentFinger,
        'enrolling'
      )

      // ───────────────────────────────────────────────────────────────────
      // CANCELAR TIMEOUT ANTERIOR
      // ───────────────────────────────────────────────────────────────────

      if (
        enrollTimeoutRef.current
      ) {
        clearTimeout(
          enrollTimeoutRef.current
        )
      }

      // ───────────────────────────────────────────────────────────────────
      // TIMEOUT DE SEGURIDAD
      // ───────────────────────────────────────────────────────────────────

      enrollTimeoutRef.current =
        setTimeout(() => {
          setFingerStates(prev => {
            if (
              prev[currentFinger] ===
              'enrolling'
            ) {
              toast.dismiss(
                `enroll-${currentFinger}`
              )

              toast.error(
                `Tiempo de espera agotado para ${FINGER_DISPLAY_NAMES[currentFinger]}`
              )

              return {
                ...prev,
                [currentFinger]:
                  'error'
              }
            }

            return prev
          })

          setSelectedFinger(null)

          enrollTimeoutRef.current =
            null
        }, ENROLL_TIMEOUT_MS)

      // ───────────────────────────────────────────────────────────────────
      // ENVIAR SOLICITUD AL SERVICIO
      // ───────────────────────────────────────────────────────────────────

      try {
        await enrollmentService.requestEnrollment({
          empleadoId,
          clienteId,

          // Device ZKTeco
          deviceId:
            currentDeviceId,

          // Serial ZKTeco
          deviceSerial:
            currentDeviceSerial,

          // Dedo
          fingerKey:
            currentFinger,

          fingerId,

          // Usuario ZKTeco
          biometricPin:
            String(biometricPin)
        })

        toast.loading(
          `Coloca "${FINGER_DISPLAY_NAMES[currentFinger]}" en el biométrico ZKTeco...`,
          {
            duration:
              ENROLL_TIMEOUT_MS,

            id:
              `enroll-${currentFinger}`
          }
        )
      } catch (err) {
        console.error(
          '[useFingerEnrollment] Error solicitando enrolamiento:',
          err
        )

        if (
          enrollTimeoutRef.current
        ) {
          clearTimeout(
            enrollTimeoutRef.current
          )

          enrollTimeoutRef.current =
            null
        }

        toast.dismiss(
          `enroll-${currentFinger}`
        )

        setFingerState(
          currentFinger,
          'error'
        )

        setSelectedFinger(null)

        toast.error(
          'Error al enviar solicitud: ' +
          (
            err?.message ||
            'Error desconocido'
          )
        )
      }
    }, [
      selectedFinger,
      selectedDeviceId,
      selectedDeviceSerial,
      empleadoData,
      empleadoId,
      clienteId,
      deviceSyncStatus,
      setFingerState
    ])

  // ─────────────────────────────────────────────────────────────────────────
  // REINTENTAR
  // ─────────────────────────────────────────────────────────────────────────

  const retryFinger =
    useCallback(
      fingerKey => {
        setFingerState(
          fingerKey,
          'not_enrolled'
        )

        if (
          selectedFinger ===
          fingerKey
        ) {
          setSelectedFinger(null)
        }
      },
      [
        selectedFinger,
        setFingerState
      ]
    )

  // ─────────────────────────────────────────────────────────────────────────
  // CAMBIAR DEVICE
  // ─────────────────────────────────────────────────────────────────────────

  const handleSetSelectedDevice = useCallback((deviceId) => {
    setSelectedDeviceId(deviceId || '')
    const device = devices.find(d => String(d.id) === String(deviceId))
    if (device) {
      setSelectedDeviceSerial(device.serial_number || '')
    } else {
      setSelectedDeviceSerial('')
    }
  }, [devices])

  const handleSetSelectedDeviceSerial = useCallback((serial) => {
    setSelectedDeviceSerial(serial || '')
    const device = devices.find(d => (d.serial_number || d.device_serial || d.numero_serie) === serial)
    if (device) {
      setSelectedDeviceId(device.id || '')
    } else {
      setSelectedDeviceId('')
    }
  }, [devices])

  // ─────────────────────────────────────────────────────────────────────────
  // RETURN
  // ─────────────────────────────────────────────────────────────────────────

  return {
    // Huellas
    fingerStates,
    selectedFinger,
    selectFinger,
    requestEnrollment,
    retryFinger,

    // Devices ZKTeco
    devices,
    selectedDeviceId,
    setSelectedDeviceId: handleSetSelectedDevice,
    selectedDeviceSerial,
    setSelectedDeviceSerial: handleSetSelectedDeviceSerial,

    // Estado de Sincronización con la Terminal
    deviceSyncStatus,
    isDeviceSynced: deviceSyncStatus === 'SYNCED',
    checkingSync,
    syncingEmployee,
    handleSyncEmployeeNow,
    checkSyncStatus,

    // Estado
    loading,

    // Empleado
    empleadoData
  }
}
