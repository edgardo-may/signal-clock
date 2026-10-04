// src/pages/Usuarios.jsx — Módulo de Gestión de Usuarios, Roles, Permisos y Accesos
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import Sidebar from "../../../shared/components/Layout/Sidebar";
import Header from "../../../shared/components/Layout/Header";
import Spinner from "../../../shared/components/ui/Spinner";
import { ROL_CONFIG } from "../../../shared/constants";
import { humanizeError } from "../../../shared/utils/errorHandlers";
import toast from "react-hot-toast";
import RolesModulesModal from "../components/RolesModulesModal";
import {
  getTenantRoles,
  ROLE_THEMES,
} from "../../../shared/auth/rolesManager";
import {
  UserCog,
  Users,
  Shield,
  ShieldCheck,
  UserPlus,
  UserCheck,
  UserX,
  Key,
  Lock,
  Mail,
  Search,
  Trash2,
  Edit3,
  Download,
  RefreshCw,
  Sparkles,
  Eye,
  EyeOff,
  Check,
  X,
} from "lucide-react";

export default function Usuarios() {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  const [clienteId, setClienteId] = useState(null);
  const [clienteNombre, setClienteNombre] = useState("Sucursal Principal");
  const [currentUserId, setCurrentUserId] = useState(null);

  // Estados de roles dinámicos
  const [roles, setRoles] = useState(() => getTenantRoles(null));
  const [modalRoles, setModalRoles] = useState(false);

  // Estados de datos
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros y Búsqueda
  const [busqueda, setBusqueda] = useState("");
  const [filtroRol, setFiltroRol] = useState("TODOS");
  const [filtroEstatus, setFiltroEstatus] = useState("TODOS");

  // Modales
  const [modalUsuario, setModalUsuario] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const [modalEliminar, setModalEliminar] = useState(null);
  const [modalPassword, setModalPassword] = useState(null);

  // Formulario de Usuario
  const [formNombre, setFormNombre] = useState("");
  const [formEmail, setFormEmail] = useState("");

  const [formRol, setFormRol] = useState("ADMIN");
  const [formEstatus, setFormEstatus] = useState("activo");
  const [formPassword, setFormPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Formulario de Reset Password
  const [nuevoPassword, setNuevoPassword] = useState("");
  const [cambiandoPass, setCambiandoPass] = useState(false);

  // Obtener sesión y cliente_id
  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      setCurrentUserId(session.user.id);

      const fromJwt =
        session.user?.app_metadata?.cliente_id ??
        session.user?.user_metadata?.cliente_id ??
        null;
      if (fromJwt) {
        setClienteId(fromJwt);
        return;
      }

      const { data: perfil } = await supabase
        .from("usuarios_perfiles")
        .select("cliente_id, clientes(nombre_empresa)")
        .eq("id", session.user.id)
        .maybeSingle();

      if (perfil?.cliente_id) {
        setClienteId(perfil.cliente_id);
        if (perfil.clientes?.nombre_empresa)
          setClienteNombre(perfil.clientes.nombre_empresa);
      }
    })();
  }, []);

  // Cargar y sincronizar roles disponibles
  const refrescarRoles = useCallback(() => {
    setRoles(getTenantRoles(clienteId));
  }, [clienteId]);

  useEffect(() => {
    refrescarRoles();
    const handleRolesUpdated = () => refrescarRoles();
    window.addEventListener("signum:roles-updated", handleRolesUpdated);
    return () =>
      window.removeEventListener("signum:roles-updated", handleRolesUpdated);
  }, [refrescarRoles]);

  // Cargar lista de usuarios
  const cargarUsuarios = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        let query = supabase
          .from("usuarios_perfiles")
          .select("*, clientes(nombre_empresa)")
          .order("nombre", { ascending: true });

        if (clienteId) {
          query = query.eq("cliente_id", clienteId);
        }

        const { data, error } = await query;

        if (error) throw error;
        setUsuarios(data || []);
      } catch (err) {
        toast.error(
          "Error al cargar usuarios: " + (err.message || "Error desconocido"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [clienteId],
  );

  useEffect(() => {
    cargarUsuarios();
  }, [cargarUsuarios]);

  // Abrir modal para crear
  const handleNuevoUsuario = () => {
    setUsuarioEditando(null);
    setFormNombre("");
    setFormEmail("");

    setFormRol(roles[0]?.key || "ADMIN");
    setFormEstatus("activo");
    setFormPassword("");
    setMostrarPassword(false);
    setModalUsuario(true);
  };

  // Abrir modal para editar
  const handleEditarUsuario = (user) => {
    setUsuarioEditando(user);
    setFormNombre(user.nombre || "");
    setFormEmail(""); // email no existe en usuarios_perfiles

    setFormRol((user.rol || "ADMIN").toUpperCase());
    setFormEstatus(user.estatus_cuenta || "activo");
    setFormPassword("");
    setMostrarPassword(false);
    setModalUsuario(true);
  };

  // Generar contraseña aleatoria segura
  const generarPasswordSegura = () => {
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let pass = "";
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormPassword(pass);
    setMostrarPassword(true);
    toast.success("Contraseña sugerida generada");
  };

  // Guardar (Crear o Actualizar) Usuario
  const handleGuardarUsuario = async (e) => {
    e.preventDefault();

    if (!formNombre.trim()) {
      toast.error("El nombre completo es obligatorio");
      return;
    }

    if (!usuarioEditando && !formEmail.trim()) {
      toast.error("El correo electrónico es obligatorio");
      return;
    }

    if (!usuarioEditando && (!formPassword || formPassword.length < 6)) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setGuardando(true);

    try {
      if (usuarioEditando) {
        // Actualizar perfil existente
        const updatePayload = {
          nombre: formNombre.trim(),
          rol: formRol.toLowerCase(),
          estatus_cuenta: formEstatus,
        };

        const { error } = await supabase
          .from("usuarios_perfiles")
          .update(updatePayload)
          .eq("id", usuarioEditando.id);

        if (error) throw error;

        toast.success("Usuario actualizado correctamente");
      } else {
        // Crear usuario mediante Edge Function segura
        // Esto NO afecta la sesión del administrador actual
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("Tu sesión ha expirado. Inicia sesión de nuevo.");
        }

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              email: formEmail.trim().toLowerCase(),
              password: formPassword,
              nombre: formNombre.trim(),
              rol: formRol.toLowerCase(),
              estatus_cuenta: formEstatus,
            }),
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Error al crear el usuario.");
        }

        toast.success(`¡Usuario ${formNombre} registrado con éxito!`);
      }

      setModalUsuario(false);
      cargarUsuarios(true);
    } catch (err) {
      toast.error(humanizeError(err.message), { duration: 5000 });
    } finally {
      setGuardando(false);
    }
  };

  // Alternar Estatus (Activar / Suspender)
  const handleToggleEstatus = async (user) => {
    const nuevoStatus =
      user.estatus_cuenta === "activo" ? "suspendido" : "activo";
    try {
      const { error } = await supabase
        .from("usuarios_perfiles")
        .update({ estatus_cuenta: nuevoStatus })
        .eq("id", user.id);

      if (error) throw error;

      toast.success(
        `Cuenta de ${user.nombre} marcada como ${nuevoStatus.toUpperCase()}`,
      );
      cargarUsuarios(true);
    } catch (err) {
      toast.error("Error al cambiar estatus: " + err.message);
    }
  };

  // Eliminar usuario — suspende en lugar de borrar (DELETE solo para service_role)
  const handleConfirmarEliminar = async () => {
    if (!modalEliminar) return;
    try {
      // RLS solo permite DELETE desde service_role, así que suspendemos la cuenta
      const { error } = await supabase
        .from("usuarios_perfiles")
        .update({ estatus_cuenta: "suspendido" })
        .eq("id", modalEliminar.id);

      if (error) throw error;

      toast.success(
        `Cuenta de ${modalEliminar.nombre} desactivada correctamente`,
      );
      setModalEliminar(null);
      cargarUsuarios(true);
    } catch (err) {
      toast.error(humanizeError(err.message));
    }
  };

  // Restablecer contraseña — nota: email no está en usuarios_perfiles
  // Solo podemos enviar si el admin conoce el email o si está en auth.users
  const handleEnviarResetPassword = async (e) => {
    e.preventDefault();
    if (!modalPassword) return;

    setCambiandoPass(true);
    try {
      toast.success(
        `Para restablecer la contraseña de ${modalPassword.nombre}, el usuario debe usar "Olvidé mi contraseña" en la pantalla de Login.`,
        { duration: 6000 },
      );
      setModalPassword(null);
      setNuevoPassword("");
    } catch (err) {
      toast.error(humanizeError(err.message));
    } finally {
      setCambiandoPass(false);
    }
  };

  // Exportar lista a CSV
  const exportarCSV = () => {
    if (usuarios.length === 0) {
      toast.error("No hay usuarios para exportar");
      return;
    }

    const headers = ["ID", "Nombre", "Rol", "Estatus", "Fecha Registro"];
    const rows = usuarios.map((u) => [
      u.id,
      `"${u.nombre || ""}"`,
      (u.rol || "operador").toUpperCase(),
      u.estatus_cuenta || "activo",
      u.creado_at ? new Date(u.creado_at).toLocaleDateString() : "",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `Directorio_Usuarios_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Directorio exportado a CSV");
  };

  // Filtrado reactivo de usuarios
  const usuariosFiltrados = usuarios.filter((u) => {
    const q = busqueda.toLowerCase().trim();
    const matchBusqueda =
      !q ||
      (u.nombre && u.nombre.toLowerCase().includes(q)) ||
      (u.rol && u.rol.toLowerCase().includes(q));

    const matchRol =
      filtroRol === "TODOS" || (u.rol && u.rol.toUpperCase() === filtroRol);

    const matchEstatus =
      filtroEstatus === "TODOS" ||
      (filtroEstatus === "ACTIVO" && u.estatus_cuenta !== "suspendido") ||
      (filtroEstatus === "SUSPENDIDO" && u.estatus_cuenta === "suspendido");

    return matchBusqueda && matchRol && matchEstatus;
  });

  // Contadores de métricas
  const totalUsuarios = usuarios.length;
  const totalAdmins = usuarios.filter(
    (u) => (u.rol || "").toUpperCase() === "ADMIN",
  ).length;
  const totalActivos = usuarios.filter(
    (u) => u.estatus_cuenta !== "suspendido",
  ).length;
  const totalSuspendidos = usuarios.filter(
    (u) => u.estatus_cuenta === "suspendido",
  ).length;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white font-sans">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 w-full space-y-6">
          {/* ── Encabezado Principal ────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
                  <UserCog className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                    Módulo de Usuarios & Accesos
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    Administración de cuentas, niveles de privilegios y seguridad del sistema.
                  </p>
                </div>
              </div>
            </div>

            {/* Botones de Acción */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => setModalRoles(true)}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs"
              >
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Roles & Permisos de Módulos</span>
              </button>

              <button
                type="button"
                onClick={exportarCSV}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs"
              >
                <Download className="w-4 h-4 text-emerald-500" />
                <span>Exportar CSV</span>
              </button>

              <button
                type="button"
                onClick={() => cargarUsuarios(true)}
                disabled={refreshing}
                className="p-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs transition-all cursor-pointer active:scale-95 shadow-xs"
                title="Actualizar lista"
              >
                <RefreshCw
                  className={`w-4 h-4 ${refreshing ? "animate-spin text-blue-600 dark:text-blue-400" : ""}`}
                />
              </button>

              <button
                type="button"
                onClick={handleNuevoUsuario}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all cursor-pointer active:scale-95"
              >
                <UserPlus className="w-4 h-4" />
                <span>Nuevo Usuario</span>
              </button>
            </div>
          </div>

          {/* ── 4 Tarjetas de Métricas KPI ──────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Total Usuarios */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Total Cuentas
                </span>
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                  <Users className="w-5 h-5" />
                </div>
              </div>
              <p
                className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {totalUsuarios}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Usuarios registrados en el tenant
              </p>
            </div>

            {/* Administradores */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Administradores
                </span>
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
              </div>
              <p
                className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {totalAdmins}
              </p>
              <p className="text-[11px] text-purple-600/80 dark:text-purple-400">
                Acceso total a configuración
              </p>
            </div>

            {/* Cuentas Activas */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Activas
                </span>
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <UserCheck className="w-5 h-5" />
                </div>
              </div>
              <p
                className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {totalActivos}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Con inicio de sesión habilitado
              </p>
            </div>

            {/* Cuentas Suspendidas */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Suspendidas
                </span>
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                  <UserX className="w-5 h-5" />
                </div>
              </div>
              <p
                className="text-2xl sm:text-3xl font-black text-rose-600 dark:text-rose-400"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {totalSuspendidos}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Acceso temporalmente bloqueado
              </p>
            </div>
          </div>

          {/* ── Filtros y Buscador ──────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Input de Búsqueda */}
            <div className="relative w-full md:w-96">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o rol..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900  placeholder-slate-400 outline-none focus:border-blue-500 transition-all shadow-inner"
              />
              {busqueda && (
                <button
                  type="button"
                  onClick={() => setBusqueda("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white "
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Selectores de Filtro */}
            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
              {/* Filtro por Rol */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">
                  Rol:
                </span>
                <select
                  value={filtroRol}
                  onChange={(e) => setFiltroRol(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="TODOS">Todos los Roles</option>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtro por Estatus */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-700 dark:text-slate-300 font-medium hidden sm:inline">
                  Estatus:
                </span>
                <select
                  value={filtroEstatus}
                  onChange={(e) => setFiltroEstatus(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900  outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="TODOS">Todos los Estatus</option>
                  <option value="ACTIVO">Activos</option>
                  <option value="SUSPENDIDO">Suspendidos</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Tabla Principal de Usuarios ────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300  uppercase tracking-wider text-[10px] font-bold">
                    <th className="py-3.5 px-4">Usuario</th>
                    <th className="py-3.5 px-4">Rol & Permisos</th>
                    <th className="py-3.5 px-4 hidden md:table-cell">
                      Empresa
                    </th>
                    <th className="py-3.5 px-4">Estatus</th>
                    <th className="py-3.5 px-4 hidden lg:table-cell">
                      Registro
                    </th>
                    <th className="py-3.5 px-4 text-right">Acciones</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[rgba(3,54,61,0.07)] ">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-16 text-center text-slate-400 dark:text-slate-500"
                      >
                        <div className="flex flex-col items-center justify-center gap-3">
                          <Spinner size={32} className="text-blue-600 dark:text-blue-400" />
                          <span className="text-sm font-semibold">
                            Cargando directorio de usuarios...
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : usuariosFiltrados.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-16 text-center text-slate-400 dark:text-slate-500"
                      >
                        <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                          <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/60 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 dark:text-slate-700 dark:text-slate-300">
                            <Users className="w-8 h-8" />
                          </div>
                          <p className="text-sm font-bold text-slate-900 ">
                            No se encontraron usuarios
                          </p>
                          <p className="text-xs text-slate-700 dark:text-slate-300 ">
                            No hay cuentas que coincidan con los filtros
                            aplicados.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setBusqueda("");
                              setFiltroRol("TODOS");
                              setFiltroEstatus("TODOS");
                            }}
                            className="mt-2 text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-300 underline cursor-pointer"
                          >
                            Limpiar filtros
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    usuariosFiltrados.map((user) => {
                      const rolKey = (user.rol || "colaborador").toUpperCase();
                      const rolConfig =
                        ROL_CONFIG[rolKey] || ROL_CONFIG.COLABORADOR;
                      const isSuspendido = user.estatus_cuenta === "suspendido";
                      const isMe = user.id === currentUserId;

                      return (
                        <tr
                          key={user.id}
                          className={`hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-900/60 transition-colors group ${
                            isSuspendido ? "opacity-70 bg-rose-50 dark:bg-rose-950/10" : ""
                          }`}
                        >
                          {/* Usuario (Avatar + Nombre + Email) */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              {user.avatar_url ? (
                                <img
                                  src={user.avatar_url}
                                  alt=""
                                  className="w-10 h-10 rounded-xl object-cover border border-slate-700 flex-shrink-0"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-primary to-purple-600 font-bold text-white flex items-center justify-center text-sm shadow-md flex-shrink-0">
                                  {(user.nombre || "U")[0].toUpperCase()}
                                </div>
                              )}

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs sm:text-sm font-bold text-slate-900  truncate leading-tight group-hover:text-blue-600 dark:text-blue-400 dark:group-hover:text-blue-300 transition-colors">
                                    {user.nombre || "Usuario sin nombre"}
                                  </p>
                                  {isMe && (
                                    <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950/60 dark:bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 dark:text-blue-300 border border-blue-500/40 dark:border-blue-500/30">
                                      Tú
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-700 dark:text-slate-300  truncate mt-0.5">
                                  ID: {user.id?.slice(0, 8)}…
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Rol & Nivel */}
                          <td className="py-3.5 px-4">
                            {(() => {
                              const foundRole = roles.find(
                                (r) => r.key.toUpperCase() === rolKey,
                              );
                              const theme = foundRole
                                ? ROLE_THEMES[foundRole.theme] || ROLE_THEMES.blue
                                : null;
                              const badgeCls = theme
                                ? theme.badgeCls
                                : rolConfig?.cls ||
                                  "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30";
                              const dotCls = theme
                                ? theme.dotCls
                                : rolConfig?.dot || "bg-slate-400";
                              const label =
                                foundRole?.label || rolConfig?.label || rolKey;

                              return (
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${badgeCls}`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${dotCls}`}
                                  />
                                  {label}
                                </span>
                              );
                            })()}
                          </td>

                          {/* Empresa / Tenant */}
                          <td className="py-3.5 px-4 hidden md:table-cell">
                            <span className="text-slate-700 dark:text-slate-300  text-[11px]">
                              {user.clientes?.nombre_empresa || "—"}
                            </span>
                          </td>

                          {/* Estatus */}
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => handleToggleEstatus(user)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer active:scale-95 ${
                                isSuspendido
                                  ? "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                              }`}
                              title="Haz clic para alternar estatus de la cuenta"
                            >
                              {isSuspendido ? (
                                <>
                                  <UserX className="w-3 h-3 text-rose-400" />
                                  <span>Suspendido</span>
                                </>
                              ) : (
                                <>
                                  <UserCheck className="w-3 h-3 text-emerald-400" />
                                  <span>Activo</span>
                                </>
                              )}
                            </button>
                          </td>

                          {/* Registro */}
                          <td className="py-3.5 px-4 hidden lg:table-cell text-slate-400 dark:text-slate-500 text-[11px]">
                            {user.creado_at ? (
                              <span>
                                {new Date(user.creado_at).toLocaleDateString(
                                  "es-MX",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )}
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                          </td>

                          {/* Acciones */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Editar */}
                              <button
                                type="button"
                                onClick={() => handleEditarUsuario(user)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/40 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-xs cursor-pointer"
                                title="Editar perfil y rol"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              {/* Restablecer Contraseña */}
                              <button
                                type="button"
                                onClick={() => setModalPassword(user)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/40 text-slate-600 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors shadow-xs cursor-pointer"
                                title="Restablecer contraseña"
                              >
                                <Key className="w-3.5 h-3.5" />
                              </button>

                              {/* Eliminar (protege contra auto-eliminación) */}
                              {!isMe && (
                                <button
                                  type="button"
                                  onClick={() => setModalEliminar(user)}
                                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 transition-colors shadow-xs cursor-pointer"
                                  title="Eliminar usuario"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* ══════════════════════════════════════════════════════════
          MODAL: CREAR / EDITAR USUARIO
      ══════════════════════════════════════════════════════════ */}
      {modalUsuario && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalUsuario(false);
          }}
        >
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-7 shadow-2xl space-y-5 animate-slideDown max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm">
                  {usuarioEditando ? (
                    <Edit3 className="w-5 h-5" />
                  ) : (
                    <UserPlus className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {usuarioEditando
                      ? "Editar Perfil de Usuario"
                      : "Registrar Nuevo Usuario"}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {usuarioEditando
                      ? "Modifica los datos personales y rol del usuario."
                      : "Crea una cuenta con acceso al sistema."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setModalUsuario(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarUsuario} className="space-y-4">
              {/* Nombre Completo */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="ej. Lic. Alejandro Morales"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Correo Electrónico */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Correo Electrónico *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    disabled={Boolean(usuarioEditando)}
                    placeholder="usuario@empresa.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 disabled:opacity-60"
                    required={!usuarioEditando}
                  />
                </div>
                {usuarioEditando && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    El correo está vinculado a la cuenta de autenticación.
                  </p>
                )}
              </div>

              {/* Selector de Rol y Privilegios Dinámico */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Rol & Nivel de Permisos *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1">
                  {roles.map((r) => {
                    const theme = ROLE_THEMES[r.theme] || ROLE_THEMES.blue;
                    const isSelected = formRol === r.key;

                    return (
                      <div
                        key={r.key}
                        onClick={() => setFormRol(r.key)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-500 shadow-xs"
                            : "bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${theme.badgeCls}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${theme.dotCls}`}
                            />
                            {r.label}
                          </span>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-tight line-clamp-2">
                          {r.desc || "Rol configurado"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Contraseña para nuevo usuario */}
              {!usuarioEditando && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Contraseña Temporal *
                    </label>
                    <button
                      type="button"
                      onClick={generarPasswordSegura}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-500 underline cursor-pointer flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      Generar segura
                    </button>
                  </div>

                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={mostrarPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 font-mono"
                      required={!usuarioEditando}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarPassword(!mostrarPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                    >
                      {mostrarPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Estatus de la Cuenta */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Estatus de la Cuenta
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="estatus"
                      value="activo"
                      checked={formEstatus === "activo"}
                      onChange={() => setFormEstatus("activo")}
                      className="accent-blue-600"
                    />
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      Activa
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="estatus"
                      value="suspendido"
                      checked={formEstatus === "suspendido"}
                      onChange={() => setFormEstatus("suspendido")}
                      className="accent-blue-600"
                    />
                    <span className="text-rose-600 dark:text-rose-400 font-semibold">
                      Suspendida
                    </span>
                  </label>
                </div>
              </div>

              {/* Botones de acción */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalUsuario(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={guardando}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95 transition-all"
                >
                  {guardando ? (
                    <>
                      <Spinner size={14} />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>
                        {usuarioEditando
                          ? "Actualizar Usuario"
                          : "Crear Usuario"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL: RESTABLECER CONTRASEÑA
      ══════════════════════════════════════════════════════════ */}
      {modalPassword && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalPassword(null);
          }}
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4 animate-slideDown">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  <Key className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Restablecer Contraseña
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalPassword(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Para restablecer la contraseña de{" "}
              <strong className="text-slate-900 dark:text-white">
                {modalPassword.nombre}
              </strong>
              , el usuario deberá utilizar la opción "Olvidé mi contraseña" en la
              pantalla de inicio de sesión.
            </p>

            <form
              onSubmit={handleEnviarResetPassword}
              className="space-y-4 pt-2"
            >
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalPassword(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={cambiandoPass}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-purple-500/20 cursor-pointer disabled:opacity-50"
                >
                  {cambiandoPass ? (
                    <Spinner size={14} />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  <span>Entendido</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL: CONFIRMAR ELIMINACIÓN
      ══════════════════════════════════════════════════════════ */}
      {modalEliminar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalEliminar(null);
          }}
        >
          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 p-6 shadow-2xl text-center space-y-4 animate-slideDown">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                ¿Desactivar Usuario?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Esta acción suspenderá la cuenta de{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {modalEliminar.nombre}
                </strong>
                . El usuario no podrá iniciar sesión.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setModalEliminar(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEliminar}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-500/20 cursor-pointer active:scale-95"
              >
                Sí, Desactivar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL: GESTIÓN DE ROLES Y PERMISOS DE MÓDULOS
      ══════════════════════════════════════════════════════════ */}
      <RolesModulesModal
        isOpen={modalRoles}
        onClose={() => setModalRoles(false)}
        clienteId={clienteId}
        usuarios={usuarios}
        onRolesChanged={refrescarRoles}
        supabaseClient={supabase}
      />
    </div>
  );
}






