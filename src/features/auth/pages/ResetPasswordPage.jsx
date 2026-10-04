import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { updatePassword } from '../services/authService'
import {
  Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowRight
} from 'lucide-react'
import AuthBranding from '../components/AuthBranding'

const BW = '#00363D'
const PASSWORD_MIN = 8

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [hasSession, setHasSession] = useState(true)

  useEffect(() => {
    // Verificar si hay sesión de recuperación activa
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session) {
        // En algunos casos Supabase tarda unos ms en procesar el hash del token
        const checkHash = window.location.hash.includes('access_token') || window.location.hash.includes('type=recovery')
        if (!checkHash) {
          setHasSession(false)
        }
      }
    })
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!password || password.length < PASSWORD_MIN) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`)
      return
    }

    if (password !== confirmPass) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    try {
      const { error: updateErr } = await updatePassword(password)
      if (updateErr) throw updateErr
      setSuccess(true)
      setTimeout(() => {
        navigate('/login', { replace: true })
      }, 2500)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la contraseña. El enlace pudo haber expirado.')
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
      <AuthBranding variant="client" />

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
          {success ? (
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
                Contraseña actualizada
              </h2>
              <p style={{ fontSize: 13.5, color: 'rgba(0,54,61,0.60)', lineHeight: 1.5, margin: '0 0 24px' }}>
                Tu contraseña ha sido restablecida exitosamente. Serás redirigido al inicio de sesión...
              </p>
              <Link
                to="/login"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '11px 20px', borderRadius: 10,
                  background: BW, color: '#FFFFFF',
                  textDecoration: 'none', fontSize: 13.5, fontWeight: 600,
                }}
              >
                Ir a Iniciar Sesión ahora
              </Link>
            </div>
          ) : !hasSession ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div
                style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: '#FEF2F2', border: '1px solid #FECACA',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px', color: '#DC2626',
                }}
              >
                <AlertCircle size={26} />
              </div>
              <h2 style={{ fontSize: 19, fontWeight: 700, color: BW, margin: '0 0 8px' }}>
                Enlace expirado o inválido
              </h2>
              <p style={{ fontSize: 13.5, color: 'rgba(0,54,61,0.60)', lineHeight: 1.5, margin: '0 0 24px' }}>
                El enlace de recuperación es de un solo uso o ha caducado. Por favor solicita uno nuevo.
              </p>
              <Link
                to="/recuperar-contrasena"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '11px 20px', borderRadius: 10,
                  background: BW, color: '#FFFFFF',
                  textDecoration: 'none', fontSize: 13.5, fontWeight: 600,
                }}
              >
                Solicitar nuevo enlace
              </Link>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <h1
                  style={{
                    margin: 0, fontSize: 22, fontWeight: 700,
                    color: BW, letterSpacing: '-0.025em',
                  }}
                >
                  Nueva contraseña
                </h1>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'rgba(0,54,61,0.50)', lineHeight: 1.5 }}>
                  Ingresa tu nueva contraseña para volver a acceder a tu cuenta.
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
                    htmlFor="reset-pass"
                    style={{
                      display: 'block', marginBottom: 6,
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: BW,
                    }}
                  >
                    Nueva Contraseña
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute', left: 14, top: '50%',
                        transform: 'translateY(-50%)', color: 'rgba(0,54,61,0.35)',
                        display: 'flex', alignItems: 'center', pointerEvents: 'none',
                      }}
                    >
                      <Lock size={16} />
                    </span>
                    <input
                      id="reset-pass"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      disabled={loading}
                      required
                      style={{
                        width: '100%', height: 44, padding: '0 40px 0 40px',
                        fontSize: 14, fontFamily: 'inherit',
                        color: BW, background: '#FFFFFF',
                        border: '1px solid rgba(0,54,61,0.18)',
                        borderRadius: 10, outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      style={{
                        position: 'absolute', right: 12, top: '50%',
                        transform: 'translateY(-50%)', background: 'none',
                        border: 'none', cursor: 'pointer',
                        color: 'rgba(0,54,61,0.40)', display: 'flex', alignItems: 'center',
                      }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reset-confirm"
                    style={{
                      display: 'block', marginBottom: 6,
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: BW,
                    }}
                  >
                    Confirmar Contraseña
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute', left: 14, top: '50%',
                        transform: 'translateY(-50%)', color: 'rgba(0,54,61,0.35)',
                        display: 'flex', alignItems: 'center', pointerEvents: 'none',
                      }}
                    >
                      <Lock size={16} />
                    </span>
                    <input
                      id="reset-confirm"
                      type={showPass ? 'text' : 'password'}
                      value={confirmPass}
                      onChange={e => setConfirmPass(e.target.value)}
                      placeholder="Repite la contraseña"
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
                  }}
                >
                  {loading ? 'Guardando contraseña…' : (
                    <>
                      Actualizar Contraseña
                      <ArrowRight size={15} />
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
