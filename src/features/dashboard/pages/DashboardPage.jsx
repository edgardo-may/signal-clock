// src/features/dashboard/pages/DashboardPage.jsx — Signum-Clock Dashboard con Paleta Oficial
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import Sidebar from "../../../shared/components/Layout/Sidebar";
import Header from "../../../shared/components/Layout/Header";
import toast from "react-hot-toast";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleX,
  CalendarDays,
  Clock3,
  Cpu,
  Globe,
  Hash,
  ListTodo,
  MonitorCog,
  RotateCw,
  Shuffle,
  Users,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  ActivityIcon,
  TrendingUpIcon,
  MapPinIcon,
  FingerprintIcon,
  ScanFaceIcon,
  CreditCardIcon,
} from "../../../shared/components/icons/lucide-animated";
import { useCurrentTenant } from "../../../shared/hooks/useCurrentTenant";
import { useAuth } from "../../auth/hooks/useAuth";
import { Skeleton } from "../../../shared/components/ui";
import {
  getLocalComponents,
  getTenantDayContext,
  loadDashboardOperations,
} from "../services/dashboardOperationsService";

// ─── Configuración de Badges Semánticos ─────────────────────────
const TIPO_BADGE = {
  entrada: {
    label: "Entrada",
    cls: "bg-[#e7f8f5] text-[#3fa9a1] border-[#bfe5e1]",
    dot: "bg-[#5dd0c7]",
  },
  salida: {
    label: "Salida",
    cls: "bg-rose-500/10    text-rose-600    dark:text-rose-400    border-rose-500/20",
    dot: "bg-rose-500",
  },
  descanso_inicio: {
    label: "Descanso ↓",
    cls: "bg-amber-500/10   text-amber-600   dark:text-amber-400   border-amber-500/20",
    dot: "bg-amber-500",
  },
  descanso_fin: {
    label: "Descanso ↑",
    cls: "bg-sky-500/10     text-sky-600     dark:text-sky-400     border-sky-500/20",
    dot: "bg-sky-500",
  },
  inicio_extra: {
    label: "Extra ↓",
    cls: "bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20",
    dot: "bg-violet-500",
  },
  fin_extra: {
    label: "Extra ↑",
    cls: "bg-purple-500/10  text-purple-600  dark:text-purple-400  border-purple-500/20",
    dot: "bg-purple-500",
  },
  extra: {
    label: "Extra",
    cls: "bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20",
    dot: "bg-violet-500",
  },
};

const METODO_CONFIG = {
  rostro: {
    icon: ScanFaceIcon,
    label: "Rostro",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  huella: {
    icon: FingerprintIcon,
    label: "Huella",
    cls: "bg-[#f2fbf9]    text-[#3fa9a1]    border-[#d5efec]",
  },
  tarjeta: {
    icon: CreditCardIcon,
    label: "Tarjeta",
    cls: "bg-amber-500/10   text-amber-600   dark:text-amber-400   border-amber-500/20",
  },
  pin: {
    icon: Hash,
    label: "PIN",
    cls: "bg-slate-100      text-slate-700   dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  },
  combinado: {
    icon: Shuffle,
    label: "Combinado",
    cls: "bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20",
  },
  web: {
    icon: Globe,
    label: "Web",
    cls: "bg-sky-500/10     text-sky-600     dark:text-sky-400     border-sky-500/20",
  },
};

// ─── Formateador de Hora ───────────────────────────────────────
function formatTime(ts, timezone) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(ts));
}

// ─── Custom Toast de Marcaje en Vivo ───────────────────────────
function fireMarkingToast(data) {
  const nombre = data.empleados
    ? `${data.empleados.nombre} ${data.empleados.apellido}`
    : "Empleado";
  const metodo = data.metodo ?? "desconocido";
  const normalized = typeof metodo === "string" ? metodo.toLowerCase() : metodo;
  const tipo = data.tipo_verificacion ?? "entrada";
  const metCfg =
    METODO_CONFIG[normalized] ??
    (normalized === "web"
      ? {
          icon: Globe,
          label: "Web",
          cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
        }
      : null);
  const MetIcon = metCfg?.icon ?? ActivityIcon;
  const tipoCfg = TIPO_BADGE[tipo];

  toast.custom(
    (t) => (
      <div
        className={`flex items-start gap-3 px-4 py-3.5 rounded-xl pointer-events-auto bg-[#0f172a] text-white border border-slate-700 shadow-2xl transition-all duration-300 ${
          t.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
        }`}
        style={{ minWidth: "300px", maxWidth: "380px" }}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-600/20 border border-blue-500/30 text-blue-400">
          <MetIcon className="w-5 h-5" strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
            ¡Marcaje Biométrico!
          </p>
          <p className="text-sm font-semibold text-white truncate">{nombre}</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${tipoCfg?.cls ?? "bg-slate-700 text-slate-300"}`}
            >
              <span
                className={`w-1 h-1 rounded-full ${tipoCfg?.dot ?? "bg-slate-400"}`}
              />
              {tipoCfg?.label ?? tipo}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${metCfg?.cls ?? "bg-slate-700 text-slate-300"}`}
            >
              {metCfg?.label ?? metodo}
            </span>
          </div>
        </div>

        <button
          onClick={() => toast.dismiss(t.id)}
          className="text-slate-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    ),
    { duration: 5000, position: "top-right" },
  );
}

