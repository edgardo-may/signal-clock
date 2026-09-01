# 01 - Arquitectura General del Módulo de Cumplimiento Laboral México 2027

> **Sistema:** Signum-Clock / Signal-Clock  
> **Fase:** Fase 1 — Attendance Engine  
> **Estado:** Implementado y Verificado  

---

## 1. Visión y Principios de Diseño

El Módulo de Cumplimiento Laboral México 2027 transforma Signum-Clock en una plataforma integral de:
1. **Control de Asistencia Biométrico (Dual Protocol ADMS + ISUP 5.0)**
2. **Registro Electrónico de Jornada Inmutable**
3. **Motor de Cumplimiento Legal (Reducción gradual 48h → 40h LFT)**
4. **Auditoría e Integridad Criptográfica**
5. **Correcciones Justificadas y Aceptación de Trabajadores**
6. **Expediente Digital de Inspección STPS**
7. **Prenómina y Exportador Modular (CONTPAQi)**

### Principios Fundamentales
- **Desacoplamiento Total:** La lógica de cálculo reside en la capa de dominio puro (`src/domain/attendance/`) sin dependencias de React, DOM ni bases de datos.
- **Inmutabilidad de Evidencia Cruda:** `attendance_logs` se mantiene estrictamente como evidencia RAW. Ninguna corrección o recálculo modifica o elimina registros de marcaje crudo.
- **Determinismo e Idempotencia:** Procesar la misma jornada N veces produce exactamente el mismo resultado y el mismo hash de integridad SHA-256.
- **Conciencia de Zona Horaria:** Toda fecha, hora de entrada, salida, turno nocturno y corte de jornada se calcula con respecto a la zona horaria efectiva del centro de trabajo (ej. `America/Mexico_City`, `America/Cancun`, `America/Merida`, `America/Tijuana`).
- **Aislamiento Multi-Tenant:** Validación estricta en cada capa para garantizar que los datos de un tenant nunca se mezclen con los de otro.

---

## 2. Flujo de Datos

```
[Biométrico ZKTeco / Hikvision / Kiosko]
                 │
                 ▼ (Marcaje Inmutable)
        attendance_logs (RAW)
                 │
                 ▼
     AttendanceNormalizer
     - Deduplicación (Anti-rebote / Ráfagas)
     - Conversión a Timezone Efectiva
                 │
                 ▼
          ShiftMatcher
     - Shift-Window Matching (Tolerancias ±2h/±3h)
     - Detección de Turnos Nocturnos y Cruce de Medianoche
                 │
                 ▼
        WorkdayCalculator
     - Segmentos de Trabajo y Descansos
     - Minutos Efectivos, Retardo, Salida Anticipada
     - Inyección desacoplada de LaborRuleProvider
                 │
                 ▼
         IncidentDetector
     - LATE, EARLY_LEAVE, MISSING_ENTRY, MISSING_EXIT, ABSENT
     - OVERTIME_DETECTED, HOLIDAY_WORK, REST_DAY_WORK
                 │
                 ▼
      WorkdayIntegrityHasher
     - Generación de Hash SHA-256 Canónico
                 │
                 ▼
      WorkdayCalculationResult
```
