/**
 * AttendanceErrors.ts
 * Jerarquía de errores tipados para el Attendance Engine.
 */

export class AttendanceError extends Error {
  public readonly code: string

  constructor(message: string, code: string = 'ATTENDANCE_ERROR') {
    super(message)
    this.code = code
    this.name = 'AttendanceError'
  }
}

export class InvalidTimezoneError extends AttendanceError {
  constructor(timezone: string) {
    super(`Zona horaria inválida o no soportada: "${timezone}"`, 'INVALID_TIMEZONE')
    this.name = 'InvalidTimezoneError'
  }
}

export class InvalidPunchError extends AttendanceError {
  constructor(message: string) {
    super(message, 'INVALID_PUNCH')
    this.name = 'InvalidPunchError'
  }
}

export class TenantMismatchError extends AttendanceError {
  constructor(expectedTenant: string, receivedTenant: string) {
    super(
      `Violación de aislamiento multi-tenant: se esperaba clienteId "${expectedTenant}" pero se recibió "${receivedTenant}"`,
      'TENANT_MISMATCH'
    )
    this.name = 'TenantMismatchError'
  }
}

export class ShiftConfigurationError extends AttendanceError {
  constructor(message: string) {
    super(message, 'SHIFT_CONFIG_ERROR')
    this.name = 'ShiftConfigurationError'
  }
}
