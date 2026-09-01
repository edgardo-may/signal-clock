/**
 * useInactivity.js — Hook de detección de inactividad con auto-logout.
 * Signum-Clock v4
 *
 * Comportamiento:
 *  - Escucha: mousemove, mousedown, keydown, touchstart, scroll, click
 *  - Throttle de eventos: 30 segundos (evita trabajo innecesario en el JS thread)
 *  - Timeout: 30 minutos de inactividad → signOut + redirect
 *  - El hook solo actúa cuando el usuario está autenticado
 *
 * Implementación:
 *  - Un único setInterval de 1 minuto verifica el timestamp de última actividad.
 *    NUNCA reinicia timers en cada evento (eso crearía memory leaks y GC pressure).
 *  - La última actividad se guarda en una ref (en memoria, no en storage).
 *  - El throttle de 30s en los listeners minimiza el trabajo durante actividad continua.
 *
 * @param {{
 *   enabled: boolean,
 *   timeoutMs?: number,
 *   onInactive: () => void | Promise<void>,
 * }} options
 */

import { useEffect, useRef, useCallback } from 'react'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000   // 30 minutos
const CHECK_INTERVAL_MS  =  1 * 60 * 1000   // Verificar cada 1 minuto
const THROTTLE_MS        = 30 * 1000         // Throttle de eventos a 30 segundos

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
  'pointerdown',
]

export function useInactivity({
  enabled = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onInactive,
}) {
  const lastActivityRef  = useRef(Date.now())
  const lastThrottleRef  = useRef(0)
  const intervalRef      = useRef(null)
  const onInactiveRef    = useRef(onInactive)

  // Mantener la referencia actualizada sin re-registrar listeners
  useEffect(() => {
    onInactiveRef.current = onInactive
  }, [onInactive])

  // Función de actualización de actividad con throttle
  const handleActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastThrottleRef.current < THROTTLE_MS) return
    lastThrottleRef.current = now
    lastActivityRef.current = now
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Limpiar si se desactiva
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      ACTIVITY_EVENTS.forEach(evt =>
        window.removeEventListener(evt, handleActivity, { passive: true })
      )
      return
    }

    // Registrar actividad inicial
    lastActivityRef.current = Date.now()
    lastThrottleRef.current = Date.now()

    // Registrar listeners de actividad (passive para no bloquear scroll)
    ACTIVITY_EVENTS.forEach(evt =>
      window.addEventListener(evt, handleActivity, { passive: true })
    )

    // Verificar inactividad periódicamente (cada 1 minuto)
    intervalRef.current = setInterval(() => {
      const inactiveMs = Date.now() - lastActivityRef.current
      if (inactiveMs >= timeoutMs) {
        onInactiveRef.current?.()
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      ACTIVITY_EVENTS.forEach(evt =>
        window.removeEventListener(evt, handleActivity, { passive: true })
      )
    }
  }, [enabled, timeoutMs, handleActivity])

  /**
   * resetActivity — Llamar manualmente para reiniciar el contador.
   * Útil para formularios o modales de larga duración.
   */
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    lastThrottleRef.current = Date.now()
  }, [])

  return { resetActivity }
}
