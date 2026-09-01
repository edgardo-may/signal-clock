/**
 * LoginPage.jsx — Nueva Experiencia de Autenticación con diseño asimétrico
 * Colores: TailAdmin Gris Carbón / Slate e Indigo.
 */

import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { signIn } from '../services/authService'
import logoImg from '../../../assets/logo.png'
import {
  Eye, EyeOff, ShieldCheck, ShieldAlert,
  ShieldX, AlertTriangle, CheckCircle2, Lock, Mail,
  Clock, ArrowRight, Users, Activity, Fingerprint,
} from 'lucide-react'

const PASSWORD_MIN_LENGTH  = 8
const MAX_CLIENT_ATTEMPTS  = 5
const LOCKOUT_MS           = 30_000

const ERROR_MAP = [
  {
    match: /invalid login credentials/i,
    code:  'INVALID_CREDENTIALS',
    title: 'Credenciales inválidas',
    msg:   'El correo o la contraseña son incorrectos.',
    icon:  ShieldX,
    color: 'rose',
  },
  {
    match: /email not confirmed/i,
    code:  'EMAIL_NOT_CONFIRMED',
    title: 'Correo sin confirmar',
    msg:   'Revisa tu bandeja de entrada y confirma tu correo.',
    icon:  AlertTriangle,
    color: 'amber',
  },
  {
    match: /account.*(suspended|disabled|banned)|User account has been disabled|ACCOUNT_SUSPENDED/i,
    code:  'ACCOUNT_SUSPENDED',
    title: 'Cuenta suspendida',
    msg:   'Tu acceso fue suspendido por el administrador.',
    icon:  ShieldAlert,
    color: 'rose',
  },
  {
    match: /too many requests|rate.?limit|over_email_send_rate_limit/i,
    code:  'RATE_LIMITED',
    title: 'Demasiados intentos',
    msg:   'IP temporalmente restringida. Espera unos minutos.',
    icon:  ShieldAlert,
    color: 'amber',
  },
  {
    match: /network|fetch|failed to fetch|NetworkError/i,
    code:  'NETWORK_ERROR',
    title: 'Error de conexión',
    msg:   'No se pudo conectar. Verifica tu conexión a internet.',
    icon:  AlertTriangle,
    color: 'slate',
  },
]

const FALLBACK_ERROR = {
  code:  'UNKNOWN',
  title: 'Error de autenticación',
  msg:   'Ocurrió un problema inesperado. Inténtalo de nuevo.',
  icon:  ShieldX,
  color: 'rose',
}

function parseError(err) {
  const msg = err?.message ?? String(err ?? '')
  return ERROR_MAP.find(e => e.match.test(msg)) ?? { ...FALLBACK_ERROR, msg }
}

function AnalogClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const sec   = time.getSeconds()
  const min   = time.getMinutes() + sec / 60
  const hr    = (time.getHours() % 12) + min / 60

  const toXY = (angle, r) => ({
    x: 80 + r * Math.cos((angle - 90) * Math.PI / 180),
    y: 80 + r * Math.sin((angle - 90) * Math.PI / 180),
  })

  const secPos  = toXY(sec  * 6,  62)
  const minPos  = toXY(min  * 6,  52)
  const hrPos   = toXY(hr   * 30, 36)

  const hourMarks = Array.from({ length: 12 }, (_, i) => {
    const angle = i * 30
    const outer = toXY(angle, 70)
    const inner = toXY(angle, i % 3 === 0 ? 62 : 65)
    return { outer, inner, major: i % 3 === 0 }
  })

  return (
    <svg viewBox="0 0 160 160" className="w-52 h-52 lg:w-64 lg:h-64" aria-hidden="true">
      <circle cx="80" cy="80" r="76" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <circle cx="80" cy="80" r="70" fill="rgba(15,23,42,0.60)" stroke="rgba(255,255,255,0.20)" strokeWidth="1" />
      {hourMarks.map(({ outer, inner, major }, i) => (
        <line
          key={i}
          x1={inner.x} y1={inner.y}
          x2={outer.x} y2={outer.y}
          stroke={major ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.30)'}
          strokeWidth={major ? 2 : 1}
          strokeLinecap="round"
        />
      ))}
      <line x1="80" y1="80" x2={hrPos.x} y2={hrPos.y} stroke="rgba(255,255,255,0.90)" strokeWidth="3" strokeLinecap="round" />
      <line x1="80" y1="80" x2={minPos.x} y2={minPos.y} stroke="rgba(255,255,255,0.80)" strokeWidth="2" strokeLinecap="round" />
      <line
        x1="80" y1="86"
        x2={secPos.x} y2={secPos.y}
        stroke="#2563EB"
        strokeWidth="1"
        strokeLinecap="round"
        style={{ transition: sec === 0 ? 'none' : 'all 0.3s cubic-bezier(0.23,1,0.32,1)' }}
      />
      <circle cx="80" cy="80" r="3" fill="#2563EB" />
      <circle cx="80" cy="80" r="1.5" fill="#2563EB" />
    </svg>
  )
}

