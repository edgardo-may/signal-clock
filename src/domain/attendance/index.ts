/**
 * index.ts
 * Punto de entrada del dominio de Asistencia (Attendance Engine).
 *
 * Módulo: Cumplimiento Laboral México 2027
 */

export * from './AttendanceTypes.ts'
export * from './AttendanceErrors.ts'
export * from './timezoneUtils.ts'
export * from './AttendanceNormalizer.ts'
export * from './ShiftMatcher.ts'
export * from './WorkdayCalculator.ts'
export * from './IncidentDetector.ts'
export * from './WorkdayIntegrityHasher.ts'
export * from './AttendanceEngine.ts'
