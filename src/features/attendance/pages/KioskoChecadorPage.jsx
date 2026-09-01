// src/pages/KioskoChecador.jsx — Reloj Checador Kiosko Web & App Móvil con Geolocalización GPS del Celular
import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../shared/components/Layout/Sidebar'
import Header from '../../../shared/components/Layout/Header'
import toast, { Toaster } from 'react-hot-toast'
import {
  Clock, Camera, CameraOff, CheckCircle2,
  XCircle, Fingerprint, Maximize2, Minimize2,
  Volume2, VolumeX, Sparkles, Check, ArrowRight,
  ShieldCheck, AlertTriangle, Delete, KeyRound,
  ArrowLeft, BadgeCheck, Loader2, FlipHorizontal,
  CheckCheck, Coffee, RotateCcw, MapPin, MapPinOff,
  Navigation,
} from 'lucide-react'

// Componente Spinner
function Spinner({ size = 16, className = '' }) {
  return (
    <Loader2
      className={`animate-spin text-current ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  )
}

// Sintetizador de audio web para feedback de marcaje (Sin dependencias externas)
function reproducirSonido(tipo = 'exito') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (tipo === 'exito') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(587.33, ctx.currentTime) // D5
      osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1) // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35)
      osc.start()
      osc.stop(ctx.currentTime + 0.35)
    } else if (tipo === 'camara') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(987.77, ctx.currentTime) // B5
      osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.05) // E6
      gain.gain.setValueAtTime(0.18, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
      osc.start()
      osc.stop(ctx.currentTime + 0.2)
    } else if (tipo === 'tecla' || tipo === 'click') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      gain.gain.setValueAtTime(0.05, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06)
      osc.start()
      osc.stop(ctx.currentTime + 0.06)
    } else if (tipo === 'pin_ok') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(523.25, ctx.currentTime) // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08) // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16) // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    } else {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, ctx.currentTime)
      osc.frequency.setValueAtTime(160, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    }
  } catch (e) {
    // Silencioso si el navegador bloquea audio
  }
}

// Vibración táctil si el dispositivo/app lo soporta
function triggerHaptic(duration = 40) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(duration)
    }
  } catch (e) {}
}

export default function KioskoChecador() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [clienteId, setClienteId] = useState(null)
  const [clienteNombre, setClienteNombre] = useState('')

  // Reloj digital en vivo
  const [currentTime, setCurrentTime] = useState(new Date())

  // Configuración de Audio
  const [audioEnabled, setAudioEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('signum_kiosko_audio')
    return saved !== 'false'
  })

  // ── GEOLOCALIZACIÓN GPS DEL CELULAR ────────────────────────
  const [gpsUbicacion, setGpsUbicacion] = useState(null)
  const [gpsCargando, setGpsCargando] = useState(false)
  const [gpsError, setGpsError] = useState(null)

  // ── ESTADOS DEL FLUJO REQUERIDO ────────────────────────────
  // 1: 'CLAVE'    -> Ingresar ID o Clave de colaborador
  // 2: 'PIN'      -> Solicitar PIN de seguridad
  // 3: 'FOTO'     -> Se despliega la cámara de reconocimiento con botón "Tomar Foto"
  // 4: 'MARCAJE'  -> Se habilitan los botones de accesos (Entrada, Salida, Inicio Comida, Fin Comida)
  // 5: 'TICKET'   -> Confirmación exitosa con la foto tomada y reinicio automático
  const [paso, setPaso] = useState('CLAVE')

  // Datos del colaborador autenticado
  const [codigoInput, setCodigoInput] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [empleadoEncontrado, setEmpleadoEncontrado] = useState(null)
  const [buscando, setBuscando] = useState(false)

  // Manejo de Cámara (Soporte dual en vivo y nativa para HTTP/HTTPS)
  const [cameraFacing, setCameraFacing] = useState('user') // 'user' | 'environment'
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraLoading, setCameraLoading] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [fotoCapturada, setFotoCapturada] = useState(null)

  // Estado de procesamiento y ticket final
  const [punching, setPunching] = useState(false)
  const [ticketConfirmacion, setTicketConfirmacion] = useState(null)
  const [countdownReset, setCountdownReset] = useState(null)

  // Función para obtener la ubicación GPS precisa del celular
  const obtenerUbicacionGPS = useCallback((silent = true) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('GPS no soportado en este navegador.')
      return
    }

    setGpsCargando(true)
    setGpsError(null)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          latitud: pos.coords.latitude,
          longitud: pos.coords.longitude,
          precision: Math.round(pos.coords.accuracy || 0),
          altitud: pos.coords.altitude || null,
          timestamp: pos.timestamp || Date.now(),
        }
        setGpsUbicacion(coords)
        setGpsCargando(false)
        if (!silent) {
          toast.success(`📍 Ubicación GPS obtenida (±${coords.precision}m)`)
          if (audioEnabled) reproducirSonido('click')
          triggerHaptic(30)
        }
      },
      (err) => {
        setGpsCargando(false)
        let msg = 'No se pudo obtener la ubicación GPS'
        if (err.code === 1) msg = 'Permiso de ubicación denegado en tu navegador'
        else if (err.code === 2) msg = 'Posición GPS no disponible'
        else if (err.code === 3) msg = 'Tiempo agotado al obtener GPS'
        setGpsError(msg)
        if (!silent) {
          toast.error(msg)
          triggerHaptic(80)
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    )
  }, [audioEnabled])

  // Obtener GPS inicial de fondo al cargar el kiosco
  useEffect(() => {
    obtenerUbicacionGPS(true)
  }, [obtenerUbicacionGPS])

  // Reloj en tiempo real
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Guardar preferencia de audio
  useEffect(() => {
    localStorage.setItem('signum_kiosko_audio', audioEnabled ? 'true' : 'false')
  }, [audioEnabled])

  // Obtener cliente_id con fallback
  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const fromJwt = session.user?.app_metadata?.cliente_id ?? session.user?.user_metadata?.cliente_id ?? null
      if (fromJwt) {
        setClienteId(fromJwt)
        return
      }

      const { data: perfil } = await supabase
        .from('usuarios_perfiles')
        .select('cliente_id, clientes(nombre_empresa)')
        .eq('id', session.user.id)
        .maybeSingle()

      if (perfil?.cliente_id) {
        setClienteId(perfil.cliente_id)
        if (perfil.clientes?.nombre_empresa) setClienteNombre(perfil.clientes.nombre_empresa)
      }
    })()
  }, [])

  // Detener la cámara de forma limpia
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop() } catch (e) {}
      })
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
    setCameraLoading(false)
  }, [])

  // Iniciar la cámara móvil y web con soporte universal para HTTP y HTTPS
  const startCamera = useCallback(async (facing = cameraFacing) => {
    try {
      setCameraLoading(true)
      setCameraError(null)
      stopCamera()

      // Verificar si el navegador soporta getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraActive(false)
        setCameraError('Modo HTTP en celular: Presiona el botón para abrir la cámara de tu celular.')
        return
      }

      let stream = null

      try {
        const constraints = {
          video: {
            facingMode: facing ? { ideal: facing } : 'user',
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (firstErr) {
        // Fallback flexible para teléfonos celulares
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true')
        videoRef.current.setAttribute('webkit-playsinline', 'true')
        videoRef.current.muted = true
        try {
          await videoRef.current.play()
        } catch (playErr) {}
        setCameraActive(true)
      }
    } catch (err) {
      setCameraActive(false)
      setCameraError(err.message || 'Presiona el botón para abrir la cámara de tu celular.')
    } finally {
      setCameraLoading(false)
    }
  }, [cameraFacing, stopCamera])

  // Gestionar ciclo de vida de la cámara según el paso actual
  useEffect(() => {
    if (paso === 'FOTO' && !fotoCapturada) {
      startCamera(cameraFacing)
      // Refrescar GPS silenciosamente en el paso de foto
      if (!gpsUbicacion) obtenerUbicacionGPS(true)
    } else if (paso === 'CLAVE' || paso === 'PIN' || paso === 'TICKET') {
      stopCamera()
    }
    return () => {
      if (paso !== 'FOTO' && paso !== 'MARCAJE') {
        stopCamera()
      }
    }
  }, [paso, fotoCapturada, cameraFacing, startCamera, stopCamera, gpsUbicacion, obtenerUbicacionGPS])

  // Alternar cámara Frontal / Trasera (Móviles y Tablets)
  const toggleCameraFacing = () => {
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user'
    setCameraFacing(nextFacing)
    startCamera(nextFacing)
  }

  // ── PASO 1: Validar Clave de Colaborador e ir a Paso 2 (PIN) ────
  const handleValidarClave = useCallback(async (clave) => {
    if (!clienteId || !clave.trim()) return

    setBuscando(true)
    const clean = clave.trim()

    try {
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, clave_empleado, pin, departamento, puesto, hikvision_device_userid, tarjeta, avatar_url, activo')
        .eq('cliente_id', clienteId)
        .or(`clave_empleado.eq.${clean},hikvision_device_userid.eq.${clean},tarjeta.eq.${clean}`)
        .maybeSingle()

      if (!error && data) {
        if (!data.activo) {
          toast.error('Este colaborador se encuentra inactivo. Marcaje bloqueado.')
          if (audioEnabled) reproducirSonido('error')
          triggerHaptic(120)
          setBuscando(false)
          return
        }

        // Validación estricta: El colaborador DEBE tener un PIN generado
        if (!data.pin || !data.pin.trim()) {
          toast.error('Este colaborador no tiene un PIN generado. No puede checar hasta que se le asigne uno.')
          if (audioEnabled) reproducirSonido('error')
          triggerHaptic(140)
          setBuscando(false)
          return
        }

        setEmpleadoEncontrado(data)
        setPaso('PIN')
        setPinInput('')
        setPinError(false)
        if (audioEnabled) reproducirSonido('pin_ok')
        triggerHaptic(40)
      } else {
        toast.error('Colaborador no encontrado. Verifica tu clave o ID.')
        if (audioEnabled) reproducirSonido('error')
        triggerHaptic(100)
      }
    } catch (e) {
      toast.error('Error al consultar colaborador.')
    } finally {
      setBuscando(false)
    }
  }, [clienteId, audioEnabled])

  // ── PASO 2: Validar PIN de Seguridad e ir a Paso 3 (FOTO) ───────
  const handleValidarPin = useCallback((pinIngresado, empleado) => {
    if (!empleado) return

    // Validación estricta: Sin PIN generado no puede continuar
    if (!empleado.pin || !empleado.pin.trim()) {
      setPinError(true)
      if (audioEnabled) reproducirSonido('error')
      triggerHaptic(120)
      toast.error('Colaborador sin PIN generado. Marcaje bloqueado.')
      return
    }

    if (pinIngresado === empleado.pin) {
      setPinError(false)
      setPaso('FOTO')
      setFotoCapturada(null)
      if (audioEnabled) reproducirSonido('pin_ok')
      triggerHaptic(50)
      toast.success(`PIN Correcto. ¡Hola, ${empleado.nombre}!`)
      startCamera(cameraFacing)
    } else {
      setPinError(true)
      if (audioEnabled) reproducirSonido('error')
      triggerHaptic(120)
      toast.error('PIN de seguridad incorrecto.')
    }
  }, [audioEnabled, cameraFacing, startCamera])

  // ── PASO 3: Tomar Foto de Reconocimiento e ir a Paso 4 (MARCAJE) ─
  const handleTomarFoto = () => {
    if (audioEnabled) reproducirSonido('camara')
    triggerHaptic(60)

    try {
      if (cameraActive && videoRef.current && canvasRef.current) {
        const video = videoRef.current
        const canvas = canvasRef.current
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        const ctx = canvas.getContext('2d')

        if (cameraFacing === 'user') {
          ctx.translate(canvas.width, 0)
          ctx.scale(-1, 1)
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const snapshot = canvas.toDataURL('image/jpeg', 0.75)
        setFotoCapturada(snapshot)
        stopCamera()
        setPaso('MARCAJE')
        toast.success('Foto tomada con éxito. Selecciona tu acceso.')
        return
      }
    } catch (e) {}

    // Si la cámara en vivo no está activa (ej. HTTP en red local), abrir la cámara nativa del celular
    if (fileInputRef.current) {
      fileInputRef.current.click()
    } else {
      stopCamera()
      setFotoCapturada(null)
      setPaso('MARCAJE')
      toast.success('Acceso habilitado. Selecciona tu acceso.')
    }
  }

  // Captura de foto mediante la cámara nativa del dispositivo (Soporta HTTP en celulares y tablets)
  const handleFileCapture = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result
      setFotoCapturada(base64)
      if (audioEnabled) reproducirSonido('camara')
      triggerHaptic(60)
      setPaso('MARCAJE')
      toast.success('Foto capturada con éxito. Selecciona tu acceso.')
    }
    reader.readAsDataURL(file)
  }

  // Continuar sin foto (en caso de que el dispositivo no tenga cámara o falle el permiso)
  const handleContinuarSinFoto = () => {
    stopCamera()
    setFotoCapturada(null)
    setPaso('MARCAJE')
    if (audioEnabled) reproducirSonido('click')
    triggerHaptic(30)
    toast('Acceso habilitado sin fotografía', { icon: '⏱️' })
  }

  // Retomar foto
  const handleRetomarFoto = () => {
    setFotoCapturada(null)
    setPaso('FOTO')
    startCamera(cameraFacing)
  }

  // ── PASO 4: Registrar Marcaje con Foto y Generar Ticket ─────────
  const ejecutarMarcaje = async (tipoVerificacion) => {
    if (!empleadoEncontrado) return

    setPunching(true)
    try {
      const now = new Date()

      const payload = {
        cliente_id: clienteId,
        empleado_id: empleadoEncontrado.id,
        dispositivo_id: null,
        verificado_at: now.toISOString(),
        tipo_verificacion: tipoVerificacion,
        metodo: 'web',
        es_manual: false,
        raw_payload: {
          origen: 'kiosko_web_app',
          snapshot: fotoCapturada,
          clave_utilizada: codigoInput,
          pin_verificado: true,
          foto_tomada: Boolean(fotoCapturada),
          ubicacion_gps: gpsUbicacion ? {
            latitud: gpsUbicacion.latitud,
            longitud: gpsUbicacion.longitud,
            precision_metros: gpsUbicacion.precision,
            altitud: gpsUbicacion.altitud,
            timestamp: gpsUbicacion.timestamp,
            mapa_url: `https://www.google.com/maps?q=${gpsUbicacion.latitud},${gpsUbicacion.longitud}`,
          } : null,
          gps_activo: Boolean(gpsUbicacion),
          navegador: navigator.userAgent,
        },
      }

      const { error } = await supabase.from('registro_asistencia').insert(payload)
      if (error) throw error

      if (audioEnabled) reproducirSonido('exito')
      triggerHaptic(80)

      const labels = {
        entrada: 'ENTRADA LABORAL',
        salida: 'SALIDA LABORAL',
        descanso_inicio: 'INICIO DE DESCANSO',
        descanso_fin: 'FIN DE DESCANSO',
      }

      setTicketConfirmacion({
        empleado: empleadoEncontrado,
        tipo: labels[tipoVerificacion] || tipoVerificacion.toUpperCase(),
        hora: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
        fecha: now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        snapshot: fotoCapturada,
        ubicacion: gpsUbicacion,
      })

      setPaso('TICKET')

      // Cuenta regresiva de 4s para reiniciar al Paso 1
      let timer = 4
      setCountdownReset(timer)
      const countdownInterval = setInterval(() => {
        timer--
        if (timer <= 0) {
          clearInterval(countdownInterval)
          resetKiosko()
        } else {
          setCountdownReset(timer)
        }
      }, 1000)

    } catch (err) {
      toast.error('Error al registrar marcaje: ' + (err.message || 'Error desconocido'))
      if (audioEnabled) reproducirSonido('error')
      triggerHaptic(120)
    } finally {
      setPunching(false)
    }
  }

  // Resetear todo al Paso 1 para el siguiente colaborador
  const resetKiosko = () => {
    stopCamera()
    setPaso('CLAVE')
    setCodigoInput('')
    setPinInput('')
    setPinError(false)
    setEmpleadoEncontrado(null)
    setFotoCapturada(null)
    setTicketConfirmacion(null)
    setCountdownReset(null)
  }

  // Teclado numérico táctil interactivo
  const handleKeypadPress = (val) => {
    if (audioEnabled) reproducirSonido('tecla')
    triggerHaptic(25)

    if (paso === 'CLAVE') {
      if (val === 'CLEAR') {
        setCodigoInput('')
      } else if (val === 'BACK') {
        setCodigoInput(prev => prev.slice(0, -1))
      } else if (val === 'ENTER') {
        handleValidarClave(codigoInput)
      } else {
        const updated = codigoInput + val
        setCodigoInput(updated)
      }
    } else if (paso === 'PIN') {
      if (val === 'CLEAR') {
        setPinInput('')
        setPinError(false)
      } else if (val === 'BACK') {
        setPinInput(prev => prev.slice(0, -1))
        setPinError(false)
      } else if (val === 'ENTER') {
        handleValidarPin(pinInput, empleadoEncontrado)
      } else {
        if (pinInput.length < 6) {
          const updated = pinInput + val
          setPinInput(updated)
          setPinError(false)

          // Auto-validar si alcanza la longitud del PIN configurado (o 4 dígitos por defecto)
          const targetLength = empleadoEncontrado?.pin?.length || 4
          if (updated.length === targetLength) {
            handleValidarPin(updated, empleadoEncontrado)
          }
        }
      }
    }
  }

  // Toggle de pantalla completa
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullScreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullScreen(false)).catch(() => {})
    }
  }

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#060911] text-slate-100 select-none overflow-x-hidden font-sans">
      <Toaster position="top-center" containerStyle={{ top: 12 }} />

      {/* ── Contenedor Principal del Kiosco (Optimizado para Celular y Pantallas Táctiles) ── */}
      <div className="relative flex flex-1 flex-col justify-between w-full max-w-lg mx-auto p-3 sm:p-5 bg-gradient-to-b from-[#080d1a] via-[#0d1424] to-[#151233] min-h-[100dvh]">

        {/* ── Barra Superior Compacta de Aplicación Móvil ── */}
        <header className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-[#11192e]/90 border border-slate-700/60 backdrop-blur-md shadow-lg">
          {/* Logo & Marca */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-primary to-slate-100 shadow-md shadow-blue-600/25 flex-shrink-0">
              <Fingerprint className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-black tracking-wider text-white truncate flex items-center gap-1">
                SIGNUM<span className="text-blue-600 dark:text-blue-400">·</span>KIOSKO
              </h1>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 font-medium truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping flex-shrink-0" />
                <span className="text-emerald-400 font-bold truncate">{clienteNombre || 'En Línea'}</span>
              </div>
            </div>
          </div>

          {/* Reloj Digital, Badge GPS & Controles */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-sm sm:text-base font-black font-mono tracking-tight text-white leading-tight">
                {currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </p>

              {/* Botón / Indicador de Geolocalización GPS en vivo */}
              <button
                type="button"
                onClick={() => obtenerUbicacionGPS(false)}
                className="flex items-center justify-end gap-1 text-[9px] sm:text-[10px] font-semibold transition-colors cursor-pointer"
                title="Presiona para actualizar ubicación GPS del celular"
              >
                {gpsCargando ? (
                  <span className="text-blue-300 flex items-center gap-0.5">
                    <Spinner size={9} /> GPS...
                  </span>
                ) : gpsUbicacion ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-0.5 hover:underline">
                    <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                    GPS ±{gpsUbicacion.precision}m
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-0.5 hover:underline">
                    <MapPinOff className="w-2.5 h-2.5 text-amber-400" />
                    Activar GPS
                  </span>
                )}
              </button>
            </div>

            {/* Controles Rápidos */}
            <div className="flex items-center gap-1 border-l border-slate-700/80 pl-2">
              <button
                type="button"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer"
                title={audioEnabled ? 'Sonido Activado' : 'Sonido Silenciado'}
              >
                {audioEnabled ? <Volume2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />}
              </button>

              <button
                type="button"
                onClick={toggleFullScreen}
                className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer"
                title="Pantalla Completa"
              >
                {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </header>

        {/* ── CUERPO PRINCIPAL DEL KIOSCO ADAPTADO AL CELULAR ── */}
        <main className="flex-1 flex flex-col justify-center my-auto py-2 w-full">

          {/* ══════════════════════════════════════════════════════════
              PASO 1: IDENTIFICACIÓN (Centrado, limpio y táctil)
          ══════════════════════════════════════════════════════════ */}
          {paso === 'CLAVE' && (
            <div className="w-full space-y-4 animate-slideDown">
              <div className="text-center space-y-1">
                <span className="text-[11px] font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase bg-blue-950/80 px-3 py-0.5 rounded-full border border-blue-500/30">
                  Identificación
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  Ingresa tu ID o Clave
                </h2>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Digita tu número laboral para iniciar tu marcaje.
                </p>
              </div>

              {/* Input de Clave */}
              <div className="relative">
                <input
                  type="text"
                  value={codigoInput}
                  onChange={e => setCodigoInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleValidarClave(codigoInput) }}
                  placeholder="ej. 101 o EMP-101"
                  className="w-full py-3.5 px-4 rounded-2xl bg-slate-950 border-2 border-blue-500/50 text-2xl font-mono font-bold text-white text-center tracking-widest placeholder-slate-600 outline-none focus:border-blue-400 shadow-inner"
                  autoFocus
                />

                {buscando ? (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400">
                    <Spinner size={22} />
                  </div>
                ) : codigoInput ? (
                  <button
                    type="button"
                    onClick={() => setCodigoInput('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-700 dark:text-slate-300 hover:text-white p-1 cursor-pointer"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                ) : null}
              </div>

              {/* Botón Continuar al PIN */}
              <button
                type="button"
                onClick={() => handleValidarClave(codigoInput)}
                disabled={!codigoInput.trim() || buscando}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-brand-primary via-purple-600 to-slate-100 hover:from-brand-primary hover:to-slate-100 text-white font-black text-sm shadow-xl shadow-blue-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer active:scale-98"
              >
                {buscando ? (
                  <>
                    <Spinner size={16} />
                    <span>Validando ID...</span>
                  </>
                ) : (
                  <>
                    <span>Continuar al PIN</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Teclado Numérico Táctil para Celular */}
              <div className="pt-2">
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleKeypadPress(String(num))}
                      className="py-3 sm:py-3.5 rounded-2xl bg-[#182138] hover:bg-slate-700 active:bg-blue-600 text-white font-mono text-xl sm:text-2xl font-black transition-all shadow-md active:scale-95 cursor-pointer select-none"
                    >
                      {num}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('CLEAR')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800/40 text-rose-300 font-bold text-xs uppercase transition-all active:scale-95 cursor-pointer select-none"
                  >
                    Borrar
                  </button>

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('0')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-[#182138] hover:bg-slate-700 active:bg-blue-600 text-white font-mono text-xl sm:text-2xl font-black transition-all shadow-md active:scale-95 cursor-pointer select-none"
                  >
                    0
                  </button>

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('BACK')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-[#182138] hover:bg-slate-700 active:bg-slate-600 text-slate-300 flex items-center justify-center transition-all active:scale-95 cursor-pointer select-none"
                    title="Retroceder un dígito"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              PASO 2: SOLICITAR PIN DE SEGURIDAD
          ══════════════════════════════════════════════════════════ */}
          {paso === 'PIN' && (
            <div className="w-full space-y-4 animate-slideDown">
              {/* Tarjeta del colaborador identificado */}
              {empleadoEncontrado && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-blue-950/70 to-purple-950/70 border border-blue-500/40 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {empleadoEncontrado.avatar_url ? (
                      <img
                        src={empleadoEncontrado.avatar_url}
                        alt=""
                        className="w-11 h-11 rounded-xl object-cover border border-blue-400 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-blue-600 font-black text-white flex items-center justify-center text-base flex-shrink-0">
                        {empleadoEncontrado.nombre[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate leading-tight">
                        {empleadoEncontrado.nombre} {empleadoEncontrado.apellido}
                      </h4>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                        {empleadoEncontrado.puesto || empleadoEncontrado.departamento || 'Colaborador'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={resetKiosko}
                    className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer flex-shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Cambiar</span>
                  </button>
                </div>
              )}

              <div className="text-center space-y-1">
                <h3 className="text-lg font-black text-white flex items-center justify-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-pink-400" />
                  Ingresa tu PIN de Seguridad
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Digita tus 4 dígitos secretos para desbloquear la cámara.
                </p>
              </div>

              {/* Indicador de dígitos de PIN (dots) */}
              <div className={`p-4 rounded-2xl bg-slate-950 border-2 transition-all flex items-center justify-center gap-4 ${
                pinError ? 'border-rose-500 bg-rose-950/20 animate-shake' : 'border-blue-500/50 shadow-inner'
              }`}>
                {[0, 1, 2, 3].map(idx => (
                  <div
                    key={idx}
                    className={`w-5 h-5 rounded-full transition-all duration-200 ${
                      pinInput.length > idx
                        ? 'bg-pink-500 scale-120 shadow-lg shadow-pink-500/60 ring-4 ring-pink-500/20'
                        : 'bg-slate-900 border-2 border-slate-700'
                    }`}
                  />
                ))}
              </div>

              {pinError && (
                <p className="text-xs font-bold text-rose-400 text-center flex items-center justify-center gap-1 animate-slideDown">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  PIN incorrecto. Intenta nuevamente.
                </p>
              )}

              {/* Teclado Numérico para PIN */}
              <div className="pt-1">
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleKeypadPress(String(num))}
                      className="py-3 sm:py-3.5 rounded-2xl bg-[#182138] hover:bg-slate-700 active:bg-blue-600 text-white font-mono text-xl sm:text-2xl font-black transition-all shadow-md active:scale-95 cursor-pointer select-none"
                    >
                      {num}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('CLEAR')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800/40 text-rose-300 font-bold text-xs uppercase transition-all active:scale-95 cursor-pointer select-none"
                  >
                    Borrar
                  </button>

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('0')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-[#182138] hover:bg-slate-700 active:bg-blue-600 text-white font-mono text-xl sm:text-2xl font-black transition-all shadow-md active:scale-95 cursor-pointer select-none"
                  >
                    0
                  </button>

                  <button
                    type="button"
                    onClick={() => handleKeypadPress('BACK')}
                    className="py-3 sm:py-3.5 rounded-2xl bg-[#182138] hover:bg-slate-700 active:bg-slate-600 text-slate-300 flex items-center justify-center transition-all active:scale-95 cursor-pointer select-none"
                    title="Retroceder un dígito"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              PASO 3: CÁMARA DE RECONOCIMIENTO Y BOTÓN DE FOTO
          ══════════════════════════════════════════════════════════ */}
          {paso === 'FOTO' && (
            <div className="w-full space-y-3.5 animate-slideDown">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Enfoca tu Rostro
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Captura tu fotografía para habilitar los accesos.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={toggleCameraFacing}
                  className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-slate-700 flex items-center gap-1 text-xs cursor-pointer active:scale-95"
                  title="Cambiar cámara Frontal / Trasera"
                >
                  <FlipHorizontal className="w-4 h-4" />
                  <span className="text-[11px]">Voltear</span>
                </button>
              </div>

              {/* Visor de Cámara Adaptado al Celular */}
              <div className="relative aspect-[4/3] max-h-64 sm:max-h-72 w-full rounded-2xl overflow-hidden bg-slate-950 border-2 border-blue-500/50 shadow-2xl flex items-center justify-center mx-auto">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraFacing === 'user' ? 'scale-x-[-1]' : ''}`}
                />

                {/* Guía facial */}
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-36 h-40 rounded-3xl border-2 border-dashed border-blue-400/80 flex items-center justify-center">
                      <span className="text-[9px] font-bold tracking-widest text-blue-200 uppercase bg-slate-950/80 px-2 py-0.5 rounded-full border border-blue-400/40">
                        Rostro
                      </span>
                    </div>
                  </div>
                )}

                {/* Estado de carga */}
                {cameraLoading && (
                  <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-2 text-blue-300">
                    <Spinner size={26} />
                    <span className="text-xs font-semibold">Iniciando cámara...</span>
                  </div>
                )}

                {/* Botón de activación directa para celular */}
                {(!cameraActive && !cameraLoading) && (
                  <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-4 text-center space-y-3">
                    <Camera className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-pulse" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-white">Cámara en Celular / Tablet</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 max-w-xs">
                        {cameraError || 'Presiona el botón para conceder permisos y tomar la foto.'}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 w-full max-w-xs">
                      <button
                        type="button"
                        onClick={() => startCamera(cameraFacing)}
                        className="w-full py-2.5 px-4 rounded-xl text-xs font-black bg-blue-600 hover:bg-blue-50 dark:bg-blue-950/60 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Permitir Cámara</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleContinuarSinFoto}
                        className="w-full py-2 px-4 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:text-white border border-slate-700 cursor-pointer active:scale-95"
                      >
                        Continuar sin foto
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <canvas ref={canvasRef} className="hidden" />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture={cameraFacing === 'user' ? 'user' : 'environment'}
                onChange={handleFileCapture}
                className="hidden"
              />

              {/* Botón Principal: TOMAR FOTO */}
              <button
                type="button"
                onClick={handleTomarFoto}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-brand-primary via-purple-600 to-pink-600 hover:from-brand-primary hover:to-pink-500 text-white font-black text-sm shadow-xl shadow-blue-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98"
              >
                <Camera className="w-5 h-5 stroke-[2.5]" />
                <span>{cameraActive ? 'Tomar Foto y Habilitar Accesos' : '📸 Abrir Cámara y Capturar Foto'}</span>
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              PASO 4: BOTONES DE ACCESOS HABILITADOS
          ══════════════════════════════════════════════════════════ */}
          {paso === 'MARCAJE' && (
            <div className="w-full space-y-3.5 animate-slideDown">
              {/* Tarjeta con miniatura de foto y estado de GPS */}
              <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-700/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {fotoCapturada ? (
                    <img
                      src={fotoCapturada}
                      alt="Evidencia"
                      className="w-11 h-11 rounded-xl object-cover border border-emerald-400 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-blue-600 font-bold text-white flex items-center justify-center text-sm flex-shrink-0">
                      {empleadoEncontrado?.nombre?.[0] || 'C'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-white truncate leading-tight">
                      {empleadoEncontrado?.nombre} {empleadoEncontrado?.apellido}
                    </h4>
                    <p className="text-[10px] text-emerald-400 font-semibold truncate flex items-center gap-1">
                      <Check className="w-3 h-3 flex-shrink-0" /> Foto Lista
                      {gpsUbicacion && (
                        <span className="text-blue-300 font-mono">· 📍 GPS ±{gpsUbicacion.precision}m</span>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={resetKiosko}
                  className="text-xs text-slate-400 dark:text-slate-500 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer flex-shrink-0"
                >
                  Cancelar
                </button>
              </div>

              <div className="text-center">
                <h3 className="text-base font-black text-white">
                  Selecciona tu Marcaje Laboral:
                </h3>
              </div>

              {/* 4 Botones de Accesos (2x2 Táctiles Grandes) */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
                {/* 1. Entrada */}
                <button
                  type="button"
                  onClick={() => ejecutarMarcaje('0')}
                  disabled={punching}
                  className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold shadow-xl shadow-emerald-500/30 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-7 h-7 mb-1.5 stroke-[2.2]" />
                  <span className="text-sm uppercase tracking-wider font-black">Entrada</span>
                  <span className="text-[10px] text-emerald-100 font-normal">Inicio jornada</span>
                </button>

                {/* 2. Salida */}
                <button
                  type="button"
                  onClick={() => ejecutarMarcaje('1')}
                  disabled={punching}
                  className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-gradient-to-b from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-bold shadow-xl shadow-rose-500/30 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-7 h-7 mb-1.5 stroke-[2.2]" />
                  <span className="text-sm uppercase tracking-wider font-black">Salida</span>
                  <span className="text-[10px] text-rose-100 font-normal">Fin jornada</span>
                </button>

                {/* 3. Inicio Descanso */}
                <button
                  type="button"
                  onClick={() => ejecutarMarcaje('2')}
                  disabled={punching}
                  className="flex flex-col items-center justify-center py-3.5 px-2 rounded-2xl bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-bold shadow-xl shadow-amber-500/30 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Coffee className="w-6 h-6 mb-1 stroke-[2.2]" />
                  <span className="text-xs uppercase tracking-wider font-bold">Inicio Comida</span>
                  <span className="text-[9px] text-amber-100 font-normal">Salida descanso</span>
                </button>

                {/* 4. Fin Descanso */}
                <button
                  type="button"
                  onClick={() => ejecutarMarcaje('3')}
                  disabled={punching}
                  className="flex flex-col items-center justify-center py-3.5 px-2 rounded-2xl bg-gradient-to-b from-sky-500 to-sky-600 hover:from-sky-400 hover:to-sky-500 text-white font-bold shadow-xl shadow-sky-500/30 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="w-6 h-6 mb-1 stroke-[2.2]" />
                  <span className="text-xs uppercase tracking-wider font-bold">Fin Comida</span>
                  <span className="text-[9px] text-sky-100 font-normal">Regreso descanso</span>
                </button>
              </div>

              {punching && (
                <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-900 text-xs font-semibold text-blue-300">
                  <Spinner size={16} />
                  <span>Guardando marcaje y coordenadas GPS...</span>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              PASO 5: TICKET DIGITAL DE CONFIRMACIÓN
          ══════════════════════════════════════════════════════════ */}
          {paso === 'TICKET' && ticketConfirmacion && (
            <div className="w-full rounded-3xl bg-gradient-to-b from-[#141d33] to-[#0c1222] border border-emerald-500/40 p-5 sm:p-7 shadow-2xl text-center space-y-4 animate-slideDown">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/30">
                <CheckCheck className="w-7 h-7 stroke-[2.5]" />
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300 bg-emerald-950/80 px-3 py-0.5 rounded-full border border-emerald-500/40 shadow-sm">
                  ¡Marcaje Registrado!
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-2 tracking-wide">
                  {ticketConfirmacion.tipo}
                </h2>
                <p className="text-xs font-mono text-blue-300 mt-0.5 font-bold">
                  {ticketConfirmacion.hora} · {ticketConfirmacion.fecha}
                </p>
              </div>

              {/* Perfil del colaborador y foto evidencia */}
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#090e1c] border border-slate-700/80 text-left">
                {ticketConfirmacion.snapshot ? (
                  <img
                    src={ticketConfirmacion.snapshot}
                    alt="Evidencia"
                    className="w-14 h-14 rounded-xl object-cover border-2 border-emerald-400 shadow-md flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-brand-primary to-purple-600 flex items-center justify-center font-black text-xl text-white shadow-md flex-shrink-0">
                    {ticketConfirmacion.empleado?.nombre?.[0] || 'C'}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-white truncate leading-tight">
                    {ticketConfirmacion.empleado?.nombre} {ticketConfirmacion.empleado?.apellido}
                  </h4>
                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
                    {ticketConfirmacion.empleado?.puesto || ticketConfirmacion.empleado?.departamento || 'Colaborador'}
                  </p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 font-semibold mt-0.5">
                    <BadgeCheck className="w-3 h-3 text-emerald-400" /> Clave: {ticketConfirmacion.empleado?.clave_empleado || ticketConfirmacion.empleado?.id}
                  </span>

                  {/* Coordenadas GPS en el ticket */}
                  {ticketConfirmacion.ubicacion && (
                    <p className="text-[9px] font-mono text-blue-300 flex items-center gap-1 mt-1">
                      <MapPin className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400" />
                      GPS: {ticketConfirmacion.ubicacion.latitud.toFixed(4)}, {ticketConfirmacion.ubicacion.longitud.toFixed(4)} (±{ticketConfirmacion.ubicacion.precision}m)
                    </p>
                  )}
                </div>
              </div>

              {/* Barra de cuenta regresiva y botón de reset */}
              <div className="pt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  Reinicio en <strong className="text-emerald-400 font-mono text-xs">{countdownReset}s</strong>...
                </span>

                <button
                  type="button"
                  onClick={resetKiosko}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-50 dark:bg-blue-950/60 transition-all shadow-lg shadow-blue-600/30 cursor-pointer active:scale-95"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}

        </main>

        {/* ── Pie de Página del Kiosco Móvil ── */}
        <footer className="text-center py-1 text-[10px] text-slate-700 dark:text-slate-300 font-medium">
          Signum·Clock Kiosko Terminal © {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  )
}






