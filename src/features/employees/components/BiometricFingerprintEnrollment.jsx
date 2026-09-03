// src/features/employees/components/BiometricFingerprintEnrollment.jsx
import React from "react";
import {
  Monitor,
  Server,
  RefreshCw,
  Info,
  AlertCircle,
  Fingerprint,
} from "lucide-react";
import { useFingerEnrollment } from "../../biometrics/hooks/useFingerEnrollment";
import { FINGER_DISPLAY_NAMES } from "../../biometrics/services/enrollmentService";
import fingerprintBg from "../../../assets/fingerprint_bg.png";

// ── Colores por estado ───────────────────────────────────────────────────────
const STATE_COLOR = {
  enrolled: "#22c55e", // Verde
  success: "#16a34a",
  selected: "#6366f1", // Índigo
  enrolling: "#f59e0b", // Ámbar
  error: "#ef4444", // Rojo
  not_enrolled: "#989898ff",
};

const getColor = (state) => STATE_COLOR[state] || STATE_COLOR.not_enrolled;

import fingerprintImg from "../../../assets/fingerprint.png";

// ── Ícono de huella detallado ──────────────────────────────────────────────
function FpIcon({ x, y, color, angle = 0, size = 32 }) {
  return (
    <g
      transform={`translate(${x},${y}) rotate(${angle}) translate(${-size / 2},${-size / 2})`}
      style={{ pointerEvents: "none" }}
    >
      <foreignObject width={size} height={size}>
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: color,
            WebkitMaskImage: `url(${fingerprintImg})`,
            maskImage: `url(${fingerprintImg})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      </foreignObject>
    </g>
  );
}

function SpinArc({ x, y, color, r = 12 }) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeOpacity={0.2}
      />
      <path
        d={`M ${x},${y - r} A ${r},${r} 0 0 1 ${x + r},${y}`}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${x} ${y}`}
          to={`360 ${x} ${y}`}
          dur="0.85s"
          repeatCount="indefinite"
        />
      </path>
    </g>
  );
}

// Coordenadas calibradas exactamente sobre la imagen de fondo actual (800x414)
const FINGER_TIPS = [
  // MANO IZQUIERDA
  { key: "left_pinky", cx: 165, cy: 157, angle: -10 },
  { key: "left_ring", cx: 206, cy: 115 },
  { key: "left_middle", cx: 262, cy: 97 },
  { key: "left_index", cx: 314, cy: 122, angle: 15 },
  { key: "left_thumb", cx: 357, cy: 216, angle: 40 },

  // MANO DERECHA
  { key: "right_thumb", cx: 437, cy: 218, angle: -45 },
  { key: "right_index", cx: 480, cy: 124, angle: -15 },
  { key: "right_middle", cx: 531, cy: 99 },
  { key: "right_ring", cx: 587, cy: 115, angle: 14 },
  { key: "right_pinky", cx: 628, cy: 158, angle: 15 },
];

export default function BiometricFingerprintEnrollment({
  empleadoId,
  clienteId,
}) {
  const {
    fingerStates,
    selectedFinger,
    selectFinger,
    requestEnrollment,
    retryFinger,
    devices,
    selectedDeviceSerial,
    setSelectedDeviceSerial,
    loading,
  } = useFingerEnrollment(empleadoId, clienteId);

  const enrolledCount = Object.values(fingerStates).filter(
    (s) => s === "enrolled" || s === "success",
  ).length;
  const isEnrolling = Object.values(fingerStates).some(
    (s) => s === "enrolling",
  );
  const currentState = selectedFinger ? fingerStates[selectedFinger] : null;

  return (
    <div className="bg-white dark:bg-[#1c2434] border border-slate-200 dark:border-[#2e3a4e] rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-sm font-bold text-slate-800 dark:text-white">
          Huella dactilar
        </span>
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
            enrolledCount > 0
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {enrolledCount} / 10 registradas
        </span>
      </div>

      <div className="relative w-full" style={{ backgroundColor: "#e2edf8" }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-slate-900/70 z-20">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
          </div>
        )}

        {/* Usamos un <img> HTML real para garantizar que siempre se muestre */}
        <img
          src={fingerprintBg}
          alt="Manos"
          className="w-full h-auto block"
          style={{ objectFit: "contain" }}
        />

        {/* Superponemos el SVG absolutamente encima para la interactividad */}
        <svg
          viewBox="0 0 800 414"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid slice"
        >
          {FINGER_TIPS.map((f) => {
            const state = fingerStates[f.key] || "not_enrolled";
            const color = getColor(state);
            const isEnrollingThis = state === "enrolling";

            return (
              <g
                key={`fp-${f.key}`}
                onClick={() => selectFinger(f.key)}
                style={{ cursor: "pointer" }}
              >
                {/* El ícono de huella y halos interactivos irán directamente sobre el fondo */}

                {(state === "selected" || state === "enrolling") && (
                  <circle
                    cx={f.cx}
                    cy={f.cy}
                    r={20}
                    fill={color}
                    fillOpacity={0.15}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeOpacity={0.4}
                  />
                )}

                {isEnrollingThis ? (
                  <SpinArc x={f.cx} y={f.cy} color={color} r={12} />
                ) : (
                  <FpIcon
                    x={f.cx}
                    y={f.cy}
                    color={color}
                    angle={f.angle}
                    size={34}
                  />
                )}

                <circle cx={f.cx} cy={f.cy} r={32} fill="transparent" />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
        {selectedFinger ? (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
              currentState === "error"
                ? "bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20"
                : currentState === "enrolling"
                  ? "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20"
                  : "bg-indigo-50 border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/20"
            }`}
          >
            {currentState === "enrolling" && (
              <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin flex-shrink-0" />
            )}
            {currentState === "error" && (
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            )}
            <span
              className={`font-semibold flex-1 ${
                currentState === "error"
                  ? "text-red-700 dark:text-red-300"
                  : currentState === "enrolling"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-indigo-700 dark:text-indigo-300"
              }`}
            >
              {FINGER_DISPLAY_NAMES[selectedFinger]}
            </span>
            <span className="text-slate-400">
              {currentState === "enrolling"
                ? "Esperando..."
                : currentState === "error"
                  ? "Error"
                  : currentState === "enrolled"
                    ? "Ya enrolado ✓"
                    : "Seleccionado"}
            </span>
            {currentState === "error" && (
              <button
                onClick={() => retryFinger(selectedFinger)}
                className="text-red-600 dark:text-red-400 underline font-medium ml-1 flex-shrink-0"
              >
                Reintentar
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-0.5">
            Toca un dedo en la imagen para seleccionarlo
          </p>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Monitor className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <select
              value={selectedDeviceSerial}
              onChange={(e) => setSelectedDeviceSerial(e.target.value)}
              disabled={isEnrolling}
              className="w-full pl-8 pr-2 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
            >
              {devices.length === 0 && (
                <option value="">Sin terminales activas</option>
              )}
              {devices.map((d) => (
                <option key={d.numero_serie} value={d.numero_serie}>
                  {d.nombre_ubicacion || d.numero_serie}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={requestEnrollment}
            disabled={
              !selectedFinger ||
              isEnrolling ||
              !selectedDeviceSerial
            }
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-sm disabled:shadow-none"
          >
            {isEnrolling ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Enrolando...
              </>
            ) : currentState === "enrolled" ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Re-enrolar
              </>
            ) : (
              <>
                <Server className="w-3.5 h-3.5" />
                Enrolar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
