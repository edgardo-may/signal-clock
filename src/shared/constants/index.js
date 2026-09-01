import {
  ScanFace,
  Fingerprint,
  CreditCard,
  Hash,
  Shuffle,
} from 'lucide-react'

// ─── Configuración visual de Roles ──────────────────────────────────────────
// La tabla usuarios_perfiles admite roles de tenant; esta fase habilita admin y auditor.
export const ROL_CONFIG = {
  ADMIN: {
    label: 'Administrador',
    cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    dot: 'bg-indigo-400',
    desc: 'Acceso total: Usuarios, biométricos, turnos y configuración global.',
  },
  AUDITOR: {
    label: 'Consulta y Reportes',
    cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
    dot: 'bg-sky-400',
    desc: 'Solo consulta de asistencia, paneles y reportes. No puede modificar información.',
  },
  RH: {
    label: 'Recursos Humanos',
    cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400',
    desc: 'Control de incidencias, días festivos y reportes de asistencia.',
  },
  SUPERVISOR: {
    label: 'Supervisor',
    cls: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    dot: 'bg-violet-400',
    desc: 'Gestión de personal, asignación de horarios y checadas manuales.',
  },
  COLABORADOR: {
    label: 'Colaborador',
    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400',
    desc: 'Acceso a terminal de kiosco y consulta básica de colaboradores.',
  },
}

// ─── Badge Config para Checadas (Tipos) ──────────────────────────────────
export const TIPO_BADGE = {
  entrada:         { label: 'Entrada',    cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500' },
  salida:          { label: 'Salida',     cls: 'bg-rose-500/10    text-rose-600    dark:text-rose-400    border-rose-500/20',    dot: 'bg-rose-500'    },
  descanso_inicio: { label: 'Descanso ↓', cls: 'bg-amber-500/10   text-amber-600   dark:text-amber-400   border-amber-500/20',   dot: 'bg-amber-500'   },
  descanso_fin:    { label: 'Descanso ↑', cls: 'bg-sky-500/10     text-sky-600     dark:text-sky-400     border-sky-500/20',     dot: 'bg-sky-500'     },
  extra:           { label: 'Extra',      cls: 'bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20',  dot: 'bg-violet-500'  },
}

// ─── Configuración visual de Métodos de Marcaje ──────────────────────────
export const METODO_CONFIG = {
  rostro:    { icon: ScanFace,     label: 'Rostro',    cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  huella:    { icon: Fingerprint,  label: 'Huella',    cls: 'bg-blue-500/10    text-blue-600    dark:text-blue-400    border-blue-500/20'    },
  tarjeta:   { icon: CreditCard,   label: 'Tarjeta',   cls: 'bg-amber-500/10   text-amber-600   dark:text-amber-400   border-amber-500/20'   },
  pin:       { icon: Hash,         label: 'PIN',        cls: 'bg-slate-500/10   text-slate-600   dark:text-slate-400   border-slate-500/20'   },
  combinado: { icon: Shuffle,      label: 'Combinado', cls: 'bg-violet-500/10  text-violet-600  dark:text-violet-400  border-violet-500/20'  },
}