// ─── Stat Card ────────────────────────────────────────────────
function StatusPill({ label, tone = "neutral" }) {
  const config = {
    success: {
      Icon: CircleCheck,
      className: "bg-[#e7f8f5] text-[#3fa9a1] border-[#bfe5e1]",
    },
    warning: {
      Icon: CircleAlert,
      className:
        "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    },
    error: {
      Icon: CircleX,
      className:
        "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
    },
    pending: {
      Icon: Clock3,
      className: "bg-[#fff5e2] text-[#b27a21] border-[#f6dfb4]",
    },
    neutral: {
      Icon: Clock3,
      className:
        "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
    },
  };
  const { Icon, className } = config[tone] ?? config.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${className}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}


// value=null significa métrica no disponible; mostrar '—' nunca '0' forzado.
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconBg,
  iconColor,
  status,
  statusTone,
  priority = "secondary",
  loading = false,
  unavailable = false,
  className = "",
}) {
  const isPrimary = priority === "primary";
  const displayValue = loading
    ? null
    : unavailable || value === null
      ? "—"
      : value;

  return (
    <div
      className={`rounded-xl border bg-white p-4 transition-colors duration-200 hover:border-[#cfecea] ${
        isPrimary ? "border-[#bfe5e1] sm:p-5" : "border-[#eef1f1] sm:p-5"
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707485] dark:text-slate-400">
            {label}
          </p>
          {status && (
            <div className="mt-2">
              <StatusPill label={status} tone={statusTone} />
            </div>
          )}
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
        >
          <Icon size={19} className={iconColor} strokeWidth={1.9} />
        </div>
      </div>

      <div className={isPrimary ? "mt-5" : "mt-4"}>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <h4
            className={`${isPrimary ? "text-3xl sm:text-[2rem]" : "text-2xl sm:text-3xl"} font-bold font-mono tracking-tight tabular-nums ${displayValue === "—" ? "text-[#a1a5ae]" : "text-[#272c3d] dark:text-white"}`}
          >
            {displayValue ?? "—"}
          </h4>
        )}
      </div>

      {sub && (
        <p className="mt-2 text-xs leading-5 text-[#a1a5ae] dark:text-slate-400">
          {loading ? <Skeleton className="h-3 w-24 mt-1" /> : sub}
        </p>
      )}
    </div>
  );
}

// ─── SVG Analytics Chart ──────────────────────────────────────
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function AnalyticsChart({ marcajes, day, loading, unavailable }) {
  const weekData = useMemo(() => {
    const counts = new Array(7).fill(0);
    marcajes.forEach((m) => {
      const localDate = getLocalComponents(
        m.verificado_at,
        day.timezone,
      ).localDate;
      const diff = Math.floor(
        (new Date(`${localDate}T12:00:00.000Z`) -
          new Date(`${day.weekStartLocalDate}T12:00:00.000Z`)) /
          86400000,
      );
      if (diff >= 0 && diff < 7) counts[diff]++;
    });
    return counts;
  }, [marcajes, day.timezone, day.weekStartLocalDate]);

  const total = weekData.reduce((a, b) => a + b, 0);
  const max = Math.max(...weekData, 1);
  const W = 500,
    H = 140;
  const padL = 0,
    padR = 0,
    padT = 12,
    padB = 0;
  const chartW = W - padL - padR;
  const barW = Math.floor(chartW / 7);
  const gap = 10;
  const todayIdx = day.dayIndex;

  return (
    <div className="rounded-xl border border-[#eef1f1] bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#1e293b]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TrendingUpIcon size={16} className="text-[#5dd0c7]" />
            Actividad de asistencia
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Checadas registradas durante los últimos 7 días
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-[#a1a5ae] sm:inline">
            Últimos 7 días
          </span>
          {loading ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <span className="font-mono text-xs font-semibold tabular-nums text-[#707485] dark:text-slate-300">
              {unavailable ? "— eventos" : `${total} eventos`}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-28 w-full" />
        </div>
      ) : unavailable ? (
        <div className="flex flex-col items-center justify-center h-36 gap-2 text-slate-400">
          <CircleAlert className="h-8 w-8 opacity-30" />
          <p className="text-xs">Gráfica no disponible</p>
        </div>
      ) : (
        <div className="w-full overflow-x-auto mt-2">
          <div className="min-w-[400px]">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-36"
              style={{ overflow: "visible" }}
            >
              {[0.25, 0.5, 0.75, 1].map((pct, i) => {
                const y = padT + (H - padT - padB) * (1 - pct);
                return (
                  <line
                    key={i}
                    x1={padL}
                    y1={y}
                    x2={W - padR}
                    y2={y}
                    stroke="currentColor"
                    className="text-[#eef1f1] dark:text-slate-800"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                );
              })}

              {weekData.map((count, i) => {
                const usableH = H - padT - padB - 24;
                const barH =
                  count === 0
                    ? 3
                    : Math.max(6, Math.round((count / max) * usableH));
                const x = padL + i * barW + gap / 2;
                const y = padT + usableH - barH;
                const width = barW - gap;
                const isToday = i === todayIdx;

                return (
                  <g key={i}>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={barH}
                      rx="5"
                      fill={isToday ? "#4ac2b8" : "rgba(93, 208, 199, 0.42)"}
                      className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                    />
                    {count > 0 && (
                      <text
                        x={x + width / 2}
                        y={y - 4}
                        textAnchor="middle"
                        fill={isToday ? "#48BFB5" : "#707485"}
                        fontSize="9"
                        fontWeight="700"
                      >
                        {count}
                      </text>
                    )}
                    <text
                      x={x + width / 2}
                      y={H - 4}
                      textAnchor="middle"
                      fill={isToday ? "#48BFB5" : "#A1A5AE"}
                      fontSize="11"
                      fontWeight={isToday ? "700" : "500"}
                    >
                      {DAYS[i]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-[#a1a5ae] dark:text-slate-400">
        El día actual se resalta discretamente para facilitar la lectura.
      </p>
    </div>
  );
}

function MethodBadge({ metodo }) {
  const normalized = typeof metodo === "string" ? metodo.toLowerCase() : metodo;
  const cfg = METODO_CONFIG[normalized] ?? {
    icon: normalized === "web" ? Globe : ActivityIcon,
    label: metodo ?? "—",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  };
  const Icon = cfg.icon;
  const isAnimated =
    cfg.icon === ScanFaceIcon ||
    cfg.icon === FingerprintIcon ||
    cfg.icon === CreditCardIcon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border ${cfg.cls}`}
    >
      {isAnimated ? (
        <Icon size={12} className="flex-shrink-0" />
      ) : (
        <Icon className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
      )}
      <span>{cfg.label}</span>
    </span>
  );
}

