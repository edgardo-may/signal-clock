# Signum Clock — Interface Design System

> Guardado el 2026-08-26. Aplica a todos los módulos de la aplicación.

---

## Identidad y dirección

**Producto:** Signum Clock — SaaS empresarial de control de asistencia y acceso biométrico.

**Usuario:** Administrador de RH o TI en una empresa mediana. Abre la app varias veces al día para revisar checadas, sincronización de dispositivos y alertas. Necesita escanear información rápido y confiar en que los datos son reales.

**Sensación objetivo:** Tecnológica, limpia, profesional. Como un panel de control industrial refinado — no un dashboard de plantilla. Densidad media: ni espartano ni saturado.

---

## Paleta

| Token semántico | Valor | Uso |
|---|---|---|
| Brand primary | `#03363D` | CTAs principales, tab activo, focus ring, texto énfasis oscuro |
| Brand secondary | `#BDD9D7` | Badges de tipo "general", hint boxes, acentos sutiles |
| Surface base | `white / slate-900` | Fondo de cards y tablas |
| Surface raised | `slate-50 / slate-800` | Hover rows, filter bar bg |
| Border default | `slate-200 / slate-800` | Bordes de cards, tablas |
| Border soft | `slate-100 / slate-800/50` | Divisores de filas internos |
| Text primary | `slate-900 / white` | Nombres, valores principales |
| Text secondary | `slate-700 / slate-300` | Contenido de soporte |
| Text muted | `slate-500 / slate-400` | Labels, metadata, timestamps |
| Text subtle | `slate-400 / slate-500` | Placeholders, íconos decorativos |

### Semántica de estados

| Estado | Background | Text | Border | Dot |
|---|---|---|---|---|
| Online / Success | `emerald-500/10` | `emerald-700 / emerald-400` | `emerald-200 / emerald-500/20` | `bg-emerald-500 animate-pulse` |
| Warning / Pending | `amber-500/10` | `amber-700 / amber-400` | `amber-200 / amber-500/20` | `bg-amber-400` |
| Processing | `blue-500/10` | `blue-700 / blue-400` | `blue-200 / blue-500/20` | `bg-blue-500 animate-pulse` |
| Error | `rose-500/10` | `rose-700 / rose-400` | `rose-200 / rose-500/20` | `bg-rose-500` |
| Disabled / Neutral | `slate-100 / slate-800` | `slate-500 / slate-400` | `slate-200 / slate-700` | `bg-slate-400` |
| Never connected | `amber-500/10` | `amber-700 / amber-400` | `amber-200 / amber-500/20` | `bg-amber-400` |
| Brand type badge | `[#BDD9D7]/30` | `[#03363D] / teal-300` | `[#BDD9D7]/50` | — |

---

## Tipografía

Escala jerárquica (4 niveles). Nunca usar solo tamaño — siempre combinar `size + weight + color`.

| Nivel | Clase | Uso |
|---|---|---|
| Primary | `text-sm font-semibold text-slate-900 dark:text-white` | Nombres de empleados, dispositivos, filas principales |
| Secondary | `text-sm text-slate-700 dark:text-slate-300` | Contenido de soporte en la misma fila |
| Metadata | `text-xs text-slate-500 dark:text-slate-400` | SN, ubicación, timestamps |
| Micro | `text-[11px] font-mono text-slate-400` | IDs, códigos, valores técnicos |
| Label | `text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500` | Encabezados de tabla y sección |
| Section title | `text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400` | Separadores de sección en forms |
| Page/card title | `text-sm font-semibold text-slate-800 dark:text-slate-200` | Header de cards |

**Reglas:**
- Números dinámicos (KPIs, contadores): siempre `tabular-nums`
- Encabezados de sección: NO usar numeración `1. 2. 3.` — usar separador visual `border-t` en forms
- Texto de fecha: `text-sm text-slate-800` para la fecha + `text-xs font-mono font-semibold text-slate-500` para la hora

---

## Espaciado

Base unit: **4px (Tailwind × 1 = 4px)**. Solo múltiplos.

