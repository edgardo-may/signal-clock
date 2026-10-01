'use strict'

class CalculationVersionError extends Error {
  constructor(version) {
    super('La implementación de cálculo requerida no está disponible.')
    this.code = 'CALCULATION_VERSION_UNAVAILABLE'
    this.expected_version = version
  }
}

// The production registry has exactly one real implementation. A semantic
// version is never an alias for the currently loaded implementation.
const productionEngines = new Map([[3, Object.freeze({
  calculationVersion: 3,
  calculate(domain, match, timezone, options) {
    return domain.WorkdayCalculator.calculate(match, timezone, options)
  },
})]])

function getCalculationEngine(version) {
  const engine = productionEngines.get(version)
  if (!engine) throw new CalculationVersionError(version)
  return engine
}

module.exports = { getCalculationEngine, CalculationVersionError }
