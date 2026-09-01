// src/features/biometrics/hooks/useFingerEnrollment.js
// Hook que orquesta el estado completo del enrolamiento de huellas dactilares.
//
// Estados por dedo:
//   not_enrolled → selected → enrolling → success → enrolled
//                                       → error   → not_enrolled (retry)

import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  enrollmentService,
  FINGER_DISPLAY_NAMES,
  FINGER_KEY_TO_FID,
} from '../services/enrollmentService'

const ALL_FINGERS = Object.keys(FINGER_KEY_TO_FID)
const INITIAL_STATES = () => Object.fromEntries(ALL_FINGERS.map(k => [k, 'not_enrolled']))
const ENROLL_TIMEOUT_MS = 30_000

/**
 * @param {string|null} empleadoId  - UUID del empleado seleccionado
 * @param {string|null} clienteId   - UUID del cliente/tenant
 */
export function useFingerEnrollment(empleadoId, clienteId) {
  // Estado de cada uno de los 10 dedos
  const [fingerStates, setFingerStates] = useState(INITIAL_STATES)
  // Dedo actualmente seleccionado por el usuario
  const [selectedFinger, setSelectedFinger] = useState(null)
  // Dispositivos disponibles
  const [devices, setDevices] = useState([])
  const [selectedDeviceSerial, setSelectedDeviceSerial] = useState('')
  // Estado de carga inicial
  const [loading, setLoading] = useState(false)
  // Datos del empleado (para obtener PIN biométrico)
  const [empleadoData, setEmpleadoData] = useState(null)

  // Referencia al timeout de enrolamiento
  const enrollTimeoutRef = useRef(null)
  // Referencia al canal Realtime
  const unsubscribeRef = useRef(null)

  // ── Helpers ───────────────────────────────────────────────────────────────

  const setFingerState = useCallback((fingerKey, state) => {
    setFingerStates(prev => ({ ...prev, [fingerKey]: state }))
  }, [])

  // ── Carga inicial cuando cambia el empleado ──────────────────────────────

  useEffect(() => {
    if (!empleadoId || !clienteId) {
      setFingerStates(INITIAL_STATES())
      setSelectedFinger(null)
      setEmpleadoData(null)
      return
    }

    // Cancelar suscripción anterior
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }

    const init = async () => {
      setLoading(true)
      setFingerStates(INITIAL_STATES())
      setSelectedFinger(null)

      try {
        // Cargar datos del empleado y dispositivos en paralelo
        const [enrolledMap, devList, empData] = await Promise.all([
          enrollmentService.getEnrolledFingers(empleadoId),
          enrollmentService.getActiveDevices(clienteId),
          enrollmentService.getEmpleadoBiometricPin(empleadoId),
        ])

        // Aplicar estados enrolados
        setFingerStates(prev => ({ ...prev, ...enrolledMap }))
        setEmpleadoData(empData)
        setDevices(devList)

        if (devList.length > 0) {
          setSelectedDeviceSerial(devList[0].numero_serie || '')
        }

        // Suscribir a actualizaciones Realtime
        unsubscribeRef.current = enrollmentService.subscribeToEnrollmentUpdates(
          empleadoId,
          (fingerKey, status) => {
            setFingerStates(prev => {
              // Solo actualizar si el estado actual lo justifica
              const current = prev[fingerKey]
              if (status === 'enrolled' && current === 'enrolling') {
                // Éxito → limpiar timeout
                if (enrollTimeoutRef.current) {
                  clearTimeout(enrollTimeoutRef.current)
                  enrollTimeoutRef.current = null
                }
                toast.success(`✅ ${FINGER_DISPLAY_NAMES[fingerKey]} enrolado exitosamente`)
                setSelectedFinger(null)
                return { ...prev, [fingerKey]: 'success' }
              }
              if (status === 'error' && current === 'enrolling') {
                if (enrollTimeoutRef.current) {
                  clearTimeout(enrollTimeoutRef.current)
                  enrollTimeoutRef.current = null
                }
                toast.error(`Error al enrolar ${FINGER_DISPLAY_NAMES[fingerKey]}`)
                return { ...prev, [fingerKey]: 'error' }
              }
              return prev
            })

            // Después de 2s en success → pasar a enrolled (estado permanente)
            if (status === 'enrolled') {
              setTimeout(() => {
                setFingerStates(prev => {
                  if (prev[fingerKey] === 'success') {
                    return { ...prev, [fingerKey]: 'enrolled' }
                  }
                  return prev
                })
              }, 2000)
            }
          }
        )
      } catch (err) {
        console.error('[useFingerEnrollment] Error al inicializar:', err)
        toast.error('Error al cargar estado de huellas')
      } finally {
        setLoading(false)
      }
    }

    init()

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      if (enrollTimeoutRef.current) {
        clearTimeout(enrollTimeoutRef.current)
        enrollTimeoutRef.current = null
      }
    }
  }, [empleadoId, clienteId])

  // ── Seleccionar un dedo ───────────────────────────────────────────────────

  const selectFinger = useCallback((fingerKey) => {
    setFingerStates(prev => {
      const current = prev[fingerKey]
      // No permitir seleccionar un dedo que está en proceso
      if (current === 'enrolling') return prev

      // Si ya estaba seleccionado → deseleccionar
      if (selectedFinger === fingerKey) {
        setSelectedFinger(null)
        // Si estaba en error → volver a not_enrolled
        if (current === 'error') return { ...prev, [fingerKey]: 'not_enrolled' }
        // Si estaba selected → volver al estado anterior
        if (current === 'selected') {
          return { ...prev, [fingerKey]: 'not_enrolled' }
        }
        return prev
      }

      // Deseleccionar el anterior si había uno
      const newStates = { ...prev }
      if (selectedFinger && newStates[selectedFinger] === 'selected') {
        newStates[selectedFinger] = 'not_enrolled'
      }

      // Seleccionar el nuevo (no re-enrolar si ya está enrolled, solo marcar selected)
      newStates[fingerKey] = 'selected'
      setSelectedFinger(fingerKey)
      return newStates
    })
  }, [selectedFinger])

  // ── Solicitar enrolamiento ────────────────────────────────────────────────

  const requestEnrollment = useCallback(async () => {
    if (!selectedFinger) {
      toast.error('Selecciona un dedo primero')
      return
    }
    if (!selectedDeviceSerial) {
      toast.error('Selecciona una terminal biométrica')
      return
    }
    if (!empleadoData) {
      toast.error('No se encontraron datos del empleado')
      return
    }

    const biometricPin = empleadoData.hikvision_device_userid || empleadoData.clave_empleado
    if (!biometricPin) {
      toast.error('El empleado no tiene PIN biométrico. Sincronízalo primero.')
      return
    }

    // Marcar como enrolling
    setFingerState(selectedFinger, 'enrolling')

    // Timeout de seguridad (30s)
    enrollTimeoutRef.current = setTimeout(() => {
      setFingerStates(prev => {
        if (prev[selectedFinger] === 'enrolling') {
          toast.error(`Tiempo de espera agotado para ${FINGER_DISPLAY_NAMES[selectedFinger]}`)
          return { ...prev, [selectedFinger]: 'error' }
        }
        return prev
      })
      setSelectedFinger(null)
      enrollTimeoutRef.current = null
    }, ENROLL_TIMEOUT_MS)

    try {
      await enrollmentService.requestEnrollment({
        empleadoId,
        clienteId,
        deviceSerial: selectedDeviceSerial,
        fingerKey: selectedFinger,
        biometricPin: String(biometricPin),
      })

      toast.loading(
        `Coloca "${FINGER_DISPLAY_NAMES[selectedFinger]}" en el biométrico...`,
        { duration: ENROLL_TIMEOUT_MS, id: `enroll-${selectedFinger}` }
      )
    } catch (err) {
      clearTimeout(enrollTimeoutRef.current)
      enrollTimeoutRef.current = null
      setFingerState(selectedFinger, 'error')
      setSelectedFinger(null)
      toast.error('Error al enviar solicitud: ' + err.message)
    }
  }, [selectedFinger, selectedDeviceSerial, empleadoData, empleadoId, clienteId, setFingerState])

  // ── Reintentar un dedo con error ─────────────────────────────────────────

  const retryFinger = useCallback((fingerKey) => {
    setFingerState(fingerKey, 'not_enrolled')
    if (selectedFinger === fingerKey) setSelectedFinger(null)
  }, [selectedFinger, setFingerState])

  return {
    fingerStates,
    selectedFinger,
    selectFinger,
    requestEnrollment,
    retryFinger,
    devices,
    selectedDeviceSerial,
    setSelectedDeviceSerial,
    loading,
    empleadoData,
  }
}
