import { useCallback, useEffect, useRef, useState } from 'react'
import { deviceRegistrationService } from '../services/deviceRegistrationService'
import toast from 'react-hot-toast'
import DeviceFormModal from './DeviceFormModal'

const labels = { PENDING: 'Pendiente de autorización', APPROVED: 'Aprobada', REJECTED: 'Rechazada', CANCELLED: 'Cancelada' }
const input = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm'
const primary = 'rounded-lg bg-[#03363D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600'
const secondary = 'rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm disabled:opacity-50'
const emptyForm = () => ({ name: '', serial_number: '', protocol: 'ZKTECO_ADMS', timezone: 'America/Cancun', location: '', device_type: 'general', request_reason: '' })

// Intent: tenant admin tracks a request; Central resolves it. Authorization leads;
// connection is deliberately absent until an operational association exists.
// Existing Signum palette, border surfaces, 4px spacing and native modal semantics.
export default function DeviceRegistrationRequests({ central, tenantId, canRequest, openRequest, onRequestOpened }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [reason, setReason] = useState('')
  const dialog = useRef(null)
  const loadSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true); setError('')
    setRows([])
    try {
      if (!central && !tenantId) { setRows([]); return }
      const result = await deviceRegistrationService.list(central ? null : tenantId)
      if (sequence === loadSequence.current) setRows(result || [])
    } catch (e) { if (sequence === loadSequence.current) setError(e.message || 'No se pudieron cargar las solicitudes.') }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [central, tenantId])
  useEffect(() => { load(); return () => { ++loadSequence.current } }, [load])
  useEffect(() => {
    if (openRequest && canRequest && tenantId) {
      setForm(emptyForm()); setReason(''); setModal({ kind: 'create' }); onRequestOpened?.()
    }
  }, [openRequest, canRequest, tenantId, onRequestOpened])
  useEffect(() => {
    if (modal && modal.kind !== 'create' && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [modal])
  // Switching tenant closes any pending intent; it cannot silently target another company.
  useEffect(() => { setModal(null); dialog.current?.close() }, [tenantId])
  const close = () => { if (!busy) { dialog.current?.close(); setModal(null); setReason('') } }
  const act = (row, kind) => { setReason(''); setModal({ row, kind }) }
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (modal.kind === 'create') await deviceRegistrationService.request(form, tenantId)
      else if (modal.kind === 'cancel') await deviceRegistrationService.cancel(modal.row.id, reason)
      else await deviceRegistrationService.resolve(modal.row.id, modal.kind === 'approve' ? 'APPROVED' : 'REJECTED', reason)
      toast.success(modal.kind === 'create' ? 'Solicitud enviada a Central. El equipo aún no está habilitado.' : 'Solicitud actualizada.')
      dialog.current?.close(); setModal(null); await load()
    } catch (e) { toast.error(e.message || 'No se pudo completar la operación.') }
    finally { setBusy(false) }
  }
  const date = value => value ? new Date(value).toLocaleString('es-MX', { timeZone: 'America/Cancun' }) : '—'
  const saveRequest = async values => {
    await deviceRegistrationService.request(values, tenantId)
    toast.success('Solicitud enviada a Central. El equipo aún no está habilitado.')
    setModal(null)
    await load()
  }
  return <section className="space-y-4 text-slate-900 dark:text-slate-100" aria-label="Solicitudes de biométricos">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold">{central ? 'Autorización de biométricos' : 'Mis solicitudes de biométricos'}</h2>
        <p className="text-sm text-slate-500">{central ? 'Revisa la empresa y el número de serie antes de autorizar la asociación.' : 'Central debe aprobar la asociación antes de habilitar el equipo.'}</p></div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950">{error}</p>}
    {loading ? <p role="status">Cargando solicitudes…</p> : !error && !rows.length ? <p className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-sm text-slate-500">Todavía no hay solicitudes de biométricos.</p> : !error && <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-left text-sm">
      <thead className="bg-slate-50 dark:bg-slate-800"><tr>{[...(central ? ['Empresa'] : []), 'Equipo / serie', 'Autorización', 'Solicitante / fecha', 'Resolución', 'Acciones'].map(title => <th key={title} className="p-3 font-medium">{title}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
        {central && <td className="p-3">{row.clientes?.nombre_empresa || row.cliente_id}</td>}
        <td className="p-3"><p className="font-medium">{row.name}</p><p className="font-mono text-xs text-slate-500">{row.serial_number}</p></td>
        <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${row.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : row.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{labels[row.status] || row.status}</span></td>
        <td className="p-3">{row.requester?.nombre || row.requested_by}<p className="text-xs text-slate-500">{date(row.requested_at)}</p></td>
        <td className="p-3">{row.resolver?.nombre || row.resolved_by || '—'}<p className="text-xs text-slate-500">{date(row.resolved_at)}</p>{row.reason && <p className="max-w-xs break-words text-xs">{row.reason}</p>}</td>
        <td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => act(row, 'detail')}>Detalle</button>
          {row.status === 'PENDING' && central && <><button type="button" className={primary} onClick={() => act(row, 'approve')}>Aprobar</button><button type="button" className={secondary} onClick={() => act(row, 'reject')}>Rechazar</button></>}
          {row.status === 'PENDING' && !central && canRequest && <button type="button" className={secondary} onClick={() => act(row, 'cancel')}>Cancelar solicitud</button>}
        </div></td>
      </tr>)}</tbody></table></div>}
    {modal?.kind === 'create' && <DeviceFormModal requestMode device="nuevo" onClose={() => setModal(null)} onSave={saveRequest} />}
    {modal && modal.kind !== 'create' && <dialog ref={dialog} aria-labelledby="device-request-title" onCancel={event => { event.preventDefault(); close() }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:border-slate-800 dark:bg-slate-900 dark:text-white">
      <form onSubmit={submit} className="space-y-4">
        <h3 id="device-request-title" className="text-lg font-semibold">{{ create: 'Solicitar biométrico', detail: 'Detalle de solicitud', approve: 'Confirmar aprobación', reject: 'Rechazar solicitud', cancel: 'Cancelar solicitud' }[modal.kind]}</h3>
        {modal.kind === 'create' ? <>
          <label className="block text-sm">Nombre<input autoFocus required maxLength={120} className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block text-sm">Número de serie<input required maxLength={50} pattern="[A-Za-z0-9_-]+" className={input} value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} /></label>
          <label className="block text-sm">Protocolo<select className={input} value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })}><option value="ZKTECO_ADMS">ZKTeco ADMS</option><option value="HIKVISION_ISUP">Hikvision ISUP</option></select></label>
          <label className="block text-sm">Ubicación<input maxLength={240} className={input} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></label>
          <label className="block text-sm">Motivo de la solicitud<textarea maxLength={1000} className={input} value={form.request_reason} onChange={e => setForm({ ...form, request_reason: e.target.value })} /></label>
          <label className="block text-sm">Zona horaria<select className={input} value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}><option>America/Cancun</option><option>America/Mexico_City</option><option>America/Tijuana</option><option>America/Hermosillo</option><option>UTC</option></select></label>
          <p className="text-xs text-slate-500">Enviar la solicitud no activa el equipo ni genera comandos. La conexión física se verifica después de la autorización.</p>
        </> : <>
          <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Empresa</dt><dd>{modal.row.clientes?.nombre_empresa || modal.row.cliente_id}</dd><dt>Equipo</dt><dd>{modal.row.name}</dd><dt>Serie</dt><dd className="break-all font-mono">{modal.row.serial_number}</dd><dt>Protocolo</dt><dd>{modal.row.protocol}</dd><dt>Zona horaria</dt><dd>{modal.row.timezone}</dd><dt>Ubicación</dt><dd>{modal.row.location || '—'}</dd><dt>Autorización</dt><dd>{labels[modal.row.status]}</dd><dt>Asociación operativa</dt><dd className="break-all">{modal.row.device_id || 'Todavía no creada'}</dd></dl>
          {modal.kind === 'approve' && <p className="text-sm">Se autorizará la asociación con esta empresa. Esto no confirma que el checador esté conectado.</p>}
          <p className="text-sm">Propósito: {{ general: 'Entradas y Salidas', entrada: 'Solo Entradas', salida: 'Solo Salidas', comedor: 'Comedor', rh: 'RH / Enrolamiento', acceso: 'Control de Acceso' }[modal.row.device_type] || modal.row.device_type}</p>
          {modal.row.request_reason && <p className="text-sm break-words">Motivo de la solicitud: {modal.row.request_reason}</p>}
          {modal.kind !== 'detail' && <label className="block text-sm">Motivo{modal.kind === 'reject' ? ' (obligatorio)' : ' (opcional)'}<textarea required={modal.kind === 'reject'} maxLength={1000} className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>}
        </>}
        <div className="flex justify-end gap-2"><button type="button" className={secondary} disabled={busy} onClick={close}>Cerrar</button>{modal.kind !== 'detail' && <button type="submit" className={primary} disabled={busy}>{busy ? 'Guardando…' : modal.kind === 'create' ? 'Enviar solicitud' : 'Confirmar'}</button>}</div>
      </form>
    </dialog>}
  </section>
}