| Contexto | Valor | Clase |
|---|---|---|
| Gap icono → texto | 8px | `gap-2` |
| Gap icono → texto compacto | 6px | `gap-1.5` |
| Padding interno de card | 20px | `p-5` |
| Padding de fila de tabla | 20px h / 14px v | `px-5 py-3.5` |
| Padding de toolbar / header de card | 16px h / 12px v | `px-4 py-3` / `px-5 py-4` |
| Separación entre secciones | 20px–24px | `space-y-5` / `space-y-6` |
| Gap entre cards de grid | 16px–20px | `gap-4` / `gap-5` |
| Padding formulario vertical | 24px | `p-6 space-y-6` |
| Separación entre campos de form | 16px | `gap-4` |
| Margen label → input | 6px | `mb-1.5` |

---

## Profundidad

**Estrategia: border-only para contenedores, sombra mínima solo en modales.**

- Cards y tablas: `border border-slate-200 dark:border-slate-800` — SIN shadow
- Modales: `shadow-xl shadow-black/10` + `backdrop-blur-sm`
- Hover rows: `hover:bg-slate-50/60 dark:hover:bg-slate-800/30` — sin borde adicional
- Inputs: `bg-slate-50 dark:bg-slate-800/80` (ligeramente más oscuro que la superficie → señal "recibo input")

**No mezclar**: si un contenedor tiene `shadow-sm` + `border` + `bg` diferenciado, es demasiado. Elegir uno.

---

## Bordes y radio

| Elemento | Radio | Clase |
|---|---|---|
| Cards / tablas / modales | 12px | `rounded-xl` |
| Inputs / selects | 8px | `rounded-lg` |
| Badges tipo pill (status) | full | `rounded-full` |
| Badges tipo chip (tipo dispositivo) | 6px | `rounded-md` |
| Íconos contenedor (KPI) | 8px | `rounded-lg` |
| Íconos contenedor (device avatar) | 8px | `rounded-lg` |
| Botones CTA | 8px | `rounded-lg` |
| Botones icon-action | 6px | `rounded-lg` |
| Botones de tipo selector (policy) | 8px | `rounded-lg` |

**Regla de oro:** Si el elemento está dentro de otro redondeado, su radio debe ser = radio_padre − padding. Nunca el mismo radio en contenedor e hijo.

---

## Componentes clave

### Status badge (pill)
```jsx
// Estado de conectividad / sincronización
<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${status.badge}`}>
  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.dot}`} />
  {status.label}
</span>
```
Siempre pill (`rounded-full`) + dot de color + texto. NUNCA solo color sin texto para accesibilidad.

### Status badge (chip pequeño — tipo dispositivo)
```jsx
<span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border ${typeInfo.badge}`}>
  <TypeIcon className="w-3 h-3" />
  {typeInfo.label}
</span>
```

### Botón CTA primario
```jsx
// 36px h · 12px v / 20px h · rounded-lg · 14px/600
<button className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#03363D] hover:bg-[#03363D]/90 shadow-sm transition-all disabled:opacity-50">
```

### Botón secundario
```jsx
<button className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
```

### Botón icon-action (hover reveal en tabla)
```jsx
// Grupo en <tr className="group">
<button className="p-1.5 rounded-lg text-slate-400 hover:text-[#03363D] dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100">
```
Acciones destructivas usan `hover:text-rose-500 hover:bg-rose-50`.

### Input / Select
```jsx
// Clase reutilizable
const inputClass = 'w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all placeholder:text-slate-400'
```

### Header de card (con enlace "ver todas")
```jsx
<div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
  <div className="flex items-center gap-2">
    <Icon className="w-4 h-4 text-slate-400" />
    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Título</h4>
  </div>
  <button className="text-xs text-[#03363D] dark:text-teal-400 hover:underline flex items-center gap-1">
    Ver todas <ArrowRight className="w-3.5 h-3.5" />
  </button>
</div>
```

### Fila vacía (empty state)
```jsx
<td colSpan={N} className="px-5 py-14 text-center">
  <Icon className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Mensaje principal</p>
  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Descripción de apoyo</p>
</td>
```

### Hint contextual (ZKTeco SN)
```jsx
// Caja de ayuda — no alert, no advertencia
<div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#BDD9D7]/20 border border-[#BDD9D7]/40">
  <Info className="w-3.5 h-3.5 text-[#03363D]/60 dark:text-teal-400 flex-shrink-0 mt-0.5" />
  <p className="text-xs text-[#03363D]/80 dark:text-teal-300/80 leading-relaxed">
    Mensaje de ayuda contextual.
  </p>
