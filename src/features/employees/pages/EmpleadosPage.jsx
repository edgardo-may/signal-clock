// src/pages/Empleados.jsx — Módulo de Gestión de Empleados (Datos Laborales con Clave de Colaborador)
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from "../../../lib/supabase"
import Sidebar from "../../../shared/components/Layout/Sidebar"
import Header from "../../../shared/components/Layout/Header"
import toast, { Toaster } from 'react-hot-toast'
import { useConfirm } from '../../../shared/hooks/useConfirm'
import { useTenantLimits } from '../../../shared/hooks/useTenantLimits'
import { useCurrentTenant } from '../../../shared/hooks/useCurrentTenant'
import { usePagination } from '../../../shared/hooks/usePagination'
import TenantSelector from '../../../shared/components/Layout/TenantSelector'
import PaginationControl from '../../../shared/components/ui/PaginationControl'
import { useAuth } from '../../auth/hooks/useAuth'
import {
  Users, UserPlus, Search, Filter, Eye, Edit3, Trash2,
  X, Save, AlertTriangle, User, Building2,
  Fingerprint, Mail, Briefcase, ShieldCheck,
  ShieldOff, RefreshCw, CheckCircle2, XCircle, Hash,
  Calendar, CalendarDays, CreditCard, Heart,
  Upload, Download, FileSpreadsheet, FileDown, Check,
  BadgeCheck, ChevronLeft, ChevronRight,
} from 'lucide-react'

// ─── Helpers ───────────────────────────────────────────────────────────────
function getInitials(nombre = '', apellido = '') {
  return `${nombre[0] ?? ''}${apellido[0] ?? ''}`.toUpperCase() || '?'
}

function formatDate(ts) {
  if (!ts) return '—'
  const parts = String(ts).split('T')[0].split('-')
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(d)
  }
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(ts))
}

const AVATAR_PALETTES = [
  { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-600 dark:text-blue-400 ', border: 'border-blue-500/30' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30' },
  { bg: 'bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' },
  { bg: 'bg-rose-500/20', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30' },
  { bg: 'bg-violet-500/20', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/30' },
  { bg: 'bg-sky-500/20', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/30' },
]

function paletteFor(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return AVATAR_PALETTES[h % AVATAR_PALETTES.length]
}

function Spinner({ size = 16 }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size }}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function FormInput({
  id, label, type = 'text', icon: Icon,
  value, onChange, placeholder, required,
  hint, error, disabled,
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 "
      >
        {label}{required && <span className="text-blue-600 dark:text-blue-400 ml-0.5">*</span>}
      </label>
      <div className="relative">
        {Icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-slate-500">
            <Icon className="w-4 h-4" strokeWidth={1.8} />
          </div>
        )}
        <input
          id={id}
          type={type}
          value={value ?? ''}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`w-full py-2.5 text-xs sm:text-sm rounded-md border bg-white  text-slate-900 dark:text-white  placeholder-slate-400 outline-none transition-all duration-200 disabled:opacity-50 ${
            error
              ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'
              : 'border-slate-200 dark:border-slate-800  focus:border-blue-500 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
          }`}
          style={{
            paddingLeft: Icon ? '2.5rem' : '0.875rem',
            paddingRight: '0.875rem',
          }}
        />
      </div>
      {hint && !error && <p className="text-[11px] text-slate-700 dark:text-slate-300">{hint}</p>}
      {error && <p className="text-[11px] text-rose-500 font-medium">{error}</p>}
    </div>
  )
}

function EstatusBadge({ activo }) {
  return activo ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Activo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F8FAFC]0/10 text-slate-700 dark:text-slate-300  border border-slate-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Inactivo
    </span>
  )
}

function AvatarCircle({ empleado, size = 36 }) {
  const pal = paletteFor(empleado.id ?? empleado.nombre)
  return empleado.avatar_url ? (
    <img
      src={empleado.avatar_url}
      alt={`${empleado.nombre} ${empleado.apellido}`}
      className="rounded-full object-cover border border-slate-200 dark:border-slate-800 "
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className={`rounded-full flex items-center justify-center font-bold border ${pal.bg} ${pal.text} ${pal.border}`}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {getInitials(empleado.nombre, empleado.apellido)}
    </div>
  )
}

// ─── CSV Helpers: Descarga de Plantilla y Exportación ───────────────────────
function descargarPlantillaCSV() {
  const encabezados = [
    'nombre',
    'apellido',
    'clave_empleado',
    'departamento',
    'puesto',
    'device_userid',
    'tarjeta',
    'sexo',
    'fecha_ingreso',
    'fecha_cumpleanos',
  ]

  const ejemplos = [
    ['Carlos', 'Mendoza', 'EMP-101', 'Operaciones', 'Supervisor', '101', '0008459201', 'M', '2023-01-15', '1990-05-20'],
    ['Mariana', 'López', 'EMP-102', 'Recursos Humanos', 'Coordinadora', '102', '0008459202', 'F', '2022-06-01', '1994-11-12'],
    ['Roberto', 'Hernández', 'EMP-103', 'Sistemas', 'Ingeniero TI', '103', '0008459203', 'M', '2021-03-10', '1988-08-30'],
  ]

  const lineas = [
    encabezados.join(','),
    ...ejemplos.map(fila => fila.map(val => `"${val}"`).join(',')),
  ]

  const contenido = '\uFEFF' + lineas.join('\n')
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla_colaboradores_signum_clock.csv'
  a.click()
  URL.revokeObjectURL(url)
  toast.success('Plantilla CSV descargada exitosamente')
}

