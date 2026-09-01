/**
 * AuthBranding.jsx — Panel de branding lateral
 * Signum-Clock v7 · Blue Whale #00363D · JetStream #BDD9D7
 *
 * Principio: espacio negativo = diseño.
 * Contiene solo: logo + nombre + tagline.
 * Nada más compite con el formulario.
 *
 * variant="client"  → branding estándar
 * variant="central" → indicador SuperAdmin sutil
 */

import logoImg from "../../../assets/logo.png";
import { ShieldCheck } from "lucide-react";

const BW = "#00363D";
const JS = "#BDD9D7";

export default function AuthBranding({ variant = "client" }) {
  const isCentral = variant === "central";

  return (
    <div
      className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden select-none"
      style={{
        width: "44%",
        minHeight: "100vh",
        backgroundColor: BW,
        /* Trama de puntos muy sutil — apenas perceptible */
        backgroundImage: `radial-gradient(circle, rgba(189,217,215,0.12) 1px, transparent 1px)`,
        backgroundSize: "32px 32px",
      }}
      aria-hidden="true"
    >
      {/* Resplandor ambiental superior — sutil, no decorativo */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "60%",
          height: "40%",
          background: `radial-gradient(ellipse at center, rgba(189,217,215,0.08) 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* Contenido centrado */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          position: "relative",
          zIndex: 1,
          /* Padding para evitar tocar los bordes */
          padding: "0 48px",
          textAlign: "center",
          transform: "translateY(-90px)",
        }}
      >
        {/* ── Logo — centrado y tamaño aumentado ── */}
        <img
          src={logoImg}
          alt="Signum-Clock"
          style={{
            width: 400,
            height: 400,
            objectFit: "contain",
            display: "block",
            margin: "0 auto -90px auto",
            flexShrink: 0,
          }}
        />

        {/* ── Nombre del Proyecto ── */}
        <h1
          style={{
            margin: "0 0 4px 0",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "0.2em",
            color: "#BDD9D7",
            fontFamily: "Inter, sans-serif",
            textTransform: "uppercase",
            WebkitFontSmoothing: "antialiased",
          }}
        >
          SIGNUM·CLOCK
        </h1>

        {/* ── Tagline ── */}
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 400,
            letterSpacing: "0.02em",
            lineHeight: 1.6,
            color: `rgba(189,217,215,0.65)`,
            fontFamily: "Inter, sans-serif",
            WebkitFontSmoothing: "antialiased",
            maxWidth: 260,
          }}
        >
          {isCentral
            ? "Administración global de la plataforma"
            : "Gestión inteligente de asistencia"}
        </p>

        {/* ── Badge SuperAdmin (solo Central) ── */}
        {isCentral && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 20,
              padding: "5px 12px",
              borderRadius: 20,
              background: "rgba(189,217,215,0.10)",
              border: "1px solid rgba(189,217,215,0.20)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: `rgba(189,217,215,0.70)`,
              fontFamily: "Inter, sans-serif",
            }}
          >
            <ShieldCheck size={11} strokeWidth={2} />
            Acceso restringido
          </div>
        )}
      </div>

      {/* ── Línea separadora derecha (borde del panel) ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 1,
          height: "100%",
          background:
            "linear-gradient(to bottom, transparent, rgba(189,217,215,0.12) 30%, rgba(189,217,215,0.12) 70%, transparent)",
        }}
      />
    </div>
  );
}
