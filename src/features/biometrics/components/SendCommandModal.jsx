// src/features/biometrics/components/SendCommandModal.jsx
import { useState, useEffect } from 'react'
import {
  X,
  Terminal,
  Send,
  Cpu,
  RefreshCw,
  Clock,
  Info,
  Trash2,
  Radio,
} from 'lucide-react'

const COMMAND_TEMPLATES = [
  { label: 'Reiniciar Dispositivo (REBOOT)', command: 'REBOOT', desc: 'Reinicia el hardware de la terminal de forma remota' },
  { label: 'Sincronizar Hora (SYNC_TIME)', command: 'SYNC_TIME', desc: 'Envía la hora actual del servidor a la terminal' },
  { label: 'Obtener Información (GET_DEVICE_INFO)', command: 'GET_DEVICE_INFO', desc: 'Solicita versión de firmware, capacidad y almacenamiento' },
  { label: 'Borrar Logs en Terminal (CLEAR_LOGS)', command: 'CLEAR_ATTENDANCE_LOGS', desc: 'Limpia los registros antiguos almacenados localmente' },
  { label: 'Probar Conectividad (PING)', command: 'PING', desc: 'Envía un eco para verificar si el socket ISUP responde' },
]

export default function SendCommandModal({
  initialData = {},
  devicesCatalog = [],
  onClose,
  onSend,
}) {
  const [deviceSerial, setDeviceSerial] = useState(initialData?.device_serial || '')
  const [commandString, setCommandString] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initialData?.device_serial) {
      setDeviceSerial(initialData.device_serial)
    } else if (devicesCatalog.length > 0 && !deviceSerial) {
      setDeviceSerial(devicesCatalog[0].serial_number)
    }
  }, [initialData, devicesCatalog])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!deviceSerial.trim()) {
      setError('Debes seleccionar un dispositivo destino.')
      return
    }
    if (!commandString.trim()) {
      setError('Debes ingresar o seleccionar una instrucción de comando.')
      return
    }

    setSubmitting(true)
    try {
      await onSend({
        device_serial: deviceSerial.trim(),
        command_string: commandString.trim(),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Emitir Comando Remoto
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Instrucción para la tabla <code className="font-mono">device_commands</code>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs">
              {error}
            </div>
          )}

          {/* Dispositivo Destino */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-500" />
              Dispositivo Destino (Serial Number) *
            </label>
            {devicesCatalog.length > 0 ? (
              <select
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="">Selecciona una terminal...</option>
                {devicesCatalog.map((d) => (
                  <option key={d.serial_number} value={d.serial_number}>
                    {d.name || d.serial_number} — SN: {d.serial_number} {d.location ? `(${d.location})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
                placeholder="Ingresa el número de serie de la terminal"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white font-mono outline-none focus:border-amber-500"
              />
            )}
          </div>

          {/* Plantillas de Comando Rápidas */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Plantillas Predefinidas
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {COMMAND_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.command}
                  type="button"
                  onClick={() => setCommandString(tmpl.command)}
                  className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    commandString === tmpl.command
                      ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    {tmpl.label}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {tmpl.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Input Comando Personalizado */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Instrucción / Comando String *
            </label>
            <input
              type="text"
              value={commandString}
              onChange={(e) => setCommandString(e.target.value)}
              placeholder="Ej: REBOOT o instrucción personalizada"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white font-mono outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
            />
          </div>

          {/* Footer Botones */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-md shadow-amber-600/25 transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? 'Enviando...' : 'Enviar a la Cola'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
