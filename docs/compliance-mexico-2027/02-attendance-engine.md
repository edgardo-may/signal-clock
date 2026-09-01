# 02 - Attendance Engine (Motor de Procesamiento de Asistencia)

> **Paquete:** `src/domain/attendance/`  
> **Fase:** Fase 1 — Implementado  

---

## 1. Módulos y Responsabilidades

| Archivo | Responsabilidad |
| :--- | :--- |
| `AttendanceTypes.ts` | Definiciones de tipos, interfaces de dominio, segmentos, incidencias y resultado consolidado `WorkdayCalculationResult`. |
| `AttendanceErrors.ts` | Jerarquía de errores tipados (`InvalidTimezoneError`, `TenantMismatchError`, `InvalidPunchError`, `ShiftConfigurationError`). |
| `timezoneUtils.ts` | Conversión y cálculo de componentes temporales locales y UTC independientes del host/servidor. |
| `AttendanceNormalizer.ts` | Normalización de marcajes de distintas fuentes (ADMS, ISUP, Kiosko, Web, Manual), ordenamiento cronológico y deduplicación inteligente anti-ráfaga. |
| `ShiftMatcher.ts` | Algoritmo de emparejamiento con ventana operativa del turno, soporte de cruce de medianoche y turnos nocturnos. |
| `WorkdayCalculator.ts` | Cálculo de segmentos (`WORK`, `BREAK`), tiempos efectivos, retardos según tolerancia, salidas anticipadas y minutos nocturnos. |
| `IncidentDetector.ts` | Detección automática e idempotente de incidencias (`LATE`, `ABSENT`, `INCOMPLETE`, `OVERTIME_DETECTED`, `HOLIDAY_WORK`, `REST_DAY_WORK`). |
| `WorkdayIntegrityHasher.ts` | Generador de hash SHA-256 sobre la representación canónica de la jornada para control de integridad y snapshot. |
| `AttendanceEngine.ts` | Orquestador principal que coordina el pipeline y expone el método estático `process(...)` y la clase `AttendanceEngine`. |

---

## 2. Salida del Motor (`WorkdayCalculationResult`)

```typescript
export interface WorkdayCalculationResult {
  clienteId: string
  empleadoId: string
  operativeDate: string // YYYY-MM-DD
  timezone: string

  scheduleId?: string
  shiftType: 'DIURNA' | 'NOCTURNA' | 'MIXTA' | 'ESPECIAL'
  isRestDay: boolean
  isHoliday: boolean
  holidayName?: string

  scheduledStart?: string
  scheduledEnd?: string
  scheduledMinutes: number

  actualStart?: string
  actualEnd?: string

  workedMinutes: number
  breakMinutes: number
  effectiveMinutes: number

  lateMinutes: number
  earlyLeaveMinutes: number
  ordinaryMinutes: number
  overtimeMinutes: number
  nightShiftMinutes: number

  status: WorkdayStatus
  missingEntry: boolean
  missingExit: boolean

  segments: WorkdaySegment[]
  sourceLogIds: string[]
  devicesInvolved: string[]

  warnings: string[]
  incidents: WorkdayIncident[]

  calculationVersion: number
  integrityHash: string // SHA-256
}
```
