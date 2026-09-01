/**
 * CentralLoginPage.jsx — Signum-Clock Central (SuperAdmin)
 * Layout split v7 · Panel branding + formulario premium
 *
 * Misma arquitectura que ClientLoginPage.
 * variant="central" en AuthBranding → badge Acceso restringido sutil.
 * Lógica de auth SuperAdmin idéntica a versiones anteriores.
 */

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { signIn } from '../../features/auth/services/authService'
import {
  Mail, Lock, Eye, EyeOff,
  AlertCircle, AlertTriangle, CheckCircle2,
  ArrowRight, ShieldCheck,
} from 'lucide-react'
import AuthBranding from '../../features/auth/components/AuthBranding'
import logoImg from '../../assets/logo.png'

/* ─── Tokens ──────────────────────────────────────────────────── */
const BW    = '#00363D'
const JS    = '#BDD9D7'
const BW_HV = '#004D57'
const BW_AC = '#002830'

/* ─── Error map ───────────────────────────────────────────────── */
const ERROR_MAP = [
  {
    match: /Correo o contraseña incorrectos|invalid login credentials/i,
    title: 'Credenciales incorrectas',
    msg:   'El correo o la contraseña no son correctos.',
    severity: 'error',
  },
  {
    match: /Acceso denegado|Acceso exclusivo/i,
    title: 'Acceso denegado',
    msg:   'Esta interfaz es exclusiva para SuperAdmins.',
    severity: 'error',
  },
  {
    match: /email not confirmed/i,
    title: 'Correo sin confirmar',
    msg:   'Confirma tu correo electrónico antes de continuar.',
    severity: 'warning',
  },
  {
    match: /account.*(suspended|disabled)|ACCOUNT_SUSPENDED/i,
    title: 'Cuenta suspendida',
    msg:   'Tu acceso fue suspendido. Contacta a soporte.',
    severity: 'error',
  },
  {
    match: /Demasiados intentos|too many requests|rate.?limit/i,
    title: 'Demasiados intentos',
    msg:   'Has superado el límite. Espera unos minutos.',
    severity: 'warning',
  },
  {
    match: /network|fetch|failed to fetch|NetworkError/i,
    title: 'Sin conexión',
    msg:   'Verifica tu conexión a internet.',
    severity: 'warning',
  },
]
const FALLBACK = { title: 'Error al iniciar sesión', msg: 'Ocurrió un problema inesperado.', severity: 'error' }
const parseError = (err) => {
  const msg = err?.message ?? String(err ?? '')
  return ERROR_MAP.find(e => e.match.test(msg)) ?? FALLBACK
}

/* ─── Styles ─────────────────────────────────────────────────── */
const SHARED_STYLES = `
  @keyframes sc-slideIn {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes sc-fadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes sc-checkPop {
    0%   { transform: scale(0.7); opacity: 0; }
    70%  { transform: scale(1.08); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes sc-spin {
    to { transform: rotate(360deg); }
  }

  .sc-card  { animation: sc-fadeUp 0.4s cubic-bezier(0.23,1,0.32,1) both; }
  .sc-alert { animation: sc-slideIn 0.2s cubic-bezier(0.23,1,0.32,1) both; }
  .sc-check { animation: sc-checkPop 0.35s cubic-bezier(0.23,1,0.32,1) both; }
  .sc-spin  { animation: sc-spin 0.8s linear infinite; }

  .sc-input {
    width: 100%; height: 44px; padding: 0 14px;
    font-size: 14px; font-family: 'Inter', sans-serif;
    color: ${BW}; background: #fff;
    border: 1.5px solid rgba(0,54,61,0.13);
    border-radius: 10px; outline: none;
    transition: border-color 140ms ease, box-shadow 140ms ease;
    -webkit-font-smoothing: antialiased;
  }
  .sc-input::placeholder { color: rgba(0,54,61,0.28); }
  .sc-input:hover:not(:disabled) { border-color: rgba(0,54,61,0.26); }
  .sc-input:focus { border-color: ${BW}; box-shadow: 0 0 0 3px rgba(189,217,215,0.40); }
  .sc-input.sc-err { border-color: #d93025; box-shadow: 0 0 0 3px rgba(217,48,37,0.10); }
  .sc-input:disabled { opacity: 0.45; cursor: not-allowed; }
  .sc-input.pl { padding-left: 40px; }
  .sc-input.pr { padding-right: 42px; }

  .sc-btn {
    width: 100%; height: 44px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600;
    letter-spacing: -0.01em;
    color: #fff; background: ${BW};
    border: none; border-radius: 10px; cursor: pointer;
    transition: background 140ms ease, transform 100ms ease, box-shadow 140ms ease;
    -webkit-font-smoothing: antialiased;
    box-shadow: 0 1px 3px rgba(0,54,61,0.16), 0 4px 10px rgba(0,54,61,0.10);
  }
  .sc-btn:hover:not(:disabled) { background: ${BW_HV}; box-shadow: 0 2px 6px rgba(0,54,61,0.20), 0 6px 16px rgba(0,54,61,0.12); }
  .sc-btn:active:not(:disabled) { background: ${BW_AC}; transform: scale(0.975); box-shadow: 0 1px 2px rgba(0,54,61,0.10); }
  .sc-btn:disabled { opacity: 0.40; cursor: not-allowed; }
  .sc-btn:focus-visible { outline: 2px solid ${JS}; outline-offset: 2px; }

  .sc-eye {
    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    background: none; border: none; padding: 4px; cursor: pointer;
    color: rgba(0,54,61,0.32); border-radius: 6px;
    display: flex; align-items: center; transition: color 140ms ease;
  }
  .sc-eye:hover { color: ${BW}; }
  .sc-eye:focus-visible { outline: 2px solid ${JS}; }
  .sc-eye:disabled { opacity: 0.35; cursor: not-allowed; }
`

