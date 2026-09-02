import React, { useState, useEffect } from 'react'
import { syncService } from './syncService'
import { enrollmentService } from './enrollmentService'

export default function SyncDeviceCard({ clienteId }) {
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null)

  // Cargar dispositivos activos
  useEffect(() => {
    if (!clienteId) return
    enrollmentService.getActiveDevices(clienteId)
      .then(data => {
        setDevices(data)
        if (data.length > 0) setSelectedDevice(data[0].serial_number)
      })
      .catch(err => console.error('Error cargando checadores:', err))
  }, [clienteId])

  const handleSyncAll = async () => {
    const dev = devices.find(d => d.serial_number === selectedDevice)
    if (!dev) return

    setLoading(true)
    setStatusMsg({ type: 'info', text: 'Encolando comandos de sincronización...' })

    try {
      const res = await syncService.syncAllEmployeesToDevice({
        clienteId,
        deviceSerial: dev.serial_number,
        deviceId: dev.id
      })

      setStatusMsg({
        type: 'success',
        text: `¡Listo! Se encolaron ${res.total} colaboradores. El checador los descargará progresivamente en sus próximos heartbeats.`
      })
    } catch (err) {
      console.error(err)
      setStatusMsg({
        type: 'error',
        text: `Error al sincronizar: ${err.message || 'Error desconocido'}`
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-lg shadow-lg text-slate-100">
      <h3 className="text-lg font-semibold mb-2">Sincronizar Colaboradores con Checador</h3>
      <p className="text-sm text-slate-400 mb-4">
        Envía las altas y nombres de todos los colaboradores activos a la memoria interna del ZKTeco para permitir checadas y enrolamiento de huellas.
      </p>

      {/* Selector de Dispositivo */}
      <div className="mb-4">
        <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">
          Checador Destino
        </label>
        <select
          value={selectedDevice}
          onChange={e => setSelectedDevice(e.target.value)}
          disabled={loading || devices.length === 0}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {devices.map(d => (
            <option key={d.id} value={d.serial_number}>
              {d.nombre} ({d.serial_number})
            </option>
          ))}
        </select>
      </div>

      {/* Botón de Sincronización */}
      <button
        onClick={handleSyncAll}
        disabled={loading || !selectedDevice}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          loading
            ? 'bg-indigo-950 text-indigo-300 cursor-not-allowed border border-indigo-800'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow'
        }`}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4 text-indigo-300" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Sincronizando...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sincronizar Todos al Checador
          </>
        )}
      </button>

      {/* Notificaciones */}
      {statusMsg && (
        <div
          className={`mt-4 p-3 rounded-lg text-xs border ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
              : statusMsg.type === 'error'
              ? 'bg-rose-950/50 border-rose-800 text-rose-300'
              : 'bg-slate-800 border-slate-700 text-slate-300'
          }`}
        >
          {statusMsg.text}
        </div>
      )}
    </div>
  )
}
