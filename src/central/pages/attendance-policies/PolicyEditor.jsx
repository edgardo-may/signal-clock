/**
 * PolicyEditor.jsx — Editor de configuración de política de asistencia
 * Signum Clock Central — Módulo: Políticas de Asistencia
 *
 * Permite configurar y guardar/publicar las reglas de retardos, faltas,
 * horas extras, salidas anticipadas y vigencia para la empresa seleccionada.
 */
import { useState } from 'react'
import {
  ArrowLeft,
  Save,
  Upload,
  Info,
  History,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Building2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  MOCK_POLICY_STATES,
  MOCK_PERIOD_OPTIONS,
  MOCK_LATE_ACTION_OPTIONS,
  MOCK_EARLY_EXIT_ACTION_OPTIONS,
  MOCK_INCIDENT_ACTION_OPTIONS,
} from './mockData'
import PolicySection from './PolicySection'
import { DatePicker } from '../../../shared/components/ui'
import PolicyVersionHistory from './PolicyVersionHistory'
import { saveCompanyPolicy } from './policyService'

/* ── Tokens de UI ─────────────────────────────────────────── */
const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all placeholder:text-slate-400'

const selectClass =
  'w-full px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all appearance-none cursor-pointer'

const numberClass =
  'w-24 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:border-[#03363D] focus:ring-1 focus:ring-[#03363D]/30 transition-all tabular-nums text-center font-medium'

/* ── Subcomponentes locales ───────────────────────────────── */

function FieldLabel({ children, htmlFor }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
    >
      {children}
    </label>
  )
}

function SwitchRow({ label, description, checked, onChange, id }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#03363D]/40 ${
          checked ? 'bg-[#03363D] dark:bg-teal-600' : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

function MinuteField({ id, value, onChange, label, unit = 'minutos' }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
      <div className="flex-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={0}
          value={value === undefined || value === null ? '' : value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className={numberClass}
        />
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[50px]">{unit}</span>
      </div>
    </div>
  )
}

function HintBox({ children }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-teal-50/70 dark:bg-teal-950/20 border border-teal-200/60 dark:border-teal-800/40">
      <Info className="w-4 h-4 text-[#03363D] dark:text-teal-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-[#03363D] dark:text-teal-300 leading-relaxed">{children}</p>
    </div>
  )
}