function exportarEmpleadosCSV(empleados) {
  if (!empleados || empleados.length === 0) {
    toast.error('No hay colaboradores para exportar')
    return
  }

  const encabezados = [
    'Clave de Colaborador',
    'ID Biométrico (Device UserID)',
    'Nombre',
    'Apellido',
    'Departamento',
    'Puesto',
    'Tarjeta RFID',
    'Sexo',
    'Fecha de Ingreso',
    'Fecha de Cumpleaños',
    'Estatus',
  ]

  const filas = empleados.map(emp => [
    emp.clave_empleado || '',
    emp.device_userid || '',
    emp.nombre || '',
    emp.apellido || '',
    emp.departamento || '',
    emp.puesto || '',
    emp.tarjeta || '',
    emp.sexo || 'M',
    emp.fecha_ingreso ? String(emp.fecha_ingreso).split('T')[0] : '',
    emp.fecha_cumpleanos ? String(emp.fecha_cumpleanos).split('T')[0] : '',
    emp.activo ? 'Activo' : 'Inactivo',
  ])

  const lineas = [
    encabezados.join(','),
    ...filas.map(fila => fila.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')),
  ]

  const contenido = '\uFEFF' + lineas.join('\n')
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `colaboradores_export_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`Exportados ${empleados.length} colaboradores`)
}

// Helper para normalizar cualquier formato de fecha a ISO YYYY-MM-DD
function normalizeToISODate(str) {
  if (!str) return null
  const s = String(str).trim()
  if (!s) return null

  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (isoMatch) {
    const y = isoMatch[1]
    const m = isoMatch[2].padStart(2, '0')
    const d = isoMatch[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0')
    const m = dmyMatch[2].padStart(2, '0')
    const y = dmyMatch[3]
    return `${y}-${m}-${d}`
  }

  const dmyShortMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/)
  if (dmyShortMatch) {
    const d = dmyShortMatch[1].padStart(2, '0')
    const m = dmyShortMatch[2].padStart(2, '0')
    let y = parseInt(dmyShortMatch[3], 10)
    y = y > 50 ? 1900 + y : 2000 + y
    return `${y}-${m}-${d}`
  }

  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return null
}

// ═══════════════════════════════════════════════════════════════
// MODAL: IMPORTAR COLABORADORES VÍA CSV
// ═══════════════════════════════════════════════════════════════
function ModalImportCSV({ clienteId, disponibles, onClose, onImported }) {
  const [csvFile, setCsvFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [parseErrors, setParseErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const parseCSVText = (text) => {
    const lines = text
      .split(/\r\n|\n/)
      .map(l => l.trim())
      .filter(Boolean)

    if (lines.length <= 1) {
      setParseErrors(['El archivo CSV está vacío o solo contiene encabezados.'])
      setParsedRows([])
      return
    }

    const delimiter = lines[0].includes(';') ? ';' : ','
    const headers = lines[0]
      .split(delimiter)
      .map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase())

    const rows = []
    const errors = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue

      const regex = new RegExp(`(?:${delimiter}|^)(?:"([^"]*)"|([^"${delimiter}]*))`, 'g')
      const matches = []
      let match
      while ((match = regex.exec(line)) !== null) {
        matches.push((match[1] || match[2] || '').trim())
      }

      const rowObj = {}
      headers.forEach((h, index) => {
        rowObj[h] = matches[index] || ''
      })

      const nombre = rowObj['nombre'] || rowObj['first_name'] || ''
      const apellido = rowObj['apellido'] || rowObj['last_name'] || ''
      const clave = rowObj['clave_empleado'] || rowObj['clave_colaborador'] || rowObj['clave'] || ''
      const depto = rowObj['departamento'] || rowObj['area'] || ''
      const puesto = rowObj['puesto'] || rowObj['cargo'] || ''
      const devId = rowObj['device_userid'] || rowObj['hikvision_device_userid'] || rowObj['id_biometrico'] || rowObj['userid'] || ''
      const tarjeta = rowObj['tarjeta'] || rowObj['rfid'] || rowObj['card_no'] || ''
      const sexo = (rowObj['sexo'] || rowObj['genero'] || 'M').toUpperCase().charAt(0)
      const rawIngreso = rowObj['fecha_ingreso'] || rowObj['ingreso'] || ''
      const rawCumple = rowObj['fecha_cumpleanos'] || rowObj['cumpleanos'] || rowObj['nacimiento'] || rowObj['fecha_nacimiento'] || ''

      const ingreso = normalizeToISODate(rawIngreso)
      const cumple = normalizeToISODate(rawCumple)

      const rowErrors = []
      if (!nombre) rowErrors.push('Falta nombre')
      if (!apellido) rowErrors.push('Falta apellido')
      if (!devId) rowErrors.push('Falta ID biométrico')
      else if (!/^\d+$/.test(devId)) rowErrors.push('ID biométrico no es numérico')

      if (rawIngreso && !ingreso) rowErrors.push('Fecha de ingreso no reconocida')
      if (rawCumple && !cumple) rowErrors.push('Fecha de cumpleaños no reconocida')

      rows.push({
        lineNum: i + 1,
        nombre,
        apellido,
        clave_empleado: clave,
        departamento: depto,
        puesto,
        device_userid: devId,
        tarjeta,
        sexo: ['M', 'F'].includes(sexo) ? sexo : 'M',
        fecha_ingreso: ingreso,
        fecha_cumpleanos: cumple,
        errors: rowErrors,
        isValid: rowErrors.length === 0,
      })
    }

    setParsedRows(rows)
    setParseErrors(errors)
  }

  const handleFileChange = (file) => {
    if (!file) return
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      toast.error('Selecciona un archivo con formato .csv')
      return
    }

    setCsvFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      parseCSVText(e.target.result)
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0])
    }
  }

  const handleExecuteImport = async () => {
    const validRows = parsedRows.filter(r => r.isValid)
    if (validRows.length === 0) {
      toast.error('No hay registros válidos para importar.')
      return
    }

    if (disponibles !== undefined && validRows.length > disponibles) {
      toast.error(`No puedes importar ${validRows.length} colaboradores porque superarías el límite de tu plan. Espacios disponibles: ${disponibles}. Contacta a Signum-Clock Central para ampliar tu capacidad.`, { duration: 7000 })
      return
    }

    setImporting(true)
    let insertados = 0

    try {
      const payloads = validRows.map(r => ({
        cliente_id: clienteId,
        nombre: r.nombre,
        apellido: r.apellido,
        clave_empleado: r.clave_empleado || null,
        departamento: r.departamento || null,
        puesto: r.puesto || null,
        device_userid: r.device_userid,
        tarjeta: r.tarjeta || null,
        sexo: r.sexo || 'M',
        fecha_ingreso: r.fecha_ingreso || null,
        fecha_cumpleanos: r.fecha_cumpleanos || null,
        activo: true,
      }))

      const { error } = await supabase.from('empleados').insert(payloads)
      if (error) throw error

      insertados = payloads.length
      toast.success(`¡${insertados} colaboradores importados exitosamente!`)
      onImported()
      onClose()
    } catch (err) {
      if (err?.code === '23505') {
        toast.error('Error: Uno o más IDs biométricos ya existen en su empresa.')
      } else {
        toast.error('Error en la importación: ' + (err?.message || ''))
      }
    } finally {
      setImporting(false)
    }
  }

  const totalValid = parsedRows.filter(r => r.isValid).length
  const totalInvalid = parsedRows.length - totalValid

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-[95%] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Importación Masiva de Colaboradores (CSV)
              </h3>
              <p className="text-xs text-slate-700">
                Carga masiva de empleados para sincronización con terminales biométricas
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 ${
              dragOver
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="p-3 rounded-full bg-blue-50 text-blue-600">
                <FileSpreadsheet className="w-8 h-8" strokeWidth={1.6} />
              </div>
              <p className="text-sm font-semibold text-slate-900">
                {csvFile ? csvFile.name : 'Haz clic para seleccionar o arrastra tu archivo CSV'}
              </p>
              <p className="text-xs text-slate-700">
                Formato UTF-8 delimitado por comas o punto y coma (.csv)
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3.5 rounded-md bg-[#F8FAFC] border border-slate-200 gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <FileDown className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span>¿No conoces el formato requerido? Descarga la plantilla oficial.</span>
            </div>
            <button
              type="button"
              onClick={descargarPlantillaCSV}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-white text-blue-600 border border-slate-200 hover:bg-blue-50 transition-colors whitespace-nowrap shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar Plantilla CSV
            </button>
          </div>

          {parsedRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Vista Previa ({parsedRows.length} filas detectadas)
                </h4>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {totalValid} válidos
                  </span>
                  {totalInvalid > 0 && (
                    <span className="text-rose-600 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {totalInvalid} con error
                    </span>
                  )}
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs table-auto">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Fila</th>
                      <th className="px-3 py-2">Clave Laboral</th>
                      <th className="px-3 py-2">ID Biométrico</th>
                      <th className="px-3 py-2">Nombre Completo</th>
                      <th className="px-3 py-2">Departamento</th>
                      <th className="px-3 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(3,54,61,0.07)]">
                    {parsedRows.map((r, i) => (
                      <tr
                        key={i}
                        className={r.isValid ? 'hover:bg-slate-50' : 'bg-rose-50/50'}
                      >
                        <td className="px-3 py-2 font-mono text-slate-400">{r.lineNum}</td>
                        <td className="px-3 py-2 font-mono text-slate-700 font-semibold">
                          {r.clave_empleado || '—'}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-blue-600">
                          {r.device_userid || '—'}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {r.nombre} {r.apellido}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.departamento || '—'}</td>
                        <td className="px-3 py-2">
                          {r.isValid ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Válido
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 font-semibold" title={r.errors.join(', ')}>
                              <XCircle className="w-3.5 h-3.5" /> {r.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleExecuteImport}
            disabled={importing || totalValid === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all active:scale-98 disabled:opacity-50"
          >
            {importing ? <><Spinner size={14} /> Importando...</> : <><Upload className="w-4 h-4" /> Importar {totalValid} Colaboradores</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MODAL: ALTA / EDICIÓN
// ═══════════════════════════════════════════════════════════════
const EMPTY_FORM = {
  nombre: '',
  apellido: '',
  clave_empleado: '',
  departamento: '',
  puesto: '',
  pin: '',
  device_userid: '',
  tarjeta: '',
  sexo: 'M',
  fecha_ingreso: '',
  fecha_cumpleanos: '',
  activo: true,
}

function ModalForm({ empleado, empleados = [], clienteId, isSuperAdmin, tenants = [], currentTenant, onClose, onSaved }) {
  const { confirmDialog, ConfirmDialogNode } = useConfirm()
  const isEdit = !!empleado
  const [targetClienteId, setTargetClienteId] = useState(
    isEdit ? (empleado.cliente_id || clienteId) : (clienteId || tenants[0]?.id || '')
  )
  const [form, setForm] = useState(
    isEdit
      ? {
          ...EMPTY_FORM,
          ...empleado,
          pin: empleado.pin || '',
          device_userid: empleado.device_userid || '',
          fecha_ingreso: empleado.fecha_ingreso ? String(empleado.fecha_ingreso).split('T')[0] : '',
          fecha_cumpleanos: empleado.fecha_cumpleanos ? String(empleado.fecha_cumpleanos).split('T')[0] : '',
        }
      : { ...EMPTY_FORM }
  )
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [showPin, setShowPin] = useState(false)

  useEffect(() => {
    if (!isEdit) {
      if (empleados && empleados.length > 0) {
        const maxId = empleados.reduce((max, emp) => {
          const current = parseInt(emp.device_userid, 10)
          return (!isNaN(current) && current > max) ? current : max
        }, 0)
        setForm(f => ({ ...f, device_userid: String(maxId + 1) }))
      } else {
        setForm(f => ({ ...f, device_userid: '1' }))
      }
    }
  }, [isEdit, empleados])

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
    setErrors(er => ({ ...er, [field]: undefined }))
  }

  const validate = () => {
    const e = {}
    if (!form.nombre.trim()) e.nombre = 'Campo requerido'
    if (!form.apellido.trim()) e.apellido = 'Campo requerido'
    if (form.device_userid && !/^\d+$/.test(form.device_userid.trim())) {
      e.device_userid = 'Solo dígitos numéricos'
    }
    if (form.pin && !/^\d{4,10}$/.test(form.pin.trim())) {
      e.pin = 'El PIN debe contener entre 4 y 10 dígitos numéricos'
    }
    if (isSuperAdmin && !targetClienteId) {
      e.cliente_id = 'Debes seleccionar una empresa destino'
    }
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    const finalClienteId = isSuperAdmin ? targetClienteId : clienteId
    if (!finalClienteId) {
      toast.error('No se pudo determinar el tenant destino.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        clave_empleado: form.clave_empleado ? form.clave_empleado.trim() : null,
        departamento: form.departamento.trim() || null,
        puesto: form.puesto.trim() || null,
        pin: form.pin ? form.pin.trim() : null,
        device_userid: form.device_userid.trim(),
        tarjeta: form.tarjeta ? form.tarjeta.trim() : null,
        sexo: form.sexo || 'M',
        fecha_ingreso: form.fecha_ingreso || null,
        fecha_cumpleanos: form.fecha_cumpleanos || null,
        activo: form.activo,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('empleados')
          .update({ ...payload, actualizado_at: new Date().toISOString() })
          .eq('id', empleado.id)
        if (error) throw error
        toast.success(`${payload.nombre} ${payload.apellido} actualizado`)
      } else {
        const selectedCompany = tenants.find(t => t.id === finalClienteId)
        const companyName = selectedCompany ? ` (${selectedCompany.nombre_empresa})` : ''

        const ok = await confirmDialog({
          title: '¿Registrar Colaborador?',
          message: `Se registrará a ${payload.nombre} ${payload.apellido}${companyName}.`,
          variant: 'info',
          confirmLabel: 'Sí, registrar'
        });
        if (!ok) return;

        const { error } = await supabase
          .from('empleados')
          .insert({ ...payload, cliente_id: finalClienteId })
        if (error) throw error
        toast.success(`${payload.nombre} ${payload.apellido} registrado exitosamente`)
      }

      onSaved()
      onClose()
    } catch (err) {
      if (err?.code === '23505') {
        setErrors({ device_userid: 'Este ID biométrico ya existe en su empresa.' })
        toast.error('ID biométrico duplicado en la terminal')
      } else {
        toast.error(err?.message ?? 'Error al guardar el colaborador')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-[95%] sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              {isEdit ? <Edit3 className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isEdit ? 'Editar Colaborador' : 'Registrar Nuevo Colaborador'}
              </h3>
              <p className="text-xs text-slate-700">
                {isEdit ? `${empleado.nombre} ${empleado.apellido}` : 'Vinculación de datos personales, laborales y hardware'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5">
          {/* ── Selector de Tenant Destino (Solo SuperAdmin) ── */}
          {isSuperAdmin && !isEdit && (
            <div className="p-4 rounded-lg bg-blue-50/80 border border-blue-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600">
                <Building2 className="w-4 h-4" />
                Empresa / Tenant Destino <span className="text-rose-500">*</span>
              </div>
              <select
                value={targetClienteId}
                onChange={(e) => setTargetClienteId(e.target.value)}
                disabled={saving}
                className="w-full py-2 px-3 text-xs sm:text-sm rounded-md border border-slate-300 bg-white text-slate-900 font-semibold outline-none focus:border-blue-500 cursor-pointer shadow-sm"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre_empresa} — Plan {t.plan_suscripcion || 'starter'}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                Como SuperAdmin, selecciona a qué empresa pertenecerá este colaborador.
              </p>
            </div>
          )}

          {!isSuperAdmin && currentTenant && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span className="text-slate-600">Empresa:</span>
              <strong className="text-slate-800 font-semibold">{currentTenant.nombre_empresa}</strong>
            </div>
          )}

          {/* ── Sección 1: Datos Personales ── */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3 flex items-center gap-1.5">
              <User className="w-4 h-4" />
              Información Personal
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormInput
                id="f-nombre" label="Nombre" icon={User}
                value={form.nombre} onChange={set('nombre')}
                placeholder="Juan" required
                error={errors.nombre} disabled={saving}
              />
              <FormInput
                id="f-apellido" label="Apellido" icon={User}
                value={form.apellido} onChange={set('apellido')}
                placeholder="Pérez" required
                error={errors.apellido} disabled={saving}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="space-y-1.5">
                <label htmlFor="f-sexo" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Sexo / Género
                </label>
                <select
                  id="f-sexo"
                  value={form.sexo}
                  onChange={set('sexo')}
                  disabled={saving}
                  className="w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border border-slate-200 bg-white text-slate-900 outline-none focus:border-blue-500"
                >
                  <option value="M">Masculino (Hombre)</option>
                  <option value="F">Femenino (Mujer)</option>
                  <option value="Otro">Otro / No especificado</option>
                </select>
              </div>

              <FormInput
                id="f-cumple" label="Fecha de Cumpleaños" icon={Calendar}
                type="date" value={form.fecha_cumpleanos} onChange={set('fecha_cumpleanos')}
                disabled={saving}
                hint="Fecha de nacimiento"
              />
            </div>
          </div>

          {/* ── Sección 2: Datos Laborales ── */}
          <div className="pt-2 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-blue-600" />
              Datos Laborales
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormInput
                id="f-depto" label="Departamento / Área" icon={Building2}
                value={form.departamento} onChange={set('departamento')}
                placeholder="Operaciones" disabled={saving}
              />
              <FormInput
                id="f-puesto" label="Puesto / Cargo" icon={Briefcase}
                value={form.puesto} onChange={set('puesto')}
                placeholder="Supervisor de Planta" disabled={saving}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <FormInput
                id="f-clave" label="Clave de Colaborador" icon={BadgeCheck}
                value={form.clave_empleado} onChange={set('clave_empleado')}
                placeholder="ej. EMP-101"
                disabled={saving}
                hint="Código interno laboral de la empresa."
              />
              <FormInput
                id="f-ingreso" label="Fecha de Ingreso" icon={CalendarDays}
                type="date" value={form.fecha_ingreso} onChange={set('fecha_ingreso')}
                disabled={saving}
                hint="Fecha de inicio de labores."
              />
            </div>
          </div>

          {/* ── Sección 3: Seguridad y Acceso Kiosco Web ── */}
          <div className="rounded-lg p-4 bg-blue-50 border border-blue-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4.5 h-4.5 text-blue-600" />
                <span className="text-xs font-bold text-slate-900">
                  Autenticación en Kiosco Checador Web
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  const randomPin = Math.floor(1000 + Math.random() * 9000).toString()
                  setForm(f => ({ ...f, pin: randomPin }))
                  setShowPin(true)
                  toast.success(`PIN generado: ${randomPin}`)
                }}
                className="text-[11px] text-blue-600 hover:underline font-semibold"
              >
                Generar PIN aleatorio
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="f-pin" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                PIN de Seguridad Personal (4 a 6 dígitos)
              </label>
              <div className="relative">
                <input
                  id="f-pin"
                  type={showPin ? 'text' : 'password'}
                  maxLength={6}
                  value={form.pin || ''}
                  onChange={set('pin')}
                  placeholder="ej. 1234"
                  disabled={saving}
                  className={`w-full py-2.5 px-3 text-xs sm:text-sm rounded-md border bg-white text-slate-900 placeholder-slate-400 outline-none font-mono tracking-widest ${
                    errors.pin ? 'border-rose-500' : 'border-slate-200 focus:border-blue-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-blue-600 font-semibold"
                >
                  {showPin ? 'Ocultar' : 'Ver'}
                </button>
              </div>
              {errors.pin ? (
                <p className="text-[11px] text-rose-500">{errors.pin}</p>
              ) : (
                <p className="text-[11px] text-slate-700">Clave numérica requerida para autenticarse y checar en el Kiosco Web.</p>
              )}
            </div>
          </div>

          {/* ── Sección 4: Credenciales de Acceso Hardware Biométrico ── */}
          <div className="rounded-lg p-4 bg-[#F8FAFC] border border-slate-200 space-y-4">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4.5 h-4.5 text-slate-700" />
              <span className="text-xs font-bold text-slate-900">
                Credenciales de Acceso Hardware Biométrico
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormInput
                id="f-devid" label="ID Biométrico (Device UserID)" icon={Hash}
                value={form.device_userid}
                onChange={set('device_userid')}
                placeholder="ej. 101"
                hint="ID numérico registrado en la terminal."
                error={errors.device_userid}
                disabled={saving}
              />
              <FormInput
                id="f-tarjeta" label="Tarjeta RFID / Mifare" icon={CreditCard}
                value={form.tarjeta} onChange={set('tarjeta')}
                placeholder="ej. 0008459201"
                disabled={saving}
                hint="Número grabado en el tag/tarjeta."
              />
            </div>
          </div>

          {/* ── Sección 5: Estatus Operativo ── */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <div>
              <p className="text-xs font-semibold text-slate-700">Estatus Operativo</p>
              <p className="text-[11px] text-slate-400">Si está inactivo, el hardware no procesará sus marcajes.</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold border transition-all ${
                form.activo
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              {form.activo ? <><CheckCircle2 className="w-3.5 h-3.5" /> Activo</> : <><XCircle className="w-3.5 h-3.5" /> Inactivo</>}
            </button>
          </div>

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all active:scale-98 disabled:opacity-50"
            >
              {saving ? <><Spinner size={14} /> Guardando...</> : <><Save className="w-4 h-4" /> {isEdit ? 'Actualizar Colaborador' : 'Guardar Colaborador'}</>}
            </button>
          </div>
        </form>
      </div>
      {ConfirmDialogNode}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MODAL: FICHA DE EMPLEADO COMPLETA
// ═══════════════════════════════════════════════════════════════
function ModalDetalle({ empleado, onClose, onReactivate, onDelete }) {
  const nombre = `${empleado.nombre} ${empleado.apellido}`

  const InfoItem = ({ icon: Icon, label, value, isMono }) => (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded bg-blue-50 text-slate-700 flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`text-xs sm:text-sm font-semibold text-slate-900 ${isMono ? 'font-mono' : ''}`}>
          {value || '—'}
        </p>
      </div>
    </div>
  )

  const getSexoLabel = (s) => {
    if (s === 'M') return 'Masculino (Hombre)'
    if (s === 'F') return 'Femenino (Mujer)'
    return s || 'No especificado'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-[95%] sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <AvatarCircle empleado={empleado} size={48} />
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">{nombre}</h3>
              <div className="flex items-center gap-2 mt-1">
                <EstatusBadge activo={empleado.activo} />
                <span className="text-xs text-slate-400 font-medium">Clave: {empleado.clave_empleado || 'Sin clave'}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Datos Personales */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3 flex items-center gap-1.5">
              <User className="w-4 h-4" />
              Datos Personales
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={User} label="Nombre Completo" value={nombre} />
              <InfoItem icon={Heart} label="Sexo / Género" value={getSexoLabel(empleado.sexo)} />
              <InfoItem icon={Calendar} label="Fecha de Cumpleaños" value={formatDate(empleado.fecha_cumpleanos)} />
            </div>
          </div>

          {/* Datos Laborales */}
          <div className="pt-2 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-blue-600" />
              Datos Laborales
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={BadgeCheck} label="Clave de Colaborador" value={empleado.clave_empleado || 'Sin clave'} isMono />
              <InfoItem icon={Building2} label="Departamento" value={empleado.departamento} />
              <InfoItem icon={Briefcase} label="Puesto / Cargo" value={empleado.puesto} />
              <InfoItem icon={CalendarDays} label="Fecha de Ingreso" value={formatDate(empleado.fecha_ingreso)} />
            </div>
          </div>

          {/* Sincronización Hardware Biométrico & Kiosco */}
          <div className="p-4 rounded-lg bg-[#F8FAFC] border border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3 flex items-center gap-1.5">
              <Fingerprint className="w-4 h-4" />
              Credenciales de Acceso Hardware & Kiosco Web
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={Hash} label="ID Biométrico (Device UserID)" value={empleado.device_userid} isMono />
              <InfoItem icon={CreditCard} label="Tarjeta RFID / Mifare" value={empleado.tarjeta || 'Sin tarjeta asignada'} isMono />
              <InfoItem icon={ShieldCheck} label="PIN de Acceso Kiosco" value={empleado.pin ? '••••••' : 'Sin PIN configurado'} isMono />
              <InfoItem icon={Calendar} label="Última Actualización" value={formatDate(empleado.actualizado_at)} />
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            {!empleado.activo ? (
              <button
                onClick={() => { onClose(); onReactivate(empleado); }}
                className="px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-green-700 bg-green-50 hover:bg-green-100 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reactivar
              </button>
            ) : null}
            <button
              onClick={() => { onClose(); onDelete(empleado); }}
              className="px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {empleado.activo ? 'Baja / Eliminar' : 'Eliminar'}
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-xs sm:text-sm font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors"
          >
            Cerrar Ficha
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: EMPLEADOS
// ═══════════════════════════════════════════════════════════════
export default function Empleados() {
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const navigate = useNavigate()

  const {
    isSuperAdmin,
    tenants,
    loadingTenants,
    currentTenantId,
    currentTenant,
    setSelectedTenantId,
    requiresTenantAssignment,
  } = useCurrentTenant()

  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filterActivo, setFilterActivo] = useState('activo')

  const [modalForm, setModalForm] = useState(null)
  const [modalDetalle, setModalDetalle] = useState(null)
  const [modalImport, setModalImport] = useState(false)

  const {
    limiteEmpleados,
    empleadosActuales,
    empleadosDisponibles,
    porcentajeEmpleados,
    empleadosAlcanzado,
    empleadosAlerta80,
    canAddEmployee,
    tenantInfo,
    bloqueado,
    vencido,
    refreshLimits,
  } = useTenantLimits(currentTenantId)

  // Cargar lista de empleados con columna device_userid
  const fetchEmpleados = useCallback(async () => {
    if (!currentTenantId) {
      setEmpleados([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('empleados')
      .select('id, nombre, apellido, clave_empleado, pin, departamento, puesto, device_userid, tarjeta, sexo, fecha_ingreso, fecha_cumpleanos, activo, avatar_url, creado_at, actualizado_at')
      .eq('cliente_id', currentTenantId)
      .order('apellido', { ascending: true })

    if (error) {
      toast.error('Error al cargar empleados: ' + error.message)
    } else {
      setEmpleados(data ?? [])
    }
    setLoading(false)
  }, [currentTenantId])

  useEffect(() => {
    fetchEmpleados()
  }, [fetchEmpleados])

  const { confirmDialog, ConfirmDialogNode } = useConfirm()

  const handleDelete = async (empleado) => {
    try {
      const { data: res, error } = await supabase.rpc('fn_employee_lifecycle', {
        p_empleado_id: empleado.id,
        p_action: 'CHECK'
      })

      if (error) throw error

      const status = res?.status

      if (status === 'ERROR') {
        toast.error('Error interno: ' + res?.message)
        return
      }

      if (status === 'UNAUTHORIZED') {
        toast.error('No tienes permisos para modificar este empleado.')
        return
      }

      if (status === 'HAS_ACTIVE_SHIFTS') {
        const count = res?.count || 1
        await confirmDialog({
          title: 'Operación Bloqueada',
          message: `Este empleado tiene ${count} turno(s) asignado(s) o agendado(s) en el futuro. Debes retirar o finalizar sus asignaciones en el módulo de turnos antes de poder eliminarlo o darlo de baja.`,
          variant: 'warning',
          confirmLabel: 'Entendido'
        })
        return
      }

      if (status === 'CAN_DEACTIVATE') {
        const attCount = res?.attendance_count || 0
        const incCount = res?.incidents_count || 0
        const devCount = res?.devices_count || 0
        
        let details = ''
        if (attCount > 0) details += `- ${attCount} registro(s) de asistencia\n`
        if (incCount > 0) details += `- ${incCount} incidencia(s)\n`
        if (devCount > 0) details += `- ${devCount} asignación(es) en terminales biométricas\n`

        const okSoft = await confirmDialog({
          title: 'Baja Laboral',
          message: `Se encontraron:\n${details}\nEl colaborador dejará de poder registrar checadas en los dispositivos asignados. Su PIN, enrolamientos e historial serán conservados para un posible reingreso.`,
          variant: 'warning',
          confirmLabel: 'Confirmar Baja Laboral'
        })
        
        if (okSoft) {
          const { data: deactRes, error: deactErr } = await supabase.rpc('fn_employee_lifecycle', {
            p_empleado_id: empleado.id,
            p_action: 'DEACTIVATE'
          })
          if (deactErr) throw deactErr
          if (deactRes?.status === 'ERROR') throw new Error(deactRes.message)
          
          toast.success(`${empleado.nombre} ha sido dado de baja`)
          fetchEmpleados()
          refreshLimits()
        }
        return
      }

      if (status === 'DEVICE_REMOVAL_REQUIRED') {
        const devCount = res?.devices_count || 0
        const okSoft = await confirmDialog({
          title: 'Retiro Físico Requerido',
          message: `Este colaborador no tiene historial, pero está asignado a ${devCount} reloj(es) biométrico(s).\n\nPrimero debe ser dado de baja para que el sistema le envíe la orden de borrado a las terminales físicas.`,
          variant: 'warning',
          confirmLabel: 'Dar de baja y borrar de reloj'
        })
        
        if (okSoft) {
          const { data: deactRes, error: deactErr } = await supabase.rpc('fn_employee_lifecycle', {
            p_empleado_id: empleado.id,
            p_action: 'DEACTIVATE'
          })
          if (deactErr) throw deactErr
          if (deactRes?.status === 'ERROR') throw new Error(deactRes.message)
          
          toast.success(`Orden enviada. ${empleado.nombre} ha sido dado de baja.`)
          fetchEmpleados()
          refreshLimits()
        }
        return
      }

      if (status === 'CAN_DELETE') {
        const ok = await confirmDialog({
          title: 'Eliminar colaborador',
          message: `Este colaborador no tiene registros históricos ni biométricos asociados.\n\n¿Estás seguro de eliminar definitivamente a ${empleado.nombre} ${empleado.apellido}? Esta acción no se puede deshacer.`,
          variant: 'danger',
          confirmLabel: 'Eliminar definitivamente'
        })
        
        if (!ok) return
        
        const { data: finalRes, error: finalErr } = await supabase.rpc('fn_employee_lifecycle', {
          p_empleado_id: empleado.id,
          p_action: 'DELETE'
        })

        if (finalErr) throw finalErr
        
        if (finalRes?.status === 'SUCCESS') {
          toast.success(`${empleado.nombre} eliminado definitivamente`)
          fetchEmpleados()
          refreshLimits()
        } else {
          toast.error('Error al intentar eliminar físicamente: ' + finalRes?.status)
        }
      }
    } catch (err) {
      toast.error(err?.message ?? 'Error al procesar la solicitud de eliminación')
    }
  }

  const handleReactivate = async (empleado) => {
    try {
      const [{ data: templates }, { data: devices }] = await Promise.all([
        supabase.from('biometric_templates').select('tipo').eq('empleado_id', empleado.id),
        supabase.from('device_employee_assignments').select('id, biometric_user_id').eq('employee_id', empleado.id).eq('suspension_reason', 'EMPLOYEE_DEACTIVATED')
      ])

      const hasHuella = templates?.some(t => t.tipo === 'huella')
      const deviceCount = devices?.length || 0
      const uniquePins = [...new Set((devices || []).map(d => d.biometric_user_id).filter(Boolean))]

      const ok = await confirmDialog({
        title: 'Reactivar Colaborador',
        message: `La identidad y el PIN se restaurarán en los dispositivos.${hasHuella ? '\n\nLas huellas deberán enrolarse nuevamente si el dispositivo las eliminó durante la baja.' : ''}`,
        variant: 'info',
        confirmLabel: 'Reactivar empleado'
      })
      
      if (!ok) return

      const { data: reactRes, error: reactErr } = await supabase.rpc('fn_employee_lifecycle', {
        p_empleado_id: empleado.id,
        p_action: 'ACTIVATE'
      })

      if (reactErr) throw reactErr
      if (reactRes?.status === 'ERROR') throw new Error(reactRes.message)

      fetchEmpleados()
      refreshLimits()

      let identidadMsg = 'Se restauró su identidad'
      if (uniquePins.length === 1) {
        identidadMsg += ` con el PIN ${uniquePins[0]}`
      } else if (uniquePins.length > 1) {
        identidadMsg = 'Se restauró la identidad del colaborador'
      }

      if (deviceCount > 0) {
        identidadMsg += ` y se enviaron solicitudes de sincronización a ${deviceCount} dispositivos.`
      } else {
        identidadMsg += '.'
      }

      toast((t) => (
        <div className="flex flex-col gap-2 min-w-[300px]">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
            <span>Colaborador reactivado</span>
          </div>
          <div className="text-sm text-slate-600">
            {identidadMsg}
          </div>
          
          {hasHuella && (
            <div className="mt-2 text-sm">
              <p className="text-amber-700 font-medium mb-2">
                Las huellas deben enrolarse nuevamente en los dispositivos.
              </p>
              <div className="flex justify-end gap-2 mt-2">
                <button 
                  onClick={() => toast.dismiss(t.id)}
                  className="px-3 py-1.5 bg-transparent text-slate-500 hover:bg-slate-100 rounded text-xs font-semibold transition-colors"
                >
                  Cerrar
                </button>
                <button 
                  onClick={() => {
                    toast.dismiss(t.id)
                    navigate(`/enrolamiento?empleado_id=${empleado.id}`)
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  Ir a Enrolamiento
                </button>
              </div>
            </div>
          )}
        </div>
      ), { duration: hasHuella ? 8000 : 4000, position: 'bottom-right' })

    } catch (err) {
      toast.error(err?.message ?? 'Error al intentar reactivar al colaborador')
    }
  }

  const handleOpenNuevoEmpleado = () => {
    if (!currentTenantId) {
      toast.error(isSuperAdmin ? 'Por favor selecciona o crea una empresa primero.' : 'No tienes una empresa asignada.')
      return
    }
    const check = canAddEmployee()
    if (!check.ok) {
      toast.error(check.reason, { duration: 7000 })
      return
    }
    setModalForm('nuevo')
  }

  const handleOpenImport = () => {
    if (!currentTenantId) {
      toast.error(isSuperAdmin ? 'Por favor selecciona o crea una empresa primero.' : 'No tienes una empresa asignada.')
      return
    }
    const check = canAddEmployee()
    if (!check.ok) {
      toast.error(check.reason, { duration: 7000 })
      return
    }
    setModalImport(true)
  }

  const filtered = empleados.filter(emp => {
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      `${emp.nombre} ${emp.apellido}`.toLowerCase().includes(q) ||
      emp.clave_empleado?.toLowerCase().includes(q) ||
      emp.device_userid?.toLowerCase().includes(q) ||
      emp.tarjeta?.toLowerCase().includes(q) ||
      emp.departamento?.toLowerCase().includes(q) ||
      emp.puesto?.toLowerCase().includes(q)

    const matchActivo =
      filterActivo === 'todos' ||
      (filterActivo === 'activo' && emp.activo) ||
      (filterActivo === 'inactivo' && !emp.activo)

    return matchSearch && matchActivo
  })

  const {
    currentPage,
    totalPages,
    paginatedItems: paginatedEmpleados,
    totalItems,
    startIndex,
    endIndex,
    nextPage,
    prevPage
  } = usePagination(filtered, 5, [search, filterActivo])

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] text-slate-900">
      <Toaster position="top-right" containerStyle={{ top: 20, right: 20 }} />

      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

        <main className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10 w-full space-y-6">
          {bloqueado && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>
                {vencido
                  ? `La suscripción de tu empresa venció el ${tenantInfo.fecha_vencimiento}. Contacta al administrador para renovar el servicio.`
                  : `Tu empresa se encuentra en estatus "${tenantInfo.estatus.toUpperCase()}". Las operaciones de registro están restringidas.`
                }
              </span>
            </div>
          )}

          {requiresTenantAssignment && (
            <div className="flex items-center gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>Tu usuario requiere asignación de <strong>cliente_id</strong> en Supabase para vincular registros.</span>
            </div>
          )}

          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                  Gestión de Empleados
                </h2>
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20">
                    Modo SuperAdmin
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                Padrón de colaboradores activos
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-nowrap overflow-x-auto pb-1 xl:pb-0">
              {isSuperAdmin && (
                <TenantSelector
                  tenants={tenants}
                  currentTenantId={currentTenantId}
                  onSelectTenant={setSelectedTenantId}
                  loading={loadingTenants}
                />
              )}

              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white border-slate-200 shadow-sm text-xs font-semibold whitespace-nowrap flex-shrink-0">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span className="text-slate-500">Capacidad:</span>
                <span className="font-mono font-bold text-slate-900">
                  {empleados.length} / {limiteEmpleados}
                </span>
                {empleadosAlcanzado ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                    LÍMITE ALCANZADO
                  </span>
                ) : empleadosAlerta80 ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                    {porcentajeEmpleados}%
                  </span>
                ) : null}
              </div>

              <button
                onClick={() => exportarEmpleadosCSV(empleados)}
                disabled={empleados.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all shadow-sm active:scale-98 disabled:opacity-50 cursor-pointer whitespace-nowrap flex-shrink-0"
                title="Exportar todos los colaboradores a CSV"
              >
                <Download className="w-3.5 h-3.5 text-emerald-500" />
                <span>Exportar ({empleados.length})</span>
              </button>

              <button
                onClick={handleOpenImport}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-white border border-slate-700 hover:bg-slate-900 transition-all shadow-sm active:scale-98 cursor-pointer whitespace-nowrap flex-shrink-0"
                title="Importar colaboradores desde archivo CSV"
              >
                <Upload className="w-3.5 h-3.5 text-sky-400" />
                <span>Importar CSV</span>
              </button>

              <button
                onClick={handleOpenNuevoEmpleado}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all active:scale-98 cursor-pointer whitespace-nowrap flex-shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Agregar Empleado</span>
              </button>
            </div>
          </div>

          <div className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por clave laboral, nombre, ID biométrico, puesto..."
                className="w-full pl-9 pr-4 py-2 rounded-md border border-slate-200 bg-[#F8FAFC] text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Estado:
              </span>
              {['todos', 'activo', 'inactivo'].map(val => (
                <button
                  key={val}
                  onClick={() => setFilterActivo(val)}
                  className={`px-3 py-1 rounded text-xs font-semibold capitalize transition-all ${
                    filterActivo === val
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-blue-50 text-slate-700 hover:bg-blue-100'
                  }`}
                >
                  {val}
                </button>
              ))}

              <button
                onClick={fetchEmpleados}
                disabled={loading}
                className="p-2 rounded-md border border-slate-200 text-slate-700 hover:text-slate-900 transition-colors"
                title="Recargar"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="rounded-sm border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-slate-700 text-sm">
                  <Spinner size={18} />
                  Cargando colaboradores...
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <User className="w-10 h-10 stroke-1" />
                  <p className="text-sm font-medium">No se encontraron colaboradores registrados.</p>
                  <button
                    onClick={() => setModalImport(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-500/40"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Importar lista desde un CSV
                  </button>
                </div>
              ) : (
                <table className="w-full table-auto">
                  <thead>
                    <tr className="bg-slate-50 text-left border-b border-slate-200">
                      {['Clave de Colaborador', 'Colaborador', 'ID Biométrico', 'Tarjeta RFID', 'Departamento', 'Puesto', 'Estatus', 'Acciones'].map(h => (
                        <th key={h} className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-700">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(3,54,61,0.07)]">
                    {paginatedEmpleados.map(emp => (
                      <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                        {/* 1. Clave de Colaborador */}
                        <td className="px-4 py-3.5">
                          {emp.clave_empleado ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold px-2.5 py-1 rounded bg-blue-50 text-slate-900 border border-slate-200 shadow-sm">
                              <BadgeCheck className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                              {emp.clave_empleado}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs font-mono">—</span>
                          )}
                        </td>

                        {/* 2. Colaborador */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <AvatarCircle empleado={emp} size={36} />
                            <div>
                              <p className="text-sm font-semibold text-slate-900 leading-tight">
                                {emp.nombre} {emp.apellido}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* 3. ID Biométrico (Device UserID en Hardware) */}
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-500/40">
                            <Fingerprint className="w-3 h-3" />
                            {emp.device_userid}
                          </span>
                        </td>

                        {/* 4. Tarjeta RFID */}
                        <td className="px-4 py-3.5">
                          {emp.tarjeta ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-700">
                              <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                              {emp.tarjeta}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>

                        {/* 5. Departamento */}
                        <td className="px-4 py-3.5 text-xs sm:text-sm text-slate-700">
                          {emp.departamento || '—'}
                        </td>

                        {/* 6. Puesto */}
                        <td className="px-4 py-3.5 text-xs sm:text-sm text-slate-700">
                          {emp.puesto || '—'}
                        </td>

                        {/* 7. Estatus */}
                        <td className="px-4 py-3.5">
                          <EstatusBadge activo={emp.activo} />
                        </td>

                        {/* 8. Acciones */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setModalDetalle(emp)}
                              className="p-1.5 rounded hover:bg-blue-100 text-slate-700 hover:text-blue-600 transition-colors"
                              title="Ver Ficha Completa"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setModalForm(emp)}
                              className="p-1.5 rounded hover:bg-blue-100 text-slate-700 hover:text-sky-600 transition-colors"
                              title="Editar"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            {!emp.activo && (
                              <button
                                onClick={() => handleReactivate(emp)}
                                className="p-1.5 rounded hover:bg-green-100 text-slate-700 hover:text-green-600 transition-colors"
                                title="Reactivar"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(emp)}
                              className="p-1.5 rounded hover:bg-red-100 text-slate-700 hover:text-red-600 transition-colors"
                              title={emp.activo ? 'Eliminar / Dar de Baja' : 'Eliminar Definitivamente'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            
            {!loading && (
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
          </div>
        </main>
      </div>

      {modalForm && (
        <ModalForm
          empleado={modalForm === 'nuevo' ? null : modalForm}
          empleados={empleados}
          clienteId={currentTenantId}
          isSuperAdmin={isSuperAdmin}
          tenants={tenants}
          currentTenant={currentTenant}
          onClose={() => setModalForm(null)}
          onSaved={() => {
            fetchEmpleados()
            refreshLimits()
          }}
        />
      )}

      {ConfirmDialogNode}

      {modalDetalle && (
        <ModalDetalle
          empleado={modalDetalle}
          onClose={() => setModalDetalle(null)}
          onReactivate={handleReactivate}
          onDelete={handleDelete}
        />
      )}

      {modalImport && (
        <ModalImportCSV
          clienteId={currentTenantId}
          disponibles={empleadosDisponibles}
          onClose={() => setModalImport(false)}
          onImported={() => {
            fetchEmpleados()
            refreshLimits()
          }}
        />
      )}
    </div>
  )
}
