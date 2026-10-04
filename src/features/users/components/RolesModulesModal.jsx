/**
 * RolesModulesModal.jsx
 * Signum-Clock · Gestor de Roles y Permisos de Módulos
 *
 * Permite a los administradores:
 *  - Ver roles disponibles y cantidad de colaboradores asignados.
 *  - Configurar qué módulos del catálogo puede visualizar cada rol.
 *  - Crear nuevos roles personalizados con colores y módulos específicos.
 *  - Eliminar roles personalizados no requeridos.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Shield,
  ShieldCheck,
  Plus,
  Trash2,
  Check,
  X,
  AlertTriangle,
  Info,
  Layers,
  Sparkles,
  CheckSquare,
  Square,
  Lock,
} from 'lucide-react'
import Spinner from '../../../shared/components/ui/Spinner'
import toast from 'react-hot-toast'
import { TENANT_MODULES } from '../../../shared/auth/permissions'
import {
  getTenantRoles,
  saveCustomRole,
  deleteCustomRole,
  getRoleModuleKeys,
  saveRoleModules,
  ROLE_THEMES,
} from '../../../shared/auth/rolesManager'

export default function RolesModulesModal({
  isOpen,
  onClose,
  clienteId,
  usuarios = [],
  onRolesChanged,
  supabaseClient,
}) {
  // Lista de roles cargados
  const [roles, setRoles] = useState([])
  const [selectedRoleKey, setSelectedRoleKey] = useState('ADMIN')
  const [roleModules, setRoleModules] = useState([])
  const [savingModules, setSavingModules] = useState(false)

  // Sub-modal / vista: Crear nuevo rol
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaClave, setNuevaClave] = useState('')
  const [nuevaDesc, setNuevaDesc] = useState('')
  const [nuevoTema, setNuevoTema] = useState('indigo')
  const [nuevosModulos, setNuevosModulos] = useState([
    'dashboard',
    'attendance',
  ])
  const [creandoRol, setCreandoRol] = useState(false)

  // Sub-modal: Confirmar eliminación de rol
  const [roleToDelete, setRoleToDelete] = useState(null)
  const [deletingRole, setDeletingRole] = useState(false)

  // Cargar roles del tenant
  const refrescarRoles = () => {
    const list = getTenantRoles(clienteId)
    setRoles(list)
    if (!list.some((r) => r.key === selectedRoleKey) && list.length > 0) {
      setSelectedRoleKey(list[0].key)
    }
  }

  useEffect(() => {
    if (isOpen) {
      refrescarRoles()
    }
  }, [isOpen, clienteId])

  // Cargar los módulos asignados al rol seleccionado
  useEffect(() => {
    if (selectedRoleKey) {
      const keys = getRoleModuleKeys(selectedRoleKey, clienteId)
      setRoleModules(keys)
    }
  }, [selectedRoleKey, clienteId])

  // Rol activo seleccionado actualmente
  const activeRole = useMemo(() => {
    return roles.find((r) => r.key === selectedRoleKey) || roles[0] || null
  }, [roles, selectedRoleKey])

  // Conteo de usuarios por rol
  const userCountByRole = useMemo(() => {
    const map = {}
    usuarios.forEach((u) => {
      const k = String(u.rol || '').trim().toUpperCase()
      map[k] = (map[k] || 0) + 1
    })
    return map
  }, [usuarios])

  // Módulos agrupados por categoría
  const modulesByGroup = useMemo(() => {
    const groups = {}
    TENANT_MODULES.forEach((mod) => {
      const g = mod.group || 'Otros'
      if (!groups[g]) groups[g] = []
      groups[g].push(mod)
    })
    return groups
  }, [])

  // Alternar selección de un módulo
  const handleToggleModule = (moduleKey) => {
    setRoleModules((prev) => {
      if (prev.includes(moduleKey)) {
        return prev.filter((k) => k !== moduleKey)
      } else {
        return [...prev, moduleKey]
      }
    })
  }

  // Seleccionar todos los módulos
  const handleSelectAll = () => {
    setRoleModules(TENANT_MODULES.map((m) => m.key))
  }

  // Deseleccionar todos
  const handleDeselectAll = () => {
    setRoleModules([])
  }

  // Guardar configuración de módulos del rol
  const handleGuardarModulos = async () => {
    if (!activeRole) return
    setSavingModules(true)
    try {
      await saveRoleModules(clienteId, activeRole.key, roleModules, supabaseClient)
      toast.success(`Módulos actualizados para el rol "${activeRole.label}"`)
      refrescarRoles()
      if (onRolesChanged) onRolesChanged()
    } catch (err) {
      toast.error('Error al guardar módulos: ' + err.message)
    } finally {
      setSavingModules(false)
    }
  }

  // Crear nuevo rol
  const handleCrearRol = async (e) => {
    e.preventDefault()
    const cleanNombre = nuevoNombre.trim()
    const cleanClave = (nuevaClave || cleanNombre)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')

    if (!cleanNombre) {
      toast.error('El nombre del rol es obligatorio.')
      return
    }

    if (!cleanClave) {
      toast.error('La clave del rol es obligatoria.')
      return
    }

    if (roles.some((r) => r.key === cleanClave)) {
      toast.error(`Ya existe un rol con la clave "${cleanClave}".`)
      return
    }

    setCreandoRol(true)
    try {
      const nuevo = saveCustomRole(clienteId, {
        key: cleanClave,
        label: cleanNombre,
        desc: nuevaDesc.trim() || 'Rol personalizado con módulos a la medida.',
        theme: nuevoTema,
        defaultModules: nuevosModulos,
      })

      // Sincronizar módulos iniciales
      await saveRoleModules(clienteId, cleanClave, nuevosModulos, supabaseClient)

      toast.success(`¡Rol "${cleanNombre}" creado exitosamente!`)
      setShowCreateModal(false)
      setNuevoNombre('')
      setNuevaClave('')
      setNuevaDesc('')
      setNuevoTema('indigo')
      setNuevosModulos(['dashboard', 'attendance'])

      refrescarRoles()
      setSelectedRoleKey(cleanClave)
      if (onRolesChanged) onRolesChanged()
    } catch (err) {
      toast.error('Error al crear rol: ' + err.message)
    } finally {
      setCreandoRol(false)
    }
  }

  // Eliminar rol personalizado
  const handleConfirmarEliminarRol = async () => {
    if (!roleToDelete) return
    setDeletingRole(true)
    try {
      deleteCustomRole(clienteId, roleToDelete.key)
      toast.success(`Rol "${roleToDelete.label}" eliminado`)
      setRoleToDelete(null)
      refrescarRoles()
      if (selectedRoleKey === roleToDelete.key) {
        setSelectedRoleKey('ADMIN')
      }
      if (onRolesChanged) onRolesChanged()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeletingRole(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-5xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* ── Encabezado del Modal ──────────────────────────────── */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Gestión de Roles & Permisos de Módulos
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Define qué módulos del sistema puede visualizar cada rol y crea roles a la medida.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shadow-blue-500/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Rol</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Cuerpo Principal: 2 Columnas ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden">
          {/* Columna Izquierda: Lista de Roles (5 cols) */}
          <div className="lg:col-span-5 border-r border-slate-200 dark:border-slate-800 p-4 overflow-y-auto space-y-2 bg-slate-50/30 dark:bg-slate-900/30 max-h-[40vh] lg:max-h-none">
            <div className="flex items-center justify-between pb-1 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <span>Roles Registrados ({roles.length})</span>
              <span className="text-[10px] lowercase font-normal">haz clic para editar módulos</span>
            </div>

            {roles.map((role) => {
              const theme = ROLE_THEMES[role.theme] || ROLE_THEMES.blue
              const isSelected = selectedRoleKey === role.key
              const assignedCount = userCountByRole[role.key] || 0
              const roleModulesCount = getRoleModuleKeys(role.key, clienteId).length

              return (
                <div
                  key={role.key}
                  onClick={() => setSelectedRoleKey(role.key)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer text-left ${
                    isSelected
                      ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-500/80 shadow-xs'
                      : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${theme.badgeCls}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${theme.dotCls}`} />
                          {role.label}
                        </span>

                        {role.isSystem && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            <Lock className="w-2.5 h-2.5" />
                            Sistema
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {role.desc || 'Sin descripción'}
                      </p>
                    </div>

                    {!role.isSystem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRoleToDelete(role)
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0"
                        title="Eliminar este rol"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 mt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1 font-medium">
                      <Layers className="w-3.5 h-3.5 text-blue-500" />
                      {roleModulesCount} de {TENANT_MODULES.length} módulos
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {assignedCount} {assignedCount === 1 ? 'usuario' : 'usuarios'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Columna Derecha: Matriz de Módulos para el Rol Activo (7 cols) */}
          <div className="lg:col-span-7 p-4 sm:p-6 overflow-y-auto flex flex-col justify-between space-y-4">
            {activeRole ? (
              <div className="space-y-5">
                {/* Info del rol seleccionado */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 uppercase">Configurando Rol:</span>
                      <span className="text-sm font-black text-slate-900 dark:text-white">
                        {activeRole.label}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 uppercase px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700">
                        {activeRole.key}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Marca los módulos que tendrán acceso los usuarios asignados a este rol.
                    </p>
                  </div>

                  {/* Acciones Rápidas */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 rounded-lg border border-blue-200 dark:border-blue-900/50 transition-colors cursor-pointer"
                    >
                      Marcar todos
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                    >
                      Desmarcar
                    </button>
                  </div>
                </div>

                {/* Lista de Módulos agrupados */}
                <div className="space-y-5">
                  {Object.entries(modulesByGroup).map(([groupName, groupModules]) => (
                    <div key={groupName} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {groupName}
                        </span>
                        <div className="h-px flex-1 bg-slate-200 dark:border-slate-800" />
                      </div>

                      <div className="grid grid-cols-1 gap-2">
                        {groupModules.map((mod) => {
                          const isAllowed = roleModules.includes(mod.key)

                          return (
                            <div
                              key={mod.key}
                              onClick={() => handleToggleModule(mod.key)}
                              className={`p-3 rounded-xl border flex items-start gap-3 transition-all cursor-pointer ${
                                isAllowed
                                  ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-500/40'
                                  : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 opacity-65 hover:opacity-100'
                              }`}
                            >
                              <button
                                type="button"
                                className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                                  isAllowed
                                    ? 'bg-emerald-600 text-white'
                                    : 'border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800'
                                }`}
                              >
                                {isAllowed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </button>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                                    {mod.label}
                                  </p>
                                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                    {mod.key}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {mod.description}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Botón Guardar Módulos */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {roleModules.length} de {TENANT_MODULES.length} módulos habilitados
                  </span>

                  <button
                    type="button"
                    onClick={handleGuardarModulos}
                    disabled={savingModules}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-2 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
                  >
                    {savingModules ? (
                      <>
                        <Spinner size={14} />
                        <span>Guardando...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Guardar Módulos del Rol</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Shield className="w-12 h-12 stroke-[1.5] mb-2 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-semibold">Selecciona un rol de la lista para configurar sus módulos.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          SUB-MODAL: NUEVO ROL
      ══════════════════════════════════════════════════════════ */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false)
          }}
        >
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4 animate-slideDown max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Registrar Nuevo Rol
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Crea un rol con módulos y distintivo de color personalizados.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCrearRol} className="space-y-4">
              {/* Nombre del Rol */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Nombre del Rol *
                </label>
                <input
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => {
                    setNuevoNombre(e.target.value)
                    if (!nuevaClave) {
                      setNuevaClave(
                        e.target.value
                          .trim()
                          .toUpperCase()
                          .replace(/[^A-Z0-9_]/g, '_')
                      )
                    }
                  }}
                  placeholder="ej. Coordinador de Operaciones"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Clave / Identificador */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Identificador / Clave Interna *
                </label>
                <input
                  type="text"
                  value={nuevaClave}
                  onChange={(e) => setNuevaClave(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                  placeholder="ej. COORDINADOR_OPERACIONES"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 uppercase"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Se utiliza internamente para asignar privilegios a los usuarios.
                </p>
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Descripción
                </label>
                <textarea
                  value={nuevaDesc}
                  onChange={(e) => setNuevaDesc(e.target.value)}
                  placeholder="Describe brevemente las responsabilidades o alcance de este rol..."
                  rows={2}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500"
                />
              </div>

              {/* Paleta / Tema de Color */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Color de Insignia
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.values(ROLE_THEMES).map((th) => (
                    <button
                      key={th.key}
                      type="button"
                      onClick={() => setNuevoTema(th.key)}
                      className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                        nuevoTema === th.key
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${th.badgeCls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${th.dotCls}`} />
                        {th.key.toUpperCase()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Módulos Iniciales */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Módulos Habilitados ({nuevosModulos.length})
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setNuevosModulos(TENANT_MODULES.map((m) => m.key))}
                      className="text-[10px] text-blue-600 dark:text-blue-400 underline font-semibold"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setNuevosModulos([])}
                      className="text-[10px] text-slate-500 underline font-semibold"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                  {TENANT_MODULES.map((mod) => {
                    const isChecked = nuevosModulos.includes(mod.key)
                    return (
                      <label
                        key={mod.key}
                        className="flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setNuevosModulos((prev) =>
                              isChecked
                                ? prev.filter((k) => k !== mod.key)
                                : [...prev, mod.key]
                            )
                          }}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {mod.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Botones de acción */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={creandoRol}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {creandoRol ? (
                    <>
                      <Spinner size={14} />
                      <span>Creando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Crear Rol</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SUB-MODAL: CONFIRMAR ELIMINACIÓN DE ROL
      ══════════════════════════════════════════════════════════ */}
      {roleToDelete && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRoleToDelete(null)
          }}
        >
          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 p-6 shadow-2xl text-center space-y-4 animate-slideDown">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                ¿Eliminar Rol "{roleToDelete.label}"?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Esta acción eliminará el rol y su configuración de módulos.
              </p>

              {(userCountByRole[roleToDelete.key] || 0) > 0 && (
                <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-700 dark:text-amber-300 text-left flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Hay <strong>{userCountByRole[roleToDelete.key]}</strong> usuario(s) actualmente con este rol. Te recomendamos reasignarlos a otro rol.
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRoleToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmarEliminarRol}
                disabled={deletingRole}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-500/20 cursor-pointer disabled:opacity-50"
              >
                {deletingRole ? 'Eliminando...' : 'Sí, Eliminar Rol'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