function RadioOption({ id, value, selected, onChange, label, recommended }) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
        selected
          ? 'border-[#03363D] bg-[#03363D]/5 dark:border-teal-400 dark:bg-teal-400/10 shadow-xs'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'
      }`}
    >
      <input
        type="radio"
        id={id}
        name="accionIncidencia"
        value={value}
        checked={selected}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      <span
        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          selected
            ? 'border-[#03363D] dark:border-teal-400'
            : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {selected && (
          <span className="w-2 h-2 rounded-full bg-[#03363D] dark:bg-teal-400 block" />
        )}
      </span>
      <span className="text-sm font-medium text-slate-800 dark:text-slate-200 flex-1">{label}</span>
      {recommended && (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-[#03363D] dark:bg-teal-900/40 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
          Recomendado
        </span>
      )}
    </label>
  )
}

/* ── Componente principal ─────────────────────────────────── */
export default function PolicyEditor({ entry, onBack, onSaveSuccess }) {
  const [currentEntry, setCurrentEntry] = useState(entry)
  const [config, setConfig] = useState({
    nombrePolitica: entry.politica !== '—' && entry.politica !== 'Sin configurar' ? entry.politica : 'Política General de Asistencia',
    ...entry.config,
  })
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const stateInfo = MOCK_POLICY_STATES[currentEntry.estado] || MOCK_POLICY_STATES.unconfigured

  function update(key, value) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave(isPublish = false) {
    setSaving(true)
    try {
      const updated = saveCompanyPolicy(currentEntry.clienteId, currentEntry, config, isPublish)
      setCurrentEntry(updated)
      if (onSaveSuccess) {
        onSaveSuccess(updated)
      }
      if (isPublish) {
        toast.success(`Política publicada con éxito (Versión v${updated.version})`)
      } else {
        toast.success('Borrador guardado con éxito')
      }
    } catch (err) {
      console.error('[PolicyEditor] Error al guardar:', err)
      toast.error('Error al guardar la política: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header del Editor ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors mt-0.5"
            aria-label="Volver al listado"
            title="Volver al listado de empresas"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
                {currentEntry.empresa}
              </h2>
              {currentEntry.idEmpresa && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  ID: #{currentEntry.idEmpresa}
                </span>
              )}
            </div>
            <div className="flex items-center flex-wrap gap-2 mt-1.5">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {config.nombrePolitica || 'Política de Asistencia'}
              </span>
              {currentEntry.version && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 tabular-nums">
                  v{currentEntry.version}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${stateInfo.badge}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateInfo.dot}`} />
                {stateInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          <button
            id="btn-save-draft"
            type="button"
            disabled={saving}
            onClick={() => handleSave(false)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-xs disabled:opacity-50"
          >
            <Save className="w-4 h-4 text-slate-500" />
            <span>Guardar borrador</span>
          </button>
          <button
            id="btn-publish-policy"
            type="button"
            disabled={saving}
            onClick={() => handleSave(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#03363D] hover:bg-[#03363D]/90 dark:bg-teal-600 dark:hover:bg-teal-700 transition-all shadow-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>Publicar versión</span>
          </button>
        </div>
      </div>

      {/* ── Banner Informativo ── */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
        <CheckCircle2 className="w-4 h-4 text-[#03363D] dark:text-teal-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <p>
            Configurando reglas para la empresa <strong className="text-slate-900 dark:text-white">{currentEntry.empresa}</strong>.
            Puedes ajustar tolerancias, retardos y acumulación para faltas automáticas. Al hacer clic en <strong>Publicar versión</strong>, la regla entra en vigor de forma activa e incrementa el versionado.
          </p>
        </div>
      </div>

      {/* ── Formulario de Configuración ── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 shadow-xs">

        {/* IDENTIFICACIÓN DE LA POLÍTICA */}
        <div>
          <FieldLabel htmlFor="nombrePolitica">Nombre descriptivo de la política</FieldLabel>
          <input
            id="nombrePolitica"
            type="text"
            value={config.nombrePolitica || ''}
            onChange={(e) => update('nombrePolitica', e.target.value)}
            placeholder="Ej. Política General Planta, Horario Comercial, etc."
            className={inputClass}
          />
        </div>

        {/* SECCIÓN 1 — JORNADA Y TOLERANCIAS */}
        <PolicySection title="Jornada y tolerancias">
          <MinuteField
            id="toleranciaEntrada"
            label="Tolerancia de entrada al turno"
            value={config.toleranciaEntrada}
            onChange={(v) => update('toleranciaEntrada', v)}
          />
          <MinuteField
            id="toleranciaSalidaAnticipada"
            label="Tolerancia de salida anticipada"
            value={config.toleranciaSalidaAnticipada}
            onChange={(v) => update('toleranciaSalidaAnticipada', v)}
          />
          <MinuteField
            id="minimoHorasExtra"
            label="Tiempo mínimo posterior al turno para considerar horas extra"
            value={config.minimoHorasExtra}
            onChange={(v) => update('minimoHorasExtra', v)}
          />
        </PolicySection>

        {/* SECCIÓN 2 — RETARDOS */}
        <PolicySection title="Reglas de retardos">
          <SwitchRow
            id="generarRetardo"
            label="Generar retardo automáticamente"
            description="Si el colaborador entra después del tiempo de tolerancia, se genera un registro de retardo."
            checked={config.generarRetardo}
            onChange={(v) => update('generarRetardo', v)}
          />
          {config.generarRetardo && (
            <MinuteField
              id="retardoDesde"
              label="Generar retardo a partir del minuto"
              value={config.retardoDesde}
              onChange={(v) => update('retardoDesde', v)}
            />
          )}
          <SwitchRow
            id="retardoGraveHabilitado"
            label="Retardo mayor / grave"
            description="Si la llegada tarde excede este umbral, el sistema clasificará el registro como retardo grave."
            checked={config.retardoGraveHabilitado}
            onChange={(v) => update('retardoGraveHabilitado', v)}
          />
          {config.retardoGraveHabilitado && (
            <MinuteField
              id="retardoGraveDesde"
              label="Aplicar retardo grave después de"
              value={config.retardoGraveDesde}
              onChange={(v) => update('retardoGraveDesde', v)}
            />
          )}
        </PolicySection>

        {/* SECCIÓN 3 — ACUMULACIÓN DE RETARDOS Y FALTAS */}
        <PolicySection title="Acumulación de retardos y generación de faltas">
          <SwitchRow
            id="acumularRetardos"
            label="Convertir retardos acumulados en falta"
            description="Aplica una acción automática (como generar falta) cuando el colaborador alcance cierta cantidad de retardos."
            checked={config.acumularRetardos}
            onChange={(v) => update('acumularRetardos', v)}
          />
          {config.acumularRetardos && (
            <div className="space-y-4 pt-2">
              <MinuteField
                id="acumularCantidad"
                label="Cantidad de retardos acumulados"
                value={config.acumularCantidad}
                unit="retardos"
                onChange={(v) => update('acumularCantidad', v)}
              />
              <div>
                <FieldLabel htmlFor="acumularPeriodo">Periodo de conteo de retardos</FieldLabel>
                <div className="relative">
                  <select
                    id="acumularPeriodo"
                    value={config.acumularPeriodo}
                    onChange={(e) => update('acumularPeriodo', e.target.value)}
                    className={selectClass}
                  >
                    {MOCK_PERIOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              {config.acumularPeriodo === 'rolling' && (
                <MinuteField
                  id="acumularDiasMoviles"
                  label="Ventana de días móviles"
                  value={config.acumularDiasMoviles}
                  unit="días"
                  onChange={(v) => update('acumularDiasMoviles', v)}
                />
              )}
              <div>
                <FieldLabel htmlFor="acumularResultado">Acción al alcanzar la cantidad de retardos</FieldLabel>
                <div className="relative">
                  <select
                    id="acumularResultado"
                    value={config.acumularResultado}
                    onChange={(e) => update('acumularResultado', e.target.value)}
                    className={selectClass}
                  >
                    {MOCK_LATE_ACTION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>
          )}
        </PolicySection>

        {/* SECCIÓN 4 — SALIDAS ANTICIPADAS */}
        <PolicySection title="Salidas anticipadas">
          <SwitchRow
            id="detectarSalidaAnticipada"
            label="Detectar salida antes del fin de turno"
            checked={config.detectarSalidaAnticipada}
            onChange={(v) => update('detectarSalidaAnticipada', v)}
          />
          {config.detectarSalidaAnticipada && (
            <div className="space-y-4 pt-2">
              <MinuteField
                id="salidaAnticipadaDesde"
                label="Considerar salida anticipada a partir de"
                value={config.salidaAnticipadaDesde}
                unit="minutos antes"
                onChange={(v) => update('salidaAnticipadaDesde', v)}
              />
              <div>
                <FieldLabel htmlFor="salidaAnticipadaAccion">Acción ante salida anticipada</FieldLabel>
                <div className="relative">
                  <select
                    id="salidaAnticipadaAccion"
                    value={config.salidaAnticipadaAccion}
                    onChange={(e) => update('salidaAnticipadaAccion', e.target.value)}
                    className={selectClass}
                  >
                    {MOCK_EARLY_EXIT_ACTION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>
          )}
        </PolicySection>

        {/* SECCIÓN 5 — HORAS EXTRAS */}
        <PolicySection title="Horas extras">
          <SwitchRow
            id="detectarHorasExtra"
            label="Detectar horas extras automáticamente"
            description="Identifica tiempo laborado posterior al fin del turno establecido."
            checked={config.detectarHorasExtra}
            onChange={(v) => update('detectarHorasExtra', v)}
          />
          {config.detectarHorasExtra && (
            <div className="space-y-4 pt-2">
              <MinuteField
                id="horasExtraMinimo"
                label="Mínimo de minutos para contabilizar horas extra"
                value={config.horasExtraMinimo}
                onChange={(v) => update('horasExtraMinimo', v)}
              />
              <SwitchRow
                id="horasExtraRequiereAutorizacion"
                label="Requiere autorización previa de RH"
                description="Las horas extra detectadas quedan en estado pendiente hasta su aprobación por Recursos Humanos."
                checked={config.horasExtraRequiereAutorizacion}
                onChange={(v) => update('horasExtraRequiereAutorizacion', v)}
              />
            </div>
          )}
        </PolicySection>

        {/* SECCIÓN 6 — ACCIONES AUTOMÁTICAS E INCIDENCIAS */}
        <PolicySection title="Tratamiento de incidencias">
          <div className="space-y-2.5">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              ¿Cómo debe registrar el sistema las incidencias generadas automáticamente?
            </p>
            {MOCK_INCIDENT_ACTION_OPTIONS.map((opt) => (
              <RadioOption
                key={opt.value}
                id={`accionIncidencia-${opt.value}`}
                value={opt.value}
                label={opt.label}
                selected={config.accionIncidencia === opt.value}
                onChange={(v) => update('accionIncidencia', v)}
                recommended={opt.value === 'pending'}
              />
            ))}
          </div>
          <HintBox>
            La opción recomendada crea incidencias en estado <strong>pendiente</strong> para que el equipo de RH mantenga el control y pueda autorizar o justificar antes de nómina.
          </HintBox>
        </PolicySection>

        {/* SECCIÓN 7 — VIGENCIA */}
        <PolicySection title="Vigencia de la política">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="vigenteDesde">Vigente desde</FieldLabel>
              <DatePicker
                id="vigenteDesde"
                value={config.vigenteDesde}
                onChange={(e) => update('vigenteDesde', e.target.value)}
                placeholder="Selecciona fecha de inicio"
              />
            </div>
            <div>
              <FieldLabel htmlFor="vigenteHasta">Vigente hasta (opcional)</FieldLabel>
              <DatePicker
                id="vigenteHasta"
                value={config.vigenteHasta}
                onChange={(e) => update('vigenteHasta', e.target.value)}
                placeholder="Sin fecha de fin (indefinida)"
              />
            </div>
          </div>
        </PolicySection>

      </div>

      {/* ── Historial de versiones ── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#03363D] dark:text-teal-400" />
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Historial de versiones publicadas
            </h4>
            {currentEntry.historial?.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 tabular-nums">
                {currentEntry.historial.length}
              </span>
            )}
          </div>
          {showHistory ? (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
          )}
        </button>
        {showHistory && (
          <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-800 pt-4">
            <PolicyVersionHistory historial={currentEntry.historial} />
          </div>
        )}
      </div>

    </div>
  )
}
