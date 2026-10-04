/**
 * DatePicker.jsx — Signum-Clock Premium Date & Range Picker
 *
 * Designed with UI/UX Pro Max & Interface Design specifications:
 * - Hierarchy: Clear focal point, high-contrast selected states, whisper range bands
 * - Palette: Signum Blue Whale (#00363D) anchor, Jet Stream (#BDD9D7) accent,
 *            plus slate dark mode support
 * - Typography: Inter font, font-variant-numeric: tabular-nums for aligned dates
 * - Interaction: Fast presets, month/year jumper, keyboard Escape/Enter,
 *                click-outside dismissal, responsive viewport-aware positioning
 * - Compatibility: Transparent drop-in replacement for <input type="date">
 *   Supports both (e) => onChange(e.target.value) and (val) => onChange(val)
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Clock,
  Sparkles,
  Check
} from 'lucide-react'

/* ─── Tokens & Constants ─────────────────────────────────────── */
const BRAND_BW = '#00363D'
const BRAND_JS = '#BDD9D7'

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

const MONTH_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
]

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']

/* ─── Helpers (Timezone-safe YYYY-MM-DD) ─────────────────────── */
export function formatToYMD(date) {
  if (!date) return ''
  if (typeof date === 'string') {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) return `${match[1]}-${match[2]}-${match[3]}`
  }
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseFromYMD(str) {
  if (!str) return null
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str
  const clean = String(str).trim()
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const y = parseInt(match[1], 10)
  const m = parseInt(match[2], 10) - 1
  const d = parseInt(match[3], 10)
  const date = new Date(y, m, d, 12, 0, 0)
  return isNaN(date.getTime()) ? null : date
}

export function formatFriendlyDisplay(ymdStr, { includeDayName = false } = {}) {
  const date = parseFromYMD(ymdStr)
  if (!date) return ''
  const day = date.getDate()
  const month = MONTH_SHORT[date.getMonth()].toLowerCase()
  const year = date.getFullYear()

  if (includeDayName) {
    const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
    const dayName = dayNames[date.getDay()]
    return `${dayName}, ${day} ${month} ${year}`
  }
  return `${day} ${month} ${year}`
}

function isSameDay(d1, d2) {
  if (!d1 || !d2) return false
  const s1 = typeof d1 === 'string' ? d1 : formatToYMD(d1)
  const s2 = typeof d2 === 'string' ? d2 : formatToYMD(d2)
  return s1 === s2
}

function isDateInRange(target, start, end) {
  if (!target || !start || !end) return false
  const t = typeof target === 'string' ? target : formatToYMD(target)
  const s = typeof start === 'string' ? start : formatToYMD(start)
  const e = typeof end === 'string' ? end : formatToYMD(end)
  return t >= s && t <= e
}

function getTodayYMD() {
  return formatToYMD(new Date())
}

/* ─── Preset Ranges Builder ───────────────────────────────────── */
export function getStandardPresets() {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()

  // Ayer
  const yest = new Date(y, m, d - 1)

  // Esta semana (Lunes a hoy)
  const dayOfWeek = today.getDay() // 0 dom, 1 lun, ...
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek
  const mondayThisWeek = new Date(y, m, d + diffToMonday)

  // Semana pasada (Lunes a Domingo anterior)
  const mondayLastWeek = new Date(y, m, d + diffToMonday - 7)
  const sundayLastWeek = new Date(y, m, d + diffToMonday - 1)

  // Mes actual (1 al último día de este mes o hoy)
  const firstDayThisMonth = new Date(y, m, 1)

  // Mes anterior
  const firstDayLastMonth = new Date(y, m - 1, 1)
  const lastDayLastMonth = new Date(y, m, 0)

  // Últimos 7 días
  const sevenDaysAgo = new Date(y, m, d - 6)

  // Últimos 30 días
  const thirtyDaysAgo = new Date(y, m, d - 29)

  return [
    { label: 'Hoy', start: formatToYMD(today), end: formatToYMD(today) },
    { label: 'Ayer', start: formatToYMD(yest), end: formatToYMD(yest) },
    { label: 'Últimos 7 días', start: formatToYMD(sevenDaysAgo), end: formatToYMD(today) },
    { label: 'Esta semana', start: formatToYMD(mondayThisWeek), end: formatToYMD(today) },
    { label: 'Semana pasada', start: formatToYMD(mondayLastWeek), end: formatToYMD(sundayLastWeek) },
    { label: 'Últimos 30 días', start: formatToYMD(thirtyDaysAgo), end: formatToYMD(today) },
    { label: 'Mes actual', start: formatToYMD(firstDayThisMonth), end: formatToYMD(today) },
    { label: 'Mes anterior', start: formatToYMD(firstDayLastMonth), end: formatToYMD(lastDayLastMonth) },
  ]
}

