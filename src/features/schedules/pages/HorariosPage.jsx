// src/pages/Horarios.jsx — Catálogo y Configuración de Horarios / Turnos
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from '../../../lib/supabase';
import Sidebar from '../../../shared/components/Layout/Sidebar';
import Header from '../../../shared/components/Layout/Header';
import toast, { Toaster } from "react-hot-toast";
import { useConfirm } from '../../../shared/hooks/useConfirm';
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant';
import TenantSelector from '../../../shared/components/Layout/TenantSelector';
import {
  Clock,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  Copy,
  AlertTriangle,
  X,
  Save,
  Calendar,
  Sun,
  Moon,
  Sunrise,
  Sunset,
  RotateCcw,
  Sparkles,
  Check,
  Hash,
  Search,
  RefreshCw,
  Loader2 as Spinner,
} from "lucide-react";

// Días de la semana en orden
const DIAS_KEYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_NOMBRES = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

const PALETA_COLORES = [
  { hex: "#4f46e5", label: "Índigo" },
  { hex: "#10b981", label: "Esmeralda" },
  { hex: "#0ea5e9", label: "Azul Cielo" },
  { hex: "#f59e0b", label: "Ámbar" },
  { hex: "#8b5cf6", label: "Violeta" },
  { hex: "#f43f5e", label: "Rosa" },
  { hex: "#06b6d4", label: "Cian" },
];

