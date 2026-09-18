'use strict'

// Internal backend composition marker. This module has no RPC client and no
// write implementation; it lets SHADOW depend on the orchestration contract
// without loading the persistence service module.
const PERSISTENCE_SERVICE_BRAND = Symbol('signum.workdayPersistenceService')

function isApprovedWorkdayPersistenceService(value) {
  return Boolean(value && value[PERSISTENCE_SERVICE_BRAND] === true && typeof value.persist === 'function')
}

module.exports = {
  PERSISTENCE_SERVICE_BRAND,
  isApprovedWorkdayPersistenceService,
}
