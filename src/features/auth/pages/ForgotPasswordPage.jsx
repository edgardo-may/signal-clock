import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { resetPassword } from '../services/authService'
import {
  Mail, ArrowLeft, Send, CheckCircle2, AlertCircle
} from 'lucide-react'
import AuthBranding from '../components/AuthBranding'

const BW = '#00363D'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const remembered = localStorage.getItem('sc_remember_email')
    if (remembered) {
      setEmail(remembered)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Ingresa un correo electrónico válido.')
      return
    }

    setLoading(true)
    try {
      const { error: resetErr } = await resetPassword(cleanEmail)
      if (resetErr) throw resetErr
      setSent(true)
    } catch (err) {
      setError(err.message || 'No se pudo enviar el enlace de recuperación.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* Branding panel */}
      <AuthBranding variant="client" />

      {/* Form panel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F6FAFA',
          padding: '32px 24px',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background:
              'radial-gradient(ellipse at 70% 15%, rgba(189,217,215,0.13) 0%, transparent 55%),' +
              'radial-gradient(ellipse at 30% 85%, rgba(189,217,215,0.08) 0%, transparent 50%)',
          }}
        />

        <div
          style={{
            width: '100%',
            maxWidth: 400,
            background: '#FFFFFF',
            borderRadius: 16,
            border: '1px solid rgba(0,54,61,0.07)',
            boxShadow:
              '0 0 0 1px rgba(0,54,61,0.03),' +
              '0 2px 8px rgba(0,54,61,0.05),' +
              '0 12px 32px rgba(0,54,61,0.07)',
            padding: '36px 32px 32px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {sent ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div
                style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'rgba(189,217,215,0.25)',
                  border: `2px solid ${BW}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <CheckCircle2 size={26} strokeWidth={2} color={BW} />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: BW, margin: '0 0 8px' }}>
                Enlace enviado
              </h2>
              <p style={{ fontSize: 13.5, color: 'rgba(0,54,61,0.60)', lineHeight: 1.5, margin: '0 0 24px' }}>
                Si existe una cuenta asociada a <strong>{email}</strong>, recibirás un correo con el enlace seguro para restablecer tu contraseña.
              </p>
              <Link
                to="/login"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '11px 20px', borderRadius: 10,
                  background: BW, color: '#FFFFFF',
                  textDecoration: 'none', fontSize: 13.5, fontWeight: 600,
                  transition: 'opacity 150ms ease',
                }}
              >
                <ArrowLeft size={16} />
                Volver a Iniciar Sesión
              </Link>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <Link
                  to="/login"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 12.5, fontWeight: 600, color: 'rgba(0,54,61,0.45)',
                    textDecoration: 'none', marginBottom: 16,
                    transition: 'color 140ms ease',
                  }}
                  onMouseOver={e => e.currentTarget.style.color = BW}
                  onMouseOut={e => e.currentTarget.style.color = 'rgba(0,54,61,0.45)'}
                >
                  <ArrowLeft size={14} />
                  Volver al login
                </Link>
                <h1
                  style={{
                    margin: 0, fontSize: 22, fontWeight: 700,
                    color: BW, letterSpacing: '-0.025em',
                  }}
                >
                  Recuperar contraseña
                </h1>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'rgba(0,54,61,0.50)', lineHeight: 1.5 }}>
                  Ingresa tu correo y te enviaremos las instrucciones para restablecer tu acceso.
                </p>
              </div>

              {error && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px', borderRadius: 8,
                    background: '#FEF2F2', border: '1px solid #FECACA',
                    color: '#991B1B', fontSize: 12.5, marginBottom: 16,
                  }}
                >
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label
                    htmlFor="forgot-email"
                    style={{
                      display: 'block', marginBottom: 6,
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: BW,
                    }}
                  >
                    Correo electrónico
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute', left: 14, top: '50%',
                        transform: 'translateY(-50%)', color: 'rgba(0,54,61,0.35)',
                        display: 'flex', alignItems: 'center', pointerEvents: 'none',
                      }}
                    >
                      <Mail size={16} />
                    </span>
                    <input
                      id="forgot-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="tu@empresa.com"
                      disabled={loading}
                      required
                      style={{
                        width: '100%', height: 44, padding: '0 14px 0 40px',
                        fontSize: 14, fontFamily: 'inherit',
                        color: BW, background: '#FFFFFF',
                        border: '1px solid rgba(0,54,61,0.18)',
                        borderRadius: 10, outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', height: 44, marginTop: 4,
                    background: BW, color: '#FFFFFF',
                    border: 'none', borderRadius: 10,
                    fontSize: 14, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                    transition: 'background 150ms ease',
                  }}
                >
                  {loading ? 'Enviando enlace…' : (
                    <>
                      Enviar enlace de recuperación
                      <Send size={15} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
