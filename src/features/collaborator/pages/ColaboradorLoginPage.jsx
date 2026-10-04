// src/features/collaborator/pages/ColaboradorLoginPage.jsx
// Login 100% Adaptable para Celulares, Tablets y Computadoras - Exclusivo para Colaboradores

import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import {
  Clock,
  KeyRound,
  Building2,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Camera,
  MapPin,
  Delete,
  AlertCircle,
  Smartphone,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getEmpresasDisponibles,
  loginColaborador,
  getLastTenantId,
  hasActiveCollaboratorSession,
} from '../services/collaboratorAuthService'

export default function ColaboradorLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()

  // Estados del formulario
  const [empresas, setEmpresas] = useState([])
  const [loadingEmpresas, setLoadingEmpresas] = useState(true)
  const [clienteId, setClienteId] = useState('')
  const [clave, setClave] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [useVirtualKeypad, setUseVirtualKeypad] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Redirigir de inmediato si ya hay sesión activa
  useEffect(() => {
    if (hasActiveCollaboratorSession()) {
      const from = location.state?.from?.pathname || '/portal-colaborador'
      navigate(from, { replace: true })
    }
  }, [navigate, location])

  // Cargar empresas disponibles
  useEffect(() => {
    let mounted = true
    async function load() {
      setLoadingEmpresas(true)
      const list = await getEmpresasDisponibles()
      if (!mounted) return
      setEmpresas(list)
      const lastId = getLastTenantId()
      if (lastId && list.some((e) => e.id === lastId)) {
        setClienteId(lastId)
      } else if (list.length === 1) {
        setClienteId(list[0].id)
      }
      setLoadingEmpresas(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  // Manejador del Teclado Numérico Virtual
  const handleKeypadPress = (digit) => {
    setErrorMsg('')
    if (pin.length < 8) {
      setPin((prev) => prev + digit)
    }
  }

  const handleKeypadBackspace = () => {
    setErrorMsg('')
    setPin((prev) => prev.slice(0, -1))
  }

  const handleKeypadClear = () => {
    setErrorMsg('')
    setPin('')
  }

  // Enviar Login
  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    setErrorMsg('')

    if (!clienteId) {
      setErrorMsg('Por favor selecciona tu empresa.')
      toast.error('Selecciona tu empresa')
      return
    }

    if (!clave.trim()) {
      setErrorMsg('Ingresa tu clave de colaborador.')
      toast.error('Ingresa tu clave de colaborador')
      return
    }

    if (!pin.trim()) {
      setErrorMsg('Ingresa tu PIN de seguridad (4 a 8 dígitos).')
      toast.error('Ingresa tu PIN')
      return
    }

    setSubmitting(true)
    const toastId = toast.loading('Verificando credenciales...')

    try {
      const result = await loginColaborador({
        clienteId,
        clave: clave.trim(),
        pin: pin.trim(),
      })

      if (!result.success) {
        toast.error(result.error || 'Credenciales inválidas', { id: toastId })
        setErrorMsg(result.error)
        setSubmitting(false)
        return
      }

      toast.success(`¡Bienvenido, ${result.session.nombre}!`, {
        id: toastId,
        icon: '👋',
      })

      const destination = location.state?.from?.pathname || '/portal-colaborador'
      navigate(destination, { replace: true })
    } catch (err) {
      toast.error('Error al iniciar sesión', { id: toastId })
      setErrorMsg('Error de conexión. Intente nuevamente.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9f9] dark:bg-[#0f172a] text-[#272c3d] dark:text-slate-100 flex flex-col justify-between selection:bg-[#03363D] selection:text-white px-4 py-6 sm:py-10">
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#03363D] flex items-center justify-center text-white shadow-sm">
            <Clock className="w-5 h-5 text-[#BDD9D7]" strokeWidth={2.2} />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-[#272c3d] dark:text-white block leading-tight">
              Signum Clock
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#03363D] dark:text-[#3fa9a1] block">
              Portal del Colaborador
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f2fbf9] dark:bg-slate-800 border border-[#bfe5e1] dark:border-slate-700 text-xs font-semibold text-[#3fa9a1] dark:text-[#5dd0c7]">
          <Smartphone className="w-3.5 h-3.5" />
          <span>Acceso Móvil</span>
        </div>
      </header>

      {/* ── Tarjeta Central de Login ───────────────────────────── */}
      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-[#eef1f1] dark:border-slate-800 p-6 sm:p-8 shadow-sm relative overflow-hidden">
          {/* Acento superior de marca */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#03363D]" />

          <div className="text-center mb-6 pt-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#f2fbf9] dark:bg-[#03363D]/30 border border-[#bfe5e1] dark:border-[#03363D]/60 text-[#3fa9a1] dark:text-[#5dd0c7] mb-3 shadow-sm">
              <KeyRound className="w-6 h-6" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#272c3d] dark:text-white tracking-tight">
              Ingreso de Colaboradores
            </h1>
            <p className="text-xs text-[#707485] dark:text-slate-400 mt-1">
              Fichaje de asistencia con verificación GPS y foto de referencia
            </p>
          </div>

          {errorMsg && (
            <div className="mb-5 flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 text-xs animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Empresa */}
            <div className="space-y-1.5">
              <label
                htmlFor="c-empresa"
                className="block text-xs font-semibold uppercase tracking-wider text-[#707485] dark:text-slate-400 flex items-center justify-between"
              >
                <span>Empresa / Sucursal</span>
                {loadingEmpresas && (
                  <span className="text-[10px] text-[#3fa9a1] animate-pulse">Cargando...</span>
                )}
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-[#707485] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  id="c-empresa"
                  value={clienteId}
                  onChange={(e) => {
                    setClienteId(e.target.value)
                    setErrorMsg('')
                  }}
                  disabled={loadingEmpresas || submitting}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-[#03363D] focus:ring-2 focus:ring-[#03363D]/10 text-[#272c3d] dark:text-white text-sm rounded-xl pl-10 pr-4 py-3 outline-none transition-all cursor-pointer disabled:opacity-50"
                >
                  <option value="">-- Selecciona tu Empresa --</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id} className="bg-white dark:bg-slate-900 text-[#272c3d] dark:text-white">
                      {emp.nombre_empresa}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 2. Clave de Colaborador */}
            <div className="space-y-1.5">
              <label
                htmlFor="c-clave"
                className="block text-xs font-semibold uppercase tracking-wider text-[#707485] dark:text-slate-400"
              >
                Clave o ID de Colaborador
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#707485] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="c-clave"
                  type="text"
                  value={clave}
                  onChange={(e) => {
                    setClave(e.target.value)
                    setErrorMsg('')
                  }}
                  placeholder="ej. EMP-001 o tu número de empleado"
                  disabled={submitting}
                  autoComplete="username"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-[#03363D] focus:ring-2 focus:ring-[#03363D]/10 text-[#272c3d] dark:text-white placeholder:text-slate-400 text-sm rounded-xl pl-10 pr-4 py-3 outline-none transition-all uppercase"
                />
              </div>
            </div>

            {/* 3. PIN de Acceso */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="c-pin"
                  className="block text-xs font-semibold uppercase tracking-wider text-[#707485] dark:text-slate-400"
                >
                  PIN de Ingreso (4 a 8 dígitos)
                </label>
                <button
                  type="button"
                  onClick={() => setUseVirtualKeypad(!useVirtualKeypad)}
                  className="text-[11px] text-[#03363D] dark:text-[#5dd0c7] hover:underline font-semibold"
                >
                  {useVirtualKeypad ? '⌨️ Usar teclado normal' : '📱 Teclado táctil'}
                </button>
              </div>

              <div className="relative">
                <KeyRound className="w-4 h-4 text-[#707485] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="c-pin"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => {
                    const onlyNums = e.target.value.replace(/\D/g, '')
                    setPin(onlyNums)
                    setErrorMsg('')
                  }}
                  placeholder="••••"
                  disabled={submitting}
                  autoComplete="current-password"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-[#03363D] focus:ring-2 focus:ring-[#03363D]/10 text-[#272c3d] dark:text-white placeholder:text-slate-400 text-base font-mono tracking-widest rounded-xl pl-10 pr-12 py-3 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#272c3d] dark:hover:text-white transition-colors p-1"
                  title={showPin ? 'Ocultar PIN' : 'Ver PIN'}
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Teclado Virtual para Móvil/Tablet */}
            {useVirtualKeypad && (
              <div className="pt-2 animate-fadeIn">
                <div className="grid grid-cols-3 gap-2 bg-[#f8f9f9] dark:bg-slate-900/60 p-3 rounded-2xl border border-[#eef1f1] dark:border-slate-800">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handleKeypadPress(digit)}
                      className="h-12 rounded-xl bg-white dark:bg-slate-800 hover:bg-[#f2fbf9] dark:hover:bg-slate-700 active:scale-95 text-lg font-bold text-[#272c3d] dark:text-white transition-all shadow-sm flex items-center justify-center cursor-pointer border border-slate-200 dark:border-slate-700"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleKeypadClear}
                    className="h-12 rounded-xl bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 text-xs font-bold text-rose-600 dark:text-rose-400 transition-all flex items-center justify-center cursor-pointer border border-rose-200 dark:border-rose-900/40"
                  >
                    Borrar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadPress('0')}
                    className="h-12 rounded-xl bg-white dark:bg-slate-800 hover:bg-[#f2fbf9] dark:hover:bg-slate-700 active:scale-95 text-lg font-bold text-[#272c3d] dark:text-white transition-all shadow-sm flex items-center justify-center cursor-pointer border border-slate-200 dark:border-slate-700"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleKeypadBackspace}
                    className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-[#707485] dark:text-slate-300 transition-all flex items-center justify-center cursor-pointer border border-slate-200 dark:border-slate-700"
                    title="Retroceso"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Botón Ingresar */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 px-4 rounded-xl bg-[#03363D] hover:bg-[#004D57] active:scale-[0.98] text-white font-bold text-sm tracking-wide shadow-sm shadow-[#03363D]/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verificando PIN...</span>
                  </>
                ) : (
                  <>
                    <span>Ingresar al Portal</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#f2fbf9] dark:bg-slate-800/80 border border-[#bfe5e1] dark:border-slate-700 text-[#3fa9a1] dark:text-[#5dd0c7] font-medium">
              <Camera className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Foto de referencia</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#f2fbf9] dark:bg-slate-800/80 border border-[#bfe5e1] dark:border-slate-700 text-[#3fa9a1] dark:text-[#5dd0c7] font-medium">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">GPS obligatorio</span>
            </div>
          </div>
        </div>

        <div className="text-center mt-5">
          <p className="text-xs text-[#707485] dark:text-slate-400">
            ¿Eres administrador de la empresa?{' '}
            <Link to="/login" className="text-[#03363D] hover:text-[#004D57] dark:text-[#5dd0c7] hover:underline font-semibold">
              Iniciar sesión aquí
            </Link>
          </p>
        </div>
      </main>

      <footer className="max-w-md w-full mx-auto text-center text-xs text-[#707485] dark:text-slate-500">
        <p>© {new Date().getFullYear()} Signum Clock · Sistema de Control de Asistencia</p>
      </footer>
    </div>
  )
}