const DIAS_DEFAULT = {
  lun: {
    activo: true,
    entrada: "08:00",
    salida: "17:00",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
  mar: {
    activo: true,
    entrada: "08:00",
    salida: "17:00",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
  mie: {
    activo: true,
    entrada: "08:00",
    salida: "17:00",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
  jue: {
    activo: true,
    entrada: "08:00",
    salida: "17:00",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
  vie: {
    activo: true,
    entrada: "08:00",
    salida: "17:00",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
  sab: {
    activo: false,
    entrada: "08:00",
    salida: "13:00",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
  dom: {
    activo: false,
    entrada: "",
    salida: "",
    tiene_descanso: false,
    descanso_inicio: "",
    descanso_fin: "",
  },
};

const PLANTILLAS_PREDEFINIDAS = [
  {
    nombre: "Jornada Administrativa (8:00 - 17:00)",
    descripcion: "Lunes a Viernes con 1 hora de comida y 10 min de tolerancia.",
    tolerancia_minutos: 10,
    color: "#4f46e5",
    dias_config: { ...DIAS_DEFAULT },
  },
  {
    nombre: "Turno Matutino Industrial (06:00 - 14:00)",
    descripcion: "Lunes a Sábado jornada corrida con 30 min de descanso.",
    tolerancia_minutos: 5,
    color: "#10b981",
    dias_config: {
      lun: {
        activo: true,
        entrada: "06:00",
        salida: "14:00",
        descanso_inicio: "10:00",
        descanso_fin: "10:30",
      },
      mar: {
        activo: true,
        entrada: "06:00",
        salida: "14:00",
        descanso_inicio: "10:00",
        descanso_fin: "10:30",
      },
      mie: {
        activo: true,
        entrada: "06:00",
        salida: "14:00",
        descanso_inicio: "10:00",
        descanso_fin: "10:30",
      },
      jue: {
        activo: true,
        entrada: "06:00",
        salida: "14:00",
        descanso_inicio: "10:00",
        descanso_fin: "10:30",
      },
      vie: {
        activo: true,
        entrada: "06:00",
        salida: "14:00",
        descanso_inicio: "10:00",
        descanso_fin: "10:30",
      },
      sab: {
        activo: true,
        entrada: "06:00",
        salida: "14:00",
        descanso_inicio: "10:00",
        descanso_fin: "10:30",
      },
      dom: {
        activo: false,
        entrada: "",
        salida: "",
        descanso_inicio: "",
        descanso_fin: "",
      },
    },
  },
  {
    nombre: "Turno Vespertino (14:00 - 22:00)",
    descripcion: "Lunes a Sábado con descanso intermedio.",
    tolerancia_minutos: 10,
    color: "#f59e0b",
    dias_config: {
      lun: {
        activo: true,
        entrada: "14:00",
        salida: "22:00",
        descanso_inicio: "18:00",
        descanso_fin: "18:30",
      },
      mar: {
        activo: true,
        entrada: "14:00",
        salida: "22:00",
        descanso_inicio: "18:00",
        descanso_fin: "18:30",
      },
      mie: {
        activo: true,
        entrada: "14:00",
        salida: "22:00",
        descanso_inicio: "18:00",
        descanso_fin: "18:30",
      },
      jue: {
        activo: true,
        entrada: "14:00",
        salida: "22:00",
        descanso_inicio: "18:00",
        descanso_fin: "18:30",
      },
      vie: {
        activo: true,
        entrada: "14:00",
        salida: "22:00",
        descanso_inicio: "18:00",
        descanso_fin: "18:30",
      },
      sab: {
        activo: true,
        entrada: "14:00",
        salida: "22:00",
        descanso_inicio: "18:00",
        descanso_fin: "18:30",
      },
      dom: {
        activo: false,
        entrada: "",
        salida: "",
        descanso_inicio: "",
        descanso_fin: "",
      },
    },
  },
  {
    nombre: "Turno Nocturno (22:00 - 06:00)",
    descripcion: "Jornada nocturna continua de Domingo a Viernes.",
    tolerancia_minutos: 15,
    color: "#8b5cf6",
    dias_config: {
      lun: {
        activo: true,
        entrada: "22:00",
        salida: "06:00",
        descanso_inicio: "02:00",
        descanso_fin: "02:30",
      },
      mar: {
        activo: true,
        entrada: "22:00",
        salida: "06:00",
        descanso_inicio: "02:00",
        descanso_fin: "02:30",
      },
      mie: {
        activo: true,
        entrada: "22:00",
        salida: "06:00",
        descanso_inicio: "02:00",
        descanso_fin: "02:30",
      },
      jue: {
        activo: true,
        entrada: "22:00",
        salida: "06:00",
        descanso_inicio: "02:00",
        descanso_fin: "02:30",
      },
      vie: {
        activo: true,
        entrada: "22:00",
        salida: "06:00",
        descanso_inicio: "02:00",
        descanso_fin: "02:30",
      },
      sab: {
        activo: false,
        entrada: "",
        salida: "",
        descanso_inicio: "",
        descanso_fin: "",
      },
      dom: {
        activo: true,
        entrada: "22:00",
        salida: "06:00",
        descanso_inicio: "02:00",
        descanso_fin: "02:30",
      },
    },
  },
];

// Calcular horas semanales a partir de la configuración de días
function calcularHorasSemanales(diasConfig = {}) {
  let totalMinutos = 0;
  DIAS_KEYS.forEach((d) => {
    const dia = diasConfig[d];
    if (dia?.activo && dia.entrada && dia.salida) {
      const [eH, eM] = dia.entrada.split(":").map(Number);
      const [sH, sM] = dia.salida.split(":").map(Number);
      let minJornada = sH * 60 + sM - (eH * 60 + eM);
      if (minJornada < 0) minJornada += 24 * 60; // Turno nocturno que cruza medianoche

      // Restar descanso si existe
      if (dia.descanso_inicio && dia.descanso_fin) {
        const [dH1, dM1] = dia.descanso_inicio.split(":").map(Number);
        const [dH2, dM2] = dia.descanso_fin.split(":").map(Number);
        let minDescanso = dH2 * 60 + dM2 - (dH1 * 60 + dM1);
        if (minDescanso < 0) minDescanso += 24 * 60;
        minJornada -= minDescanso;
      }

      if (minJornada > 0) totalMinutos += minJornada;
    }
  });
  const hrs = Math.floor(totalMinutos / 60);
  const mins = totalMinutos % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs} hrs`;
}

// ═══════════════════════════════════════════════════════════════
// MODAL: CREAR / EDITAR HORARIO
// ═══════════════════════════════════════════════════════════════
function ModalHorario({ horario, clienteId, onClose, onSaved }) {
  const isEdit = !!horario;
  const [nombre, setNombre] = useState(horario?.nombre || "");
  const [descripcion, setDescripcion] = useState(horario?.descripcion || "");
  const [tolerancia, setTolerancia] = useState(
    horario?.tolerancia_minutos ?? 10,
  );
  const [color, setColor] = useState(horario?.color || "#4f46e5");
  const [dias, setDias] = useState(horario?.dias_config || DIAS_DEFAULT);
  const [activo, setActivo] = useState(horario?.activo ?? true);
  const [saving, setSaving] = useState(false);

  const horasSemanales = useMemo(() => calcularHorasSemanales(dias), [dias]);

  const setDiaProp = (diaKey, prop, val) => {
    setDias((prev) => ({
      ...prev,
      [diaKey]: {
        ...prev[diaKey],
        [prop]: val,
      },
    }));
  };

  const copiarLunesATodos = () => {
    const lun = dias.lun;
    if (!lun) return;
    const updated = { ...dias };
    DIAS_KEYS.forEach((k) => {
      if (k !== "dom") {
        updated[k] = {
          ...updated[k],
          entrada: lun.entrada,
          salida: lun.salida,
          tiene_descanso: lun.tiene_descanso,
          descanso_inicio: lun.descanso_inicio,
          descanso_fin: lun.descanso_fin,
        };
      }
    });
    setDias(updated);
    toast.success("Horario de Lunes replicado a la semana laboral");
  };

  const handleCargarPlantilla = (p) => {
    setNombre(p.nombre);
    setDescripcion(p.descripcion);
    setTolerancia(p.tolerancia_minutos);
    setColor(p.color);
    setDias(p.dias_config);
    toast.success(`Plantilla "${p.nombre}" aplicada`);
  };

  const { confirmDialog, ConfirmDialogNode } = useConfirm();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) {
      toast.error("El nombre del horario es requerido");
      return;
    }

    if (!isEdit) {
      const ok = await confirmDialog({
        title: '¿Crear Horario?',
        message: `¿Estás seguro de crear el horario "${nombre.trim()}"?`,
        variant: 'info',
        confirmLabel: 'Sí, crear'
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const payload = {
        cliente_id: clienteId,
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        tolerancia_minutos: Number(tolerancia) || 0,
        color,
        dias_config: dias,
        activo,
        actualizado_at: new Date().toISOString(),
      };

      if (isEdit) {
        const { error } = await supabase
          .from("horarios")
          .update(payload)
          .eq("id", horario.id);
        if (error) throw error;
        toast.success(`Horario "${nombre}" actualizado`);
      } else {
        const { error } = await supabase.from("horarios").insert(payload);
        if (error) throw error;
        toast.success(`Horario "${nombre}" creado`);
      }

      onSaved();
      onClose();
    } catch (err) {
      toast.error(err?.message || "Error al guardar el horario");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-[95%] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-white border border-slate-200 dark:border-slate-800  shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800  sticky top-0 bg-white dark:bg-white z-10">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-lg text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white ">
                {isEdit ? "Editar Horario / Turno" : "Crear Nuevo Horario"}
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Total acumulado estimado:{" "}
                <strong className="text-blue-600 dark:text-blue-400  font-mono">
                  {horasSemanales} semanales
                </strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:text-slate-300 "
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Plantillas Rápidas si es nuevo */}
          {!isEdit && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Cargar desde plantilla rápida:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PLANTILLAS_PREDEFINIDAS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleCargarPlantilla(p)}
                    className="flex items-center justify-between p-2.5 rounded-md border border-slate-200 dark:border-slate-800  bg-slate-50  hover:border-blue-500 text-left transition-all text-xs group"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-semibold text-slate-900 dark:text-white  group-hover:text-blue-600 dark:text-blue-400">
                        {p.nombre.split(" (")[0]}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      {p.dias_config.lun.entrada}-{p.dias_config.lun.salida}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Datos Generales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Nombre del Turno / Jornada{" "}
                <span className="text-blue-600 dark:text-blue-400">*</span>
              </label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="ej. Turno Matutino 08:00 - 17:00"
                required
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
                Tolerancia de Retardo (Minutos)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={tolerancia}
                  onChange={(e) => setTolerancia(e.target.value)}
                  placeholder="10"
                  className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">
                  min
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Descripción u Observaciones (Opcional)
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Detalles sobre descansos, áreas de aplicación o rotación..."
              className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-200 dark:border-slate-800  bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none focus:border-blue-500"
            />
          </div>

          {/* Selector de Color Distintivo */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ">
              Color Distintivo del Turno
            </label>
            <div className="flex items-center gap-3">
              {PALETA_COLORES.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setColor(c.hex)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    color === c.hex
                      ? "ring-2 ring-offset-2 ring-indigo-500 scale-110"
                      : "opacity-75 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                >
                  {color === c.hex && (
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Matriz Semanal de Configuración */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800  space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white ">
                  Configuración Diaria (Lunes a Domingo)
                </h4>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Activa los días laborables e indica las horas de entrada y
                  salida.
                </p>
              </div>

              <button
                type="button"
                onClick={copiarLunesATodos}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-blue-600 dark:text-blue-400  bg-blue-50 dark:bg-blue-950/60 dark:bg-blue-950/40 border border-blue-500/40  hover:bg-blue-100 transition-colors"
                title="Copia las horas del Lunes al resto de días"
              >
                <Copy className="w-3 h-3" />
                Copiar Lunes a Semana
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {DIAS_KEYS.map((key) => {
                const dia = dias[key] || {};
                return (
                  <div
                    key={key}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-md border transition-all gap-3 ${
                      dia.activo
                        ? "bg-white  border-slate-200 dark:border-slate-800 "
                        : "bg-slate-50  border-slate-200 dark:border-slate-800 opacity-60"
                    }`}
                  >
                    {/* Toggle del día */}
                    <div className="flex items-center gap-3 w-32">
                      <input
                        type="checkbox"
                        id={`dia-${key}`}
                        checked={!!dia.activo}
                        onChange={(e) =>
                          setDiaProp(key, "activo", e.target.checked)
                        }
                        className="w-4 h-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 cursor-pointer"
                      />
                      <label
                        htmlFor={`dia-${key}`}
                        className="text-xs font-bold text-slate-900 dark:text-white  cursor-pointer"
                      >
                        {DIAS_NOMBRES[key]}
                      </label>
                    </div>

                    {/* Inputs de Horas */}
                    {dia.activo ? (
                      <div className="flex-1 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs items-end">
                          <div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold block">Hora de Entrada</span>
                            <input
                              type="time"
                              value={dia.entrada || '08:00'}
                              onChange={e => setDiaProp(key, 'entrada', e.target.value)}
                              className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50 dark:bg-white text-slate-900 dark:text-white  font-mono text-xs"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold block">Hora de Salida</span>
                            <input
                              type="time"
                              value={dia.salida || '17:00'}
                              onChange={e => setDiaProp(key, 'salida', e.target.value)}
                              className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-800  bg-slate-50 dark:bg-white text-slate-900 dark:text-white  font-mono text-xs"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 pb-2">
                            <input
                              type="checkbox"
                              id={`descanso-${key}`}
                              checked={dia.tiene_descanso ?? !!(dia.descanso_inicio && dia.descanso_fin)}
                              onChange={e => {
                                const checked = e.target.checked
                                setDias(prev => ({
                                  ...prev,
                                  [key]: {
                                    ...prev[key],
                                    tiene_descanso: checked,
                                    descanso_inicio: checked ? (prev[key].descanso_inicio || '13:00') : '',
                                    descanso_fin: checked ? (prev[key].descanso_fin || '14:00') : '',
                                  },
                                }))
                              }}
                              className="w-3.5 h-3.5 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 cursor-pointer"
                            />
                            <label htmlFor={`descanso-${key}`} className="text-[11px] font-medium text-slate-700 dark:text-slate-300  cursor-pointer whitespace-nowrap">
                              Descanso intermedio
                            </label>
                          </div>
                        </div>

                        {/* Campos de descanso solo si está activado */}
                        {(dia.tiene_descanso ?? !!(dia.descanso_inicio && dia.descanso_fin)) && (
                          <div className="grid grid-cols-2 gap-2 text-xs p-2 rounded bg-slate-50  border border-slate-200 dark:border-slate-800 ">
                            <div>
                              <span className="text-[10px] text-blue-600 dark:text-blue-400  font-semibold block">Inicio Descanso / Comida</span>
                              <input
                                type="time"
                                value={dia.descanso_inicio || ''}
                                onChange={e => setDiaProp(key, 'descanso_inicio', e.target.value)}
                                placeholder="13:00"
                                className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-800  bg-white dark:bg-white text-slate-900 dark:text-white  font-mono text-xs"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-blue-600 dark:text-blue-400  font-semibold block">Fin Descanso / Comida</span>
                              <input
                                type="time"
                                value={dia.descanso_fin || ''}
                                onChange={e => setDiaProp(key, 'descanso_fin', e.target.value)}
                                placeholder="14:00"
                                className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-800  bg-white dark:bg-white text-slate-900 dark:text-white  font-mono text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500 italic">Día no laborable (Descanso)</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer de Acciones */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800 ">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300  hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white shadow-md transition-all active:scale-98 disabled:opacity-50"
              style={{ backgroundColor: color }}
            >
              {saving ? (
                <>
                  <Spinner size={14} /> Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />{" "}
                  {isEdit ? "Actualizar Horario" : "Guardar Horario"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      {ConfirmDialogNode}
    </div>
  );
}

// COMPONENTE PRINCIPAL: HORARIOS
// ═══════════════════════════════════════════════════════════════
export default function Horarios() {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );

  const {
    isSuperAdmin,
    tenants,
    loadingTenants,
    currentTenantId,
    currentTenant,
    setSelectedTenantId,
    requiresTenantAssignment,
  } = useCurrentTenant();

  const [horarios, setHorarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalForm, setModalForm] = useState(null);

  const { confirmDialog, ConfirmDialogNode } = useConfirm();

  const handleDelete = async (horario) => {
    const ok = await confirmDialog({
      title: 'Eliminar Horario',
      message: '¿Estás seguro de eliminar este turno? Los colaboradores que lo tengan asignado perderán su configuración de jornada.',
      variant: 'danger',
      confirmLabel: 'Confirmar Eliminación'
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("horarios")
        .delete()
        .eq("id", horario.id);
      if (error) throw error;

      toast.success(`Horario "${horario.nombre}" eliminado`);
      fetchHorarios();
    } catch (err) {
      if (err?.code === "23503") {
        toast.error(
          "Este horario tiene colaboradores asignados. Reasigna los turnos antes de eliminarlo.",
        );
      } else {
        toast.error(err?.message || "Error al eliminar el horario");
      }
    }
  };

  // Cargar catálogo de horarios
  const fetchHorarios = useCallback(async () => {
    if (!currentTenantId) {
      setHorarios([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("horarios")
      .select("*")
      .eq("cliente_id", currentTenantId)
      .order("creado_at", { ascending: true });

    if (error) {
      toast.error("Error al cargar horarios: " + error.message);
    } else {
      setHorarios(data || []);
    }
    setLoading(false);
  }, [currentTenantId]);

  useEffect(() => {
    fetchHorarios();
  }, [fetchHorarios]);

  const filtered = horarios.filter((h) => {
    const q = search.toLowerCase();
    return (
      !q ||
      h.nombre.toLowerCase().includes(q) ||
      h.descripcion?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]  text-slate-900 dark:text-white ">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />
      {ConfirmDialogNode}

      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          {/* Banner de Asignación de Tenant (SOLO para usuarios regulares sin cliente_id) */}
          {requiresTenantAssignment && (
            <div className="flex items-center gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
            </div>
          )}

          {/* Barra Superior */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white  flex items-center gap-2.5">
                  <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  Catálogo de Horarios y Turnos
                </h2>
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    SuperAdmin
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                Definición de jornadas laborales para <strong className="text-blue-600 dark:text-blue-400">{currentTenant?.nombre_empresa || 'Empresa'}</strong> ({filtered.length} configurados)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {isSuperAdmin && (
                <TenantSelector
                  tenants={tenants}
                  currentTenantId={currentTenantId}
                  onSelectTenant={setSelectedTenantId}
                  loading={loadingTenants}
                />
              )}

              <button
                onClick={() =>
                  currentTenantId
                    ? setModalForm("nuevo")
                    : toast.error(isSuperAdmin ? "Selecciona una empresa primero" : "Se requiere cliente_id")
                }
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all active:scale-98 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Nuevo Horario</span>
              </button>
            </div>
          </div>

          {/* Buscador */}
          <div className="rounded-sm border border-slate-200 dark:border-slate-800 bg-white p-4 shadow-sm  dark:bg-white flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar turno por nombre o descripción..."
                className="w-full pl-9 pr-4 py-2 rounded-md border border-slate-200 dark:border-slate-800  bg-slate-50  text-xs sm:text-sm text-slate-900 dark:text-white  placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              onClick={fetchHorarios}
              disabled={loading}
              className="p-2 rounded-md border border-slate-200 dark:border-slate-800  text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white  transition-colors"
              title="Recargar"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* Grid de Horarios */}
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-slate-700 dark:text-slate-300 text-sm">
              <Spinner size={18} />
              Cargando catálogo de horarios...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-sm border border-dashed border-slate-200 dark:border-slate-800  p-8 text-center bg-white dark:bg-white">
              <Clock className="w-12 h-12 text-slate-300 dark:text-slate-700 dark:text-slate-300" />
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white ">
                  Aún no tienes horarios configurados
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                  Crea tu primer turno laboral o utiliza una plantilla rápida.
                </p>
              </div>
              <button
                onClick={() => setModalForm("nuevo")}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold text-white bg-blue-600 hover:bg-slate-100 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Crear Horario
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filtered.map((h) => {
                const totalHoras = calcularHorasSemanales(h.dias_config);
                const diasCfg = h.dias_config || {};

                return (
                  <div
                    key={h.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800  bg-white dark:bg-white p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Top Card */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: h.color || "#4f46e5" }}
                          />
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white  leading-tight">
                            {h.nombre}
                          </h3>
                        </div>

                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400  border border-blue-500/40  whitespace-nowrap">
                          {totalHoras}
                        </span>
                      </div>

                      {h.descripcion && (
                        <p className="text-xs text-slate-700 dark:text-slate-300  mb-4 line-clamp-2">
                          {h.descripcion}
                        </p>
                      )}

                      {/* Tolerancia */}
                      <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300  mb-4 font-medium">
                        <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60  font-mono text-[11px]">
                          Tolerancia: {h.tolerancia_minutos} min
                        </span>
                        <span className="text-slate-400 dark:text-slate-500">·</span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {
                            Object.values(diasCfg).filter((d) => d?.activo)
                              .length
                          }{" "}
                          días activos
                        </span>
                      </div>

                      {/* Badges de días */}
                      <div className="flex items-center justify-between gap-1 pt-3 border-t border-slate-200 dark:border-slate-800  mb-4">
                        {DIAS_KEYS.map((k) => {
                          const isActivo = diasCfg[k]?.activo;
                          return (
                            <div
                              key={k}
                              className={`flex flex-col items-center justify-center w-8 h-10 rounded text-[10px] font-bold uppercase transition-colors ${
                                isActivo
                                  ? "bg-blue-50 dark:bg-blue-950/60  text-blue-600 dark:text-blue-400  border border-blue-500/40 "
                                  : "bg-blue-50 dark:bg-blue-950/60  text-slate-400 dark:text-slate-500 dark:text-slate-700 dark:text-slate-300 border border-transparent"
                              }`}
                              title={`${DIAS_NOMBRES[k]}: ${isActivo ? `${diasCfg[k]?.entrada} - ${diasCfg[k]?.salida}` : "Descanso"}`}
                            >
                              <span>{k}</span>
                              <span className="text-[8px] font-normal">
                                {isActivo ? "✓" : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800 ">
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {h.dias_config?.lun?.activo
                          ? `${h.dias_config.lun.entrada} - ${h.dias_config.lun.salida}`
                          : "Horario variable"}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setModalForm(h)}
                          className="p-1.5 rounded hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-sky-600 transition-colors"
                          title="Editar Horario"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(h)}
                          className="p-1.5 rounded hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:text-rose-600 transition-colors"
                          title="Eliminar Horario"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Modales */}
      {modalForm && (
        <ModalHorario
          horario={modalForm === "nuevo" ? null : modalForm}
          clienteId={currentTenantId}
          onClose={() => setModalForm(null)}
          onSaved={fetchHorarios}
        />
      )}
    </div>
  );
}