/* ─── PasswordField ─────────────────────────────────────────── */
function PasswordField({ id, value, onChange, disabled, hasError, onBlur }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'rgba(0,54,61,0.32)', pointerEvents: 'none', display: 'flex',
        }}
      >
        <Lock size={15} strokeWidth={1.8} />
      </span>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="••••••••"
        autoComplete="current-password"
        aria-invalid={hasError ? 'true' : 'false'}
        className={`sc-input pl pr${hasError ? ' sc-err' : ''}`}
      />
      <button
        type="button"
        className="sc-eye"
        onClick={() => setShow(v => !v)}
        disabled={disabled}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {show ? <EyeOff size={15} strokeWidth={1.8} /> : <Eye size={15} strokeWidth={1.8} />}
      </button>
    </div>
  )
}

/* ─── PremiumEmailField ─────────────────────────────────────── */
function PremiumEmailField({ id, value, onChange, onBlur, disabled, hasError, isTouched }) {
  const isValid = value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !hasError;
  const showErr = hasError && isTouched;
  
  return (
    <div style={{ position: 'relative' }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: isValid ? '#10b981' : (showErr ? '#ef4444' : 'rgba(0,54,61,0.32)'), 
          pointerEvents: 'none', display: 'flex', transition: 'color 0.3s ease'
        }}
      >
        <Mail size={15} strokeWidth={1.8} />
      </span>
      <input
        id={id}
        type="email"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="superadmin@signum-clock.com"
        autoComplete="email"
        aria-invalid={showErr ? 'true' : 'false'}
        aria-describedby={showErr ? `${id}-err` : undefined}
        className={`sc-input pl pr`}
        style={{
          borderColor: showErr ? '#ef4444' : (isValid ? '#10b981' : undefined),
          boxShadow: showErr ? '0 0 0 3px rgba(239,68,68,0.1)' : (isValid ? '0 0 0 3px rgba(16,185,129,0.1)' : undefined),
          paddingRight: isValid || showErr ? 40 : 14,
          transition: 'all 0.3s ease',
          backgroundColor: isValid ? '#f0fdf4' : (showErr ? '#fef2f2' : '#ffffff')
        }}
      />
      <div
        style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          opacity: isValid ? 1 : 0, scale: isValid ? '1' : '0.5', pointerEvents: 'none'
        }}
      >
        <CheckCircle2 size={18} strokeWidth={2.5} color="#10b981" />
      </div>
      <div
        style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          opacity: showErr && !isValid ? 1 : 0, scale: showErr && !isValid ? '1' : '0.5', pointerEvents: 'none'
        }}
      >
        <AlertCircle size={18} strokeWidth={2.5} color="#ef4444" />
      </div>
    </div>
  )
}