const MOCK_EVENTS = [
  { name: 'Carlos M.',    type: 'Entrada',    time: '07:02', method: 'Huella',  color: '#10b981' },
  { name: 'Ana R.',       type: 'Entrada',    time: '07:14', method: 'Rostro',  color: '#10b981' },
  { name: 'Luis V.',      type: 'Retardo',    time: '08:06', method: 'Tarjeta', color: '#f59e0b' },
]

const HOUR_BARS = [
  { h: '06', v: 0.2 }, { h: '07', v: 0.85 }, { h: '08', v: 0.95 },
  { h: '09', v: 0.45 }, { h: '10', v: 0.30 }, { h: '11', v: 0.20 },
  { h: '12', v: 0.15 }, { h: '13', v: 0.25 }, { h: '14', v: 0.75 },
]

function TerminalPanel() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-MX', {
    weekday: 'long', day: '2-digit', month: 'long',
  })

  return (
    <div
      className="hidden lg:flex flex-col relative overflow-hidden"
      style={{
        width: '55%',
        minHeight: '100vh',
        backgroundColor: '#2563EB',
        background: 'linear-gradient(160deg, #2563EB 0%, #0f172a 100%)',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="relative flex flex-col h-full p-10 xl:p-14">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <img src={logoImg} className="h-10 w-10 rounded-xl object-cover bg-white p-1" alt="Logo" />
          <div>
            <h1 className="text-sm font-bold tracking-[0.18em] text-white m-0">
              SIGNUM<span className="text-blue-400">·</span>CLOCK
            </h1>
            <p className="text-[11px] font-medium text-slate-400">
              Control de Asistencia
            </p>
          </div>
        </div>

        {/* Reloj */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 -mt-8">
          <div className="relative">
            <AnalogClock />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium capitalize text-slate-300">
              {dateStr}
            </p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-semibold text-slate-200">
                Sistema en línea
              </span>
            </div>
          </div>

          <div className="flex gap-6">
            {[
              { label: 'Empleados',   value: '48',  icon: Users },
              { label: 'Marcajes',    value: '124', icon: Activity },
              { label: 'Biométricos', value: '6',   icon: Fingerprint },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="text-center text-slate-300">
                <Icon className="w-4 h-4 mx-auto mb-1 text-slate-400" strokeWidth={1.5} />
                <p className="text-xl font-bold tabular-nums">{value}</p>
                <p className="text-[10px] font-medium text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actividad Horaria */}
        <div className="rounded-xl p-4 bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-slate-500">
            Actividad del día
          </p>
          <div className="flex items-end gap-1.5 h-12">
            {HOUR_BARS.map(({ h, v }) => (
              <div key={h} className="flex flex-col items-center gap-1 flex-1">
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${v * 100}%`,
                    minHeight: '3px',
                    backgroundColor: v > 0.7 ? '#2563EB' : 'rgba(255,255,255,0.20)',
                  }}
                />
                <span className="text-[8px] font-medium text-slate-600">{h}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {MOCK_EVENTS.map((ev, i) => (
              <div key={i} className="flex items-center justify-between text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
                  <span className="text-[11px] font-medium">{ev.name}</span>
                  <span className="text-[10px] text-slate-500">{ev.type}</span>
                </div>
                <span className="text-[10px] font-mono">{ev.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const location = useLocation()

  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [showPass,      setShowPass]      = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [errorDef,      setErrorDef]      = useState(null)
  const [fieldError,    setFieldError]    = useState(null)
  const [loginOk,       setLoginOk]       = useState(false)
  const [attempts,      setAttempts]      = useState(0)
  const [lockedUntil,   setLockedUntil]   = useState(null)
  const [lockCountdown, setLockCountdown] = useState(0)
  const [showFocused,   setShowFocused]   = useState(null)
  const [sessionReason, setSessionReason] = useState(null)

  useEffect(() => {
    const reason = location.state?.reason
    if (reason === 'inactivity') setSessionReason('inactivity')
    else if (reason === 'other_tab') setSessionReason('other_tab')
    else if (reason === 'token_expired') setSessionReason('token_expired')
  }, [location.state])

  useEffect(() => {
    if (!lockedUntil) return
    const tick = () => {
      const rem = Math.max(0, lockedUntil - Date.now())
      setLockCountdown(Math.ceil(rem / 1000))
      if (rem <= 0) {
        setLockedUntil(null)
        setAttempts(0)
        setErrorDef(null)
      }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [lockedUntil])

  const isLocked = lockedUntil && Date.now() < lockedUntil

  function validate() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Ingresa un correo válido.'
    if (!password || password.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
    return null
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setErrorDef(null)
    setFieldError(null)
    if (isLocked) return

    const validErr = validate()
    if (validErr) { setFieldError(validErr); return }

    setLoading(true)
    try {
      const { data, error } = await signIn(email, password)
      if (error) throw error

      if (data?.user) {
        setLoginOk(true)
        setAttempts(0)
      }
    } catch (err) {
      const newAttempts = attempts + 1
      setAttempts(newAttempts)
      const def = parseError(err)
      setErrorDef(def)

      if (newAttempts >= MAX_CLIENT_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS)
        setErrorDef({
          ...parseError({ message: 'too many requests' }),
          title: 'Cuenta bloqueada temporalmente',
          msg: `Demasiados intentos. Espera ${LOCKOUT_MS / 1000} segundos.`,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <TerminalPanel />
      <div className="flex flex-1 flex-col items-center justify-center px-6 sm:px-10 lg:px-16 bg-slate-100 relative">
        <div className="w-full max-w-sm">
          {sessionReason && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl mb-6 bg-amber-50 border border-amber-200 text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">Sesión expirada</p>
                <p className="text-xs mt-0.5">Por inactividad o cambio de pestaña. Inicia sesión nuevamente.</p>
              </div>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-2xl font-extrabold text-slate-900">Inicia sesión</h2>
            <p className="text-sm mt-1.5 text-slate-500">Ingresa tus credenciales de administrador</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-[11px] font-bold uppercase tracking-widest text-slate-700">
                Correo electrónico
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2">
                  <Mail className={`w-4 h-4 ${showFocused === 'email' ? 'text-blue-600' : 'text-slate-400'}`} />
                </span>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setFieldError(null); setErrorDef(null) }}
                  placeholder="admin@empresa.com"
                  disabled={loading || isLocked || loginOk}
                  onFocus={() => setShowFocused('email')}
                  onBlur={() => setShowFocused(null)}
                  className="w-full pl-10 pr-4 py-3 text-[13px] rounded-xl outline-none border border-slate-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white text-slate-950"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-[11px] font-bold uppercase tracking-widest text-slate-700">
                Contraseña
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2">
                  <Lock className={`w-4 h-4 ${showFocused === 'password' ? 'text-blue-600' : 'text-slate-400'}`} />
                </span>
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setFieldError(null); setErrorDef(null) }}
                  placeholder="••••••••"
                  disabled={loading || isLocked || loginOk}
                  onFocus={() => setShowFocused('password')}
                  onBlur={() => setShowFocused(null)}
                  className="w-full pl-10 pr-11 py-3 text-[13px] rounded-xl outline-none border border-slate-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white text-slate-950"
                />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {fieldError && (
              <div className="p-2.5 rounded-lg text-[12px] bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                {fieldError}
              </div>
            )}

            {errorDef && !isLocked && (
              <div className="p-3 rounded-lg text-[12px] bg-rose-50 border border-rose-200 text-rose-700">
                <p className="font-semibold">{errorDef.title}</p>
                <p className="mt-0.5 opacity-90">{errorDef.msg}</p>
              </div>
            )}

            {isLocked && (
              <div className="p-2.5 rounded-lg text-[12px] bg-amber-50 border border-amber-200 text-amber-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                Inténtalo de nuevo en {lockCountdown}s
              </div>
            )}

            <button
              type="submit"
              disabled={loading || isLocked || loginOk}
              className="w-full py-3.5 px-4 rounded-xl font-semibold text-[13px] text-white bg-blue-600 hover:bg-blue-700 transition-all duration-200 active:scale-[0.98] disabled:opacity-60 shadow-md shadow-blue-600/30"
            >
              {loginOk ? 'Acceso concedido' : loading ? 'Autenticando...' : 'Iniciar sesión'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}