</div>
```

---

## Tokens de estado del dispositivo ZKTeco

```js
const STATUS_CONFIG = {
  online:   { label: 'Online',           dot: 'bg-emerald-500 animate-pulse', badge: 'bg-emerald-500/10 ...' },
  offline:  { label: 'Offline',          dot: 'bg-rose-500',                  badge: 'bg-rose-500/10 ...' },
  pending:  { label: 'Nunca conectado',  dot: 'bg-amber-400',                 badge: 'bg-amber-500/10 ...' },
  disabled: { label: 'Deshabilitado',   dot: 'bg-slate-400',                 badge: 'bg-slate-100 ...' },
}

function getDeviceStatus(d) {
  if (!d.is_active) return 'disabled'
  if (!d.last_activity) return 'pending'
  if (new Date() - new Date(d.last_activity) < 5 * 60 * 1000) return 'online'
  return 'offline'
}
```

---

## Tokens de estado de sincronización ADMS

```js
const SYNC_STATUS = {
  SYNCED:  { label: 'Sincronizado',  badge: 'bg-emerald-50 ... border-emerald-200 ...', dot: 'bg-emerald-500' },
  SYNCING: { label: 'Sincronizando', badge: 'bg-blue-50 ... border-blue-200 ...',    dot: 'bg-blue-500 animate-pulse' },
  ERROR:   { label: 'Error',         badge: 'bg-rose-50 ... border-rose-200 ...',    dot: 'bg-rose-500' },
  PENDING: { label: 'Pendiente',     badge: 'bg-amber-50 ... border-amber-200 ...',  dot: 'bg-amber-400' },
}
```

---

## Tokens de estado ATTLOG (ZKTeco protocolo)

```js
const ATTLOG_STATUS = {
  '0': { label: 'Entrada',          style: 'bg-emerald-50 ... border-emerald-200 ...' },
  '1': { label: 'Salida',           style: 'bg-slate-100 ... border-slate-200 ...' },
  '2': { label: 'Salida a comer',   style: 'bg-orange-50 ... border-orange-200 ...' },
  '3': { label: 'Regreso de comer', style: 'bg-amber-50 ... border-amber-200 ...' },
  '4': { label: 'Entrada extra',    style: 'bg-blue-50 ... border-blue-200 ...' },
  '5': { label: 'Salida extra',     style: 'bg-purple-50 ... border-purple-200 ...' },
}
// Fallback: `Estado: ${status ?? '—'}`
```

---

## Responsive

| Breakpoint | Estrategia |
|---|---|
| `md` (768px+) | Tabla completa visible |
| `< md` | Cards móviles con datos prioritarios, acciones en footer de card |
| `sm` (640px+) | Grid 2 cols en forms, 2 cols en toolbars |
| `< sm` | Stack vertical en toolbar, cards full-width |

**Regla:** NO resolver mobile con solo `overflow-x-auto`. Si la tabla tiene >4 columnas y alguna es secundaria, usar cards en mobile. La estrategia es `hidden md:table` + `block md:hidden` (cards).

---

## Patrones prohibidos

- `shadow-sm` + `border` + `bg` diferente en la misma card → elegir máximo 2
- Acciones siempre visibles en tablas → usar `group-hover:opacity-100`
- Estado del servidor hardcodeado como "Activo" sin datos reales
- Múltiples badges de estado en la misma fila (uno solo)
- Radio idéntico en contenedor e hijo anidado
- `text-[10px]` como tamaño principal — reservar para metadata extrema
- Títulos de sección numerados (`1. Identificación`) — usar `border-t` + label
- Botones con el mismo peso visual en la misma fila

---

## Íconos (Lucide React)

Tamaños estándar:

| Contexto | Clase |
|---|---|
| Ícono en tabla header de card | `w-4 h-4` |
| Ícono en KPI contenedor | `w-3.5 h-3.5` |
| Ícono de estado / dot | `w-1.5 h-1.5 rounded-full` (solo span, no ícono) |
| Ícono en botón icon-action | `w-4 h-4` |
| Ícono en badge de tipo | `w-3 h-3` |
| Ícono en hint / info box | `w-3.5 h-3.5` |
| Ícono empty state | `w-8 h-8` |
