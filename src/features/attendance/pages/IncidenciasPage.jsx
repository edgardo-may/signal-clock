// src/features/attendance/pages/IncidenciasPage.jsx — Matriz de Incidencias con Formato Visual Enriquecido y Cabecera Limpia
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import Sidebar from "../../../shared/components/Layout/Sidebar";
import Header from "../../../shared/components/Layout/Header";
import toast from "react-hot-toast";
import { usePagination } from "../../../shared/hooks/usePagination";
import PaginationControl from "../../../shared/components/ui/PaginationControl";
import { useCurrentTenant } from "../../../shared/hooks/useCurrentTenant";
import { useConfirm } from "../../../shared/hooks/useConfirm";
import { DatePicker } from "../../../shared/components/ui";
import { todayStr } from "../../../shared/utils/dateUtils";
import {
  Search,
  RefreshCw,
  Download,
  Plus,
  X,
  Trash2,
  Save,
  FileText,
  Grid,
  Check,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// ANCHOS FIJOS DE LA MATRIZ
// ═══════════════════════════════════════════════════════════════
const COL_NAME_W = 320; // ancho fijo de la columna Colaborador (px)
const COL_DAY_W = 79; // ancho fijo de cada columna de día (px)

// ═══════════════════════════════════════════════════════════════
// CATÁLOGO DE TIPOS DE INCIDENCIA (Colores distintivos oficiales)
// ═══════════════════════════════════════════════════════════════
export const TIPOS_INCIDENCIA = [
  {
    id: "Asistencia",
    label: "Asistencia",
    abbr: "ASI",
    color:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800",
    dotColor: "bg-emerald-500",
    cardBg:
      "bg-emerald-50/60 border-emerald-200 text-emerald-900 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:border-emerald-800/60 dark:text-emerald-200",
    selectedStyle:
      "ring-2 ring-emerald-500 border-emerald-500 bg-emerald-100/90 dark:bg-emerald-900/60 text-emerald-950 dark:text-emerald-100 shadow-xs",
  },
  {
    id: "Retardo",
    label: "Retardo",
    abbr: "RET",
    color:
      "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800",
    dotColor: "bg-amber-500",
    cardBg:
      "bg-amber-50/60 border-amber-200 text-amber-900 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:border-amber-800/60 dark:text-amber-200",
    selectedStyle:
      "ring-2 ring-amber-500 border-amber-500 bg-amber-100/90 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 shadow-xs",
  },
  {
    id: "Falta Injustificada",
    label: "Falta Injustificada",
    abbr: "FI",
    color:
      "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800",
    dotColor: "bg-rose-500",
    cardBg:
      "bg-rose-50/60 border-rose-200 text-rose-900 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:border-rose-800/60 dark:text-rose-200",
    selectedStyle:
      "ring-2 ring-rose-500 border-rose-500 bg-rose-100/90 dark:bg-rose-900/60 text-rose-950 dark:text-rose-100 shadow-xs",
  },
  {
    id: "Vacaciones",
    label: "Vacaciones",
    abbr: "VAC",
    color:
      "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800",
    dotColor: "bg-sky-500",
    cardBg:
      "bg-sky-50/60 border-sky-200 text-sky-900 hover:bg-sky-100/70 dark:bg-sky-950/30 dark:border-sky-800/60 dark:text-sky-200",
    selectedStyle:
      "ring-2 ring-sky-500 border-sky-500 bg-sky-100/90 dark:bg-sky-900/60 text-sky-950 dark:text-sky-100 shadow-xs",
  },
  {
    id: "Permiso con Goce de Sueldo",
    label: "Permiso con Goce",
    abbr: "PGS",
    color:
      "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800",
    dotColor: "bg-teal-500",
    cardBg:
      "bg-teal-50/60 border-teal-200 text-teal-900 hover:bg-teal-100/70 dark:bg-teal-950/30 dark:border-teal-800/60 dark:text-teal-200",
    selectedStyle:
      "ring-2 ring-teal-500 border-teal-500 bg-teal-100/90 dark:bg-teal-900/60 text-teal-950 dark:text-teal-100 shadow-xs",
  },
  {
    id: "Permiso sin Goce de Sueldo",
    label: "Permiso sin Goce",
    abbr: "PSS",
    color:
      "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800",
    dotColor: "bg-orange-500",
    cardBg:
      "bg-orange-50/60 border-orange-200 text-orange-900 hover:bg-orange-100/70 dark:bg-orange-950/30 dark:border-orange-800/60 dark:text-orange-200",
    selectedStyle:
      "ring-2 ring-orange-500 border-orange-500 bg-orange-100/90 dark:bg-orange-900/60 text-orange-950 dark:text-orange-100 shadow-xs",
  },
  {
    id: "Incapacidad por Enfermedad General",
    label: "Incapacidad Enf. General",
    abbr: "IEG",
    color:
      "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800",
    dotColor: "bg-purple-500",
    cardBg:
      "bg-purple-50/60 border-purple-200 text-purple-900 hover:bg-purple-100/70 dark:bg-purple-950/30 dark:border-purple-800/60 dark:text-purple-200",
    selectedStyle:
      "ring-2 ring-purple-500 border-purple-500 bg-purple-100/90 dark:bg-purple-900/60 text-purple-950 dark:text-purple-100 shadow-xs",
  },
  {
    id: "Incapacidad por Riesgo de Trabajo",
    label: "Incapacidad Riesgo Trab.",
    abbr: "IRT",
    color:
      "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800",
    dotColor: "bg-indigo-500",
    cardBg:
      "bg-indigo-50/60 border-indigo-200 text-indigo-900 hover:bg-indigo-100/70 dark:bg-indigo-950/30 dark:border-indigo-800/60 dark:text-indigo-200",
    selectedStyle:
      "ring-2 ring-indigo-500 border-indigo-500 bg-indigo-100/90 dark:bg-indigo-900/60 text-indigo-950 dark:text-indigo-100 shadow-xs",
  },
  {
    id: "Incapacidad por Maternidad",
    label: "Incapacidad Maternidad",
    abbr: "IM",
    color:
      "bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-950/70 dark:text-pink-300 dark:border-pink-800",
    dotColor: "bg-pink-500",
    cardBg:
      "bg-pink-50/60 border-pink-200 text-pink-900 hover:bg-pink-100/70 dark:bg-pink-950/30 dark:border-pink-800/60 dark:text-pink-200",
    selectedStyle:
      "ring-2 ring-pink-500 border-pink-500 bg-pink-100/90 dark:bg-pink-900/60 text-pink-950 dark:text-pink-100 shadow-xs",
  },
  {
    id: "Suspensión Disciplinaria",
    label: "Suspensión Disciplinaria",
    abbr: "SD",
    color:
      "bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
    dotColor: "bg-slate-500",
    cardBg:
      "bg-slate-100/80 border-slate-300 text-slate-800 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-200",
    selectedStyle:
      "ring-2 ring-slate-500 border-slate-500 bg-slate-200/90 dark:bg-slate-700/80 text-slate-900 dark:text-white shadow-xs",
  },
];

export function getTipoInfo(tipoId) {
  if (!tipoId) {
    return {
      id: "",
      label: "Incidencia",
      abbr: "INC",
      color:
        "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      dotColor: "bg-slate-400",
      cardBg: "bg-slate-50 border-slate-200 text-slate-700",
      selectedStyle: "ring-2 ring-slate-500 border-slate-500 bg-slate-100",
    };
  }

  const clean = tipoId.trim().toLowerCase();
  const found = TIPOS_INCIDENCIA.find(
    (t) =>
      t.id.toLowerCase() === clean ||
      t.label.toLowerCase() === clean ||
      t.abbr.toLowerCase() === clean,
  );
  if (found) return found;

  // Aliases comunes y coincidencias parciales
  if (clean.includes("asistencia"))
    return (
      TIPOS_INCIDENCIA.find((t) => t.abbr === "ASI") || TIPOS_INCIDENCIA[0]
    );
  if (clean.includes("retardo"))
    return (
      TIPOS_INCIDENCIA.find((t) => t.abbr === "RET") || TIPOS_INCIDENCIA[1]
    );
  if (clean.includes("falta"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "FI") || TIPOS_INCIDENCIA[2];
  if (clean.includes("vacaci"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "VAC");
  if (clean.includes("goce") && !clean.includes("sin"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "PGS");
  if (clean.includes("sin goce") || clean.includes("sin sueldo"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "PSS");
  if (clean.includes("matern"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "IM");
  if (clean.includes("riesgo"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "IRT");
  if (clean.includes("enfermedad"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "IEG");
  if (clean.includes("suspensi"))
    return TIPOS_INCIDENCIA.find((t) => t.abbr === "SD");

  return {
    id: tipoId,
    label: tipoId,
    abbr: tipoId.slice(0, 3).toUpperCase(),
    color:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    dotColor: "bg-slate-400",
    cardBg: "bg-slate-50 border-slate-200 text-slate-700",
    selectedStyle: "ring-2 ring-slate-500 border-slate-500 bg-slate-100",
  };
}

// Utilidad para generar lista de días (fechas iniciales a la izquierda, fecha más reciente a la derecha)
function getDatesInRange(start, end) {
  if (!start || !end) return [];
  let s = start;
  let e = end;
  if (s > e) {
    const temp = s;
    s = e;
    e = temp;
  }
  const dates = [];
  const current = new Date(`${s}T12:00:00`);
  const endDate = new Date(`${e}T12:00:00`);
  while (current <= endDate) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Formatea una fecha local como YYYY-MM-DD (sin desfase por zona horaria)
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
// MODAL: REGISTRAR O EDITAR INCIDENCIA
// ═══════════════════════════════════════════════════════════════
function ModalIncidencia({
  incidencia,
  preselectedEmpId,
  preselectedDate,
  empleados,
  clienteId,
  userRol,
  onClose,
  onSaved,
  onDelete,
}) {
  const isEdit = !!incidencia;
  const [empleadoId, setEmpleadoId] = useState(
    incidencia?.empleado_id || preselectedEmpId || empleados[0]?.id || "",
  );
  const initialDate = preselectedDate || todayStr();
  const [fechaInicio, setFechaInicio] = useState(
    incidencia?.fecha_inicio || initialDate,
  );
  const [fechaFin, setFechaFin] = useState(
    incidencia?.fecha_fin || initialDate,
  );
  const [tipoIncidencia, setTipoIncidencia] = useState(() => {
    if (incidencia?.tipo_incidencia) {
      return getTipoInfo(incidencia.tipo_incidencia).id;
    }
    return TIPOS_INCIDENCIA[0].id;
  });
  const [descripcion, setDescripcion] = useState(incidencia?.descripcion || "");
  const [estado, setEstado] = useState(incidencia?.estado || "Aprobado");
  const [saving, setSaving] = useState(false);

  const selectedEmp = empleados.find((e) => e.id === empleadoId);
  const canAuthorize =
    userRol === "admin" || userRol === "rh" || userRol === "superadmin";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!empleadoId || !fechaInicio || !fechaFin) {
      return toast.error("Selecciona colaborador y fechas.");
    }
    if (fechaInicio > fechaFin) {
      return toast.error(
        "La fecha de fin no puede ser anterior a la de inicio.",
      );
    }

    setSaving(true);
    try {
      const payload = {
        cliente_id: clienteId,
        empleado_id: empleadoId,
        tipo_incidencia: tipoIncidencia,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        descripcion: descripcion.trim() || null,
        estado: canAuthorize
          ? estado
          : isEdit
            ? incidencia.estado
            : "Pendiente",
      };

      if (isEdit) {
        const { error } = await supabase
          .from("incidencias")
          .update(payload)
          .eq("id", incidencia.id);
        if (error) throw error;
        toast.success("Incidencia actualizada");
      } else {
        const { error } = await supabase.from("incidencias").insert(payload);
        if (error) throw error;
        toast.success("Incidencia agregada");
      }

      onSaved();
      onClose();
    } catch (err) {
      toast.error("Error al guardar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-lg max-h-[92vh] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-850 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800 dark:text-white">
                {isEdit ? "Editar Incidencia" : "Asignar Incidencia"}
              </h3>
              <p className="text-xs text-slate-400">
                {selectedEmp
                  ? `${selectedEmp.nombre} ${selectedEmp.apellido}`
                  : "Completa la información"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 space-y-4 text-sm overflow-y-auto flex-1"
        >
          {/* Colaborador */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">
              Colaborador
            </label>
            <select
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
              disabled={isEdit}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-blue-500 font-medium disabled:opacity-75"
            >
              {empleados.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.nombre} {emp.apellido}{" "}
                  {emp.departamento ? `(${emp.departamento})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Tipo de Incidencia con Selector Visual a Colores */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                Tipo de Incidencia
              </label>
              {(() => {
                const current = getTipoInfo(tipoIncidencia);
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-2xs ${current.color}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${current.dotColor}`}
                    />
                    <span>
                      [{current.abbr}] {current.label}
                    </span>
                  </span>
                );
              })()}
            </div>

            {/* Grid interactivo de tipos con sus colores característicos */}
            <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40">
              {TIPOS_INCIDENCIA.map((t) => {
                const isSelected = tipoIncidencia === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTipoIncidencia(t.id)}
                    className={`relative flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? `${t.selectedStyle} scale-[1.01]`
                        : `${t.cardBg} opacity-85 hover:opacity-100 hover:scale-[1.005]`
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.dotColor} ${isSelected ? "ring-2 ring-white dark:ring-slate-900" : ""}`}
                      />
                      <div className="min-w-0">
                        <span className="block text-xs font-bold truncate">
                          {t.label}
                        </span>
                        <span className="text-[10px] font-semibold opacity-70">
                          {t.abbr}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <div
                        className={`p-0.5 rounded-full shrink-0 ${t.dotColor} text-white shadow-2xs`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fechas Inicio (Izquierda) / Fin (Derecha) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">
                Fecha Inicio
              </label>
              <DatePicker
                value={fechaInicio}
                onChange={(e) => {
                  setFechaInicio(e.target.value);
                  if (e.target.value > fechaFin) setFechaFin(e.target.value);
                }}
                required
                placeholder="Fecha inicio"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">
                Fecha Fin
              </label>
              <DatePicker
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                required
                placeholder="Fecha fin"
              />
            </div>
          </div>

          {/* Estado de Aprobación */}
          {canAuthorize && (
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">
                Estado
              </label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-blue-500 font-semibold"
              >
                <option value="Aprobado">Aprobado</option>
                <option value="Pendiente">Pendiente</option>
                <option value="Rechazado">Rechazado</option>
              </select>
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">
              Notas / Motivo
            </label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              placeholder="Detalles opcionales o justificante..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {/* Acciones */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
            {isEdit ? (
              <button
                type="button"
                onClick={() => onDelete(incidencia)}
                className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Guardando..." : isEdit ? "Actualizar" : "Guardar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default function IncidenciasPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  const { currentTenantId } = useCurrentTenant();
  const { confirmDialog, ConfirmDialogNode } = useConfirm();

  const [empleados, setEmpleados] = useState([]);
  const [incidencias, setIncidencias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [userRol, setUserRol] = useState("");

  // Rango de fechas: hoy por defecto en los 2 calendarios
  const today = todayStr();
  const [fechaInicio, setFechaInicio] = useState(today);
  const [fechaFin, setFechaFin] = useState(today);

  // Modal para agregar/editar
  const [modalData, setModalData] = useState(null);

  // Obtener rol
  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: perfil } = await supabase
        .from("usuarios_perfiles")
        .select("rol")
        .eq("id", session.user.id)
        .maybeSingle();
      if (perfil?.rol) setUserRol(perfil.rol);
    })();
  }, []);

  // Cargar datos
  const fetchData = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);

    try {
      // 1. Empleados
      const { data: empData, error: empError } = await supabase
        .from("empleados")
        .select(
          "id, nombre, apellido, clave_empleado, departamento, device_userid",
        )
        .eq("cliente_id", currentTenantId)
        .eq("activo", true)
        .order("apellido", { ascending: true });

      if (empError) throw empError;
      setEmpleados(empData || []);

      // 2. Incidencias en el rango
      const { data: incData, error: incError } = await supabase
        .from("incidencias")
        .select("*")
        .eq("cliente_id", currentTenantId)
        .lte("fecha_inicio", fechaFin)
        .gte("fecha_fin", fechaInicio);

      if (incError) throw incError;
      setIncidencias(incData || []);
    } catch (err) {
      console.error(err);
      toast.error("Error al cargar datos: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [currentTenantId, fechaInicio, fechaFin]);

  useEffect(() => {
    fetchData();
  }, [currentTenantId]);

  // Días en el rango para las columnas con información de fin de semana y día de hoy
  const dateColumns = useMemo(() => {
    const dates = getDatesInRange(fechaInicio, fechaFin);
    return dates.map((d) => {
      const dateStr = toLocalDateStr(d);
      const dayNum = d.getDate();
      const dayOfWeek = d.getDay(); // 0 = Sun, 6 = Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const weekdayName = new Intl.DateTimeFormat("es-MX", {
        weekday: "short",
      }).format(d);
      const weekdayCap =
        weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1, 3);

      return {
        id: dateStr,
        dayNum,
        weekdayCap,
        isWeekend,
        isToday: dateStr === today,
      };
    });
  }, [fechaInicio, fechaFin, today]);

  // Ancho total de la tabla = columna nombre + (días × ancho de día)
  const tableWidth = COL_NAME_W + dateColumns.length * COL_DAY_W;

  // Filtrado de colaboradores por búsqueda
  const filteredEmpleados = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return empleados;
    return empleados.filter((e) => {
      const full = `${e.nombre || ""} ${e.apellido || ""}`.toLowerCase();
      const code = String(
        e.clave_empleado || e.device_userid || "",
      ).toLowerCase();
      const depto = (e.departamento || "").toLowerCase();
      return full.includes(q) || code.includes(q) || depto.includes(q);
    });
  }, [empleados, search]);

  // Paginación (10 colaboradores por página)
  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedEmpleados,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage,
  } = usePagination(filteredEmpleados, 10, [search, filteredEmpleados]);

  // Clic en Celda: abre modal con colaborador y fecha listos
  const handleCellClick = (empId, dateStr, existingInc = null) => {
    setModalData({
      incidencia: existingInc,
      preselectedEmpId: empId,
      preselectedDate: dateStr,
    });
  };

  // Eliminar incidencia
  const handleDelete = async (inc) => {
    const ok = await confirmDialog({
      title: "¿Eliminar incidencia?",
      message: `Se eliminará la incidencia "${inc.tipo_incidencia}" permanentemente.`,
      variant: "danger",
      confirmLabel: "Sí, eliminar",
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("incidencias")
        .delete()
        .eq("id", inc.id);
      if (error) throw error;
      toast.success("Incidencia eliminada");
      if (modalData) setModalData(null);
      fetchData();
    } catch (err) {
      toast.error("Error al eliminar: " + err.message);
    }
  };

  // Exportar CSV
  const handleExport = () => {
    if (filteredEmpleados.length === 0 || dateColumns.length === 0) return;
    const headers = [
      "ID de persona",
      "Nombre de la persona",
      "Departamento",
      ...dateColumns.map((c) => `${c.dayNum} ${c.weekdayCap}`),
    ];

    const rows = filteredEmpleados.map((emp) => {
      const empIncs = incidencias.filter((i) => i.empleado_id === emp.id);
      const dayValues = dateColumns.map((col) => {
        const match = empIncs.find(
          (i) => col.id >= i.fecha_inicio && col.id <= i.fecha_fin,
        );
        return match ? getTipoInfo(match.tipo_incidencia).abbr : "";
      });
      return [
        emp.device_userid || emp.clave_empleado || "—",
        `"${emp.nombre || ""} ${emp.apellido || ""}"`,
        `"${emp.departamento || "—"}"`,
        ...dayValues,
      ];
    });

    const csvContent =
      "\ufeff" +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Matriz_Incidencias_${fechaInicio}_a_${fechaFin}.csv`;
    link.click();
    toast.success("CSV exportado");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-slate-900 text-slate-900 dark:text-white font-inter">
      {ConfirmDialogNode}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          {/* ── Encabezado Limpio (Sin saturación de información) ────── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                Matriz de Incidencias
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Visualiza y asigna incidencias por día para cada colaborador.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300 shadow-xs"
                title="Recargar"
              >
                <RefreshCw
                  className={`w-5 h-5 ${loading ? "animate-spin text-blue-500" : ""}`}
                />
              </button>

              <button
                onClick={handleExport}
                disabled={filteredEmpleados.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800/60 disabled:opacity-50 shadow-xs"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>

              <button
                onClick={() => setModalData({ incidencia: null })}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all active:scale-98"
              >
                <Plus className="w-4 h-4" />
                Nueva Incidencia
              </button>
            </div>
          </div>

          {/* ── Barra de Controles Única: Desde, Hasta, Consultar y Buscar ── */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-end justify-between gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                <div className="space-y-1.5 w-full sm:w-44">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Fecha Inicio
                  </label>
                  <DatePicker
                    value={fechaInicio}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFechaInicio(val);
                      if (val && fechaFin && val > fechaFin) setFechaFin(val);
                    }}
                    placeholder="Fecha inicio"
                  />
                </div>
                <div className="space-y-1.5 w-full sm:w-44">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Fecha Fin
                  </label>
                  <DatePicker
                    value={fechaFin}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFechaFin(val);
                      if (val && fechaInicio && val < fechaInicio)
                        setFechaInicio(val);
                    }}
                    placeholder="Fecha fin"
                  />
                </div>
                <div className="pt-5 w-full sm:w-auto">
                  <button
                    onClick={fetchData}
                    className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                  >
                    Consultar
                  </button>
                </div>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar colaborador..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-900 dark:text-white transition-colors"
                />
              </div>
            </div>

            {/* ── Tabla Matriz de Incidencias (Formato Visual Enriquecido) ── */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto select-none bg-white dark:bg-slate-800">
                <table
                  className="text-left border-collapse"
                  style={{
                    tableLayout: "fixed",
                    width: tableWidth,
                    minWidth: tableWidth,
                  }}
                >
                  {/* Anchos fijos: nombre y cada día */}
                  <colgroup>
                    <col style={{ width: COL_NAME_W }} />
                    {dateColumns.map((col) => (
                      <col key={col.id} style={{ width: COL_DAY_W }} />
                    ))}
                  </colgroup>

                  {/* Encabezado con Días */}
                  <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      {/* Columna fija: Colaborador */}
                      <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-xs font-extrabold text-slate-700 dark:text-slate-200 uppercase tracking-wider border-r border-slate-200 dark:border-slate-700 shadow-[4px_0_10px_-3px_rgba(0,0,0,0.06)]">
                        Colaborador
                      </th>

                      {/* Columnas de Días: orden cronológico de izquierda a derecha */}
                      {dateColumns.map((col) => (
                        <th
                          key={col.id}
                          className={`p-2 text-center border-r border-slate-200 dark:border-slate-700 transition-colors ${
                            col.isToday
                              ? "bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-extrabold ring-1 ring-inset ring-blue-500/30"
                              : col.isWeekend
                                ? "bg-slate-100/70 dark:bg-slate-950/50 text-slate-400 dark:text-slate-500"
                                : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <div className="text-[11px] font-black leading-tight">
                            {col.dayNum}
                          </div>
                          <div className="text-[9px] font-bold uppercase opacity-80 leading-tight">
                            {col.weekdayCap}
                          </div>
                          {col.isToday && (
                            <div
                              className="w-1.5 h-1.5 rounded-full bg-blue-600 mx-auto mt-0.5"
                              title="Hoy"
                            />
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  {/* Filas de Colaboradores */}
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={1 + dateColumns.length}
                          className="px-4 py-16 text-slate-500"
                        >
                          <div className="sticky left-4 w-max max-w-[80vw] text-center">
                            <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-2 text-blue-500" />
                            Cargando matriz de incidencias...
                          </div>
                        </td>
                      </tr>
                    ) : paginatedEmpleados.length > 0 ? (
                      paginatedEmpleados.map((emp) => {
                        const empIncs = incidencias.filter(
                          (i) => i.empleado_id === emp.id,
                        );

                        return (
                          <tr
                            key={emp.id}
                            className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors group"
                          >
                            {/* Columna Fija: Identidad del Colaborador */}
                            <td className="sticky left-0 z-10 bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-750 px-4 py-2 border-r border-slate-200 dark:border-slate-700 shadow-[4px_0_10px_-3px_rgba(0,0,0,0.06)] transition-colors">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-xs shrink-0 shadow-xs">
                                  {emp.nombre?.charAt(0) || "U"}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div
                                    className="text-xs font-bold text-slate-900 dark:text-white truncate"
                                    title={`${emp.nombre} ${emp.apellido}`}
                                  >
                                    {emp.nombre} {emp.apellido}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 truncate">
                                    <span>
                                      ID:{" "}
                                      {emp.clave_empleado ||
                                        emp.device_userid ||
                                        "—"}
                                    </span>
                                    {emp.departamento && (
                                      <>
                                        <span>•</span>
                                        <span className="truncate">
                                          {emp.departamento}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Celdas por Día: orden cronológico de izquierda a derecha */}
                            {dateColumns.map((col) => {
                              const match = empIncs.find(
                                (i) =>
                                  col.id >= i.fecha_inicio &&
                                  col.id <= i.fecha_fin,
                              );

                              return (
                                <td
                                  key={col.id}
                                  onClick={() =>
                                    handleCellClick(emp.id, col.id, match)
                                  }
                                  className={`p-1 text-center border-r border-slate-100 dark:border-slate-800/80 cursor-pointer relative transition-all ${
                                    match
                                      ? "bg-transparent"
                                      : col.isWeekend
                                        ? "bg-slate-50/50 dark:bg-slate-950/30 hover:bg-blue-50/50 dark:hover:bg-blue-950/30"
                                        : "hover:bg-blue-50/60 dark:hover:bg-blue-950/40"
                                  } ${col.isToday ? "ring-1 ring-inset ring-blue-400/20" : ""}`}
                                  title={
                                    match
                                      ? `${match.tipo_incidencia} (${match.estado})\nDel ${match.fecha_inicio} al ${match.fecha_fin}${match.descripcion ? `\nNota: ${match.descripcion}` : ""}`
                                      : `Asignar incidencia el ${col.id} a ${emp.nombre} ${emp.apellido}`
                                  }
                                >
                                  {match ? (
                                    (() => {
                                      const meta = getTipoInfo(
                                        match.tipo_incidencia,
                                      );
                                      return (
                                        <div
                                          className={`inline-flex items-center justify-center w-full py-1 px-1 rounded-lg border text-[10px] font-black shadow-xs transition-transform hover:scale-105 ${meta.color}`}
                                        >
                                          <span className="truncate">
                                            {meta.abbr}
                                          </span>
                                          <span
                                            className={`w-1.5 h-1.5 rounded-full ml-1 shrink-0 ${
                                              match.estado === "Aprobado"
                                                ? "bg-emerald-500"
                                                : match.estado === "Rechazado"
                                                  ? "bg-rose-500"
                                                  : "bg-amber-400 animate-ping"
                                            }`}
                                          />
                                        </div>
                                      );
                                    })()
                                  ) : (
                                    <div className="w-full h-7 flex items-center justify-center group/empty">
                                      <span className="text-slate-300 dark:text-slate-600 group-hover/empty:hidden text-xs">
                                        —
                                      </span>
                                      <span className="hidden group-hover/empty:flex items-center justify-center w-5 h-5 rounded-md bg-blue-600/10 text-blue-600 font-bold text-xs hover:bg-blue-600 hover:text-white transition-colors">
                                        +
                                      </span>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={1 + dateColumns.length}
                          className="px-4 py-12 text-slate-500"
                        >
                          <div className="sticky left-4 w-max max-w-[80vw] text-center">
                            {search
                              ? `No se encontraron coincidencias para "${search}"`
                              : "No hay datos en este rango de fechas."}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              {!loading && filteredEmpleados.length > 0 && (
                <PaginationControl
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  startIndex={startIndex}
                  endIndex={endIndex}
                  nextPage={nextPage}
                  prevPage={prevPage}
                  itemName="colaboradores"
                />
              )}

              {/* Leyenda Visual de Tipos de Incidencia */}
              <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-xs">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                  Leyenda:
                </span>
                {TIPOS_INCIDENCIA.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[10px] font-black border ${t.color}`}
                    >
                      {t.abbr}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                      {t.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modal Agregar / Editar */}
      {modalData && (
        <ModalIncidencia
          incidencia={modalData.incidencia}
          preselectedEmpId={modalData.preselectedEmpId}
          preselectedDate={modalData.preselectedDate}
          empleados={empleados}
          clienteId={currentTenantId}
          userRol={userRol}
          onClose={() => setModalData(null)}
          onSaved={fetchData}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