/* ═══════════════════════════════════════════════════════════════ */
/* ── Componente Principal: DatePicker (Single Date) ──────────── */
/* ═══════════════════════════════════════════════════════════════ */
export default function DatePicker({
  value,
  onChange,
  placeholder = 'Seleccionar fecha',
  min,
  max,
  disabled = false,
  readOnly = false,
  error = false,
  label = null,
  id,
  name,
  className = '',
  size = 'md', // 'sm' | 'md' | 'lg'
  clearable = true,
  align = 'left', // 'left' | 'right'
  quickPresets = true,
  ...restProps
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewMode, setViewMode] = useState('days') // 'days' | 'months' | 'years'

  const containerRef = useRef(null)
  const popoverRef = useRef(null)

  const selectedYMD = useMemo(() => formatToYMD(value), [value])
  const selectedDate = useMemo(() => parseFromYMD(selectedYMD), [selectedYMD])

  // Fecha visible para la navegación de mes y año
  const [viewDate, setViewDate] = useState(() => {
    return selectedDate || new Date()
  })

  // Sincronizar vista si cambia el valor externamente
  useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate)
    }
  }, [selectedYMD])

  // Cerrar al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target)
      ) {
        setIsOpen(false)
        setViewMode('days')
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setViewMode('days')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Despachador de evento transparente compatible con (e) => setVal(e.target.value)
  const emitChange = useCallback((ymdStr) => {
    if (!onChange || disabled || readOnly) return
    const syntheticEvent = {
      target: { value: ymdStr, name: name || id },
      currentTarget: { value: ymdStr, name: name || id },
      value: ymdStr,
      toString: () => ymdStr,
      valueOf: () => ymdStr,
      [Symbol.toPrimitive]: () => ymdStr
    }
    onChange(syntheticEvent, ymdStr)
  }, [onChange, disabled, readOnly, name, id])

  const handleSelectDay = (ymdStr) => {
    emitChange(ymdStr)
    setIsOpen(false)
    setViewMode('days')
  }

  const handleClear = (e) => {
    e.stopPropagation()
    emitChange('')
    setIsOpen(false)
  }

  const handleQuickToday = () => {
    const today = getTodayYMD()
    emitChange(today)
    setViewDate(new Date())
    setIsOpen(false)
  }

  const handleQuickYesterday = () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const yest = formatToYMD(d)
    emitChange(yest)
    setViewDate(d)
    setIsOpen(false)
  }

  // Navegación de mes
  const handlePrevMonth = () => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }
  const handleNextMonth = () => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  // Navegación de año
  const handlePrevYear = () => {
    setViewDate(prev => new Date(prev.getFullYear() - 1, prev.getMonth(), 1))
  }
  const handleNextYear = () => {
    setViewDate(prev => new Date(prev.getFullYear() + 1, prev.getMonth(), 1))
  }

  // Matriz de días del mes visible
  const calendarGrid = useMemo(() => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()

    const firstDayOfMonth = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // 0 = Domingo, 1 = Lunes, ...
    let startingDayOfWeek = firstDayOfMonth.getDay()
    // Ajustar a Lunes = 0, Domingo = 6
    const mondayOffset = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1

    const days = []

    // Días del mes anterior para completar la primera semana
    const prevMonthDays = new Date(year, month, 0).getDate()
    for (let i = mondayOffset - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      const dateObj = new Date(year, month - 1, d)
      days.push({
        dayNumber: d,
        ymd: formatToYMD(dateObj),
        isCurrentMonth: false,
        dateObj
      })
    }

    // Días del mes actual
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d)
      days.push({
        dayNumber: d,
        ymd: formatToYMD(dateObj),
        isCurrentMonth: true,
        dateObj
      })
    }

    // Días del siguiente mes para cerrar en cuadrícula completa (múltiplo de 7, máx 42)
    const remaining = (7 - (days.length % 7)) % 7
    for (let d = 1; d <= remaining; d++) {
      const dateObj = new Date(year, month + 1, d)
      days.push({
        dayNumber: d,
        ymd: formatToYMD(dateObj),
        isCurrentMonth: false,
        dateObj
      })
    }

    return days
  }, [viewDate])

  // Años disponibles para selector rápido
  const currentYear = viewDate.getFullYear()
  const yearRange = useMemo(() => {
    const base = Math.floor(currentYear / 12) * 12
    const list = []
    for (let i = base - 2; i <= base + 13; i++) list.push(i)
    return list
  }, [currentYear])

  // Estilos y tamaños de botón disparador
  const sizeClasses = {
    sm: 'h-8 px-2.5 text-xs',
    md: 'h-9 sm:h-10 px-3 text-xs sm:text-sm',
    lg: 'h-11 px-3.5 text-sm'
  }[size] || 'h-10 px-3 text-sm'

  const todayYMD = getTodayYMD()

  return (
    <div className={`relative inline-block w-full ${className}`} ref={containerRef}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5"
        >
          {label}
        </label>
      )}

      {/* Disparador tipo Input */}
      <button
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        onClick={() => {
          if (!disabled && !readOnly) setIsOpen(!isOpen)
        }}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border transition-all duration-150 select-none text-left
          ${sizeClasses}
          ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800' : 'cursor-pointer'}
          ${error ? 'border-red-500 focus:ring-2 focus:ring-red-500/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}
          ${isOpen ? 'ring-2 ring-blue-500/20 border-blue-500 dark:border-blue-400' : ''}
          bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs`}
        style={{
          fontVariantNumeric: 'tabular-nums'
        }}
        {...restProps}
      >
        <div className="flex items-center gap-2 overflow-hidden truncate">
          <CalendarIcon
            className={`w-4 h-4 flex-shrink-0 transition-colors ${
              selectedYMD ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
            }`}
          />
          <span className={`truncate ${selectedYMD ? 'font-medium' : 'text-slate-400 dark:text-slate-500'}`}>
            {selectedYMD ? formatFriendlyDisplay(selectedYMD, { includeDayName: false }) : placeholder}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {clearable && selectedYMD && !disabled && !readOnly && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Limpiar fecha"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Popover flotante del Calendario */}
      {isOpen && (
        <div
          ref={popoverRef}
          className={`absolute z-50 mt-1.5 w-72 sm:w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 shadow-2xl p-4 transition-all animate-in fade-in zoom-in-95 duration-150 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={{
            boxShadow: '0 10px 25px -5px rgba(0, 54, 61, 0.12), 0 8px 10px -6px rgba(0, 54, 61, 0.08)'
          }}
        >
          {/* Cabecera: Mes, Año y Controles */}
          <div className="flex items-center justify-between gap-2 pb-3 mb-2 border-b border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode(prev => prev === 'days' ? 'months' : 'days')}
              className="flex items-center gap-1 px-2 py-1 -ml-1 text-sm font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <span>{MONTH_NAMES[viewDate.getMonth()]}</span>
              <span className="text-slate-400 font-normal">{viewDate.getFullYear()}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
            </button>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* VISTA 1: Selector de Meses */}
          {viewMode === 'months' && (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Seleccionar Mes
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handlePrevYear}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {viewDate.getFullYear()}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextYear}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_NAMES.map((name, idx) => {
                  const isCurrent = viewDate.getMonth() === idx
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setViewDate(new Date(viewDate.getFullYear(), idx, 1))
                        setViewMode('days')
                      }}
                      className={`py-2 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* VISTA 2: Días del Calendario */}
          {viewMode === 'days' && (
            <div>
              {/* Encabezado de Días de la Semana */}
              <div className="grid grid-cols-7 gap-1 mb-1.5 text-center">
                {WEEKDAYS.map((w, idx) => (
                  <span
                    key={w}
                    className={`text-[11px] font-semibold py-1 select-none ${
                      idx >= 5 ? 'text-slate-400/80 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {w}
                  </span>
                ))}
              </div>

              {/* Matriz de Días */}
              <div className="grid grid-cols-7 gap-1">
                {calendarGrid.map((item, idx) => {
                  const isSelected = isSameDay(item.ymd, selectedYMD)
                  const isToday = item.ymd === todayYMD
                  const isDimmed = !item.isCurrentMonth

                  const isDisabled =
                    (min && item.ymd < min) ||
                    (max && item.ymd > max)

                  return (
                    <button
                      key={`${item.ymd}-${idx}`}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => handleSelectDay(item.ymd)}
                      className={`relative h-8 sm:h-9 w-full rounded-xl text-xs font-medium flex items-center justify-center transition-all duration-100 cursor-pointer
                        ${isDisabled ? 'opacity-25 cursor-not-allowed text-slate-400' : ''}
                        ${
                          isSelected
                            ? 'bg-[#00363D] dark:bg-blue-600 text-white font-bold shadow-sm scale-100 z-10'
                            : isDimmed
                            ? 'text-slate-300 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400'
                        }`}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      <span>{item.dayNumber}</span>
                      {isToday && !isSelected && (
                        <span className="absolute bottom-1 w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400" />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Acciones Rápidas Inferiores */}
              {quickPresets && (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleQuickYesterday}
                      className="px-2 py-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-medium cursor-pointer"
                    >
                      Ayer
                    </button>
                    <button
                      type="button"
                      onClick={handleQuickToday}
                      className="px-2 py-1 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors font-semibold cursor-pointer"
                    >
                      Hoy
                    </button>
                  </div>

                  {selectedYMD && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="px-2 py-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
/* ── Componente de Rango: DateRangePicker ────────────────────── */
/* ═══════════════════════════════════════════════════════════════ */
export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRangeChange,
  min,
  max,
  disabled = false,
  className = '',
  size = 'md',
  showPresets = true
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredDate, setHoveredDate] = useState(null)
  const containerRef = useRef(null)
  const popoverRef = useRef(null)

  const startYMD = useMemo(() => formatToYMD(startDate), [startDate])
  const endYMD = useMemo(() => formatToYMD(endDate), [endDate])

  // Fecha base para mostrar en el calendario
  const [viewDate, setViewDate] = useState(() => {
    return parseFromYMD(startYMD) || new Date()
  })

  // Preset seleccionado actual (si coincide)
  const presets = useMemo(() => getStandardPresets(), [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target)
      ) {
        setIsOpen(false)
        setHoveredDate(null)
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setHoveredDate(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Despachar cambios de rango
  const emitRange = (newStart, newEnd) => {
    if (onRangeChange) {
      onRangeChange({ startDate: newStart, endDate: newEnd })
    }
    if (onStartDateChange) {
      const ev = { target: { value: newStart }, value: newStart }
      onStartDateChange(ev, newStart)
    }
    if (onEndDateChange) {
      const ev = { target: { value: newEnd }, value: newEnd }
      onEndDateChange(ev, newEnd)
    }
  }

  // Lógica de clic de día en rango (primer clic define inicio, segundo define fin)
  const handleDayClick = (ymdStr) => {
    if (!startYMD || (startYMD && endYMD)) {
      // Iniciar nuevo rango
      emitRange(ymdStr, '')
    } else if (startYMD && !endYMD) {
      // Segundo clic: ordenar si es anterior
      if (ymdStr < startYMD) {
        emitRange(ymdStr, startYMD)
      } else {
        emitRange(startYMD, ymdStr)
      }
      setIsOpen(false)
    }
  }

  const handleApplyPreset = (p) => {
    emitRange(p.start, p.end)
    const d = parseFromYMD(p.start)
    if (d) setViewDate(d)
    setIsOpen(false)
  }

  // Generar cuadrícula del mes
  const calendarGrid = useMemo(() => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()

    const firstDay = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    let startingDayOfWeek = firstDay.getDay()
    const mondayOffset = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1

    const days = []
    const prevMonthDays = new Date(year, month, 0).getDate()
    for (let i = mondayOffset - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      const dateObj = new Date(year, month - 1, d)
      days.push({ dayNumber: d, ymd: formatToYMD(dateObj), isCurrentMonth: false })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d)
      days.push({ dayNumber: d, ymd: formatToYMD(dateObj), isCurrentMonth: true })
    }

    const remaining = (7 - (days.length % 7)) % 7
    for (let d = 1; d <= remaining; d++) {
      const dateObj = new Date(year, month + 1, d)
      days.push({ dayNumber: d, ymd: formatToYMD(dateObj), isCurrentMonth: false })
    }

    return days
  }, [viewDate])

  const displayText = useMemo(() => {
    if (startYMD && endYMD) {
      return `${formatFriendlyDisplay(startYMD)} — ${formatFriendlyDisplay(endYMD)}`
    }
    if (startYMD) {
      return `Desde ${formatFriendlyDisplay(startYMD)} (Elige fin)`
    }
    return 'Seleccionar rango de fechas'
  }, [startYMD, endYMD])

  const effectiveEnd = endYMD || (startYMD && hoveredDate && hoveredDate > startYMD ? hoveredDate : null)

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Botón Disparador del Rango */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl border transition-all text-xs sm:text-sm font-medium cursor-pointer shadow-xs
          ${isOpen ? 'ring-2 ring-blue-500/20 border-blue-500 dark:border-blue-400' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}
          bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>{displayText}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover con Presets + Calendario */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute z-50 mt-2 left-0 sm:left-auto sm:right-0 w-[320px] sm:w-[540px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 shadow-2xl overflow-hidden p-4 flex flex-col sm:flex-row gap-4 animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Sidebar de Presets */}
          {showPresets && (
            <div className="sm:w-44 border-b sm:border-b-0 sm:border-r border-slate-100 dark:border-slate-800 pb-3 sm:pb-0 sm:pr-3 flex flex-col gap-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-2">
                Accesos Rápidos
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-1 gap-1">
                {presets.map((p) => {
                  const isActive = startYMD === p.start && endYMD === p.end
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleApplyPreset(p)}
                      className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-between ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{p.label}</span>
                      {isActive && <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Área del Calendario */}
          <div className="flex-1">
            {/* Header Mes / Año */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Días semana */}
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {WEEKDAYS.map(w => (
                <span key={w} className="text-[11px] font-semibold text-slate-400 py-1">
                  {w}
                </span>
              ))}
            </div>

            {/* Días con Range Highlighting */}
            <div className="grid grid-cols-7 gap-y-1 gap-x-0.5">
              {calendarGrid.map((item, idx) => {
                const isStart = isSameDay(item.ymd, startYMD)
                const isEnd = isSameDay(item.ymd, effectiveEnd)
                const inRange = isDateInRange(item.ymd, startYMD, effectiveEnd)
                const isDimmed = !item.isCurrentMonth

                let bgClasses = ''
                if (isStart && isEnd) {
                  bgClasses = 'bg-[#00363D] dark:bg-blue-600 text-white font-bold rounded-xl shadow-xs'
                } else if (isStart) {
                  bgClasses = 'bg-[#00363D] dark:bg-blue-600 text-white font-bold rounded-l-xl'
                } else if (isEnd) {
                  bgClasses = 'bg-[#00363D] dark:bg-blue-600 text-white font-bold rounded-r-xl'
                } else if (inRange) {
                  bgClasses = 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200'
                } else {
                  bgClasses = isDimmed
                    ? 'text-slate-300 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl'
                }

                return (
                  <button
                    key={`${item.ymd}-${idx}`}
                    type="button"
                    onClick={() => handleDayClick(item.ymd)}
                    onMouseEnter={() => setHoveredDate(item.ymd)}
                    className={`h-8 w-full text-xs font-medium flex items-center justify-center transition-colors cursor-pointer ${bgClasses}`}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {item.dayNumber}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
