// src/central/pages/CentralUsersPage.jsx — Gestión Global de Usuarios en Signum-Clock Central
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import CentralLayout from '../components/CentralLayout'
import { useConfirm } from '../../shared/hooks/useConfirm'
import {
  Users, UserPlus, Search, Filter, RefreshCw,
  Edit3, Trash2, X, Save, CheckCircle2, XCircle,
  Shield, Building2, Mail, Lock, UserCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'

export default function CentralUsersPage() {
  const [usuarios, setUsuarios] = useState([])
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTenant, setFilterTenant] = useState('todos')
  const [filterRol, setFilterRol] = useState('todos')

  const [modalForm, setModalForm] = useState(null)
  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [
        { data: usersData, error: usersErr },
        { data: tenantsData, error: tenantsErr }
      ] = await Promise.all([
        supabase
          .from('usuarios_perfiles')
          .select('*, clientes(nombre_empresa, plan_suscripcion)')
          .order('creado_at', { ascending: false }),
        supabase
          .from('clientes')
          .select('id, nombre_empresa')
          .order('nombre_empresa', { ascending: true })
      ])

      if (usersErr) throw usersErr
      if (tenantsErr) throw tenantsErr

      setUsuarios(usersData || [])
      setTenants(tenantsData || [])
    } catch (err) {
      console.error('[CentralUsersPage] Error:', err)
      toast.error('Error al cargar usuarios: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredUsuarios = useMemo(() => {
    return usuarios.filter(u => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        u.nombre?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.clientes?.nombre_empresa?.toLowerCase().includes(q)

      const matchTenant =
        filterTenant === 'todos' ||
        (filterTenant === 'superadmin' && !u.cliente_id) ||
        u.cliente_id === filterTenant

      const matchRol =
        filterRol === 'todos' || u.rol === filterRol

      return matchSearch && matchTenant && matchRol
    })
  }, [usuarios, search, filterTenant, filterRol])

  return (
    <CentralLayout>
      {ConfirmDialogNode}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Usuarios Globales
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              {usuarios.length} Usuarios Registrados
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-550 dark:text-slate-400 mt-1">
            Supervisión y control de accesos administrativos en todas las empresas
          </p>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all shadow-sm cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Refrescar</span>
        </button>
      </div>

      {/* Filtros */}
      <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o empresa..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filterTenant}
            onChange={(e) => setFilterTenant(e.target.value)}
            className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-350 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer transition-all"
          >
            <option value="todos">Todas las Empresas</option>
            <option value="superadmin">Plataforma Central (SuperAdmins)</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.nombre_empresa}</option>
            ))}
          </select>

          <select
            value={filterRol}
            onChange={(e) => setFilterRol(e.target.value)}
            className="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-350 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer transition-all"
          >
            <option value="todos">Todos los Roles</option>
            <option value="superadmin">SuperAdmin</option>
            <option value="admin">Administrador</option>
            <option value="rh">Recursos Humanos</option>
            <option value="supervisor">Supervisor</option>
            <option value="colaborador">Colaborador</option>
          </select>
        </div>
      </div>

      {/* Tabla de Usuarios */}
      <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <tr>
                <th className="px-5 py-3.5">Usuario</th>
                <th className="px-5 py-3.5">Rol</th>
                <th className="px-5 py-3.5">Empresa Asignada</th>
                <th className="px-5 py-3.5">Estatus Cuenta</th>
                <th className="px-5 py-3.5">Fecha Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando usuarios...
                  </td>
                </tr>
              ) : filteredUsuarios.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    No se encontraron usuarios con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredUsuarios.map((u) => {
                  const isSuper = u.rol?.toLowerCase() === 'superadmin' || (!u.cliente_id && u.rol === 'admin')

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                            isSuper ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20' : 'bg-blue-650/10 text-blue-650 dark:text-blue-400 border border-blue-500/20'
                          }`}>
                            {u.nombre?.[0]?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white text-sm">{u.nombre || 'Sin Nombre'}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{u.email || u.id}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                          isSuper 
                            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}>
                          {u.rol || 'colaborador'}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        {isSuper ? (
                          <span className="text-purple-600 dark:text-purple-450 font-semibold flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5" /> Signum-Clock Central
                          </span>
                        ) : u.clientes ? (
                          <span className="text-slate-900 dark:text-white font-semibold flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-450" /> {u.clientes.nombre_empresa}
                          </span>
                        ) : (
                          <span className="text-slate-450 dark:text-slate-500 italic">Sin empresa asignada</span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {u.estatus_cuenta || 'activo'}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {u.creado_at ? new Date(u.creado_at).toLocaleDateString('es-MX') : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </CentralLayout>
  )
}
