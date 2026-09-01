/**
 * PrivateRoute.jsx — Guard de rutas protegidas v4
 * Signum-Clock · Jet Stream + Blue Whale palette
 *
 * Comportamiento:
 *  status === 'loading'        → Pantalla de carga (previene FOCP)
 *  status === 'authenticated'  → Renderiza children
 *  status === 'unauthenticated'→ Redirige a /login con reason si existe
 *
 * Prevención de FOCP:
 *  Mientras status es 'loading', mostramos una pantalla de carga
 *  con la paleta brand. NUNCA mostramos contenido protegido antes
 *  de determinar el estado de sesión.
 */

import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../../features/auth/hooks/useAuth'
import { Clock } from 'lucide-react'

export default function PrivateRoute({ children }) {
  const { status } = useAuth()
  const location   = useLocation()
  const [logoutReason, setLogoutReason] = useState(null)

  // Escuchar evento de logout para capturar el motivo
  useEffect(() => {
    const handler = (e) => {
      setLogoutReason(e.detail?.reason ?? 'manual')
    }
    window.addEventListener('signum:logout', handler)
    return () => window.removeEventListener('signum:logout', handler)
  }, [])

  // ── Estado de carga → pantalla de carga brand ───────────────
  if (status === 'loading') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ backgroundColor: '#F8FAFC' }}
        aria-busy="true"
        aria-label="Verificando sesión"
      >
        {/* Logo animado */}
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: '#2563EB',
            boxShadow: '0 8px 24px rgba(3,54,61,0.25)',
          }}
        >
          <Clock className="w-7 h-7 animate-spin" style={{ color: '#E2E8F0', animationDuration: '3s' }} />
        </div>

        {/* Indicador de carga */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: '#2563EB',
                  opacity: 0.3,
                  animation: `loadingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
          <p
            className="text-xs font-medium"
            style={{ color: '#2563EB' }}
          >
            Verificando sesión...
          </p>
        </div>

        <style>{`
          @keyframes loadingDot {
            0%, 80%, 100% { opacity: 0.15; transform: scale(0.9); }
            40%           { opacity: 1;    transform: scale(1.1); }
          }
        `}</style>
      </div>
    )
  }

  // ── Sin sesión → redirigir al login ──────────────────────────
  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from:   location.pathname,
          reason: logoutReason,
        }}
      />
    )
  }

  // ── Autenticado → renderizar contenido protegido ─────────────
  return children
}





