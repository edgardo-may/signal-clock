import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

export default function CreateCompanyUserDialog({ tenants, initialTenantId, onClose, onCreated }) {
  const dialog = useRef(null)
  const submitting = useRef(false)
  const [form, setForm] = useState({ cliente_id: initialTenantId || '', nombre: '', email: '', rol: 'admin', password: '' })
  const [saving, setSaving] = useState(false)
  const [visible, setVisible] = useState(false)
  const [created, setCreated] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current.showModal() }, [])
  const update = (event) => setForm(previous => ({ ...previous, [event.target.name]: event.target.value }))
  const company = tenants.find(tenant => tenant.id === form.cliente_id)
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600'

  async function submit(event) {
    event.preventDefault()
    if (submitting.current || created) return
    if (!company) { setError('Selecciona una empresa válida.'); return }
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session?.access_token) throw new Error('Tu sesión ha expirado. Inicia sesión nuevamente.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ ...form, nombre: form.nombre.trim(), email: form.email.trim().toLowerCase(), estatus_cuenta: 'activo' }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo crear el usuario.')
      setCreated(true)
      setVisible(false)
      onCreated()
      toast.success('Usuario creado en ' + company.nombre_empresa)
    } catch (err) {
      setError(err.message || 'No se pudo crear el usuario.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialog} onCancel={event => { if (saving) event.preventDefault(); else onClose() }} onClose={onClose}
      aria-labelledby="create-company-user-title"
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 backdrop:bg-slate-950/60">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 id="create-company-user-title" className="text-xl font-bold">{created ? 'Primer acceso listo' : 'Crear usuario de empresa'}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{created ? 'Entrega estos datos al responsable de la empresa.' : 'Selecciona la empresa que recibirá este acceso.'}</p>
        </div>
        <button type="button" disabled={saving} aria-label="Cerrar" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"><X className="w-5 h-5" /></button>
      </div>
      {created ? (
        <div className="space-y-4">
          <dl className="space-y-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-4 text-sm">
            <div><dt className="text-slate-500">Empresa</dt><dd className="font-semibold">{company?.nombre_empresa}</dd></div>
            <div><dt className="text-slate-500">Usuario</dt><dd>{form.nombre}</dd></div>
            <div><dt className="text-slate-500">Correo de acceso</dt><dd className="break-all">{form.email.trim().toLowerCase()}</dd></div>
            <div><dt className="text-slate-500">Rol</dt><dd>{form.rol === 'admin' ? 'Administrador' : 'Auditor'}</dd></div>
          </dl>
          <label className="block text-sm font-medium">Contraseña inicial
            <div className="flex items-center gap-2"><input readOnly type={visible ? 'text' : 'password'} value={form.password} className={inputClass} />
              <button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVisible(!visible)} className="p-2">{visible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div>
          </label>
          <p className="text-xs text-slate-500">La cuenta está activa. No se envía correo automático; comparte la contraseña por un canal privado. No se guardará en esta pantalla al cerrarla.</p>
          <button type="button" onClick={onClose} className="w-full rounded-xl bg-[#03363D] text-white py-2.5 font-semibold">Listo</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">Empresa
            <select name="cliente_id" required value={form.cliente_id} onChange={update} disabled={saving} className={inputClass}>
              <option value="">Selecciona una empresa</option>
              {tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.nombre_empresa}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Nombre completo<input name="nombre" required autoComplete="name" value={form.nombre} onChange={update} disabled={saving} className={inputClass} /></label>
          <label className="block text-sm font-medium">Correo de acceso<input name="email" type="email" required autoComplete="email" value={form.email} onChange={update} disabled={saving} className={inputClass} /></label>
          <label className="block text-sm font-medium">Rol<select name="rol" value={form.rol} onChange={update} disabled={saving} className={inputClass}><option value="admin">Administrador de empresa</option><option value="auditor">Auditor</option></select></label>
          <label className="block text-sm font-medium">Contraseña inicial
            <div className="flex items-center gap-2"><input name="password" type={visible ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={form.password} onChange={update} disabled={saving} className={inputClass} />
              <button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVisible(!visible)} className="p-2">{visible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div>
          </label>
          <p className="text-xs text-slate-500">Mínimo 8 caracteres. La cuenta se crea activa sin cerrar tu sesión central.</p>
          {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-3 pt-2"><button type="button" disabled={saving} onClick={onClose} className="px-4 py-2 text-sm">Cancelar</button><button type="submit" disabled={saving} className="rounded-xl bg-[#03363D] text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{saving ? 'Creando…' : 'Crear acceso'}</button></div>
        </form>
      )}
    </dialog>
  )
}