/* ─── FieldError ─────────────────────────────────────────────── */
function FieldError({ msg }) {
  if (!msg) return null
  return (
    <p
      className="sc-alert"
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 12, fontWeight: 500, color: '#c53030', margin: '4px 0 0',
      }}
      role="alert"
    >
      <AlertCircle size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
      {msg}
    </p>
  )
}

/* ─── AlertBanner ────────────────────────────────────────────── */
function AlertBanner({ def }) {
  if (!def) return null
  const isWarn = def.severity === 'warning'
  return (
    <div
      className="sc-alert"
      role="alert"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 14px', borderRadius: 8, fontSize: 13,
        background: isWarn ? '#fffbeb' : '#fff5f5',
        border: `1px solid ${isWarn ? '#f6e05e' : '#feb2b2'}`,
        color: isWarn ? '#744210' : '#c53030',
      }}
    >
      {isWarn
        ? <AlertTriangle size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
        : <AlertCircle   size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
      }
      <div>
        <p style={{ fontWeight: 600, lineHeight: 1.3, margin: 0 }}>{def.title}</p>
        <p style={{ margin: '2px 0 0', opacity: 0.85, lineHeight: 1.4 }}>{def.msg}</p>
      </div>
    </div>
  )
}

/* ─── CentralLoginPage ───────────────────────────────────────── */
export default function CentralLoginPage() {
  const navigate = useNavigate()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [loading,      setLoading]      = useState(false)
  const [loginOk,      setLoginOk]      = useState(false)
  const [errorDef,     setErrorDef]     = useState(null)
  const [emailErr,     setEmailErr]     = useState('')
  const [passErr,      setPassErr]      = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [passTouched,  setPassTouched]  = useState(false)

  const validateEmail    = v => !v ? 'Ingresa tu correo.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Formato inválido.' : ''
  const validatePassword = v => !v ? 'Ingresa tu contraseña.' : v.length < 8 ? 'Mínimo 8 caracteres.' : ''

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorDef(null)

    const eErr = validateEmail(email)
    const pErr = validatePassword(password)
    setEmailErr(eErr); setPassErr(pErr)
    setEmailTouched(true); setPassTouched(true)
    if (eErr || pErr) return

    setLoading(true)
    try {
      const { data, profile, error } = await signIn(email.trim(), password)
      if (error) throw error

      const isSuperAdmin = profile?.rol?.toLowerCase() === 'superadmin'

      if (!isSuperAdmin) {
        await supabase.auth.signOut()
        setErrorDef({
          severity: 'error',
          title: 'Acceso denegado',
          msg: 'Esta interfaz está reservada exclusivamente para SuperAdmins.',
        })
        return
      }

      setLoginOk(true)
      setTimeout(() => navigate('/central', { replace: true }), 700)
    } catch (err) {
      console.error('[CentralLogin]', err)
      setErrorDef(parseError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{SHARED_STYLES}</style>

      <div
        style={{
          display: 'flex', minHeight: '100vh',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* ── Panel izquierdo (branding Central) ── */}
        <AuthBranding variant="central" />

        {/* ── Panel derecho (formulario) ── */}
        <div
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: '#F6FAFA', padding: '32px 24px', position: 'relative',
          }}
        >
          {/* Ambiental sutil */}
          <div
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background:
                'radial-gradient(ellipse at 70% 15%, rgba(189,217,215,0.13) 0%, transparent 55%),' +
                'radial-gradient(ellipse at 30% 85%, rgba(189,217,215,0.08) 0%, transparent 50%)',
            }}
          />



          {/* ── Card ── */}
          <div
            className="sc-card"
            style={{
              width: '100%', maxWidth: 380,
              background: '#FFFFFF',
              borderRadius: 16,
              border: '1px solid rgba(0,54,61,0.07)',
              boxShadow:
                '0 0 0 1px rgba(0,54,61,0.03),' +
                '0 2px 8px rgba(0,54,61,0.05),' +
                '0 12px 32px rgba(0,54,61,0.07)',
              padding: '36px 32px 32px',
              position: 'relative', zIndex: 1,
            }}
          >
            {loginOk ? (
              <div
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 12, padding: '8px 0', textAlign: 'center',
                }}
              >
                <div
                  className="sc-check"
                  style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: 'rgba(189,217,215,0.25)', border: `2px solid ${BW}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <CheckCircle2 size={22} strokeWidth={2} color={BW} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: BW }}>Acceso concedido</p>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(0,54,61,0.45)' }}>Redirigiendo…</p>
                </div>
              </div>
            ) : (
              <>
                {/* Header + badge */}
                <div style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      marginBottom: 12,
                      padding: '3px 9px', borderRadius: 20,
                      background: 'rgba(189,217,215,0.15)',
                      border: '1px solid rgba(0,54,61,0.10)',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: 'rgba(0,54,61,0.60)',
                    }}
                  >
                    <ShieldCheck size={10} strokeWidth={2.5} />
                    SuperAdmin
                  </div>
                  <h1
                    style={{
                      margin: 0, fontSize: 22, fontWeight: 700,
                      color: BW, letterSpacing: '-0.025em', lineHeight: 1.2,
                    }}
                  >
                    Panel Central
                  </h1>
                  <p
                    style={{
                      margin: '8px 0 0', fontSize: 14,
                      color: 'rgba(0,54,61,0.48)', lineHeight: 1.5,
                    }}
                  >
                    Acceso exclusivo para administradores
                  </p>
                </div>

                {/* Form */}
                <form
                  onSubmit={handleSubmit}
                  noValidate
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                >
                  <AlertBanner def={errorDef} />

                  {/* Email */}
                  <div>
                    <label
                      htmlFor="cn-email"
                      style={{
                        display: 'block', marginBottom: 6,
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                        textTransform: 'uppercase', color: BW,
                      }}
                    >
                      Correo electrónico
                    </label>
                    <PremiumEmailField
                      id="cn-email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setEmailErr(''); setErrorDef(null) }}
                      onBlur={() => { setEmailTouched(true); setEmailErr(validateEmail(email)) }}
                      disabled={loading}
                      hasError={emailErr}
                      isTouched={emailTouched}
                    />
                    {emailTouched && <span id="cn-email-err"><FieldError msg={emailErr} /></span>}
                  </div>

                  {/* Password */}
                  <div>
                    <label
                      htmlFor="cn-pass"
                      style={{
                        display: 'block', marginBottom: 6,
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                        textTransform: 'uppercase', color: BW,
                      }}
                    >
                      Contraseña
                    </label>
                    <PasswordField
                      id="cn-pass"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setPassErr(''); setErrorDef(null) }}
                      onBlur={() => { setPassTouched(true); setPassErr(validatePassword(password)) }}
                      disabled={loading}
                      hasError={!!(passErr && passTouched)}
                    />
                    {passTouched && <span id="cn-pass-err"><FieldError msg={passErr} /></span>}
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="sc-btn"
                    style={{ marginTop: 6 }}
                  >
                    {loading ? (
                      <>
                        <span
                          className="sc-spin"
                          aria-hidden="true"
                          style={{
                            width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                            border: '2px solid rgba(255,255,255,0.28)', borderTopColor: '#fff',
                            display: 'inline-block',
                          }}
                        />
                        Autenticando…
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={15} strokeWidth={2} />
                        Acceder al Panel de Control
                        <ArrowRight size={15} strokeWidth={2} />
                      </>
                    )}
                  </button>

                  {/* Forgot */}
                  <div style={{ textAlign: 'center', marginTop: 4 }}>
                    <Link
                      to="/recuperar-contrasena"
                      style={{
                        fontSize: 13, fontWeight: 500,
                        color: 'rgba(0,54,61,0.40)',
                        textDecoration: 'none',
                        transition: 'color 140ms ease',
                      }}
                      onMouseOver={e => e.currentTarget.style.color = BW}
                      onMouseOut={e => e.currentTarget.style.color = 'rgba(0,54,61,0.40)'}
                    >
                      ¿Olvidaste tu contraseña?
                    </Link>
                  </div>
                </form>
              </>
            )}
          </div>

          {/* Link a Client */}
          <div
            style={{
              position: 'absolute', bottom: 24, left: 0, right: 0,
              textAlign: 'center', zIndex: 1,
            }}
          >
            <Link
              to="/login"
              style={{
                fontSize: 12, fontWeight: 500,
                color: 'rgba(0,54,61,0.30)',
                textDecoration: 'none',
                transition: 'color 140ms ease',
              }}
              onMouseOver={e => e.currentTarget.style.color = BW}
              onMouseOut={e => e.currentTarget.style.color = 'rgba(0,54,61,0.30)'}
            >
              ¿Eres admin de una empresa? Ir a Signum-Clock Client →
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