// ─── Realtime Table con Paginación ────────────────────────────
const PER_PAGE = 5;

function RealtimeTable({ marcajes, newFlash, loading, unavailable, timezone }) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [marcajes.length]);

  const total = marcajes.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = marcajes.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="overflow-hidden rounded-xl border border-[#eef1f1] bg-white dark:border-slate-800 dark:bg-[#1e293b]">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-[#272c3d] dark:text-white">
            <Activity size={16} className="text-[#5dd0c7]" strokeWidth={2} />
            Últimas checadas
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Recepción instantánea de eventos con notificación visual
          </p>
        </div>

        <span className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-full border border-[#bfe5e1] bg-[#e7f8f5] px-2.5 py-1 text-xs font-semibold text-[#3fa9a1]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#5dd0c7]"></span>
          {loading ? "…" : unavailable ? "—" : `${total} eventos`}
        </span>
      </div>

      {/* Table Content */}
      <div className="hidden overflow-x-auto md:block">
        {loading ? (
          <div className="p-6 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : unavailable ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-rose-600 dark:text-rose-400">
            <CircleX size={40} className="opacity-70" strokeWidth={1.5} />
            <p className="text-sm font-medium">
              No se pudieron cargar los marcajes.
            </p>
          </div>
        ) : marcajes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <Activity size={40} className="opacity-30" strokeWidth={1.5} />
            <p className="text-sm font-medium">
              Esperando marcajes en tiempo real...
            </p>
          </div>
        ) : (
          <table className="w-full table-auto">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                {[
                  "Empleado",
                  "Tipo de Marcaje",
                  "Método Biométrico",
                  "Ubicación / Terminal",
                  "Fecha y Hora",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((m) => {
                const badge = TIPO_BADGE[m.tipo_verificacion] ?? {
                  label: m.tipo_verificacion,
                  cls: "bg-slate-100 text-slate-600 border-slate-200",
                  dot: "bg-slate-400",
                };
                const isNew = m.id === newFlash;
                const nombre = m.empleados
                  ? `${m.empleados.nombre} ${m.empleados.apellido}`
                  : "Desconocido";
                const avatar = m.empleados?.avatar_url;
                const initials = m.empleados
                  ? `${m.empleados.nombre[0]}${m.empleados.apellido[0]}`
                  : "?";
                const ubicacion =
                  m.devices?.location || m.devices?.name || null;
                const gps = m.raw_payload?.ubicacion_gps;

                return (
                  <tr
                    key={m.id}
                    className={`transition-colors duration-200 ${
                      isNew
                        ? "bg-[#f2fbf9]"
                        : "hover:bg-[#f8f9f9] dark:hover:bg-slate-800/40"
                    }`}
                  >
                    {/* Empleado */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={nombre}
                            className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-[#e7f8f5] text-[#3fa9a1]">
                            {initials}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            {nombre}
                            {isNew && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#e7f8f5] text-[#3fa9a1] animate-pulse">
                                NUEVO
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border ${badge.cls}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${badge.dot}`}
                        />
                        {badge.label}
                      </span>
                    </td>

                    {/* Método */}
                    <td className="px-5 py-3 whitespace-nowrap">
                      <MethodBadge metodo={m.metodo} />
                    </td>

                    {/* Ubicación / Dispositivo / GPS */}
                    <td className="px-5 py-3 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {ubicacion ? (
                        <span className="flex items-center gap-1.5">
                          <MapPinIcon
                            size={16}
                            className="text-[#5dd0c7] flex-shrink-0"
                          />
                          {ubicacion}
                        </span>
                      ) : gps?.latitud != null && gps?.longitud != null ? (
                        <a
                          href={gps.mapa_url || `https://www.google.com/maps?q=${gps.latitud},${gps.longitud}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline font-medium"
                          title={`Precisión: ±${gps.precision_metros || 0}m`}
                        >
                          <MapPinIcon size={14} className="text-blue-500 flex-shrink-0" />
                          <span>GPS ({Number(gps.latitud).toFixed(4)}, {Number(gps.longitud).toFixed(4)})</span>
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="px-5 py-3 text-xs font-mono font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatTime(m.verificado_at, timezone)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile cards */}
      {loading && (
        <div className="flex flex-col gap-3 p-4 md:hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading &&
        marcajes.length === 0 &&
        (unavailable ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-rose-600 dark:text-rose-400 md:hidden">
            <CircleX size={36} className="opacity-70" strokeWidth={1.5} />
            <p className="text-sm font-medium">
              No se pudieron cargar los marcajes.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400 md:hidden">
            <Activity size={36} className="opacity-30" strokeWidth={1.5} />
            <p className="text-sm font-medium">
              Esperando marcajes en tiempo real...
            </p>
          </div>
        ))}

      {!loading && marcajes.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
          {rows.map((m) => {
            const badge = TIPO_BADGE[m.tipo_verificacion] ?? {
              label: m.tipo_verificacion,
              cls: "bg-slate-100 text-slate-600 border-slate-200",
              dot: "bg-slate-400",
            };
            const isNew = m.id === newFlash;
            const nombre = m.empleados
              ? `${m.empleados.nombre} ${m.empleados.apellido}`
              : "Desconocido";
            const avatar = m.empleados?.avatar_url;
            const initials = m.empleados
              ? `${m.empleados.nombre[0]}${m.empleados.apellido[0]}`
              : "?";
            const ubicacion =
              m.devices?.location || m.devices?.name || null;
            const gps = m.raw_payload?.ubicacion_gps;

            return (
              <article
                key={m.id}
                className={`px-4 py-3.5 ${isNew ? "bg-[#f2fbf9]" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={nombre}
                        className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e7f8f5] text-xs font-bold text-[#3fa9a1]">
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {nombre}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                        {ubicacion ? (
                          ubicacion
                        ) : gps?.latitud != null && gps?.longitud != null ? (
                          <a
                            href={gps.mapa_url || `https://www.google.com/maps?q=${gps.latitud},${gps.longitud}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                            title={`Precisión: ±${gps.precision_metros || 0}m`}
                          >
                            <MapPinIcon size={12} className="text-blue-500 flex-shrink-0" />
                            <span>GPS ({Number(gps.latitud).toFixed(4)}, {Number(gps.longitud).toFixed(4)})</span>
                          </a>
                        ) : (
                          "Terminal no disponible"
                        )}
                      </p>
                    </div>
                  </div>
                  <time className="shrink-0 font-mono text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                    {formatTime(m.verificado_at, timezone)}
                  </time>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${badge.cls}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>
                  <MethodBadge metodo={m.metodo} />
                  {isNew && (
                    <span className="text-[11px] font-semibold text-[#3fa9a1]">
                      Nuevo
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Paginación */}
      {!loading && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mostrando{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {total === 0 ? 0 : (page - 1) * PER_PAGE + 1}–
              {Math.min(page * PER_PAGE, total)}
            </span>{" "}
            de{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {total}
            </span>{" "}
            registros
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1).map(
              (p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                    p === page
                      ? "bg-[#5dd0c7] text-white shadow-md"
                      : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {p}
                </button>
              ),
            )}

            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel de Atención ────────────────────────────────────────
function AttentionPanel({ stats, loading, widgetErrors }) {
  const devHealth = stats.deviceHealth;

  const attention = [
    stats.pendingIncidents > 0 && {
      icon: ListTodo,
      value: stats.pendingIncidents,
      label:
        stats.pendingIncidents === 1
          ? "incidencia pendiente"
          : "incidencias pendientes",
      tone: "warning",
    },
    devHealth.offline > 0 && {
      icon: WifiOff,
      value: devHealth.offline,
      label:
        devHealth.offline === 1
          ? "terminal sin conexión"
          : "terminales sin conexión",
      tone: "error",
    },
    devHealth.pendingConnection > 0 && {
      icon: Clock3,
      value: devHealth.pendingConnection,
      label:
        devHealth.pendingConnection === 1
          ? "terminal sin actividad"
          : "terminales sin actividad",
      tone: "pending",
    },
    devHealth.syncErrors > 0 && {
      icon: CircleX,
      value: devHealth.syncErrors,
      label:
        devHealth.syncErrors === 1
          ? "sincronización con error"
          : "sincronizaciones con error",
      tone: "error",
    },
    devHealth.pendingSync > 0 && {
      icon: RotateCw,
      value: devHealth.pendingSync,
      label:
        devHealth.pendingSync === 1
          ? "sincronización pendiente"
          : "sincronizaciones pendientes",
      tone: "pending",
    },
  ].filter(Boolean);

  const hasErrors = widgetErrors.incidents || widgetErrors.devices;

  return (
    <section className="rounded-xl border border-[#eef1f1] bg-white p-4 dark:border-slate-800 dark:bg-[#1e293b] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <CircleAlert
              className="h-4 w-4 text-amber-500"
              aria-hidden="true"
            />
            Requiere atención
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Solo situaciones operativas que necesitan revisión.
          </p>
        </div>
        {!loading && (
          <StatusPill
            label={
              attention.length
                ? `${attention.length} pendiente${attention.length === 1 ? "" : "s"}`
                : "Sin pendientes"
            }
            tone={attention.length ? "warning" : "success"}
          />
        )}
      </div>

      {loading ? (
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-2/3 rounded-lg" />
        </div>
      ) : hasErrors ? (
        <div className="mt-4 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-3 text-sm text-amber-700 dark:text-amber-400">
          Algunas alertas operativas no están disponibles en este momento.
        </div>
      ) : attention.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {attention.map(({ icon: Icon, value, label, tone }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/30"
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${tone === "error" ? "text-rose-500" : tone === "warning" ? "text-amber-500" : "text-blue-500"}`}
                aria-hidden="true"
              />
              <span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {value}
              </span>
              <span className="min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">
                {label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          Sin incidencias pendientes, terminales offline ni sincronizaciones por
          revisar.
        </div>
      )}
    </section>
  );
}

// ─── Estado de Jornada ────────────────────────────────────────
function TodayStatus({ stats, loading, widgetErrors }) {
  const scheduledUnavailable = stats.scheduled === null;

  return (
    <section className="rounded-xl border border-[#eef1f1] bg-white p-4 dark:border-slate-800 dark:bg-[#1e293b] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <CalendarDays
              className="h-4 w-4 text-blue-600 dark:text-blue-400"
              aria-hidden="true"
            />
            Estado de la jornada
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Resumen basado en horarios asignados y fuentes verificadas.
          </p>
        </div>
        <StatusPill label="Cobertura parcial" tone="pending" />
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900/30">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Programados
              </dt>
              <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                {scheduledUnavailable ? "—" : stats.scheduled}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900/30">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Presentes ahora
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                No disponible
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900/30">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Faltantes
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                No disponible
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900/30">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Retardos
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                No disponible
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Presentes, faltantes y retardos se habilitarán cuando los registros
            de jornada del Attendance Engine tengan cobertura comprobada para el
            día.
          </p>
          {stats.scheduledAmbiguities > 0 && (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              {stats.scheduledAmbiguities} colaborador
              {stats.scheduledAmbiguities === 1 ? "" : "es"} con horario ambiguo
              no se incluy{stats.scheduledAmbiguities === 1 ? "ó" : "eron"} en
              Programados.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function formatLastActivity(timestamp) {
  if (!timestamp) return "Sin actividad registrada";
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000),
  );
  if (elapsedMinutes < 1) return "Actividad hace menos de un minuto";
  if (elapsedMinutes < 60) return `Actividad hace ${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  return `Actividad hace ${hours} h`;
}

// ─── Estado de terminales (detalle) ──────────────────────────
// UNA sola sección de terminales — sin duplicar KPI superior.
function DeviceHealth({ deviceHealth, loading, unavailable }) {
  const statusConfig = {
    online: { label: "Online", tone: "success", Icon: Wifi },
    offline: { label: "Offline", tone: "error", Icon: WifiOff },
    pending: { label: "Sin actividad", tone: "pending", Icon: Clock3 },
    disabled: { label: "Deshabilitado", tone: "neutral", Icon: MonitorCog },
  };

  const devices = deviceHealth.devices;

  return (
    <section className="rounded-xl border border-[#eef1f1] bg-white dark:border-slate-800 dark:bg-[#1e293b]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <Cpu
              className="h-4 w-4 text-blue-600 dark:text-blue-400"
              aria-hidden="true"
            />
            Estado de terminales
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Conectividad según la última actividad ADMS.
          </p>
        </div>
        {!loading && !unavailable && devices.length > 0 && (
          <span className="text-xs font-mono font-semibold text-[#707485] tabular-nums">
            {deviceHealth.online}/{deviceHealth.active} online
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-4 flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 flex flex-col gap-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
          ))}
        </div>
      ) : unavailable ? (
        <div className="p-5 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <CircleAlert className="h-4 w-4 text-amber-500 flex-shrink-0" />
          Estado de terminales no disponible.
        </div>
      ) : devices.length === 0 ? (
        <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
          No hay terminales registradas para esta empresa.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {devices.map((device) => {
            const status = statusConfig[device.operationalStatus];
            const StatusIcon = status.Icon;
            const name =
              device.name || device.serial_number || "Terminal sin nombre";
            const location = device.location || "Sin ubicación configurada";
            return (
              <li
                key={device.id}
                className="flex items-center gap-3 px-4 py-3.5 sm:px-5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <MonitorCog className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {location} · {formatLastActivity(device.last_activity)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusPill label={status.label} tone={status.tone} />
                  {(device.sync.error > 0 || device.sync.pending > 0) && (
                    <span
                      className={`flex items-center gap-1 text-[11px] font-semibold ${device.sync.error > 0 ? "text-rose-600 dark:text-rose-400" : "text-blue-600 dark:text-blue-400"}`}
                    >
                      <StatusIcon className="h-3 w-3" aria-hidden="true" />
                      {device.sync.error > 0
                        ? `${device.sync.error} con error`
                        : `${device.sync.pending} pendiente${device.sync.pending === 1 ? "" : "s"}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: DASHBOARD
// ═══════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user, profile } = useAuth();
  const userName =
    profile?.nombre?.trim() ||
    user?.user_metadata?.nombre?.trim() ||
    user?.email?.split("@")[0] ||
    "";
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  const { currentTenantId, loadingTenants, requiresTenantAssignment } =
    useCurrentTenant();
  const requestRef = useRef(0);
  const recentMarkIdsRef = useRef(new Set());

  const EMPTY_DEVICE_HEALTH = {
    devices: [],
    active: 0,
    online: 0,
    offline: 0,
    pendingConnection: 0,
    disabled: 0,
    pendingSync: 0,
    syncErrors: 0,
  };

  const [stats, setStats] = useState({
    activeEmployees: null,
    inactiveEmployees: null,
    scheduled: null,
    scheduledAmbiguities: 0,
    pendingIncidents: null,
    todayMarks: null,
    deviceHealth: EMPTY_DEVICE_HEALTH,
  });
  const [widgetErrors, setWidgetErrors] = useState({
    employees: null,
    schedules: null,
    devices: null,
    incidents: null,
    todayMarks: null,
    recentMarks: null,
    weeklyMarks: null,
  });
  const [day, setDay] = useState(() =>
    getTenantDayContext("America/Mexico_City"),
  );
  const [marcajes, setMarcajes] = useState([]);
  const [weeklyMarks, setWeeklyMarks] = useState([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [newFlash, setNewFlash] = useState(null);

  // ── Cargar datos iniciales ────────────────────────────────────
  const loadData = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoadingInit(true);
    setWidgetErrors({
      employees: null,
      schedules: null,
      devices: null,
      incidents: null,
      todayMarks: null,
      recentMarks: null,
      weeklyMarks: null,
    });

    if (!currentTenantId) {
      setStats({
        activeEmployees: null,
        inactiveEmployees: null,
        scheduled: null,
        scheduledAmbiguities: 0,
        pendingIncidents: null,
        todayMarks: null,
        deviceHealth: EMPTY_DEVICE_HEALTH,
      });
      setMarcajes([]);
      setWeeklyMarks([]);
      recentMarkIdsRef.current = new Set();
      setLoadingInit(false);
      return;
    }

    // loadDashboardOperations nunca lanza — cada widget tiene su error individual.
    const data = await loadDashboardOperations(supabase, currentTenantId);
    if (requestId !== requestRef.current) return;

    setStats(data.stats);
    setDay(data.day);
    setMarcajes(data.recentMarks);
    setWeeklyMarks(data.weeklyMarks);
    setWidgetErrors(data.widgetErrors);
    recentMarkIdsRef.current = new Set(data.recentMarks.map((mark) => mark.id));
    setLoadingInit(false);
  }, [currentTenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Supabase Realtime ─────────────────────────────────────────
  useEffect(() => {
    if (!currentTenantId) return undefined;

    const channel = supabase
      .channel(`registro_asistencia-realtime-dashboard-${currentTenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "registro_asistencia",
          filter: `cliente_id=eq.${currentTenantId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from("registro_asistencia")
            .select(
              `id, verificado_at, tipo_verificacion, metodo,
                     empleados(nombre, apellido, avatar_url),
                     devices(name, location)`,
            )
            .eq("id", payload.new.id)
            .eq("cliente_id", currentTenantId)
            .single();

          if (data) {
            if (recentMarkIdsRef.current.has(data.id)) return;
            recentMarkIdsRef.current.add(data.id);
            setMarcajes((prev) => [data, ...prev].slice(0, 50));

            const localDate = getLocalComponents(
              data.verificado_at,
              day.timezone,
            ).localDate;
            if (localDate === day.localDate) {
              setStats((prev) => ({
                ...prev,
                todayMarks: (prev.todayMarks ?? 0) + 1,
              }));
            }
            if (
              localDate >= day.weekStartLocalDate &&
              localDate < day.weekEndLocalDate
            ) {
              setWeeklyMarks((prev) => [
                { verificado_at: data.verificado_at },
                ...prev,
              ]);
            }
            setNewFlash(data.id);
            setTimeout(() => setNewFlash(null), 2500);
            fireMarkingToast(data);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    currentTenantId,
    day.localDate,
    day.timezone,
    day.weekEndLocalDate,
    day.weekStartLocalDate,
  ]);

  const fechaHoy = new Intl.DateTimeFormat("es-MX", {
    timeZone: day.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const dashboardLoading = loadingInit || loadingTenants;

  // Sub-textos dinámicos para las KPI cards
  const empleadosSub = widgetErrors.employees
    ? "No disponible"
    : stats.inactiveEmployees !== null
      ? `${stats.inactiveEmployees} inactivo${stats.inactiveEmployees === 1 ? "" : "s"}`
      : "Cargando catálogo";

  const dispositivosSub = widgetErrors.devices
    ? "Estado no disponible"
    : stats.deviceHealth.offline > 0
      ? `${stats.deviceHealth.offline} sin conexión`
      : "Todas las habilitadas reportan actividad";

  const dispositivosValor = dashboardLoading
    ? "—"
    : widgetErrors.devices
      ? "—"
      : `${stats.deviceHealth.online} / ${stats.deviceHealth.active}`;

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8f9f9] dark:bg-[#0f172a] text-[#272c3d] dark:text-slate-100">
      {/* Sidebar */}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Content Area */}
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        {/* Main Content */}
        <main className="mx-auto w-full max-w-[1440px] space-y-6 p-4 md:p-6 2xl:p-8">
          {/* Page Title */}
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#272c3d] dark:text-white">
              {userName ? `Bienvenido, ${userName}` : "Bienvenido"}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
              {fechaHoy} ·{" "}
              {dashboardLoading
                ? "Cargando resumen operativo…"
                : stats.scheduled !== null
                  ? `${stats.scheduled} empleados programados hoy`
                  : "Resumen operativo disponible"}
            </p>
          </div>

          {requiresTenantAssignment && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
              Asigna una empresa a este usuario para consultar el resumen
              operativo.
            </div>
          )}

          {/* Fila principal: gráfica + 4 KPIs */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
            <AnalyticsChart
              marcajes={weeklyMarks}
              day={day}
              loading={dashboardLoading}
              unavailable={Boolean(widgetErrors.weeklyMarks)}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* KPI 1: Colaboradores activos */}
              <StatCard
                label="Colaboradores activos"
                value={stats.activeEmployees}
                sub={empleadosSub}
                icon={Users}
                status="Catálogo"
                statusTone="neutral"
                iconBg="bg-[#f2fbf9] text-[#5dd0c7] border border-[#e7f8f5]"
                iconColor="text-[#5dd0c7]"
                loading={dashboardLoading}
                unavailable={Boolean(widgetErrors.employees)}
              />
              {/* KPI 2: Checadas hoy */}
              <StatCard
                label="Checadas hoy"
                value={stats.todayMarks}
                sub="Eventos recibidos dentro de la jornada local"
                icon={Clock3}
                status={
                  widgetErrors.todayMarks
                    ? "No disponible"
                    : "Actividad registrada"
                }
                statusTone={widgetErrors.todayMarks ? "neutral" : "success"}
                iconBg="bg-[#f2fbf9] text-[#5dd0c7] border border-[#e7f8f5]"
                iconColor="text-[#5dd0c7]"
                priority="primary"
                loading={dashboardLoading}
                unavailable={Boolean(widgetErrors.todayMarks)}
              />
              {/* KPI 3: Incidencias pendientes */}
              <StatCard
                label="Incidencias pendientes"
                value={stats.pendingIncidents}
                sub="Solicitudes que requieren revisión"
                icon={ListTodo}
                status={
                  widgetErrors.incidents
                    ? "No disponible"
                    : stats.pendingIncidents > 0
                      ? "Revisar"
                      : "Sin pendientes"
                }
                statusTone={
                  widgetErrors.incidents
                    ? "neutral"
                    : stats.pendingIncidents > 0
                      ? "warning"
                      : "success"
                }
                iconBg="bg-[#fff5e2] text-[#d9982f] border border-[#f6dfb4]"
                iconColor="text-[#d9982f]"
                loading={dashboardLoading}
                unavailable={Boolean(widgetErrors.incidents)}
              />
              {/* KPI 4: Terminales — resumen rápido. El detalle está en DeviceHealth abajo. */}
              <StatCard
                label="Terminales"
                value={dispositivosValor}
                sub={dispositivosSub}
                icon={Wifi}
                status={
                  widgetErrors.devices
                    ? "No disponible"
                    : stats.deviceHealth.offline > 0
                      ? "Atención requerida"
                      : "Con actividad"
                }
                statusTone={
                  widgetErrors.devices
                    ? "neutral"
                    : stats.deviceHealth.offline > 0
                      ? "error"
                      : "success"
                }
                iconBg="bg-[#f2fbf9] text-[#5dd0c7] border border-[#e7f8f5]"
                iconColor="text-[#5dd0c7]"
                loading={dashboardLoading}
                unavailable={Boolean(widgetErrors.devices)}
              />
            </div>
          </div>

          {/* Fila media: alertas + jornada */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <AttentionPanel
              stats={stats}
              loading={dashboardLoading}
              widgetErrors={widgetErrors}
            />
            <TodayStatus
              stats={stats}
              loading={dashboardLoading}
              widgetErrors={widgetErrors}
            />
          </div>

          {/* Fila inferior: checadas recientes + detalle de terminales */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
            <RealtimeTable
              marcajes={marcajes}
              newFlash={newFlash}
              loading={dashboardLoading}
              unavailable={Boolean(widgetErrors.recentMarks)}
              timezone={day.timezone}
            />
            {/* Estado de terminales: detalle por dispositivo.
                No duplica la KPI de arriba; aporta nombre, ubicación y última actividad. */}
            <DeviceHealth
              deviceHealth={stats.deviceHealth}
              loading={dashboardLoading}
              unavailable={Boolean(widgetErrors.devices)}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
