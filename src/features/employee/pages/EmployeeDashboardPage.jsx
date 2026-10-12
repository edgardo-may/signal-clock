// src/features/employee/pages/EmployeeDashboardPage.jsx — Signum-Clock Portal del Empleado
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getEmployeeSession,
  logoutEmployee,
  getEmployeeState,
  registrarChecada,
  getClockPreference,
  setClockPreference,
} from "../services/employeeAuthService";
import {
  ensureServerTimeSync,
  getServerNow,
  formatInTenantTimezone,
  resolveLocationTimezone,
  getDeviceClockDriftSeconds,
} from "../services/serverTimeService";
import toast from "react-hot-toast";
import { getPunchDay, getNextPunch } from "../services/punchFlow";
import {
  Clock,
  CheckCircle2,
  Calendar,
  Building2,
  Briefcase,
  Fingerprint,
  Coffee,
  LogOut as LogOutIcon,
  LogIn as LogInIcon,
  User,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  Sun,
  Moon,
  ChevronDown,
  RefreshCw,
  MapPin,
  MapPinOff,
  Navigation,
  CalendarDays,
  Camera,
  CameraOff,
  FlipHorizontal,
  X,
  AlertTriangle,
  Check,
  Save,
} from "lucide-react";
import {
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from "../../../shared/components/ui";

// ─── Configuración Semántica de Tipos de Marcaje ──────────────────
const PUNCH_CONFIG = {
  entrada: {
    label: "Entrada",
    actionText: "Registrar Entrada",
    desc: "Iniciar jornada de trabajo",
    icon: LogInIcon,
    theme: "emerald",
    badgeCls:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    dotCls: "bg-emerald-500",
    btnCls:
      "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20 active:scale-[0.98]",
  },
  descanso_inicio: {
    label: "Salida a Descanso",
    actionText: "Iniciar Descanso",
    desc: "Comida o pausa laboral",
    icon: Coffee,
    theme: "amber",
    badgeCls:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    dotCls: "bg-amber-500",
    btnCls:
      "bg-amber-500 hover:bg-amber-600 text-white shadow-sm shadow-amber-500/20 active:scale-[0.98]",
  },
  descanso_fin: {
    label: "Regreso de Descanso",
    actionText: "Finalizar Descanso",
    desc: "Reincorporación a labores",
    icon: Sparkles,
    theme: "sky",
    badgeCls:
      "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
    dotCls: "bg-sky-500",
    btnCls:
      "bg-sky-600 hover:bg-sky-700 text-white shadow-sm shadow-sky-600/20 active:scale-[0.98]",
  },
  salida: {
    label: "Salida",
    actionText: "Registrar Salida",
    desc: "Concluir jornada laboral",
    icon: LogOutIcon,
    theme: "rose",
    badgeCls:
      "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
    dotCls: "bg-rose-500",
    btnCls:
      "bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/20 active:scale-[0.98]",
  },
};

export default function EmployeeDashboardPage() {
  const navigate = useNavigate();
  const employeeSession = getEmployeeSession();
  const activeTenantId = employeeSession?.clienteId;
  const [clockSlug, setClockSlug] = useState(getClockPreference);
  const [availableClocks, setAvailableClocks] = useState([]);
  const pendingPunch = useRef(null);

  // Estados del empleado
  const [loading, setLoading] = useState(true);
  const [empleado, setEmpleado] = useState(null);
  const [horarioAsignado, setHorarioAsignado] = useState(null);
  const [checadasHoy, setChecadasHoy] = useState([]);
  const [punchDataReady, setPunchDataReady] = useState(false);
  const [historialReciente, setHistorialReciente] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  // Estado y geolocalización GPS (Estricta)
  const [gpsUbicacion, setGpsUbicacion] = useState(null);
  const [gpsCargando, setGpsCargando] = useState(false);
  const [gpsError, setGpsError] = useState(null);

  // Hora del Servidor Sincronizada (Anti-manipulación de reloj local)
  const [serverTime, setServerTime] = useState(new Date());
  const [tenantTimezone, setTenantTimezone] = useState(
    employeeSession?.timezone || resolveLocationTimezone()
  );
  const [clockDrift, setClockDrift] = useState(0);
  const punchDay = getPunchDay(serverTime, tenantTimezone);

  // ── Cámara y Foto de Referencia para Marcaje ─────────────────────
  // Modal de marcaje: cuando hacen clic en entrada/salida, se activa la cámara
  const [modalMarcaje, setModalMarcaje] = useState(null); // { tipo: 'entrada', config: ... }
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState("user"); // 'user' | 'environment'
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [fotoCapturada, setFotoCapturada] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── 1. Sincronizar Hora Oficial del Servidor ──────────────────────
  useEffect(() => {
    let mounted = true;
    async function initServerTime() {
      await ensureServerTimeSync();
      if (!mounted) return;
      setServerTime(getServerNow());
      setClockDrift(getDeviceClockDriftSeconds());
    }
    initServerTime();

    // Monotonic clock timer (no se afecta si el usuario mueve la hora del celular/PC)
    const timer = setInterval(() => {
      if (mounted) {
        setServerTime(getServerNow());
      }
    }, 1000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  // ── 2. Helper para obtener GPS del dispositivo ───────────────────
  const obtenerUbicacionGPS = useCallback((silent = true) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("GPS no soportado en este dispositivo/navegador.");
      return Promise.resolve(null);
    }

    setGpsCargando(true);
    setGpsError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            precision_metros: Math.round(pos.coords.accuracy || 0),
            altitud: pos.coords.altitude || null,
            timestamp: pos.timestamp || Date.now(),
            mapa_url: `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`,
          };
          setGpsUbicacion(coords);
          setGpsCargando(false);
          setGpsError(null);

          if (!silent) {
            toast.success(
              `📍 Ubicación GPS detectada (±${coords.precision_metros}m)`
            );
          }
          resolve(coords);
        },
        (err) => {
          setGpsCargando(false);
          let msg = "No se pudo obtener la ubicación GPS";
          if (err.code === 1)
            msg = "Permiso de ubicación denegado en tu navegador/celular";
          else if (err.code === 2) msg = "Posición GPS no disponible";
          else if (err.code === 3) msg = "Tiempo agotado al obtener GPS";
          setGpsError(msg);
          if (!silent) {
            toast.error(msg);
          }
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 15000,
        }
      );
    });
  }, []);

  // ── 3. Primer Acceso: Solicitar permisos para GPS y Cámara ───────
  // "siempre solicitar en el primer acceso permisos para gps y camara
  // pero cuando se den los permisos que no active la camara hasta que se marque"
  useEffect(() => {
    // A. Solicitar GPS
    obtenerUbicacionGPS(true);

    // B. Solicitar permiso de cámara por adelantado y APAGARLA de inmediato
    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    ) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user" }, audio: false })
        .then((stream) => {
          // Apagar inmediatamente todos los tracks para que no quede rastro ni luz activa
          stream.getTracks().forEach((track) => track.stop());
        })
        .catch((err) => {
          console.warn("Permiso inicial de cámara:", err?.message || err);
        });
    }
  }, [obtenerUbicacionGPS]);

  // ── 4. Control de Cámara: Activar solo al marcar y Apagar al guardar ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraLoading(false);
  }, []);

  const startCamera = useCallback(
    async (facing = cameraFacing) => {
      try {
        setCameraLoading(true);
        setCameraError(null);
        stopCamera();

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCameraActive(false);
          setCameraError(
            "Cámara directa no disponible. Puedes usar el botón para tomar foto con tu celular."
          );
          return;
        }

        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: facing === "user" ? "user" : "environment",
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
            audio: false,
          });
        } catch (_) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.setAttribute("webkit-playsinline", "true");
          videoRef.current.muted = true;
          try {
            await videoRef.current.play();
          } catch (_) {}
          setCameraActive(true);
        }
      } catch (err) {
        setCameraActive(false);
        setCameraError(
          "No se pudo acceder a la cámara. Concede permisos para tomar la foto de referencia."
        );
      } finally {
        setCameraLoading(false);
      }
    },
    [cameraFacing, stopCamera]
  );

  const toggleCameraFacing = () => {
    const nextFacing = cameraFacing === "user" ? "environment" : "user";
    setCameraFacing(nextFacing);
    startCamera(nextFacing);
  };

  const capturarSnapshot = useCallback(() => {
    try {
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = Math.min(video.videoWidth || 640, 640);
        canvas.height = Math.round(canvas.width * (video.videoHeight || 480) / (video.videoWidth || 640));
        const ctx = canvas.getContext("2d");

        if (cameraFacing === "user") {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const snapshot = canvas.toDataURL("image/jpeg", 0.65);
        setFotoCapturada(snapshot);
        return snapshot;
      }
    } catch (e) {
      console.warn("Error al capturar frame:", e);
    }
    return null;
  }, [cameraFacing]);

  const handleFileCapture = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(image.width, 640);
        canvas.height = Math.round(canvas.width * image.height / image.width);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        setFotoCapturada(canvas.toDataURL('image/jpeg', 0.65));
        toast.success("Foto de referencia lista");
      };
      image.onerror = () => toast.error('No se pudo abrir la foto.');
      image.src = event.target?.result;
    };
    reader.readAsDataURL(file);
  };

  // All personal data comes from the verified HttpOnly session.
  const cargarDatosEmpleado = useCallback(async () => {
    setLoading(true);
    setPunchDataReady(false);
    try {
      let result = await getEmployeeState(clockSlug);
      if (!result.success && clockSlug) {
        result = await getEmployeeState('');
        if (result.success) { setClockPreference(''); setClockSlug(''); }
      }
      if (!result.success) throw new Error(result.error);
      const own = result.session;
      setEmpleado({ id: own.empleadoId, cliente_id: own.clienteId, nombre: own.nombre,
        apellido: own.apellido, clave_empleado: own.claveEmpleado, departamento: own.departamento,
        puesto: own.puesto, avatar_url: own.avatarUrl, activo: true });
      const timezone = own.timezone || 'UTC';
      setTenantTimezone(timezone);
      setServerTime(new Date(result.server_time));
      setAvailableClocks(result.clocks || []);
      if (result.clock && result.clock !== clockSlug) {
        setClockPreference(result.clock);
        setClockSlug(result.clock);
      }
      const day = getPunchDay(new Date(result.server_time), timezone);
      const rows = result.attendance || [];
      setChecadasHoy(rows.filter(row => row.verificado_at >= day.start && row.verificado_at < day.end));
      setHistorialReciente(rows.slice(0, 20));
      setHorarioAsignado(result.horario);
      setPunchDataReady(Boolean(result.clock));
    } catch (err) {
      setChecadasHoy([]);
      setHistorialReciente([]);
      toast.error(err.message || 'No se pudo consultar tu información.');
    } finally { setLoading(false); }
  }, [clockSlug, punchDay.localDate]);

  useEffect(() => {
    cargarDatosEmpleado();
  }, [cargarDatosEmpleado]);

  // ── 6. Determinar Estado Operativo Actual de la Jornada ────────
  const ultimoMarcaje = checadasHoy[0] || null;
  const hasScheduledBreak = Boolean(
    horarioAsignado?.dias_config?.[punchDay.weekday]?.tiene_descanso ??
    horarioAsignado?.tiene_descanso
  );
  const nextPunch = punchDataReady ? getNextPunch(checadasHoy, hasScheduledBreak) : null;

  const estadoJornada = useMemo(() => {
    if (!ultimoMarcaje) {
      return {
        label: "Jornada no iniciada",
        sub: "Aún no registras tu entrada hoy",
        tone: "neutral",
        nextRecommended: "entrada",
      };
    }

    const tipo = ultimoMarcaje.tipo_verificacion;
    const horaFmt = formatInTenantTimezone(
      ultimoMarcaje.verificado_at,
      tenantTimezone,
      { hour: "2-digit", minute: "2-digit" }
    );

    if (tipo === "entrada" || tipo === "descanso_fin") {
      return {
        label: "En jornada activa",
        sub: `Entrada registrada a las ${horaFmt}`,
        tone: "success",
        nextRecommended: tipo === "entrada" && hasScheduledBreak ? "descanso_inicio" : "salida",
      };
    }

    if (tipo === "descanso_inicio") {
      return {
        label: "En receso / descanso",
        sub: "Recuerda registrar tu regreso al concluir",
        tone: "warning",
        nextRecommended: "descanso_fin",
      };
    }

    if (tipo === "salida") {
      return {
        label: "Jornada concluida",
        sub: `Salida registrada a las ${horaFmt}`,
        tone: "neutral",
        nextRecommended: null,
      };
    }

    return {
      label: "En servicio",
      sub: `Marcaje registrado a las ${horaFmt}`,
      tone: "success",
      nextRecommended: null,
    };
  }, [ultimoMarcaje, tenantTimezone, hasScheduledBreak]);

  // ── 7. Iniciar Marcaje: Activar Cámara y Abrir Modal ────────────
  // "cuando marquen entrada se active la camara y puedan tomar la foto de referencia"
  const handleIniciarMarcaje = (tipoVerificacion) => {
    if (actionLoading || loading || tipoVerificacion !== nextPunch) return;
    if (!empleado || !activeTenantId) {
      toast.error("No hay empleado activo seleccionado.");
      return;
    }

    // Solicitar GPS de inmediato si aún no se tiene
    if (!gpsUbicacion) {
      obtenerUbicacionGPS(false);
    }

    pendingPunch.current = crypto.randomUUID();
    const cfg = PUNCH_CONFIG[tipoVerificacion];
    setModalMarcaje({ tipo: tipoVerificacion, config: cfg });
    setFotoCapturada(null);

    // Encender la cámara únicamente ahora
    startCamera(cameraFacing);
  };

  // Cerrar el modal y apagar la cámara de inmediato sin rastros
  const handleCerrarModalMarcaje = () => {
    stopCamera();
    setModalMarcaje(null);
    setFotoCapturada(null);
  };

  // ── 8. Guardar Marcaje y Apagar Cámara ───────────────────────────
  // "y cuando le den en guardar que ya se apague la camara sin que tenga rastros de que esta activado"
  // "que no acepte checadas sin gps y que tome la hora del servidor segun su zona horaria"
  const handleGuardarMarcaje = async () => {
    if (!modalMarcaje) return;
    const tipoVerificacion = modalMarcaje.tipo;
    if (actionLoading || loading || tipoVerificacion !== nextPunch) return;

    // VALIDACIÓN ESTRICTA DE GPS
    let coords = gpsUbicacion;
    if (!coords || !Number.isFinite(coords.latitud) || !Number.isFinite(coords.longitud)) {
      toast.loading("Obteniendo coordenadas GPS obligatorias...", {
        id: "check-gps",
      });
      coords = await obtenerUbicacionGPS(false);
      toast.dismiss("check-gps");
    }

    if (!coords || !Number.isFinite(coords.latitud) || !Number.isFinite(coords.longitud)) {
      toast.error(
        "📍 Marcaje Rechazado: Es obligatorio activar la ubicación GPS en tu dispositivo.",
        { duration: 5000, icon: "⚠️" }
      );
      return;
    }

    setActionLoading(true);
    const toastId = toast.loading("Guardando marcaje con foto y GPS...");

    try {
      // 1. Obtener snapshot de la cámara (si aún no se tomó manualmente, capturarlo ahora)
      let snapshot = fotoCapturada;
      if (!snapshot && videoRef.current) {
        snapshot = capturarSnapshot();
      }

      const result = await registrarChecada({ direction: tipoVerificacion, clockSlug,
        requestId: pendingPunch.current, evidence: { snapshot: snapshot || null,
          foto_tomada: Boolean(snapshot), ubicacion_gps: coords } });
      if (!result.success) throw new Error(result.error);
      const nuevoRegistro = result.registro;
      const punchServerDate = new Date(nuevoRegistro.verificado_at);
      pendingPunch.current = null;

      // ¡APAGAR LA CÁMARA COMPLETAMENTE SIN DEJAR RASTROS!
      stopCamera();
      setModalMarcaje(null);
      setFotoCapturada(null);

      const horaLocal = formatInTenantTimezone(
        punchServerDate,
        tenantTimezone,
        { hour: "2-digit", minute: "2-digit" }
      );

      toast.success(
        `¡${modalMarcaje.config?.label || "Marcaje"} registrado correctamente a las ${horaLocal}!`,
        { id: toastId, icon: "⏱️" }
      );

      // Actualizar listas locales en vivo
      if (nuevoRegistro) {
        setChecadasHoy((prev) => [nuevoRegistro, ...prev]);
        setHistorialReciente((prev) => [nuevoRegistro, ...prev.slice(0, 19)]);
      }
    } catch (err) {
      console.error("Error al registrar checada:", err);
      toast.error(
        "Error al registrar la checada: " + (err.message || "Intente de nuevo"),
        { id: toastId }
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Cerrar Sesión del Empleado
  const handleCerrarSesion = async () => {
    stopCamera();
    const result = await logoutEmployee();
    if (!result.success) { toast.error(result.error); return; }
    navigate("/employee-portal/login", { replace: true });
  };

  // Formato de hora y fecha del servidor para el Hero Clock
  const horaStr = formatInTenantTimezone(serverTime, tenantTimezone, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const fechaStr = formatInTenantTimezone(serverTime, tenantTimezone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] text-slate-800 dark:text-slate-100 antialiased selection:bg-[#03363D] selection:text-white">
      {/* ─── BARRA SUPERIOR DEL PORTAL ──────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-[#0F172A]/85 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Marca / Identidad */}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#03363D] flex items-center justify-center text-white shadow-sm">
              <Clock className="w-5 h-5 text-[#BDD9D7]" strokeWidth={2.2} />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white block leading-none">
                Signum Clock
              </span>
              <span className="text-[11px] font-semibold text-[#03363D] dark:text-[#BDD9D7] uppercase tracking-wider block mt-0.5">
                Portal del Empleado
              </span>
            </div>
          </div>

          {/* Empresa / Selector de prueba / Sesión */}
          <div className="flex items-center gap-2 sm:gap-4">
            {availableClocks.length > 1 && (
              <select aria-label="Punto de checada" value={clockSlug}
                onChange={e => { setClockPreference(e.target.value); setClockSlug(e.target.value); }}
                className="max-w-40 rounded-lg border p-2 text-xs dark:bg-slate-800">
                <option value="">Selecciona un punto</option>
                {availableClocks.map(clock => <option key={clock.slug} value={clock.slug}>{clock.name}</option>)}
              </select>
            )}

            {employeeSession?.nombreEmpresa && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                {employeeSession?.nombreEmpresa}
              </span>
            )}

            <button
              onClick={handleCerrarSesion}
              title="Cerrar sesión"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50"
            >
              <LogOutIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── CONTENIDO PRINCIPAL ─────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {loading ? (
          <div className="space-y-6">
            <SkeletonCard className="h-44" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <SkeletonCard className="md:col-span-2 h-72" />
              <SkeletonCard className="h-72" />
            </div>
          </div>
        ) : !empleado ? (
          <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-center max-w-lg mx-auto my-12">
            <User className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800 dark:text-white">
              Perfil no vinculado
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              Tu cuenta de usuario no está asociada a un empleado de la
              empresa. Contacta al administrador de Recursos Humanos.
            </p>
            <button
              onClick={handleCerrarSesion}
              className="px-4 py-2 rounded-xl bg-[#03363D] text-white text-xs font-bold"
            >
              Ir al Login de Empleados
            </button>
          </div>
        ) : (
          <>
            {/* ── SECCIÓN 1: Ficha del Empleado & Horario ──────── */}
            <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 transition-all shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
                {/* Info Personal */}
                <div className="flex items-center gap-3.5 sm:gap-4">
                  {empleado.avatar_url ? (
                    <img
                      src={empleado.avatar_url}
                      alt={empleado.nombre}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm flex-shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#03363D] text-[#BDD9D7] flex items-center justify-center font-bold text-lg sm:text-xl shadow-sm flex-shrink-0">
                      {empleado.nombre?.[0]}
                      {empleado.apellido?.[0]}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white truncate">
                        {empleado.nombre} {empleado.apellido}
                      </h1>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Activo
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-y-1 gap-x-2.5 sm:gap-x-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {empleado.puesto && (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                          {empleado.puesto}
                        </span>
                      )}
                      {empleado.departamento && (
                        <span className="hidden sm:inline-flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {empleado.departamento}
                        </span>
                      )}
                      {empleado.clave_empleado && (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                          Clave:{" "}
                          <strong className="text-slate-700 dark:text-slate-300">
                            {empleado.clave_empleado}
                          </strong>
                        </span>
                      )}
                      {empleado.device_userid && (
                        <span className="hidden lg:inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 dark:text-blue-400">
                          <Fingerprint className="w-3.5 h-3.5" /> ID:{" "}
                          {empleado.device_userid}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Badge Horario Asignado */}
                <div className="sm:border-l sm:border-slate-200 dark:sm:border-slate-800 sm:pl-6 flex-shrink-0">
                  <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5 sm:mb-1">
                    Horario de Trabajo
                  </p>
                  {horarioAsignado ? (
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#03363D] dark:text-[#BDD9D7]" />
                        {horarioAsignado.nombre}
                      </p>
                      <p className="text-[11px] sm:text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                        {horarioAsignado.hora_entrada?.slice(0, 5)} -{" "}
                        {horarioAsignado.hora_salida?.slice(0, 5)}
                        {horarioAsignado.tolerancia_minutos > 0 && (
                          <span className="ml-1.5 font-sans font-normal text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400">
                            (Tol: {horarioAsignado.tolerancia_minutos}m)
                          </span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      Sin horario asignado
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* ── SECCIÓN 2: Hero Punch Station (Estación de Fichaje) ─ */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Card Central de Marcaje */}
              <section className="lg:col-span-2 bg-white dark:bg-[#1E293B] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 sm:p-7 flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-[#BDD9D7]/15 dark:bg-[#03363D]/20 rounded-full blur-3xl pointer-events-none" />

                <div>
                  {/* Top Bar de la Estación */}
                  <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                      Estación de Fichaje en Vivo
                    </span>

                    {/* Indicador GPS + Estado de la Jornada */}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {gpsCargando && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20 animate-pulse">
                          <Navigation className="w-3 h-3 animate-spin" />
                          GPS...
                        </span>
                      )}

                      {!gpsCargando && gpsUbicacion && (
                        <a
                          href={`https://www.google.com/maps?q=${gpsUbicacion.latitud},${gpsUbicacion.longitud}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Lat: ${gpsUbicacion.latitud.toFixed(4)}, Lng: ${gpsUbicacion.longitud.toFixed(4)} (±${Math.round(gpsUbicacion.precision_metros || 0)}m)`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                        >
                          <MapPin className="w-3 h-3 text-emerald-500" />
                          GPS Activo (±{gpsUbicacion.precision_metros}m)
                        </a>
                      )}

                      {!gpsCargando && !gpsUbicacion && (
                        <button
                          type="button"
                          onClick={() => obtenerUbicacionGPS(false)}
                          title={
                            gpsError ||
                            "GPS no detectado. Clic para activar."
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer"
                        >
                          <MapPinOff className="w-3 h-3 text-amber-500" />
                          Activar GPS
                        </button>
                      )}

                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                          estadoJornada.tone === "success"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                            : estadoJornada.tone === "warning"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            estadoJornada.tone === "success"
                              ? "bg-emerald-500"
                              : estadoJornada.tone === "warning"
                                ? "bg-amber-500"
                                : "bg-slate-400"
                          }`}
                        />
                        {estadoJornada.label}
                      </span>
                    </div>
                  </div>

                  {/* Reloj Digital Hero (Hora autoritativa del servidor en zona del cliente) */}
                  <div className="text-center py-3 sm:py-6">
                    <div className="font-mono text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                      {horaStr}
                    </div>
                    <p className="text-xs sm:text-base font-medium text-slate-500 dark:text-slate-400 mt-1.5 sm:mt-2 capitalize">
                      {fechaStr}
                    </p>
                    <div className="mt-2.5 flex items-center justify-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#03363D]/10 dark:bg-[#BDD9D7]/15 text-[#03363D] dark:text-[#BDD9D7] border border-[#03363D]/20">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Hora Oficial Servidor ({tenantTimezone})</span>
                      </span>
                    </div>

                    {Math.abs(clockDrift) > 60 && (
                      <div className="mt-2.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-1 inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                          Reloj del celular desfasado ({clockDrift > 0 ? `+${clockDrift}s` : `${clockDrift}s`}). Se aplica la hora oficial del servidor de forma estricta.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Botones de Acción de Fichaje */}
                <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 text-center sm:text-left flex items-center justify-between">
                    <span>Selecciona tu marcaje</span>
                    <span className="text-[10px] text-slate-400 lowercase font-normal">
                      (Activa cámara y toma foto al pulsar)
                    </span>
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                    {Object.entries(PUNCH_CONFIG).map(([key, cfg]) => {
                      const Icon = cfg.icon;
                      const isRecommended =
                        nextPunch === key;

                      return (
                        <button
                          key={key}
                          disabled={actionLoading || loading || !isRecommended}
                          onClick={() => handleIniciarMarcaje(key)}
                          className={`flex flex-col items-center justify-center p-3 sm:p-3.5 rounded-xl border transition-all duration-200 text-center group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                            isRecommended
                              ? `${cfg.btnCls} border-transparent ring-2 ring-offset-2 ring-[#03363D] dark:ring-offset-slate-900`
                              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-750"
                          }`}
                        >
                          <div
                            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center mb-1.5 sm:mb-2 transition-transform group-hover:scale-110 ${
                              isRecommended
                                ? "bg-white/20 text-white"
                                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            <Icon className="w-5 h-5" strokeWidth={2.2} />
                          </div>
                          <span className="text-xs font-bold leading-tight block">
                            {cfg.label}
                          </span>
                          <span
                            className={`text-[10px] mt-0.5 hidden sm:block ${
                              isRecommended ? "text-white/80" : "text-slate-400"
                            }`}
                          >
                            {cfg.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Bitácora de Hoy */}
              <section className="bg-white dark:bg-[#1E293B] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6 flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#03363D] dark:text-[#BDD9D7]" />
                      Marcajes de Hoy
                    </h3>
                    <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                      {checadasHoy.length}
                    </span>
                  </div>

                  {checadasHoy.length === 0 ? (
                    <div className="py-8 sm:py-12 text-center text-slate-400">
                      <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-xs font-medium">No hay marcajes registrados hoy.</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Tus entradas y descansos aparecerán aquí.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {checadasHoy.map((chk) => {
                        const cfg = PUNCH_CONFIG[chk.tipo_verificacion] || {
                          label: chk.tipo_verificacion,
                          badgeCls: "bg-slate-100 text-slate-700",
                          dotCls: "bg-slate-400",
                        };
                        const Icon = cfg.icon || Clock;
                        const horaLocal = formatInTenantTimezone(
                          chk.verificado_at,
                          tenantTimezone,
                          { hour: "2-digit", minute: "2-digit" }
                        );
                        const hasSnapshot = Boolean(
                          chk.raw_payload?.snapshot || chk.raw_payload?.foto_tomada
                        );

                        return (
                          <div
                            key={chk.id}
                            className="flex items-center justify-between p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                          >
                            <div className="flex items-center gap-2.5 sm:gap-3">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.badgeCls}`}
                              >
                                <Icon className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                  {cfg.label}
                                </p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                  <span>{chk.metodo || "Web"}</span>
                                  {chk.raw_payload?.ubicacion_gps && (
                                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                                      <MapPin className="w-2.5 h-2.5" /> GPS
                                    </span>
                                  )}
                                  {hasSnapshot && (
                                    <span className="text-sky-600 dark:text-sky-400 flex items-center gap-0.5">
                                      <Camera className="w-2.5 h-2.5" /> Foto
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                              {horaLocal}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 mt-4 text-center">
                  <span className="text-[10px] sm:text-[11px] text-slate-400">
                    Registro avalado con sello horario digital
                  </span>
                </div>
              </section>
            </div>

            {/* ── SECCIÓN 3: Historial Reciente (Últimos 7 días) ──── */}
            {/* OMITIDO en móvil (<md); VISIBLE en tablet (md) y FULL VISIBLE en PC/Laptop (lg) */}
            <section className="hidden md:block bg-white dark:bg-[#1E293B] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#03363D] dark:text-[#BDD9D7]" />
                    Historial Reciente de Fichajes
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Registro de eventos de los últimos 7 días con verificación de GPS y sello horario
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                  Últimos 7 días
                </span>
              </div>

              {historialReciente.length === 0 ? (
                <div className="py-10 text-center text-slate-400">
                  <p className="text-xs">
                    No hay actividad previa registrada en este periodo.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <th className="py-2.5 px-3">Fecha</th>
                        <th className="py-2.5 px-3">Hora Servidor</th>
                        <th className="py-2.5 px-3">Evento</th>
                        <th className="hidden lg:table-cell py-2.5 px-3">Método</th>
                        <th className="py-2.5 px-3">Ubicación GPS</th>
                        <th className="py-2.5 px-3 text-right">Estatus</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                      {historialReciente.map((log) => {
                        const cfg = PUNCH_CONFIG[log.tipo_verificacion] || {
                          label: log.tipo_verificacion,
                          badgeCls: "bg-slate-100 text-slate-700",
                          dotCls: "bg-slate-400",
                        };
                        const fechaStr = formatInTenantTimezone(
                          log.verificado_at,
                          tenantTimezone,
                          { weekday: "short", day: "2-digit", month: "short" }
                        );
                        const horaStr = formatInTenantTimezone(
                          log.verificado_at,
                          tenantTimezone,
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          }
                        );
                        const hasSnapshot = Boolean(
                          log.raw_payload?.snapshot || log.raw_payload?.foto_tomada
                        );

                        return (
                          <tr
                            key={log.id}
                            className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-200 capitalize whitespace-nowrap">
                              {fechaStr}
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                              {horaStr}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold text-[11px] border ${cfg.badgeCls}`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${cfg.dotCls}`}
                                />
                                {cfg.label}
                              </span>
                            </td>
                            <td className="hidden lg:table-cell py-3 px-3 text-slate-500 capitalize">
                              <span>{log.metodo || "Web"}</span>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                {log.raw_payload?.ubicacion_gps ? (
                                  <a
                                    href={
                                      log.raw_payload.ubicacion_gps.mapa_url ||
                                      `https://www.google.com/maps?q=${log.raw_payload.ubicacion_gps.latitud},${log.raw_payload.ubicacion_gps.longitud}`
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`GPS: ${Number(
                                      log.raw_payload.ubicacion_gps.latitud
                                    ).toFixed(4)}, ${Number(
                                      log.raw_payload.ubicacion_gps.longitud
                                    ).toFixed(4)} (±${Math.round(
                                      log.raw_payload.ubicacion_gps
                                        .precision_metros || 0
                                    )}m)`}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                                  >
                                    <MapPin className="w-3 h-3" />
                                    <span>Mapa GPS</span>
                                  </a>
                                ) : (
                                  <span className="text-slate-400 text-[11px]">—</span>
                                )}

                                {hasSnapshot && (
                                  <span
                                    title="Foto de referencia capturada"
                                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded"
                                  >
                                    <Camera className="w-2.5 h-2.5" /> Foto
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />{" "}
                                Verificado
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* ─── MODAL DE FICHAJE CON CÁMARA Y FOTO DE REFERENCIA ─────────── */}
      {/* Se activa únicamente al marcar; al darle Guardar se apaga la cámara sin rastros */}
      {modalMarcaje && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4">
            {/* Encabezado del Modal */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    modalMarcaje.config?.badgeCls || "bg-slate-100"
                  }`}
                >
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {modalMarcaje.config?.actionText || "Registrar Fichaje"}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Tomar foto
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCerrarModalMarcaje}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title="Cancelar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Visor de Cámara en Vivo / Snapshot */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800 shadow-inner">
              {fotoCapturada ? (
                <div className="relative w-full h-full">
                  <img
                    src={fotoCapturada}
                    alt="Snapshot de referencia"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-3 left-3 px-2 py-0.5 rounded-lg bg-emerald-600/90 text-white text-[11px] font-bold flex items-center gap-1 shadow-md">
                    <Check className="w-3 h-3" />
                    Foto de referencia lista
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFotoCapturada(null);
                      startCamera(cameraFacing);
                    }}
                    className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-semibold transition-colors shadow-md flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Repetir foto
                  </button>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className={`w-full h-full object-cover ${
                      cameraFacing === "user" ? "scale-x-[-1]" : ""
                    }`}
                    playsInline
                    muted
                  />

                  {/* Guía facial */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-36 h-48 rounded-full border-2 border-dashed border-[#5dd0c7]/40 shadow-sm" />
                  </div>

                  {cameraLoading && (
                    <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center gap-2 text-white">
                      <div className="w-7 h-7 border-2 border-[#5dd0c7] border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-semibold">
                        Activando cámara...
                      </span>
                    </div>
                  )}

                  {cameraError && (
                    <div className="absolute inset-0 bg-slate-950/90 p-4 flex flex-col items-center justify-center text-center gap-2 text-slate-300">
                      <CameraOff className="w-7 h-7 text-rose-400" />
                      <p className="text-xs">{cameraError}</p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold mt-1"
                      >
                        📷 Tomar foto con celular
                      </button>
                    </div>
                  )}

                  {/* Botón flotante para alternar cámara frontal / trasera */}
                  {cameraActive && (
                    <button
                      type="button"
                      onClick={toggleCameraFacing}
                      className="absolute bottom-3 right-3 p-2 rounded-xl bg-black/50 hover:bg-black/70 text-white text-xs transition-colors backdrop-blur-sm shadow-md"
                      title="Girar cámara"
                    >
                      <FlipHorizontal className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}

              <canvas ref={canvasRef} className="hidden" />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                onChange={handleFileCapture}
                className="hidden"
              />
            </div>

            {/* Estado del GPS dentro del Modal */}
            <div
              className={`p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border ${
                gpsUbicacion
                  ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/25 text-rose-800 dark:text-rose-300"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {gpsUbicacion ? (
                  <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 flex-shrink-0" />
                )}
                <span className="truncate">
                  {gpsUbicacion
                    ? `GPS Confirmado (±${gpsUbicacion.precision_metros}m)`
                    : "Ubicación GPS obligatoria para checar"}
                </span>
              </div>

              {!gpsUbicacion && (
                <button
                  type="button"
                  onClick={() => obtenerUbicacionGPS(false)}
                  className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px] flex-shrink-0 cursor-pointer"
                >
                  Activar GPS
                </button>
              )}
            </div>

            {/* Botón para Tomar Foto Manual (Opcional, si no, se toma al guardar) */}
            {!fotoCapturada && cameraActive && (
              <button
                type="button"
                onClick={capturarSnapshot}
                className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4 text-[#3fa9a1]" />
                <span>Tomar foto</span>
              </button>
            )}

            {/* Botón Principal: GUARDAR Y APAGAR CÁMARA */}
            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCerrarModalMarcaje}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleGuardarMarcaje}
                disabled={actionLoading || !gpsUbicacion}
                className={`flex-2 py-3 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  modalMarcaje.config?.btnCls || "bg-[#03363D] text-white"
                } ${
                  !gpsUbicacion || actionLoading
                    ? "opacity-50 cursor-not-allowed"
                    : "active:scale-[0.98]"
                }`}
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Guardar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
